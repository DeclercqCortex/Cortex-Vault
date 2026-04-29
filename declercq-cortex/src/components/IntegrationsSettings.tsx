import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface IntegrationsSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface GitHubConfig {
  token: string;
  repos: string[];
}

interface GitHubSummary {
  markdown: string;
  last_fetch_iso: string;
  error: string;
}

/**
 * Cluster 10 — Integrations settings modal.
 *
 * v1 surfaces only the GitHub integration. Calendar / Overleaf are
 * deliberately out of scope for this cluster (build when their triggers
 * fire). Layout reserves a pattern for additional integration panels —
 * each could become its own collapsible section under "GitHub" without
 * a wider rewrite.
 *
 * Token storage tradeoff: v1 stores the PAT in `config.json` (per-user
 * %APPDATA%). The cluster doc explicitly accepts this for a single-user
 * personal tool; OS-keychain integration is reserved for v2.
 */
export function IntegrationsSettings({
  isOpen,
  onClose,
}: IntegrationsSettingsProps) {
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GitHubSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Mask the token unless the user explicitly reveals it. Avoids the
  // PAT showing on screen during a screenshare. Declared up here with
  // the other hooks (Rules of Hooks: must be before any early return).
  const [showToken, setShowToken] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);

  // Load existing config when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setTestResult(null);
    setSavedAt(null);
    setLoading(true);
    invoke<GitHubConfig | null>("get_github_config")
      .then((cfg) => {
        if (cfg) {
          setToken(cfg.token ?? "");
          setRepos(cfg.repos.length > 0 ? cfg.repos : [""]);
        } else {
          setToken("");
          setRepos([""]);
        }
      })
      .catch((e) => setError(`Couldn't load saved config: ${e}`))
      .finally(() => {
        setLoading(false);
        setTimeout(() => tokenRef.current?.focus(), 0);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function updateRepo(idx: number, value: string) {
    setRepos((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function addRepoRow() {
    setRepos((prev) => [...prev, ""]);
  }

  function removeRepoRow(idx: number) {
    setRepos((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length === 0 ? [""] : next;
    });
  }

  async function save() {
    setError(null);
    setTestResult(null);
    const cleanedRepos = repos.map((r) => r.trim()).filter((r) => r.length > 0);
    setSaving(true);
    try {
      await invoke("set_github_config", {
        token: token.trim(),
        repos: cleanedRepos,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setError(null);
    setTestResult(null);
    if (
      !window.confirm(
        "Remove the saved GitHub token and repos? You'll need to enter the token again to reconnect.",
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await invoke("clear_github_config");
      setToken("");
      setRepos([""]);
      setSavedAt(Date.now());
    } catch (e) {
      setError(`Disconnect failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    // Save first so the test uses the live values, even if the user
    // hasn't clicked Save yet.
    setError(null);
    setTestResult(null);
    const cleanedRepos = repos.map((r) => r.trim()).filter((r) => r.length > 0);
    if (token.trim().length === 0) {
      setError("Enter a personal access token before testing.");
      return;
    }
    setTesting(true);
    try {
      await invoke("set_github_config", {
        token: token.trim(),
        repos: cleanedRepos,
      });
      const result = await invoke<GitHubSummary>("fetch_github_summary_now", {
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      setTestResult(result);
    } catch (e) {
      setError(`Test failed: ${e}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Integrations settings"
      >
        <h2 style={styles.heading}>Integrations</h2>
        <p style={styles.hint}>
          Read-only integrations that surface external context inside daily
          notes. Tokens are stored locally in your config file.
        </p>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>GitHub</span>
            <span style={styles.sectionStatus}>
              {token.trim().length > 0 ? "Configured" : "Not configured"}
            </span>
          </div>
          <p style={styles.sectionHint}>
            A Personal Access Token with <code>repo</code> read scope. Recent
            commits (last 24h) and your open PRs across the configured repos
            will appear under <em>## Today&apos;s GitHub activity</em> in
            today&apos;s daily note.
          </p>

          <label style={styles.label}>
            <span style={styles.labelText}>Personal access token</span>
            <div style={styles.tokenRow}>
              <input
                ref={tokenRef}
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                style={styles.input}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                style={styles.btnGhost}
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <div style={{ marginTop: "0.85rem" }}>
            <span style={styles.labelText}>
              Repos to watch (one per row, in <code>owner/name</code> format)
            </span>
            <div style={styles.reposList}>
              {repos.map((r, i) => (
                <div key={i} style={styles.repoRow}>
                  <input
                    type="text"
                    value={r}
                    onChange={(e) => updateRepo(i, e.target.value)}
                    placeholder="myorg/cortex"
                    style={styles.input}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => removeRepoRow(i)}
                    style={styles.btnGhost}
                    title="Remove this repo"
                    aria-label="Remove repo"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addRepoRow}
                style={{ ...styles.btnGhost, marginTop: "0.4rem" }}
              >
                + Add repo
              </button>
            </div>
          </div>

          {error && <p style={styles.error}>{error}</p>}
          {savedAt !== null && !error && <p style={styles.success}>Saved.</p>}
          {testResult && (
            <div style={styles.testResult}>
              <div style={styles.testHeader}>
                <strong>Test connection</strong>
                <span style={styles.muted}>
                  {testResult.error
                    ? "Failed"
                    : testResult.last_fetch_iso
                      ? `OK · ${testResult.last_fetch_iso}`
                      : "OK"}
                </span>
              </div>
              {testResult.error ? (
                <p style={styles.error}>{testResult.error}</p>
              ) : (
                <pre style={styles.preview}>{testResult.markdown}</pre>
              )}
            </div>
          )}

          <div style={styles.actionsRow}>
            <button
              onClick={testConnection}
              disabled={testing || saving || loading}
              style={styles.btnGhost}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            <button
              onClick={disconnect}
              disabled={testing || saving || loading}
              style={styles.btnDanger}
            >
              Disconnect
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} disabled={saving} style={styles.btnGhost}>
              Close
            </button>
            <button
              onClick={save}
              disabled={testing || saving || loading}
              style={styles.btnPrimary}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div style={{ ...styles.section, opacity: 0.5 }}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>
              Google Calendar / Overleaf (later)
            </span>
            <span style={styles.sectionStatus}>Not in this cluster</span>
          </div>
          <p style={styles.sectionHint}>
            Planned for separate clusters once their triggers fire — see{" "}
            <code>cluster_10_integrations.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    minWidth: "520px",
    maxWidth: "640px",
    maxHeight: "calc(100vh - 4rem)",
    overflowY: "auto",
    padding: "1.5rem 1.75rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
  },
  heading: { margin: "0 0 0.4rem", fontSize: "1.1rem", fontWeight: 600 },
  hint: {
    margin: "0 0 1rem",
    fontSize: "0.82rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  section: {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "1rem 1.1rem",
    marginBottom: "0.85rem",
    background: "var(--bg-elev)",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: "0.4rem",
  },
  sectionTitle: { fontWeight: 600, fontSize: "0.95rem" },
  sectionStatus: {
    fontSize: "0.72rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  sectionHint: {
    margin: "0 0 0.85rem",
    fontSize: "0.82rem",
    color: "var(--text-2)",
    lineHeight: 1.45,
  },
  label: { display: "block" },
  labelText: {
    display: "block",
    fontSize: "0.78rem",
    color: "var(--text-2)",
    marginBottom: "0.25rem",
  },
  input: {
    width: "100%",
    padding: "0.45rem 0.6rem",
    fontSize: "0.9rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  tokenRow: {
    display: "flex",
    gap: "0.4rem",
  },
  reposList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  repoRow: {
    display: "flex",
    gap: "0.4rem",
    alignItems: "center",
  },
  actionsRow: {
    marginTop: "1rem",
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  btnGhost: {
    padding: "5px 12px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    whiteSpace: "nowrap",
  },
  btnPrimary: {
    padding: "5px 16px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "var(--primary)",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  btnDanger: {
    padding: "5px 12px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  error: {
    margin: "0.6rem 0 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  success: {
    margin: "0.6rem 0 0",
    color: "var(--accent)",
    fontSize: "0.85rem",
  },
  testResult: {
    marginTop: "0.85rem",
    padding: "0.7rem 0.85rem",
    background: "var(--bg-deep)",
    border: "1px solid var(--border-2)",
    borderRadius: "6px",
  },
  testHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "0.4rem",
  },
  preview: {
    margin: 0,
    fontSize: "0.78rem",
    color: "var(--text-2)",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "240px",
    overflowY: "auto",
  },
  muted: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
  },
};
