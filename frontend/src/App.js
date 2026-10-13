import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";

const API_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://YOUR_CLOUD_RUN_URL"
    : "http://localhost:5000");
const api = axios.create({ baseURL: API_URL, timeout: 45000 });
const chartColors = ["#89a8ff", "#76dbc0", "#f3c97a", "#f49d92", "#a8bbff", "#9fd5ff"];

const severityClass = (severity) => `status-pill ${String(severity || "Low").toLowerCase()}`;

function MetricCard({ label, value, helper, severity, direction, scale }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <b className={severityClass(severity)}>{severity} bias</b>
      </div>
      <strong>{value}</strong>
      {direction && (
        <div className="metric-direction">
          <span className="metric-arrow">{direction === "lower" ? "↓" : "↑"}</span>
          <span>{direction === "lower" ? "Lower is better" : "Higher is better"}</span>
          <em>{scale}</em>
        </div>
      )}
      <p>{helper}</p>
    </article>
  );
}

function FixCard({ fix }) {
  return (
    <article className="fix-card">
      <span>{fix.type}</span>
      <h4>{fix.title}</h4>
      <p>{fix.description}</p>
      <b>{fix.impact}</b>
    </article>
  );
}

function createDataset(file, index) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    file,
    status: "profiling",
    columns: [],
    columnProfiles: [],
    sampleRows: [],
    sensitive: "",
    outcome: "",
    result: null,
    fixed: null,
    repair: null,
    suggestions: null,
    chatMessages: [
      {
        role: "assistant",
        text: "Ask about the bias result, risky columns, or how to prepare a cleaner downloadable dataset."
      }
    ],
    error: "",
    message: "Reading dataset structure..."
  };
}

function fileSize(file) {
  if (!file) return "";
  const sizeMb = file.size / (1024 * 1024);
  return sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`;
}

function statusMessage(status) {
  const map = {
    profiling: "Profiling",
    ready: "Ready",
    analyzing: "Auditing",
    done: "Completed",
    suggesting: "Generating",
    fixing: "Mitigating",
    repairing: "Repairing",
    chatting: "Replying",
    error: "Error"
  };
  return map[status] || status;
}

function validationMessage(dataset) {
  if (!dataset) return "";
  if (!dataset.columns.length) return "Columns are still loading. Wait for profiling to finish.";
  if (!dataset.sensitive || !dataset.outcome) return "Choose both a group column and an outcome column.";
  if (dataset.sensitive === dataset.outcome) return "Group column and outcome column must be different.";
  return "";
}

function suggestedColumns(dataset) {
  if (!dataset?.columnProfiles?.length) return [];
  return dataset.columnProfiles
    .filter((profile) => profile.unique >= 2 && profile.unique <= 12)
    .slice(0, 4)
    .map((profile) => profile.name);
}

function metricSeverity(metricName, value) {
  if (metricName === "disparateImpact") {
    if (value < 0.6) return "High";
    if (value < 0.8) return "Medium";
    return "Low";
  }
  if (value >= 0.2) return "High";
  if (value >= 0.1) return "Medium";
  return "Low";
}

export default function App() {
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [workspaceMode, setWorkspaceMode] = useState("home");
  const [chatInput, setChatInput] = useState("");
  const [showAllRepairNotes, setShowAllRepairNotes] = useState(false);
  const [config, setConfig] = useState({
    gemini_configured: false,
    gemini_message: "Gemini is not configured yet.",
    suggestion_mode: "offline",
    limits: {}
  });

  useEffect(() => {
    api.get("/config").then((response) => setConfig(response.data)).catch(() => {});
  }, []);

  const active = useMemo(
    () => datasets.find((dataset) => dataset.id === activeId) || datasets[0],
    [datasets, activeId]
  );

  const updateDataset = (id, patch) => {
    setDatasets((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const appendChatMessage = (id, message) => {
    setDatasets((items) =>
      items.map((item) => (
        item.id === id ? { ...item, chatMessages: [...item.chatMessages, message] } : item
      ))
    );
  };

  const profileDataset = async (dataset) => {
    const formData = new FormData();
    formData.append("file", dataset.file);
    try {
      const response = await api.post("/columns", formData);
      const columns = response.data.columns || [];
      const sensitiveCandidates = response.data.sensitive_candidates || [];
      updateDataset(dataset.id, {
        status: "ready",
        message: "Columns detected",
        columns,
        columnProfiles: response.data.column_profiles || [],
        sampleRows: response.data.sample_rows || [],
        sensitive: sensitiveCandidates[0] || columns[0] || "",
        outcome: response.data.outcome_candidate || columns[columns.length - 1] || "",
        error: ""
      });
    } catch (err) {
      updateDataset(dataset.id, {
        status: "error",
        message: "Could not profile dataset",
        error: err.response?.data?.error || "Could not read this CSV."
      });
    }
  };

  const onDrop = useCallback((acceptedFiles) => {
    const next = acceptedFiles.map(createDataset);
    setDatasets(next);
    setActiveId(next[0]?.id || "");
    setActiveTab("overview");
    setWorkspaceMode("home");
    next.forEach(profileDataset);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    multiple: true,
    maxFiles: 8
  });

  const analyzeOne = async (dataset) => {
    updateDataset(dataset.id, {
      status: "analyzing",
      message: "Running fairness audit",
      error: "",
      result: null,
      fixed: null,
      repair: null,
      suggestions: null
    });

    const formData = new FormData();
    formData.append("file", dataset.file);
    formData.append("sensitive_col", dataset.sensitive);
    formData.append("outcome_col", dataset.outcome);

    try {
      const response = await api.post("/analyze", formData);
      updateDataset(dataset.id, {
        status: "done",
        message: "Fairness audit completed",
        result: response.data,
        error: ""
      });
      setActiveId(dataset.id);
      setActiveTab("overview");
      setWorkspaceMode("audit");
    } catch (err) {
      updateDataset(dataset.id, {
        status: "error",
        message: "Audit failed",
        error: err.response?.data?.error || "Analysis failed. Try a different group or outcome column."
      });
    }
  };

  const getSuggestions = async () => {
    if (!active?.result) return;
    updateDataset(active.id, { status: "suggesting", message: "Generating AI guidance", error: "" });
    setWorkspaceMode("audit");
    setActiveTab("copilot");
    try {
      const response = await api.post("/suggest", {
        bias_metrics: active.result.bias_metrics,
        dataset_type: active.repair?.dataset_type || "hiring"
      });
      updateDataset(active.id, {
        status: "done",
        message: response.data.suggestions?.source === "gemini" ? "Gemini suggestions ready" : "Offline guidance ready",
        suggestions: response.data.suggestions
      });
      setActiveTab("copilot");
    } catch {
      updateDataset(active.id, { status: "done", error: "Could not generate suggestions." });
    }
  };

  const sendChat = async () => {
    if (!active || !chatInput.trim()) return;
    const message = chatInput.trim();
    appendChatMessage(active.id, { role: "user", text: message });
    setChatInput("");
    updateDataset(active.id, { status: "chatting", message: "FairAI is replying", error: "" });

    try {
      const response = await api.post("/chat", {
        message,
        dataset_info: active.result?.dataset_info || {},
        bias_metrics: active.result?.bias_metrics || {},
        repair_summary: active.repair?.repair_summary || {}
      });
      appendChatMessage(active.id, {
        role: "assistant",
        text: response.data.reply?.answer || "I could not generate a response yet."
      });
      updateDataset(active.id, { status: "done", message: "Assistant reply ready" });
    } catch {
      appendChatMessage(active.id, {
        role: "assistant",
        text: "I could not answer that right now. Try asking after you run the audit."
      });
      updateDataset(active.id, { status: "done", error: "Could not reach the assistant." });
    }
  };

  const applyFix = async () => {
    if (!active?.result) return;
    updateDataset(active.id, { status: "fixing", message: "Applying fairness mitigation", error: "" });
    const formData = new FormData();
    formData.append("file", active.file);
    formData.append("sensitive_col", active.sensitive);
    formData.append("outcome_col", active.outcome);

    try {
      const response = await api.post("/fix", formData);
      updateDataset(active.id, {
        status: "done",
        message: "Mitigation comparison ready",
        fixed: response.data.improved_metrics
      });
      setActiveTab("mitigation");
    } catch (err) {
      updateDataset(active.id, {
        status: "done",
        error: err.response?.data?.error || "Could not apply mitigation."
      });
    }
  };

  const repairDataset = async () => {
    if (!active) return;
    updateDataset(active.id, { status: "repairing", message: "Repairing and preparing download", error: "" });
    const formData = new FormData();
    formData.append("file", active.file);
    formData.append("sensitive_col", active.sensitive);
    formData.append("outcome_col", active.outcome);

    try {
      const response = await api.post("/repair", formData);
      updateDataset(active.id, {
        status: "done",
        message: "Repaired dataset ready",
        repair: response.data
      });
      setActiveTab("mitigation");
    } catch (err) {
      updateDataset(active.id, {
        status: "done",
        error: err.response?.data?.error || "Could not repair this dataset."
      });
    }
  };

  const downloadRepair = () => {
    if (!active?.repair?.csv_text) return;
    const blob = new Blob([active.repair.csv_text], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = active.repair.download_name || "fairai_repaired.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const metrics = active?.result?.bias_metrics;
  const groupRows = metrics
    ? Object.entries(metrics.group_selection_rates).map(([group, rate]) => ({ group, rate }))
    : [];
  const currentValidation = validationMessage(active);
  const canAnalyzeActive = Boolean(active?.columns?.length >= 2 && active?.sensitive && active?.outcome && !currentValidation);
  const previewColumns = active?.sampleRows?.length ? Object.keys(active.sampleRows[0]).slice(0, 5) : [];
  const columnHints = suggestedColumns(active);
  const hasActiveDataset = Boolean(active);
  const showAuditWorkspace = workspaceMode === "audit" && Boolean(active?.result);
  const repairNotes = active?.repair?.repair_summary?.notes || [];
  const visibleRepairNotes = showAllRepairNotes ? repairNotes : repairNotes.slice(0, 5);
  const hiddenRepairNotes = Math.max(repairNotes.length - visibleRepairNotes.length, 0);
  const navItems = [
    ["overview", "Overview"],
    ["features", "Signals"],
    ["copilot", "Co-pilot"],
    ["mitigation", "Repair"]
  ];

  useEffect(() => {
    setShowAllRepairNotes(false);
  }, [activeId, activeTab, active?.repair?.download_name]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand-mark">F</div>
          <div>
            <strong>FairAI</strong>
            <span>{config.gemini_configured ? "Gemini connected" : "Offline guidance"}</span>
          </div>
        </div>

        {/* The hero owns the primary upload while the workspace is empty, so
            this stays hidden until there is something to add *to*. Keeping both
            visible produced two identically labelled buttons. */}
        {datasets.length > 0 && (
          <button className="upload-button secondary" {...getRootProps()}>
            <input {...getInputProps()} />
            {isDragActive ? "Drop to add" : "+ Add dataset"}
          </button>
        )}

        <div className="sidebar-note">
          Review decision data, talk to the assistant, and ship a cleaner export.
        </div>

        <div className="dataset-list">
          {datasets.length === 0 && <p className="muted">No dataset yet.</p>}
          {datasets.map((dataset) => (
            <button
              key={dataset.id}
              className={`dataset-item ${active?.id === dataset.id ? "selected" : ""}`}
              onClick={() => {
                setActiveId(dataset.id);
                setWorkspaceMode(dataset.result ? "audit" : "home");
              }}
            >
              <div className="dataset-row">
                <strong>{dataset.file.name}</strong>
                <span>{statusMessage(dataset.status)}</span>
              </div>
              <small>{fileSize(dataset.file)} | {dataset.columns.length || 0} columns</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">FairAI workspace</span>
            <h1>Bias review with an AI-native workflow.</h1>
          </div>
          <div className="topbar-status">
            <span>{config.gemini_configured ? "Live AI suggestions enabled" : "Live AI suggestions disabled"}</span>
          </div>
        </header>

        {!showAuditWorkspace && (
        <section className="hero-assistant panel">
          <div className="hero-copy">
            <span className="eyebrow">Assistant-led audit</span>
            <h2>{hasActiveDataset ? "Talk to FairAI, then run the audit." : "Start by uploading a dataset and asking a question."}</h2>
            <p>
              {hasActiveDataset
                ? "Use the assistant like a focused audit co-pilot. It can explain the data, guide the audit, suggest fixes, and help you prepare a repaired export."
                : "FairAI works best as a chat-first audit workspace. Upload a CSV, then ask what group and outcome columns it detected and what to review first."}
            </p>
            {!hasActiveDataset && (
              <button className={`hero-upload ${isDragActive ? "is-dragging" : ""}`} {...getRootProps()}>
                <input {...getInputProps()} />
                <strong>{isDragActive ? "Drop your CSV here" : "Upload a CSV to start"}</strong>
                <span>
                  {isDragActive
                    ? "Release to load the file."
                    : "Drag a file here, or click to browse. The included sample_hiring_data.csv is a good first run."}
                </span>
              </button>
            )}
            <div className="hero-actions">
              {hasActiveDataset ? (
                <>
                  {/* "Run audit" lives in the control bar below, beside the
                      group/outcome selectors it depends on. A second copy here
                      rendered at the same time with the same label. */}
                  <button
                    className="action-button secondary"
                    disabled={!active?.result || active.status === "suggesting"}
                    onClick={getSuggestions}
                  >
                    {active?.status === "suggesting" ? "Generating..." : "Generate guidance"}
                  </button>
                  <button
                    className="action-button secondary"
                    disabled={active?.status === "repairing"}
                    onClick={repairDataset}
                  >
                    {active?.status === "repairing" ? "Repairing..." : "Repair dataset"}
                  </button>
                  <button
                    className="action-button ghost"
                    disabled={!active?.repair?.csv_text}
                    onClick={downloadRepair}
                  >
                    Download repaired CSV
                  </button>
                </>
              ) : (
                /* These are a description of the workflow, not actions. They
                   were <button>s with no handler, so "Upload a CSV" looked
                   clickable and competed with the real upload control. */
                <ol className="hero-steps">
                  <li>Upload a CSV</li>
                  <li>Review the detected columns</li>
                  <li>Run the audit</li>
                </ol>
              )}
            </div>
            {active?.result && (
              <button className="return-link" onClick={() => setWorkspaceMode("audit")}>
                Return to audit workspace
              </button>
            )}
          </div>

          <div className="hero-chat panel">
            <div className="panel-head assistant-head">
              <div>
                <h3>FairAI assistant</h3>
                <span>{config.gemini_configured ? "Gemini-backed guidance and Q&A" : "Offline assistant mode"}</span>
              </div>
              <span className="assistant-status">{config.gemini_configured ? "Live" : "Offline"}</span>
            </div>

            <div className="chat-thread hero-chat-thread">
              {(active?.chatMessages || [
                {
                  role: "assistant",
                  text: "Upload a dataset and ask what I detect. I will guide you through the audit, explain the results, and help you prepare a cleaned export."
                }
              ]).map((message, index) => (
                <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
                  <b>{message.role === "assistant" ? "FairAI" : "You"}</b>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>

            <div className="chat-form">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Ask what bias FairAI found, which columns are risky, or how to repair the dataset."
              />
              <div className="chat-actions">
                <span className="chat-hint">
                  {hasActiveDataset ? "Try asking: Which columns should I audit first?" : "Try asking: What will you check after I upload a dataset?"}
                </span>
                <button className="action-button" onClick={sendChat} disabled={!hasActiveDataset || active?.status === "chatting" || !chatInput.trim()}>
                  {active?.status === "chatting" ? "Thinking..." : "Ask"}
                </button>
              </div>
            </div>
          </div>
        </section>
        )}

        {!active && !showAuditWorkspace && (
          <section className="welcome-panel compact-welcome">
            <h2>Waiting for the first dataset</h2>
            <p>Use the upload area above. Once a file is loaded, the assistant will guide the audit from the top of the page.</p>
          </section>
        )}

        {active && !showAuditWorkspace && (
          <>
            <section className="control-bar">
              <div className="dataset-meta">
                <strong>{active.file.name}</strong>
                <span>{fileSize(active.file)} | {active.columns.length || 0} detected columns</span>
              </div>

              <label>
                Group column
                <select
                  value={active.sensitive}
                  disabled={!active.columns.length}
                  onChange={(event) => updateDataset(active.id, { sensitive: event.target.value })}
                >
                  {!active.columns.length && <option value="">No columns</option>}
                  {active.columns.map((column) => (
                    <option key={column} value={column}>{column}</option>
                  ))}
                </select>
              </label>

              <label>
                Outcome column
                <select
                  value={active.outcome}
                  disabled={!active.columns.length}
                  onChange={(event) => updateDataset(active.id, { outcome: event.target.value })}
                >
                  {!active.columns.length && <option value="">No columns</option>}
                  {active.columns.map((column) => (
                    <option key={column} value={column}>{column}</option>
                  ))}
                </select>
              </label>

              <button
                className="action-button"
                disabled={active.status === "profiling" || active.status === "analyzing" || !canAnalyzeActive}
                onClick={() => analyzeOne(active)}
              >
                {active.status === "analyzing" ? "Auditing..." : "Run audit"}
              </button>
            </section>

            {!active.result && (
              <section className="hint-row">
                <div className="hint-card">
                  <strong>Suggested group columns</strong>
                  <span>{columnHints.length ? columnHints.join(", ") : "Select a demographic or category column with a small number of unique values."}</span>
                </div>
                <div className="hint-card">
                  <strong>Current status</strong>
                  <span>{currentValidation || active.message || "Ready to run fairness audit."}</span>
                </div>
              </section>
            )}

            {active.error && <div className="error-box">{active.error}</div>}

            {!active.result && active.columnProfiles.length > 0 && (
              <section className="preview-grid">
                <div className="panel">
                  <div className="panel-head">
                    <h3>Detected columns</h3>
                    <span>{active.message}</span>
                  </div>
                  <div className="column-grid">
                    {active.columnProfiles.slice(0, 10).map((profile) => (
                      <article key={profile.name}>
                        <b>{profile.name}</b>
                        <span>{profile.type}</span>
                        <small>{profile.unique} unique values</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Sample rows</h3>
                    <span>Profile preview</span>
                  </div>
                  <div className="sample-table-wrap">
                    <table className="sample-table">
                      <thead>
                        <tr>
                          {previewColumns.map((column) => <th key={column}>{column}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {active.sampleRows.slice(0, 4).map((row, index) => (
                          <tr key={index}>
                            {previewColumns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {active.result && (
              <section className="home-audit-entry panel">
                <div>
                  <h3>Audit workspace is ready</h3>
                  <p>Open the dedicated audit view to review metrics, signals, co-pilot guidance, and repaired exports.</p>
                </div>
                <button className="action-button" onClick={() => setWorkspaceMode("audit")}>
                  Open audit workspace
                </button>
              </section>
            )}
          </>
        )}

        {showAuditWorkspace && (
          <section className="audit-shell">
            {/* Horizontal section bar. A vertical nav column here cost ~380px of
                width beside the sidebar that already exists, which squeezed the
                charts and left a dead gutter on wide screens. */}
            <header className="audit-topline">
              <div className="audit-file">
                <span className="eyebrow">Audit workspace</span>
                <strong>{active.file.name}</strong>
                <small>{fileSize(active.file)} | {active.columns.length || 0} columns</small>
              </div>
              <button className="nav-back" onClick={() => setWorkspaceMode("home")}>
                Back to assistant
              </button>
            </header>

            <nav className="audit-tabs">
              {navItems.map(([id, label]) => (
                <button
                  key={id}
                  className={`audit-tab ${activeTab === id ? "active" : ""}`}
                  onClick={() => setActiveTab(id)}
                  aria-current={activeTab === id ? "page" : undefined}
                >
                  {label}
                </button>
              ))}
            </nav>

            <section className="audit-main">
              <section className="control-bar audit-control-bar">
                <label>
                  Group column
                  <select
                    value={active.sensitive}
                    disabled={!active.columns.length}
                    onChange={(event) => updateDataset(active.id, { sensitive: event.target.value })}
                  >
                    {!active.columns.length && <option value="">No columns</option>}
                    {active.columns.map((column) => (
                      <option key={column} value={column}>{column}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Outcome column
                  <select
                    value={active.outcome}
                    disabled={!active.columns.length}
                    onChange={(event) => updateDataset(active.id, { outcome: event.target.value })}
                  >
                    {!active.columns.length && <option value="">No columns</option>}
                    {active.columns.map((column) => (
                      <option key={column} value={column}>{column}</option>
                    ))}
                  </select>
                </label>

                <button
                  className="action-button"
                  disabled={active.status === "profiling" || active.status === "analyzing" || !canAnalyzeActive}
                  onClick={() => analyzeOne(active)}
                >
                  {active.status === "analyzing" ? "Auditing..." : "Run audit"}
                </button>
              </section>

              {active.error && <div className="error-box">{active.error}</div>}

              {activeTab === "overview" && metrics && (
                <section className="stack">
                  {metrics.model_warning && (
                    <div className="model-warning">
                      <strong>Not meaningful:</strong>
                      <span>{metrics.model_warning}</span>
                    </div>
                  )}
                  <div className="metric-grid">
                    <MetricCard
                      label="Demographic parity"
                      value={metrics.demographic_parity_diff}
                      severity={metricSeverity("parity", metrics.demographic_parity_diff)}
                      direction="lower"
                      scale="0 = equal · 1 = total gap"
                      helper="How far apart the groups' selection rates are. 0.213 means one group is selected 21.3 percentage points more often."
                    />
                    <MetricCard
                      label="Disparate impact"
                      value={metrics.disparate_impact_ratio}
                      severity={metricSeverity("disparateImpact", metrics.disparate_impact_ratio)}
                      direction="higher"
                      scale="1.0 = equal · pass mark 0.80"
                      helper="The lower group's selection rate divided by the higher group's. Below 0.80 fails the US four-fifths rule."
                    />
                    <MetricCard
                      label="Equalized odds"
                      value={metrics.equalized_odds_diff}
                      severity={metricSeverity("odds", metrics.equalized_odds_diff)}
                      direction="lower"
                      scale="0 = equal error rates"
                      helper="Whether the model makes mistakes at the same rate for each group, among people who deserved the same outcome."
                    />
                  </div>

                  <p className="setup-message metric-footnote">
                    These describe the outcomes recorded in your {metrics.dataset_rows} rows, before any
                    model is involved. The Repair tab compares a model trained on this data
                    against a mitigated one, measured on the same {metrics.evaluation_rows} held-out rows.
                  </p>

                  <div className="overview-grid">
                  <div className="panel">
                    <div className="panel-head">
                      <h3>Selection rate by group</h3>
                      <span>{active.sensitive} vs {active.outcome}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={groupRows} barCategoryGap="28%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2a44" />
                        <XAxis dataKey="group" tick={{ fontSize: 12, fill: "#93a0bd" }} />
                        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: "#93a0bd" }} />
                        <Tooltip
                          formatter={(value) => [`${value}%`, "Selection rate"]}
                          cursor={{ fill: "rgba(79, 126, 255, 0.08)" }}
                          contentStyle={{
                            background: "#111926",
                            border: "1px solid #273248",
                            borderRadius: 10,
                            color: "#eef4ff"
                          }}
                        />
                        <Bar dataKey="rate" radius={[6, 6, 0, 0]} maxBarSize={96}>
                          {groupRows.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="panel">
                    <div className="panel-head">
                      <h3>Group detail</h3>
                      <span>Gap measured against the best-treated group</span>
                    </div>
                    <table className="group-table">
                      <thead>
                        <tr>
                          <th>Group</th>
                          <th>Selection rate</th>
                          <th>Gap vs best</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...groupRows].sort((a, b) => b.rate - a.rate).map(({ group, rate }, index) => {
                          const best = Math.max(...groupRows.map((r) => r.rate));
                          const gap = +(best - rate).toFixed(1);
                          return (
                            <tr key={group}>
                              <td>
                                <span className="group-swatch" style={{ background: chartColors[groupRows.findIndex((r) => r.group === group) % chartColors.length] }} />
                                {group}
                              </td>
                              <td><b>{rate}%</b></td>
                              <td className={gap > 0 ? "gap-behind" : "gap-best"}>
                                {index === 0 ? "best" : `-${gap} pts`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  </div>
                </section>
              )}

              {activeTab === "features" && metrics && (
                <section className="panel">
                  <div className="panel-head">
                    <h3>Decision signals</h3>
                    <span>Most influential features in the audit model</span>
                  </div>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart layout="vertical" data={metrics.top_bias_features} margin={{ left: 24, right: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2a44" />
                      <XAxis type="number" tick={{ fontSize: 12, fill: "#93a0bd" }} />
                      <YAxis dataKey="feature" type="category" width={170} tick={{ fontSize: 12, fill: "#dfe6f7" }} />
                      <Tooltip />
                      <Bar dataKey="importance" fill="#87aefb" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </section>
              )}

              {activeTab === "copilot" && (
                <section className="copilot-grid">
                  <div className="panel copilot-panel">
                    {!active.suggestions ? (
                      <div className="copilot-empty">
                        <h3>Generate AI guidance</h3>
                        <p>
                          {config.gemini_configured
                            ? "Live Gemini suggestions are available for this audit."
                            : "Gemini is not configured, so offline guidance will be shown."}
                        </p>
                        <button className="action-button" onClick={getSuggestions} disabled={active.status === "suggesting"}>
                          {active.status === "suggesting" ? "Generating..." : "Generate guidance"}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="panel-head">
                          <h3>{active.suggestions.source === "gemini" ? "Gemini summary" : "Offline summary"}</h3>
                          <span>{active.message}</span>
                        </div>
                        <div className="gemini-summary">{active.suggestions.summary}</div>
                        <div className="fix-grid">
                          {active.suggestions.fixes.map((fix, index) => <FixCard key={index} fix={fix} />)}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="panel audit-chat-panel">
                    <div className="panel-head assistant-head">
                      <div>
                        <h3>Ask FairAI</h3>
                        <span>{config.gemini_configured ? "Live assistant for this audit" : "Offline assistant for this audit"}</span>
                      </div>
                      <span className="assistant-status">{config.gemini_configured ? "Live" : "Offline"}</span>
                    </div>
                    <div className="chat-thread audit-chat-thread">
                      {active.chatMessages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
                          <b>{message.role === "assistant" ? "FairAI" : "You"}</b>
                          <p>{message.text}</p>
                        </div>
                      ))}
                    </div>
                    <div className="chat-form compact-chat-form">
                      <textarea
                        value={chatInput}
                        onChange={(event) => setChatInput(event.target.value)}
                        placeholder="Ask the assistant to explain this audit or recommend the next step."
                      />
                      <div className="chat-actions">
                        <span className="chat-hint">Try asking: Explain this fairness result in plain English.</span>
                        <button className="action-button" onClick={sendChat} disabled={active.status === "chatting" || !chatInput.trim()}>
                          {active.status === "chatting" ? "Thinking..." : "Ask"}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeTab === "mitigation" && (
                <section className="stack">
                  <div className="repair-actions">
                    <button className="action-button secondary" onClick={applyFix} disabled={active.status === "fixing"}>
                      {active.status === "fixing" ? "Applying..." : "Run mitigation"}
                    </button>
                    <button className="action-button" onClick={repairDataset} disabled={active.status === "repairing"}>
                      {active.status === "repairing" ? "Repairing..." : "Repair dataset"}
                    </button>
                    <button className="action-button ghost" onClick={downloadRepair} disabled={!active.repair?.csv_text}>
                      Download repaired CSV
                    </button>
                  </div>

                  {active.fixed?.model_warning && (
                    <div className="model-warning">
                      <strong>Not meaningful:</strong>
                      <span>{active.fixed.model_warning}</span>
                    </div>
                  )}

                  {(active.fixed || active.repair) && (
                    <div className="comparison-grid">
                      {active.fixed && [
                        // Before MUST be the baseline model on the same test split,
                        // not the dataset's label rates - comparing a dataset
                        // property to a model prediction overstates the gain.
                        ["Demographic parity", metrics.model_metrics?.demographic_parity_diff, active.fixed.demographic_parity_diff, "lower"],
                        ["Disparate impact", metrics.model_metrics?.disparate_impact_ratio, active.fixed.disparate_impact_ratio, "higher"],
                        ["Equalized odds", metrics.model_metrics?.equalized_odds_diff, active.fixed.equalized_odds_diff, "lower"]
                      ].map(([label, before, after, direction]) => {
                        const improved = direction === "lower" ? after < before : after > before;
                        return (
                          <article className="comparison-card" key={label}>
                            <span>{label}</span>
                            <div>
                              <b className="before">{before}</b>
                              <em>to</em>
                              <b className="after">{after}</b>
                            </div>
                            <div className="metric-direction">
                              <span className="metric-arrow">{direction === "lower" ? "↓" : "↑"}</span>
                              <span>{direction === "lower" ? "Lower is better" : "Higher is better"}</span>
                              <em>{improved ? "improved" : "no improvement"}</em>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {active.fixed && metrics.model_metrics && (
                    <div className="panel">
                      <div className="panel-head">
                        <h3>Model quality</h3>
                        <span>Same {active.fixed.evaluation_rows} evaluation rows, before and after</span>
                      </div>
                      <table className="group-table">
                        <thead>
                          <tr>
                            <th>Measure</th>
                            <th>Before</th>
                            <th>After</th>
                            <th>Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ["Accuracy", "accuracy"],
                            ["Precision", "precision"],
                            ["Recall", "recall"]
                          ].map(([label, key]) => {
                            const before = metrics.model_metrics[key];
                            const after = active.fixed[key];
                            const delta = +(after - before).toFixed(3);
                            return (
                              <tr key={key}>
                                <td>{label}</td>
                                <td>{before}</td>
                                <td><b>{after}</b></td>
                                <td className={delta < 0 ? "gap-behind" : "gap-best"}>
                                  {delta > 0 ? `+${delta}` : delta === 0 ? "no change" : delta}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="setup-message metric-footnote">
                        Fairness gains usually cost accuracy or recall. A large recall drop means
                        the mitigated model misses more people who did deserve the positive outcome.
                      </p>
                    </div>
                  )}

                  {active.repair && (
                    <section className="repair-grid">
                      <div className="panel">
                        <div className="panel-head">
                          <h3>Repair summary</h3>
                          <span>{active.repair.download_name}</span>
                        </div>
                        <div className="repair-summary">
                          <div className="repair-meta">
                            <b>{active.repair.repair_summary.rows_before}</b>
                            <span>rows before</span>
                          </div>
                          <div className="repair-meta">
                            <b>{active.repair.repair_summary.rows_after}</b>
                            <span>rows after</span>
                          </div>
                          <div className="repair-meta">
                            <b>{active.repair.repair_summary.normalized_outcome_column || "No"}</b>
                            <span>normalized outcome</span>
                          </div>
                        </div>
                        <div className="notes-head">
                          <strong>Repair notes</strong>
                          <span>{repairNotes.length} changes captured</span>
                        </div>
                        <ul className="notes-list compact">
                          {visibleRepairNotes.map((note, index) => <li key={index}>{note}</li>)}
                        </ul>
                        {repairNotes.length > 5 && (
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => setShowAllRepairNotes((current) => !current)}
                          >
                            {showAllRepairNotes ? "Show fewer notes" : `Show all changes (${hiddenRepairNotes} more)`}
                          </button>
                        )}
                      </div>

                      <div className="panel subtle-panel">
                        <div className="panel-head">
                          <h3>Download-ready output</h3>
                          <span>{active.repair.dataset_type}</span>
                        </div>
                        <p className="setup-message">The repaired CSV keeps the original rows, fills missing values, removes duplicates, and adds a fairness weight column.</p>
                        <div className="model-warning">
                          <strong>Read this:</strong>
                          <span>
                            The historical outcomes are <b>not</b> rewritten, so the bias is still
                            in the data. The fix lives in the <code>{active.repair.repair_summary.fairness_weight_column || "fairness weight"}</code> column:
                            pass it as <code>sample_weight</code> when you train. Re-uploading this
                            file and running a plain audit will show the original bias, because an
                            audit ignores the weights.
                          </span>
                        </div>
                        <p className="setup-message">Use the downloaded file for a cleaner training pipeline, a fairness review handoff, or a before-and-after demo story.</p>
                      </div>
                    </section>
                  )}
                </section>
              )}
            </section>
          </section>
        )}
      </section>
    </main>
  );
}
