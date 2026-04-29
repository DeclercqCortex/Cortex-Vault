import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

interface IntegrationsSettingsProps {
  vaultPath: string;
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
  vaultPath,
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

        <GoogleCalendarSection vaultPath={vaultPath} />

        <div style={{ ...styles.section, opacity: 0.5 }}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>Outlook Calendar (later)</span>
            <span style={styles.sectionStatus}>Cluster 13 — planned</span>
          </div>
          <p style={styles.sectionHint}>
            Will reuse this cluster's OAuth scaffold — see{" "}
            <code>cluster_13_outlook_calendar_sync.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cluster 12 — Google Calendar section
// -----------------------------------------------------------------------------

interface GoogleCalendarConfigPayload {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at_unix: number;
  calendar_id: string;
  user_email: string;
  last_sync_unix: number;
}

interface GoogleAuthHandshake {
  auth_url: string;
  port: number;
  state: string;
}

interface GoogleCalendarItem {
  id: string;
  summary: string;
  primary: boolean;
  background_color: string | null;
  selected: boolean;
}

interface SyncSummary {
  total: number;
  added: number;
  updated: number;
  deleted: number;
  last_sync_iso: string;
  error: string;
}

function GoogleCalendarSection({ vaultPath }: { vaultPath: string }) {
  const [cfg, setCfg] = useState<GoogleCalendarConfigPayload | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);

  // Load any saved config + the calendar list (if connected) on mount
  // and after any state-changing action.
  async function refresh() {
    try {
      const c = await invoke<GoogleCalendarConfigPayload | null>(
        "get_google_calendar_config",
      );
      setCfg(c);
      if (c) {
        setClientId(c.client_id);
        setClientSecret(c.client_secret);
        try {
          const list = await invoke<GoogleCalendarItem[]>(
            "list_google_calendars",
          );
          setCalendars(list);
        } catch (e) {
          console.warn("[google] couldn't list calendars:", e);
          setCalendars([]);
        }
      } else {
        setCalendars([]);
      }
    } catch (e) {
      setError(`Couldn't load Google Calendar config: ${e}`);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setError(null);
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Enter both Client ID and Client Secret first.");
      return;
    }
    setBusy(true);
    try {
      // 1. Backend binds a loopback listener and returns the auth URL.
      const handshake = await invoke<GoogleAuthHandshake>(
        "start_google_oauth",
        {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        },
      );

      // 2. Open the auth URL in the user's default browser.
      try {
        await openUrl(handshake.auth_url);
      } catch (e) {
        // Fallback: surface the URL for the user to copy/paste.
        console.warn("[google] openUrl failed:", e);
        setError(
          `Couldn't open the browser automatically. Open this URL manually: ${handshake.auth_url}`,
        );
        // Don't return — still wait for the callback in case the
        // user opens the URL themselves.
      }

      // 3. Wait for Google's redirect to hit our loopback listener.
      const code = await invoke<string>("await_google_oauth_code", {
        port: handshake.port,
        expectedState: handshake.state,
      });

      // 4. Exchange the code for tokens.
      const newCfg = await invoke<GoogleCalendarConfigPayload>(
        "complete_google_oauth",
        {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          code,
          port: handshake.port,
        },
      );
      setCfg(newCfg);
      // 5. Pull the calendar list now that we have a valid token.
      const list = await invoke<GoogleCalendarItem[]>("list_google_calendars");
      setCalendars(list);
    } catch (e) {
      setError(`Connect failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickCalendar(calendarId: string) {
    setError(null);
    try {
      await invoke("set_google_calendar_id", { calendarId });
      await refresh();
    } catch (e) {
      setError(`Couldn't select calendar: ${e}`);
    }
  }

  async function syncNow() {
    setError(null);
    setSyncing(true);
    try {
      const summary = await invoke<SyncSummary>("sync_google_calendar", {
        vaultPath,
      });
      setLastSummary(summary);
      await refresh();
    } catch (e) {
      setError(`Sync failed: ${e}`);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect Google Calendar? Synced events will be removed from Cortex's calendar on the next sync. Your tokens will be cleared from config.",
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await invoke("disconnect_google_calendar");
      setCfg(null);
      setCalendars([]);
      setClientId("");
      setClientSecret("");
      setLastSummary(null);
    } catch (e) {
      setError(`Disconnect failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const connected = cfg !== null && cfg.refresh_token.length > 0;
  const lastSyncLabel = formatLastSync(cfg?.last_sync_unix);

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionTitle}>Google Calendar</span>
        <span style={styles.sectionStatus}>
          {connected ? `Connected · ${cfg?.user_email ?? ""}` : "Not connected"}
        </span>
      </div>

      <p style={styles.sectionHint}>
        Read-only sync (Google → Cortex). Events from your selected calendar
        appear in Cortex's week / month views and the notification bell. Edits
        in Cortex don&apos;t push back to Google. You provide your own Google
        Cloud OAuth client — Cortex doesn&apos;t ship credentials.
      </p>

      <button
        type="button"
        onClick={() => setHelpOpen((o) => !o)}
        style={{ ...styles.btnGhost, marginBottom: "0.6rem" }}
      >
        {helpOpen ? "Hide setup steps" : "Show setup steps"}
      </button>
      {helpOpen && (
        <>
          <ol style={googleStyles.steps}>
            <li>
              Open{" "}
              <code>https://console.cloud.google.com/apis/credentials</code> and
              create a project (or pick one).
            </li>
            <li>
              Enable the Google Calendar API for the project (APIs &amp;
              Services → Library → search &quot;Google Calendar&quot; → Enable).
            </li>
            <li>
              Configure the OAuth consent screen (APIs &amp; Services → OAuth
              consent screen). Set <strong>User Type</strong> to{" "}
              <strong>External</strong> (for personal Gmail).
            </li>
            <li>
              <strong>Add the Calendar scope</strong> — on the OAuth consent
              screen wizard, click through to the <em>Scopes</em> step → Add or
              Remove Scopes → search &quot;calendar&quot; → check{" "}
              <code>https://www.googleapis.com/auth/calendar.readonly</code> →
              Update → Save. Without this, Google issues tokens that lack the
              scope and Sync fails with{" "}
              <code>ACCESS_TOKEN_SCOPE_INSUFFICIENT</code>.
            </li>
            <li>
              <strong>Add yourself as a test user</strong> — same OAuth consent
              screen page → scroll to <em>Test users</em> → Add Users → enter
              the Gmail address whose calendar you want to sync. This step is
              required while the app is in Testing publishing status (which it
              should stay in for personal use). Skipping it produces a 403
              access_denied error during Connect.
            </li>
            <li>
              Credentials → Create Credentials → OAuth client ID → Application
              type: <strong>Desktop app</strong>. Name it &quot;Cortex&quot;.
            </li>
            <li>
              Copy the Client ID + Client Secret into the fields below and click
              Connect. A browser window will open for Google&apos;s auth flow.
            </li>
          </ol>
          <p style={googleStyles.troubleshoot}>
            <strong>Got &quot;Error 403: access_denied&quot;?</strong> The
            Google account you signed in with isn&apos;t on the test-users list
            yet. Go back to step 5 in the OAuth consent screen, add the email,
            and try Connect again.
            <br />
            <br />
            <strong>
              Got &quot;ACCESS_TOKEN_SCOPE_INSUFFICIENT&quot; on Sync?
            </strong>{" "}
            Connect succeeded but the token lacks the calendar scope. Step
            4&apos;s &quot;Add the Calendar scope&quot; was skipped. Add it,
            then Disconnect + Reconnect in Cortex. If the consent screen
            doesn&apos;t re-prompt for the new scope, revoke Cortex&apos;s
            access at <code>https://myaccount.google.com/permissions</code> and
            try again.
            <br />
            <br />
            <strong>Got &quot;SERVICE_DISABLED&quot; on Sync?</strong> The
            Google Calendar API isn&apos;t enabled in the same Cloud project as
            your OAuth client (step 2 was skipped or applied to a different
            project). The error message includes a one-click activation URL —
            open it, click Enable, wait 1-2 minutes, then Sync now again. No
            need to Disconnect/Reconnect; the token is fine.
          </p>
        </>
      )}

      {!connected && (
        <>
          <label style={styles.label}>
            <span style={styles.labelText}>Client ID</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-abc….apps.googleusercontent.com"
              style={styles.input}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label style={{ ...styles.label, marginTop: "0.6rem" }}>
            <span style={styles.labelText}>Client Secret</span>
            <div style={styles.tokenRow}>
              <input
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-…"
                style={styles.input}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                style={styles.btnGhost}
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <div style={{ ...styles.actionsRow, marginTop: "0.85rem" }}>
            <button onClick={connect} disabled={busy} style={styles.btnPrimary}>
              {busy ? "Connecting…" : "Connect Google Calendar"}
            </button>
          </div>
        </>
      )}

      {connected && (
        <>
          <div style={googleStyles.calRow}>
            <label style={{ flex: 1 }}>
              <span style={styles.labelText}>Calendar</span>
              <select
                value={cfg?.calendar_id ?? "primary"}
                onChange={(e) => pickCalendar(e.target.value)}
                style={styles.input}
              >
                {calendars.length === 0 && (
                  <option value={cfg?.calendar_id ?? "primary"}>
                    {cfg?.calendar_id ?? "primary"}
                  </option>
                )}
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.primary ? `${c.summary} (primary)` : c.summary}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={googleStyles.syncRow}>
            <span style={styles.muted}>Last sync: {lastSyncLabel}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={syncNow}
              disabled={syncing}
              style={styles.btnPrimary}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>

          {lastSummary && (
            <p style={googleStyles.summary}>
              {lastSummary.error ? (
                <span style={{ color: "var(--danger)" }}>
                  {lastSummary.error}
                </span>
              ) : (
                <>
                  Synced {lastSummary.total} event
                  {lastSummary.total === 1 ? "" : "s"}: {lastSummary.added}{" "}
                  added, {lastSummary.updated} updated, {lastSummary.deleted}{" "}
                  removed.
                </>
              )}
            </p>
          )}

          <div style={{ ...styles.actionsRow, marginTop: "0.6rem" }}>
            <button
              onClick={disconnect}
              disabled={busy}
              style={styles.btnDanger}
            >
              Disconnect
            </button>
          </div>
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

function formatLastSync(unix: number | undefined): string {
  if (!unix || unix === 0) return "never";
  const d = new Date(unix * 1000);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return d.toLocaleString();
}

const googleStyles: Record<string, React.CSSProperties> = {
  steps: {
    margin: "0 0 0.85rem",
    paddingLeft: "1.25rem",
    fontSize: "0.78rem",
    color: "var(--text-2)",
    lineHeight: 1.55,
  },
  calRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "0.5rem",
    marginBottom: "0.7rem",
  },
  syncRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.4rem",
  },
  summary: {
    margin: "0.4rem 0",
    fontSize: "0.78rem",
    color: "var(--text-2)",
  },
  troubleshoot: {
    margin: "0 0 0.85rem",
    padding: "0.5rem 0.7rem",
    fontSize: "0.78rem",
    color: "var(--text-2)",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-2)",
    borderLeft: "3px solid var(--warning, var(--accent))",
    borderRadius: "5px",
    lineHeight: 1.5,
  },
};

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
