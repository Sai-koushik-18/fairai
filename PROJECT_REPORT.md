# FairAI — Technical Report

An audit tool for detecting and mitigating bias in automated decision datasets.
Built for Google Solution Challenge 2026, Problem Statement 4 (Unbiased AI Decision).

This document describes what was built, the fairness methodology behind it, the
defects found while validating it, and the limitations that remain. It assumes
familiarity with supervised classification and basic fairness terminology.

---

## 1. What the system does

A user uploads a CSV of past decisions — who was hired, approved, admitted. The
system answers three questions:

1. **Is there a disparity?** Measured across a chosen demographic column.
2. **What is driving it?** Which features the decision model relies on.
3. **Does mitigation help, and what does it cost?** A reweighted model compared
   against the baseline on identical held-out data.

The workflow is: upload → detect columns → audit → inspect feature influence →
generate remediation guidance (Gemini) → apply mitigation → export a weighted
training set.

## 2. Architecture

```
React 18 SPA  ──HTTP──>  Flask API  ──>  pandas validation
(Recharts,                               Fairlearn metrics
 react-dropzone)                         scikit-learn model
                                         Google Gemini API
```

| Layer | Implementation |
|---|---|
| Frontend | React 18, Recharts, react-dropzone, axios — ~1,080 lines |
| Backend | Flask + Flask-CORS, 8 REST endpoints — ~1,040 lines |
| Fairness | Fairlearn 0.10.0 |
| Model | scikit-learn 1.5.1, RandomForestClassifier |
| LLM | Google Gemini via `google-generativeai` |
| Hosting | Render (Flask backend, gunicorn) and Vercel (static frontend) |

Endpoints: `/` `/config` `/columns` `/analyze` `/suggest` `/fix` `/chat` `/repair`.

Pinned to Python 3.12 — `numpy==1.26.4` publishes no wheels for 3.13+, so the
setup scripts refuse to build a virtualenv on an unsupported interpreter rather
than failing opaquely during `pip install`.

## 3. Fairness methodology

### 3.1 Column detection

Sensitive columns are matched against a keyword list (gender, race, caste,
religion, region, age, …) constrained to 2–20 distinct values. Identifier
columns are excluded by name pattern and by a uniqueness ratio above 0.95, so
`employee_id` is never offered as a demographic group.

Outcome detection matches a separate keyword list, **skipping any column that
already looks sensitive** — see §4.2.

### 3.2 Metrics

Three metrics, two of which improve downward and one upward:

| Metric | Definition | Optimum |
|---|---|---|
| Demographic parity difference | `max_g P(Ŷ=1 \| A=g) − min_g P(Ŷ=1 \| A=g)` | 0 |
| Disparate impact ratio | `min_g P(Ŷ=1 \| A=g) ÷ max_g P(Ŷ=1 \| A=g)` | 1.0 |
| Equalized odds difference | larger of the TPR gap and FPR gap across groups | 0 |

Disparate impact carries legal weight: the US EEOC four-fifths rule treats a
ratio below 0.80 as evidence of adverse impact. The UI marks that threshold and
states each metric's direction, because presenting three numbers that move in
opposite directions without that label invites misreading.

### 3.3 Two distinct measurements

The system reports fairness at two levels, and keeps them separate:

- **Dataset level** — computed from the recorded outcomes across every row. No
  model involved. This answers "is the historical record itself skewed?"
- **Model level** — computed from predictions on a held-out test split. This
  answers "does a model trained on this reproduce the skew?"

Conflating these was the most serious defect found (§4.1).

### 3.4 Audit model

A RandomForestClassifier (`n_estimators=30`, `max_depth=8`, `random_state=42`)
on a stratified 70/30 split. Deliberately small: the model exists to reveal
which features drive decisions and to provide a mitigation baseline, not to be
a production classifier. The fixed seed makes every reported figure reproducible.

Categorical features are label-encoded; the outcome and any system-generated
helper column are excluded from the feature set (§4.4).

### 3.5 Mitigation — reweighing

Pre-processing reweighing (Kamiran & Calders). Each row receives

```
w(g, o) = [ P(group = g) × P(outcome = o) ] / P(group = g, outcome = o)
```

normalised to mean 1, then passed as `sample_weight` during training. Rows from
under-selected group/outcome combinations gain influence; over-represented
combinations lose it. On the sample dataset weights range 0.670–1.660 and change
4 of 90 test predictions.

The labels are never rewritten. Nothing fabricates outcomes.

## 4. Defects found during validation

The system was validated by driving the real UI in a browser and comparing every
figure against an independent scikit-learn/Fairlearn harness. Six defects
surfaced that unit tests on the happy path would not have caught.

### 4.1 Before and after were measured on different populations

**Severity: high — this inflated the headline result.**

"Before" demographic parity and disparate impact were computed from raw labels
across all rows. "After" came from model predictions on the 30% test split. The
comparison therefore set a property of the *dataset* against a property of a
*model*.

On the sample data the reported gain was 0.213 → 0.095. Measured consistently it
is 0.146 → 0.095 — the improvement was overstated by 0.067 of 0.118, roughly
**57%**. On the Adult Income dataset, by 0.054. Equalized odds was unaffected,
being prediction-based on both sides already.

**Fix:** both models now pass through one `score_predictions()` function on the
same evaluation split. Dataset-level figures are still shown, labelled as
describing the data rather than any model.

### 4.2 A demographic column could be selected as the outcome

The outcome keyword `"status"` is a substring of `marital_status`, so that
column was chosen as *both* the sensitive attribute and the decision outcome —
which either errors out or produces a meaningless audit. Any dataset with a
`marital_status` column hit this.

**Fix:** outcome detection skips columns matching the sensitive keyword list. A
demographic attribute is never the decision being audited.

### 4.3 A model predicting one class scored as perfectly fair

On an imbalanced dataset (~11% positive) the model predicted the negative class
for all 3,000 test rows. With no variance, every fairness metric collapses to
its optimum: parity 0.0, equalized odds 0.0, severity "Low", green badge.

A model that approves nobody is trivially fair and completely useless. It was
being presented as a clean bill of health.

**Fix:** if the positive prediction rate falls below 1% or above 99%, severity
becomes "Unreliable" (never green) and the UI explains why the scores are not
meaningful.

### 4.4 Outcome leakage through the repaired export

The repaired CSV carried two generated columns: a normalised copy of the outcome
and the fairness weight. Re-uploading that file fed both back as **features**.
The copy of the outcome *is* the answer, so the model scored by reading it:

| Feature | Importance before fix | After fix |
|---|---|---|
| `hired_normalized` | 0.5238 | excluded |
| `fairai_fairness_weight` | 0.3824 | excluded |
| `skills_score` | 0.0345 | 0.4204 |

90% of model importance was system artefacts. Equalized odds read 0.0 — the
signature of a model predicting perfectly — and mitigation appeared to fail.

**Fix:** feature selection excludes the outcome, its normalised twin, and the
weight column, in both the audit and mitigation paths. The normalised copy is
now written only when the outcome genuinely needs converting, not when it is
already binary.

### 4.5 Model quality was never measured

No accuracy, precision or recall anywhere in the codebase. A fairness tool that
reports only fairness implies mitigation is free. It is not: on Adult Income,
recall falls from 0.542 to 0.462 while parity improves — the mitigated model
misses substantially more genuinely qualified candidates.

**Fix:** all three are computed for both models on the same split and displayed
beneath the fairness comparison, with the trade-off stated explicitly.

### 4.6 Unhandled crash on a header-only CSV

A CSV with headers and no rows produced an unhandled `IndexError` and a 500.
**Fix:** validated at the CSV reader, so every endpoint returns a 400 with a
readable message.

### 4.7 Also corrected

- All three hardcoded Gemini model names had been retired server-side. `/suggest`
  exceeded the frontend's 45-second timeout. Benchmarking available models
  (2.9s to 147s) and reordering the fallback chain brought it to 2.3s.
- `repair` presented dataset cleaning in a way that implied the bias had been
  removed. The outcomes are untouched; the fix lives in the weight column and
  only materialises if that column is used during training. The UI now says so.

## 5. Results

Measured on identical held-out rows, baseline versus reweighted.

**`sample_hiring_data.csv`** — 300 rows, gender / hired

| | Parity ↓ | Disparate impact ↑ | Equalized odds ↓ | Accuracy | Precision | Recall |
|---|---|---|---|---|---|---|
| Dataset | 0.213 | 0.751 | — | — | — | — |
| Baseline model | 0.146 | 0.845 | 0.182 | 0.678 | 0.747 | 0.868 |
| Mitigated | **0.095** | **0.899** | **0.140** | 0.678 | 0.741 | 0.882 |

Selection rates: Female 64.2%, Male 85.5%. Disparate impact moves from failing
the 0.80 threshold to passing it, at no accuracy cost.

**`adult_income.csv`** — 10,000 rows from UCI Adult, sex / income

| | Parity ↓ | Disparate impact ↑ | Accuracy | Precision | Recall |
|---|---|---|---|---|---|
| Dataset | 0.198 | 0.340 | — | — | — |
| Baseline model | 0.144 | 0.309 | 0.858 | 0.787 | 0.542 |
| Mitigated | **0.061** | **0.600** | 0.851 | 0.823 | **0.462** |

A much larger fairness gain, and a visible cost: recall drops 8 points. This is
the honest shape of fairness work, and the tool now shows it rather than hiding
it.

Validation datasets come from the Fairlearn benchmark suite, so the figures are
reproducible against published baselines.

## 6. Known limitations

Stated explicitly rather than discovered by a reviewer:

1. **Reweighing is effective for binary groups only.** On a 5-category race
   column, parity moved 0.168 → 0.169. The weights balance group/outcome pairs
   but the classifier still optimises overall accuracy, so multi-class gaps do
   not close. Demonstrations should use a two-group attribute.
2. **One mitigation technique.** No adversarial debiasing, no post-processing
   threshold optimisation, no comparison between methods.
3. **The audit model is small and fixed.** Appropriate for explanation, not a
   claim about what a tuned production model would do.
4. **No intersectional analysis.** Groups are audited one attribute at a time;
   disparities affecting, say, women in rural regions specifically are invisible.
5. **12,000-row analysis cap**, sampled with a fixed seed. Larger datasets are
   audited on a subsample.
6. **Correlation, not causation.** Feature importance shows what the model
   relies on, not what causes the disparity. A proxy variable and a legitimate
   predictor are indistinguishable to the method.

## 7. Engineering practice

- Every figure in this report was produced by running the real system and
  cross-checked against an independent harness built directly on scikit-learn
  and Fairlearn.
- The UI was validated by automated browser runs at 1920×1080 and 1440×900,
  driving the full workflow and asserting zero console and network errors.
- Fixed random seeds throughout, so results are reproducible.
- Secrets are kept out of version control; the API key lives in a gitignored
  `.env` and the repository is scanned for credential patterns before each push.

## 8. What distinguishes this work

The measurable part is not that a bias audit was built — Fairlearn provides the
metrics. It is that the implementation was **adversarially validated against
itself**, and that the validation found real methodological errors: a 57%
overstatement of its own headline result, a data-leakage path that made a
useless model look perfect, and a degenerate-model case that scored maximum
fairness for a classifier that approved nobody.

Each of those would have survived a demo. The tool now reports a smaller
improvement than it originally claimed, and that is the point — the number it
reports is one that withstands scrutiny.
