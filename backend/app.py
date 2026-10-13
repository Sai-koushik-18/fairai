from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import pandas as pd
import numpy as np
from fairlearn.metrics import demographic_parity_difference, equalized_odds_difference
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import google.generativeai as genai
import os
import json
import io
import re

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024
MAX_UPLOAD_SIZE_BYTES = app.config["MAX_CONTENT_LENGTH"]


def max_upload_size_mb():
    return int(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))


def validate_uploaded_file(file):
    if file is None:
        return "No file uploaded"
    filename = (file.filename or "").strip()
    if not filename:
        return "Uploaded file is missing a filename."
    if not filename.lower().endswith(".csv"):
        return "Please upload a CSV file."

    current_position = file.stream.tell()
    file.stream.seek(0, os.SEEK_END)
    size_bytes = file.stream.tell()
    file.stream.seek(current_position)

    if size_bytes > MAX_UPLOAD_SIZE_BYTES:
        return (
            f"File is too large ({round(size_bytes / (1024 * 1024), 1)} MB). "
            f"Please upload a CSV smaller than {max_upload_size_mb()} MB."
        )
    return None

def load_local_env_value(key_name):
    search_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), "..", "frontend", ".env")
    ]
    for path in search_paths:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                for line in handle:
                    stripped = line.strip()
                    if not stripped or stripped.startswith("#") or "=" not in stripped:
                        continue
                    name, value = stripped.split("=", 1)
                    if name.strip() == key_name:
                        return value.strip().strip('"').strip("'")
        except OSError:
            continue
    return ""


def get_gemini_api_key():
    return (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or load_local_env_value("GEMINI_API_KEY")
    )


def gemini_status():
    api_key = get_gemini_api_key()
    if not api_key or api_key == "YOUR_GEMINI_API_KEY_HERE":
        return {
            "configured": False,
            "message": "Gemini API key was not found in the backend environment or local .env files."
        }
    if len(api_key) < 20:
        return {
            "configured": False,
            "message": "Gemini API key looks incomplete. Paste the full key and restart the backend."
        }
    return {
        "configured": True,
        "message": "Gemini API key detected. Live AI suggestions are available."
    }


def configure_gemini():
    status = gemini_status()
    if status["configured"]:
        genai.configure(api_key=get_gemini_api_key())
    return status


configure_gemini()

MAX_PROFILE_ROWS = 3000
MAX_ANALYSIS_ROWS = 12000
MAX_SAMPLE_ROWS = 6


def gemini_ready():
    return gemini_status()["configured"]


def read_csv_upload(file, max_rows=None):
    raw = file.read()
    last_error = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(
                io.BytesIO(raw),
                encoding=encoding,
                nrows=max_rows,
                low_memory=False
            )
            df.columns = [str(col).strip() for col in df.columns]
            df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
            if df.columns.empty:
                return None, "This CSV has no usable columns. Please upload a file with a header row and data."
            if df.empty:
                return None, "This CSV has headers but no data rows."
            return df, None
        except Exception as exc:
            last_error = exc
    return None, f"Could not read CSV: {last_error}"


def is_identifier_column(series):
    normalized = series.dropna()
    if normalized.empty:
        return False
    unique_ratio = normalized.nunique(dropna=True) / max(len(normalized), 1)
    name_like = str(series.name).strip().lower()
    if any(token in name_like for token in ("id", "uuid", "email", "phone", "mobile", "name")):
        return True
    return unique_ratio > 0.95


def detect_sensitive_columns(df):
    sensitive_keywords = [
        "gender", "sex", "race", "ethnicity", "caste", "religion", "age",
        "nationality", "region", "district", "zip", "pincode", "marital",
        "disability", "language", "community", "minority", "location"
    ]
    found = []
    for col in df.columns:
        col_lower = col.lower()
        unique_count = df[col].nunique(dropna=True)
        if is_identifier_column(df[col]):
            continue
        if any(keyword in col_lower for keyword in sensitive_keywords) and 2 <= unique_count <= 20:
            found.append(col)
    if found:
        return found

    fallback = []
    for col in df.columns:
        unique_count = df[col].nunique(dropna=True)
        if 2 <= unique_count <= 12 and not is_identifier_column(df[col]):
            fallback.append(col)
    return fallback[:5]


def detect_outcome_column(df):
    outcome_keywords = [
        "hired", "selected", "approved", "outcome", "result", "label",
        "target", "decision", "status", "loan", "admit", "accepted", "eligible"
    ]
    for col in df.columns:
        col_lower = col.lower()
        if any(keyword in col_lower for keyword in outcome_keywords):
            return col
    candidate_cols = []
    for col in df.columns:
        unique_count = df[col].nunique(dropna=True)
        if 2 <= unique_count <= 5 and not is_identifier_column(df[col]):
            candidate_cols.append(col)
    if candidate_cols:
        return candidate_cols[-1]
    return df.columns[-1]


def column_profiles(df):
    profiles = []
    for col in df.columns:
        profiles.append({
            "name": col,
            "type": str(df[col].dtype),
            "unique": int(df[col].nunique(dropna=True)),
            "non_null": int(df[col].notna().sum())
        })
    return profiles


def recommend_columns(df):
    sensitive_candidates = detect_sensitive_columns(df)
    outcome_candidate = detect_outcome_column(df)

    if not sensitive_candidates:
        fallback_groups = []
        for col in df.columns:
            unique_count = df[col].nunique(dropna=True)
            if 2 <= unique_count <= 10 and not is_identifier_column(df[col]) and col != outcome_candidate:
                fallback_groups.append(col)
        sensitive_candidates = fallback_groups[:5]

    return {
        "sensitive_candidates": sensitive_candidates,
        "outcome_candidate": outcome_candidate
    }


def encode_dataframe(df):
    df_encoded = df.copy()
    for col in df_encoded.columns:
        if df_encoded[col].dtype == object:
            encoder = LabelEncoder()
            df_encoded[col] = encoder.fit_transform(df_encoded[col].astype(str).fillna("missing"))
        else:
            df_encoded[col] = pd.to_numeric(df_encoded[col], errors="coerce")
            fill_value = df_encoded[col].median() if df_encoded[col].notna().any() else 0
            df_encoded[col] = df_encoded[col].fillna(fill_value)
    return df_encoded


def to_binary_outcome(series):
    positive_values = {
        "1", "true", "yes", "y", "hired", "hire", "approved", "approve",
        "selected", "select", "pass", "accepted", "accept", "positive",
        "eligible", "admitted", "success"
    }
    negative_values = {
        "0", "false", "no", "n", "not hired", "rejected", "reject",
        "denied", "deny", "not selected", "fail", "declined", "negative",
        "ineligible", "not admitted"
    }

    if pd.api.types.is_numeric_dtype(series):
        values = pd.to_numeric(series, errors="coerce").fillna(0)
        unique_values = set(values.dropna().unique().tolist())
        if unique_values.issubset({0, 1}):
            return values.astype(int)
        return (values > values.median()).astype(int)

    normalized = series.astype(str).str.strip().str.lower()
    mapped = normalized.map(
        lambda value: 1 if value in positive_values else (0 if value in negative_values else np.nan)
    )

    if mapped.isna().any():
        encoded = LabelEncoder().fit_transform(normalized)
        fallback = (encoded > np.median(encoded)).astype(int)
        mapped = mapped.fillna(pd.Series(fallback, index=series.index))

    return mapped.astype(int)


def severity_from_dpd(dpd):
    if dpd >= 0.2:
        return "High", "red"
    if dpd >= 0.1:
        return "Medium", "amber"
    return "Low", "green"


def safe_train_test_split(X, y):
    stratify = y if y.nunique() == 2 and y.value_counts().min() >= 2 else None
    return train_test_split(X, y, test_size=0.3, random_state=42, stratify=stratify)


def compute_bias_metrics(df, sensitive_col, outcome_col):
    if sensitive_col == outcome_col:
        return None, "Sensitive column and outcome column must be different."
    if sensitive_col not in df.columns or outcome_col not in df.columns:
        return None, "Selected columns were not found in this dataset."

    df = df.dropna(subset=[sensitive_col, outcome_col]).copy()
    if len(df) < 20:
        return None, "Dataset must have at least 20 usable rows."
    if df[sensitive_col].nunique(dropna=True) < 2:
        return None, "Sensitive column must contain at least two groups."
    if df[sensitive_col].nunique(dropna=True) > 50:
        return None, "Sensitive column has too many unique values. Choose a group column, not an ID column."

    y = to_binary_outcome(df[outcome_col])
    if y.nunique() < 2:
        return None, "Outcome column must contain at least two classes, such as 0/1, yes/no, approved/rejected."

    group_rates = {}
    for group in df[sensitive_col].dropna().unique().tolist():
        mask = df[sensitive_col] == group
        group_rates[str(group)] = round(float(y.loc[mask].mean()) * 100, 1)

    actual_rates = [rate / 100 for rate in group_rates.values()]
    dpd = max(actual_rates) - min(actual_rates) if len(actual_rates) >= 2 else 0.0
    impact_ratio = min(actual_rates) / max(actual_rates) if max(actual_rates) > 0 else 1.0

    df_encoded = encode_dataframe(df)
    feature_cols = [col for col in df_encoded.columns if col != outcome_col]
    X = df_encoded[feature_cols]

    if len(X) > MAX_ANALYSIS_ROWS:
        sample_index = X.sample(MAX_ANALYSIS_ROWS, random_state=42).index
        X = X.loc[sample_index]
        y = y.loc[sample_index]
        df_encoded = df_encoded.loc[sample_index]

    X_train, X_test, y_train, y_test = safe_train_test_split(X, y)
    sens_test = df_encoded[sensitive_col].loc[X_test.index]

    model = RandomForestClassifier(n_estimators=30, max_depth=8, random_state=42, n_jobs=1)
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    try:
        eod = abs(float(equalized_odds_difference(y_test, y_pred, sensitive_features=sens_test)))
    except Exception:
        eod = 0.0

    importances = getattr(model, "feature_importances_", np.zeros(len(feature_cols)))
    top_features = sorted(
        [{"feature": col, "importance": round(float(score), 4)}
         for col, score in zip(feature_cols, importances)],
        key=lambda item: item["importance"],
        reverse=True
    )[:8]

    severity, severity_color = severity_from_dpd(abs(dpd))
    return {
        "demographic_parity_diff": round(abs(dpd), 3),
        "equalized_odds_diff": round(eod, 3),
        "disparate_impact_ratio": round(float(impact_ratio), 3),
        "bias_severity": severity,
        "bias_severity_color": severity_color,
        "group_selection_rates": group_rates,
        "top_bias_features": top_features
    }, None


def apply_reweighing(df, sensitive_col, outcome_col):
    if sensitive_col == outcome_col:
        raise ValueError("Sensitive column and outcome column must be different.")

    df = df.dropna(subset=[sensitive_col, outcome_col]).copy()
    df_encoded = encode_dataframe(df)
    y = to_binary_outcome(df[outcome_col])
    sens = df_encoded[sensitive_col]
    feature_cols = [col for col in df_encoded.columns if col != outcome_col]
    X = df_encoded[feature_cols]

    total = len(df)
    group_counts = sens.value_counts()
    outcome_counts = y.value_counts()
    joint_counts = pd.crosstab(sens, y)

    weights = []
    for group, outcome in zip(sens, y):
        expected = group_counts[group] * outcome_counts[outcome] / total
        observed = joint_counts.loc[group, outcome]
        weights.append(expected / observed if observed else 1.0)
    weights = pd.Series(weights, index=df.index)
    weights = weights / weights.mean()

    if len(X) > MAX_ANALYSIS_ROWS:
        sample_index = X.sample(MAX_ANALYSIS_ROWS, random_state=42).index
        X = X.loc[sample_index]
        y = y.loc[sample_index]
        sens = sens.loc[sample_index]
        weights = weights.loc[sample_index]

    X_train, X_test, y_train, y_test = safe_train_test_split(X, y)
    w_train = weights.loc[X_train.index]
    sens_test = sens.loc[X_test.index]

    model = RandomForestClassifier(n_estimators=30, max_depth=8, random_state=42, n_jobs=1)
    model.fit(X_train, y_train, sample_weight=w_train)
    y_pred = model.predict(X_test)

    try:
        dpd_after = abs(float(demographic_parity_difference(y_test, y_pred, sensitive_features=sens_test)))
    except Exception:
        dpd_after = 0.0
    try:
        eod_after = abs(float(equalized_odds_difference(y_test, y_pred, sensitive_features=sens_test)))
    except Exception:
        eod_after = 0.0

    group_pred_rates = []
    for group in sens_test.unique():
        mask = sens_test == group
        group_pred_rates.append(float(y_pred[mask].mean()))
    impact_after = min(group_pred_rates) / max(group_pred_rates) if group_pred_rates and max(group_pred_rates) > 0 else 1.0

    severity, severity_color = severity_from_dpd(dpd_after)
    return {
        "demographic_parity_diff": round(dpd_after, 3),
        "equalized_odds_diff": round(eod_after, 3),
        "disparate_impact_ratio": round(float(impact_after), 3),
        "bias_severity": severity,
        "bias_severity_color": severity_color
    }


def fallback_suggestions():
    return {
        "source": "fallback",
        "fixes": [
            {
                "type": "Data Fix",
                "title": "Rebalance underrepresented groups",
                "description": "Collect more examples from groups with lower selection rates and audit labels for historical bias. Track selection rate gaps before retraining.",
                "impact": "20-30% bias reduction"
            },
            {
                "type": "Model Fix",
                "title": "Train with fairness constraints",
                "description": "Use Fairlearn mitigation methods such as reweighing or demographic parity constraints. Compare fairness metrics before shipping the model.",
                "impact": "30-50% bias reduction"
            },
            {
                "type": "Process Fix",
                "title": "Add human review and blind screening",
                "description": "Hide sensitive attributes during early review and require manual review for borderline automated decisions. Keep an audit log for accountability.",
                "impact": "15-25% bias reduction"
            }
        ],
        "summary": "Gemini is not available right now, so FairAI is showing offline fairness recommendations."
    }


def get_gemini_suggestions(bias_data, dataset_type="hiring"):
    try:
        status = configure_gemini()
        if not status["configured"]:
            fallback = fallback_suggestions()
            fallback["summary"] = status["message"]
            return fallback

        groups = bias_data.get("group_selection_rates", {})
        groups_str = ", ".join([f"{group}: {rate}%" for group, rate in groups.items()])
        top_features = ", ".join([item["feature"] for item in bias_data.get("top_bias_features", [])[:4]])

        prompt = f"""You are an AI fairness expert helping a Google Solution Challenge prototype.
Return only valid JSON.

Dataset type: {dataset_type}
Demographic parity difference: {bias_data.get('demographic_parity_diff')}
Disparate impact ratio: {bias_data.get('disparate_impact_ratio')}
Equalized odds difference: {bias_data.get('equalized_odds_diff')}
Bias severity: {bias_data.get('bias_severity')}
Group selection rates: {groups_str}
Top decision features: {top_features}

JSON schema:
{{
  "source": "gemini",
  "summary": "one sentence",
  "fixes": [
    {{"type": "Data Fix", "title": "short title", "description": "2 sentences", "impact": "expected improvement"}},
    {{"type": "Model Fix", "title": "short title", "description": "2 sentences", "impact": "expected improvement"}},
    {{"type": "Process Fix", "title": "short title", "description": "2 sentences", "impact": "expected improvement"}}
  ]
}}"""

        # Ordered fastest-first. The frontend gives up after 45s, so a slow
        # model is worse than a slightly weaker one. Benchmarked on this
        # workload: flash-lite ~3s, flash-latest ~17s, gemini-3.5-flash ~147s.
        candidate_models = [
            "gemini-3.1-flash-lite",
            "gemini-flash-lite-latest",
            "gemini-flash-latest"
        ]
        response = None
        last_error = None
        for model_name in candidate_models:
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                if response:
                    break
            except Exception as exc:
                last_error = exc

        if response is None:
            raise last_error or RuntimeError("No Gemini model returned a response.")

        raw = response.text.strip().replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        parsed["source"] = parsed.get("source", "gemini")
        return parsed
    except Exception as exc:
        fallback = fallback_suggestions()
        fallback["summary"] = f"Gemini request failed, so offline guidance is being shown instead. Details: {exc}"
        return fallback



def estimate_fairness_weights(df, sensitive_col, outcome_col):
    df = df.dropna(subset=[sensitive_col, outcome_col]).copy()
    if df.empty:
        return pd.Series(dtype=float)

    encoded_sensitive = df[sensitive_col].astype(str).fillna("missing")
    binary_outcome = to_binary_outcome(df[outcome_col])
    total_rows = len(df)
    group_counts = encoded_sensitive.value_counts()
    outcome_counts = binary_outcome.value_counts()
    joint_counts = pd.crosstab(encoded_sensitive, binary_outcome)

    weights = []
    for group_value, outcome_value in zip(encoded_sensitive, binary_outcome):
        expected = group_counts[group_value] * outcome_counts[outcome_value] / total_rows
        observed = joint_counts.loc[group_value, outcome_value]
        weights.append(expected / observed if observed else 1.0)

    result = pd.Series(weights, index=df.index, dtype=float)
    return result / result.mean()


def repair_dataset(df, sensitive_col="", outcome_col=""):
    cleaned = df.copy()
    repair_notes = []

    duplicate_count = int(cleaned.duplicated().sum())
    if duplicate_count:
        cleaned = cleaned.drop_duplicates().copy()
        repair_notes.append(f"Removed {duplicate_count} duplicate rows.")

    numeric_columns = cleaned.select_dtypes(include=[np.number]).columns.tolist()
    categorical_columns = [column for column in cleaned.columns if column not in numeric_columns]

    for column in numeric_columns:
        missing_count = int(cleaned[column].isna().sum())
        if missing_count:
            fill_value = cleaned[column].median() if cleaned[column].notna().any() else 0
            cleaned[column] = cleaned[column].fillna(fill_value)
            repair_notes.append(f"Filled {missing_count} missing values in numeric column '{column}'.")

    for column in categorical_columns:
        missing_count = int(cleaned[column].isna().sum())
        if missing_count:
            mode = cleaned[column].mode(dropna=True)
            fill_value = mode.iloc[0] if not mode.empty else "missing"
            cleaned[column] = cleaned[column].fillna(fill_value)
            repair_notes.append(f"Filled {missing_count} missing values in categorical column '{column}'.")

    identifier_columns = [column for column in cleaned.columns if is_identifier_column(cleaned[column])]
    if identifier_columns:
        repair_notes.append(
            "Flagged identifier-like columns for caution: " + ", ".join(identifier_columns[:6])
        )

    normalized_outcome_column = ""
    if outcome_col and outcome_col in cleaned.columns:
        normalized_outcome_column = f"{outcome_col}_normalized"
        cleaned[normalized_outcome_column] = to_binary_outcome(cleaned[outcome_col]).astype(int)
        repair_notes.append(f"Added normalized binary outcome column '{normalized_outcome_column}'.")

    fairness_weight_column = ""
    if (
        sensitive_col
        and outcome_col
        and sensitive_col in cleaned.columns
        and outcome_col in cleaned.columns
        and cleaned[sensitive_col].nunique(dropna=True) >= 2
    ):
        try:
            fairness_weight_column = "fairai_fairness_weight"
            weights = estimate_fairness_weights(cleaned, sensitive_col, outcome_col)
            cleaned.loc[weights.index, fairness_weight_column] = weights.round(4)
            repair_notes.append(
                "Added a fairness weight column to support rebalanced model training."
            )
        except Exception:
            fairness_weight_column = ""

    if not repair_notes:
        repair_notes.append("No structural issues were found, so the dataset was preserved.")

    return {
        "cleaned_df": cleaned,
        "repair_notes": repair_notes,
        "identifier_columns": identifier_columns,
        "normalized_outcome_column": normalized_outcome_column,
        "fairness_weight_column": fairness_weight_column
    }


def guess_dataset_type(filename, columns):
    text = f"{filename} " + " ".join(columns)
    normalized = text.lower()
    if any(token in normalized for token in ("loan", "credit", "cash")):
        return "loan approval"
    if any(token in normalized for token in ("patient", "medical", "health")):
        return "healthcare"
    return "hiring"


def fallback_chat_answer(message, context):
    bias_metrics = context.get("bias_metrics") or {}
    dataset_info = context.get("dataset_info") or {}
    summary_bits = []

    if bias_metrics:
        summary_bits.append(
            f"Current demographic parity difference is {bias_metrics.get('demographic_parity_diff', 'n/a')}"
        )
        summary_bits.append(
            f"and disparate impact ratio is {bias_metrics.get('disparate_impact_ratio', 'n/a')}."
        )
    else:
        summary_bits.append("No audit result is loaded yet.")

    if dataset_info:
        summary_bits.append(
            f"The current dataset has {dataset_info.get('rows', 'unknown')} rows and {len(dataset_info.get('columns', []))} columns."
        )

    return {
        "source": "fallback",
        "answer": (
            "FairAI assistant is answering in offline mode. "
            + " ".join(summary_bits)
            + " Ask about risky columns, fairness metrics, mitigation, or how to prepare a cleaner dataset."
        )
    }


def get_chat_response(message, context):
    cleaned_message = re.sub(r"\s+", " ", str(message or "")).strip()
    if not cleaned_message:
        return {
            "source": "fallback",
            "answer": "Ask a question about the audit, risky columns, or how to improve the dataset."
        }

    try:
        status = configure_gemini()
        if not status["configured"]:
            return fallback_chat_answer(cleaned_message, context)

        prompt = f"""You are FairAI, a fairness audit assistant.
Answer the user's question in clear English.
Keep the answer under 140 words.
If the user asks for certainty, do not promise perfect accuracy.
Focus on fairness, risky columns, mitigation, and downloadable repaired data.

Context JSON:
{json.dumps(context, ensure_ascii=True)}

User question:
{cleaned_message}

Return only valid JSON using this schema:
{{
  "source": "gemini",
  "answer": "short helpful answer"
}}"""

        # Ordered fastest-first. The frontend gives up after 45s, so a slow
        # model is worse than a slightly weaker one. Benchmarked on this
        # workload: flash-lite ~3s, flash-latest ~17s, gemini-3.5-flash ~147s.
        candidate_models = [
            "gemini-3.1-flash-lite",
            "gemini-flash-lite-latest",
            "gemini-flash-latest"
        ]
        response = None
        last_error = None
        for model_name in candidate_models:
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                if response:
                    break
            except Exception as exc:
                last_error = exc

        if response is None:
            raise last_error or RuntimeError("No Gemini model returned a response.")

        raw = response.text.strip().replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        parsed["source"] = parsed.get("source", "gemini")
        return parsed
    except Exception:
        return fallback_chat_answer(cleaned_message, context)
def build_dataset_info(df, sensitive_col, outcome_col, filename):
    recommendations = recommend_columns(df)
    return {
        "filename": filename,
        "rows": int(len(df)),
        "columns": list(df.columns),
        "column_profiles": column_profiles(df),
        "sensitive_column": sensitive_col,
        "outcome_column": outcome_col,
        "sensitive_candidates": recommendations["sensitive_candidates"],
        "outcome_candidate": recommendations["outcome_candidate"]
    }


@app.route("/", methods=["GET"])
def health():
    return jsonify({
        "status": "FairAI API running",
        "version": "1.1.0",
        "gemini_configured": gemini_ready(),
        "max_profile_rows": MAX_PROFILE_ROWS,
        "max_analysis_rows": MAX_ANALYSIS_ROWS
    })


@app.route("/columns", methods=["POST"])
def get_columns():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["file"]
    file_error = validate_uploaded_file(file)
    if file_error:
        return jsonify({"error": file_error}), 400

    df, read_error = read_csv_upload(file, max_rows=MAX_PROFILE_ROWS)
    if read_error:
        return jsonify({"error": read_error}), 400
    recommendations = recommend_columns(df)
    return jsonify({
        "columns": list(df.columns),
        "column_profiles": column_profiles(df),
        "sensitive_candidates": recommendations["sensitive_candidates"],
        "outcome_candidate": recommendations["outcome_candidate"],
        "sample_rows": df.head(MAX_SAMPLE_ROWS).fillna("").to_dict(orient="records")
    })


@app.route("/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    file_error = validate_uploaded_file(file)
    if file_error:
        return jsonify({"error": file_error}), 400

    df, read_error = read_csv_upload(file, max_rows=MAX_ANALYSIS_ROWS)
    if read_error:
        return jsonify({"error": read_error}), 400

    sensitive_col = request.form.get("sensitive_col") or ""
    outcome_col = request.form.get("outcome_col") or ""
    recommendations = recommend_columns(df)
    sensitive_candidates = recommendations["sensitive_candidates"]

    if not sensitive_col or sensitive_col not in df.columns:
        sensitive_col = sensitive_candidates[0] if sensitive_candidates else df.columns[0]
    if not outcome_col or outcome_col not in df.columns:
        outcome_col = recommendations["outcome_candidate"]

    metrics, error = compute_bias_metrics(df, sensitive_col, outcome_col)
    if error:
        return jsonify({
            "error": error,
            "dataset_info": build_dataset_info(df, sensitive_col, outcome_col, file.filename)
        }), 400

    return jsonify({
        "status": "success",
        "dataset_info": build_dataset_info(df, sensitive_col, outcome_col, file.filename),
        "bias_metrics": metrics
    })


@app.route("/suggest", methods=["POST"])
def suggest():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    suggestions = get_gemini_suggestions(
        data.get("bias_metrics", {}),
        data.get("dataset_type", "hiring")
    )
    return jsonify({"status": "success", "suggestions": suggestions})


@app.route("/config", methods=["GET"])
def config():
    status = gemini_status()
    return jsonify({
        "gemini_configured": status["configured"],
        "gemini_message": status["message"],
        "suggestion_mode": "gemini" if status["configured"] else "offline",
        "limits": {
            "profile_rows": MAX_PROFILE_ROWS,
            "analysis_rows": MAX_ANALYSIS_ROWS
        }
    })


@app.route("/fix", methods=["POST"])
def fix():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    file_error = validate_uploaded_file(file)
    if file_error:
        return jsonify({"error": file_error}), 400

    df, read_error = read_csv_upload(file, max_rows=MAX_ANALYSIS_ROWS)
    if read_error:
        return jsonify({"error": read_error}), 400

    sensitive_col = request.form.get("sensitive_col", "")
    outcome_col = request.form.get("outcome_col", "")
    if not sensitive_col or sensitive_col not in df.columns:
        candidates = detect_sensitive_columns(df)
        sensitive_col = candidates[0] if candidates else df.columns[0]
    if not outcome_col or outcome_col not in df.columns:
        outcome_col = detect_outcome_column(df)

    try:
        improved = apply_reweighing(df, sensitive_col, outcome_col)
        return jsonify({"status": "success", "improved_metrics": improved})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400



@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No chat payload provided"}), 400

    answer = get_chat_response(
        data.get("message", ""),
        {
            "dataset_info": data.get("dataset_info", {}),
            "bias_metrics": data.get("bias_metrics", {}),
            "repair_summary": data.get("repair_summary", {})
        }
    )
    return jsonify({"status": "success", "reply": answer})


@app.route("/repair", methods=["POST"])
def repair():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    file_error = validate_uploaded_file(file)
    if file_error:
        return jsonify({"error": file_error}), 400

    df, read_error = read_csv_upload(file, max_rows=MAX_ANALYSIS_ROWS)
    if read_error:
        return jsonify({"error": read_error}), 400

    sensitive_col = request.form.get("sensitive_col", "")
    outcome_col = request.form.get("outcome_col", "")
    if not sensitive_col or sensitive_col not in df.columns:
        candidates = detect_sensitive_columns(df)
        sensitive_col = candidates[0] if candidates else ""
    if not outcome_col or outcome_col not in df.columns:
        outcome_col = detect_outcome_column(df) if len(df.columns) else ""

    repair_result = repair_dataset(df, sensitive_col, outcome_col)
    cleaned_df = repair_result["cleaned_df"]

    before_metrics, after_metrics = None, None
    if sensitive_col and outcome_col:
        before_metrics, _ = compute_bias_metrics(df, sensitive_col, outcome_col)

        # The repair adds helper columns (a normalized copy of the outcome and a
        # fairness weight). Scoring on those would leak the outcome into the
        # features, so evaluate on the original columns only.
        helper_cols = [
            repair_result["normalized_outcome_column"],
            repair_result["fairness_weight_column"]
        ]
        scored_df = cleaned_df.drop(
            columns=[col for col in helper_cols if col and col in cleaned_df.columns]
        )

        # The repaired export is meant to be trained with its fairness weights,
        # so report the fairness those weights actually deliver.
        try:
            after_metrics = apply_reweighing(scored_df, sensitive_col, outcome_col)
        except Exception:
            after_metrics, _ = compute_bias_metrics(scored_df, sensitive_col, outcome_col)

    csv_bytes = cleaned_df.to_csv(index=False).encode("utf-8")
    filename_root = os.path.splitext(file.filename)[0] or "dataset"
    download_name = f"{filename_root}_repaired.csv"

    if request.form.get("download") == "true":
        return Response(
            csv_bytes,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={download_name}"}
        )

    return jsonify({
        "status": "success",
        "dataset_type": guess_dataset_type(file.filename, list(cleaned_df.columns)),
        "download_name": download_name,
        "repair_summary": {
            "notes": repair_result["repair_notes"],
            "identifier_columns": repair_result["identifier_columns"],
            "normalized_outcome_column": repair_result["normalized_outcome_column"],
            "fairness_weight_column": repair_result["fairness_weight_column"],
            "rows_before": int(len(df)),
            "rows_after": int(len(cleaned_df))
        },
        "before_metrics": before_metrics,
        "after_metrics": after_metrics,
        "csv_text": csv_bytes.decode("utf-8")
    })

if __name__ == "__main__":
    app.run(
        debug=os.environ.get("FLASK_DEBUG", "").lower() == "true",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "5000"))
    )




