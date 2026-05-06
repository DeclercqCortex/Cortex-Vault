// Cluster 22 v1.0 — Document Templates modal.
//
// Lists every document type (Daily Log, Project, Experiment, Iteration,
// Protocol, Idea, Method, Plain note). Each row exposes Edit (opens the
// underlying .md file in the active slot like any other note — hooks into
// every Cluster 21 effect for free) and Reset (re-writes the bundled
// default).
//
// The "Templates enabled" toggle is the escape hatch from the spec: when
// off, future creation calls pass `useTemplate: false` to the Tauri side
// and the existing hardcoded body is used verbatim. Persisted to
// localStorage at `cortex:templates-enabled`. Default true.
//
// The right-hand pane shows a live preview of the selected type's template
// rendered against sample placeholder values, so the user can see what a
// freshly-created file would look like without leaving the modal.

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DocumentTemplateInfo {
  doc_type: string;
  path: string;
  exists: boolean;
  modified_unix: number;
}

interface TemplatesModalProps {
  vaultPath: string;
  /** Open Edit by routing the template's .md path into the active slot. */
  onEdit: (templatePath: string) => void;
  onClose: () => void;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  "daily-log": "Daily Log",
  project: "Project",
  experiment: "Experiment",
  iteration: "Iteration",
  protocol: "Protocol",
  idea: "Idea",
  method: "Method",
  note: "Plain note",
};

/** All eight v1.0 doc types in a deliberate display order — Daily Log
 * lives at the top because Ctrl+D is the most-used creation flow.
 */
const DOC_TYPE_ORDER: string[] = [
  "daily-log",
  "note",
  "idea",
  "method",
  "protocol",
  "project",
  "experiment",
  "iteration",
];

const TEMPLATES_ENABLED_KEY = "cortex:templates-enabled";

export function readTemplatesEnabled(): boolean {
  try {
    const raw = localStorage.getItem(TEMPLATES_ENABLED_KEY);
    if (raw === null) return true; // default ON
    return raw === "true";
  } catch {
    return true;
  }
}

function writeTemplatesEnabled(v: boolean) {
  try {
    localStorage.setItem(TEMPLATES_ENABLED_KEY, v ? "true" : "false");
  } catch {
    /* localStorage may be unavailable; the toggle still affects in-session use */
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTimestamp(unix: number): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  return d.toLocaleString();
}

/** Sample placeholder context per doc type — used to drive the preview
 * pane. Sample values are deliberately recognisable so the preview reads
 * as a worked example.
 */
function sampleContext(docType: string): Record<string, unknown> {
  const today = todayIso();
  // Sample week number — sufficient for the preview, the real one comes
  // from Rust at creation time.
  const weekNum = (() => {
    const d = new Date();
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    }
    return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  })();
  const dayOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][new Date().getDay()];

  const base = {
    date: today,
    vaultName: "Declercq Cortex",
    weekNumber: weekNum,
    dayOfWeek,
  };

  switch (docType) {
    case "daily-log":
      return {
        ...base,
        title: today,
        slug: today,
        prevDailyLink: "[[2026-05-05]]",
      };
    case "project":
      return {
        ...base,
        title: "Mean-field tumor modeling",
        slug: "mean-field-tumor-modeling",
      };
    case "experiment":
      return {
        ...base,
        title: "Boundary condition sweep",
        slug: "boundary-condition-sweep",
        parentProject: "01-Mean-field tumor modeling",
        modeling: true,
      };
    case "iteration":
      return {
        ...base,
        title: `Iter 03 — ${today}`,
        slug: "iter-03",
        iterationNumber: 3,
        parentExperiment: "01-Boundary condition sweep",
        parentProject: "01-Mean-field tumor modeling",
      };
    case "protocol":
      return {
        ...base,
        title: "PBS wash for adherent cells",
        slug: "pbs-wash-for-adherent-cells",
        domain: "wet-lab",
      };
    case "idea":
      return {
        ...base,
        title: "Mean-field misses spatial heterogeneity",
        slug: "mean-field-misses-spatial-heterogeneity",
      };
    case "method":
      return {
        ...base,
        title: "Spectral collocation on Chebyshev grid",
        slug: "spectral-collocation-on-chebyshev-grid",
        domain: "modeling",
        complexity: 3,
      };
    case "note":
    default:
      return {
        ...base,
        title: "Reading notes — Strogatz Ch 3",
        slug: "reading-notes-strogatz-ch-3",
      };
  }
}

export function TemplatesModal({
  vaultPath,
  onEdit,
  onClose,
}: TemplatesModalProps) {
  const [list, setList] = useState<DocumentTemplateInfo[]>([]);
  const [selectedType, setSelectedType] = useState<string>("daily-log");
  const [previewBody, setPreviewBody] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(readTemplatesEnabled());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      const result = await invoke<DocumentTemplateInfo[]>(
        "list_document_templates",
        { vaultPath },
      );
      // Sort by DOC_TYPE_ORDER for a deterministic display.
      const ordered = [...result].sort(
        (a, b) =>
          DOC_TYPE_ORDER.indexOf(a.doc_type) -
          DOC_TYPE_ORDER.indexOf(b.doc_type),
      );
      setList(ordered);
    } catch (e) {
      setError(`Could not list templates: ${e}`);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);

  // Re-render the preview pane whenever the selected type changes or the
  // template body on disk might have changed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await invoke<string>("read_document_template", {
          vaultPath,
          docType: selectedType,
        });
        const ctx = sampleContext(selectedType);
        const rendered = await invoke<string>("preview_document_template", {
          templateBody: body,
          ...ctx,
        });
        if (!cancelled) setPreviewBody(rendered);
      } catch (e) {
        if (!cancelled) setPreviewBody(`(preview failed: ${e})`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedType, vaultPath, list]);

  async function handleEdit(docType: string) {
    setError(null);
    setBusy(true);
    try {
      // Ensure the template file exists on disk before opening it.
      // read_document_template lazily writes the bundled default when
      // the file is missing, so this single call doubles as a
      // "make-sure-the-file-exists" step.
      await invoke<string>("read_document_template", {
        vaultPath,
        docType,
      });
      const info = list.find((t) => t.doc_type === docType);
      if (!info) {
        setError(`No template entry for ${docType}`);
        return;
      }
      onEdit(info.path);
    } catch (e) {
      setError(`Could not open template: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(docType: string) {
    setError(null);
    if (
      !window.confirm(
        `Reset the ${DOC_TYPE_LABELS[docType] ?? docType} template to the bundled default? Any custom changes will be overwritten.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await invoke<string>("reset_document_template", {
        vaultPath,
        docType,
      });
      await reload();
      // If the user is currently viewing the reset type, refresh the preview.
      if (selectedType === docType) {
        // Force re-fetch by toggling the dependency.
        setSelectedType((prev) => (prev === docType ? `${docType}` : docType));
        setList((l) => [...l]);
      }
    } catch (e) {
      setError(`Could not reset template: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  function handleToggleEnabled(v: boolean) {
    setEnabled(v);
    writeTemplatesEnabled(v);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  const selected = useMemo(
    () => list.find((t) => t.doc_type === selectedType) ?? null,
    [list, selectedType],
  );

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Document templates"
      >
        <div style={styles.headerRow}>
          <h2 style={styles.heading}>Document templates</h2>
          <label style={styles.toggleRow}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <span style={styles.toggleText}>Templates enabled</span>
          </label>
        </div>
        <p style={styles.hint}>
          Templates live at{" "}
          <code style={styles.codeInline}>
            &lt;vault&gt;/.cortex/document-templates/&lt;type&gt;.md
          </code>
          . Edit opens the file in the active slot — every text-editor effect
          works there.
        </p>

        <div style={styles.body}>
          <div style={styles.list}>
            {list.map((t) => {
              const isSelected = t.doc_type === selectedType;
              return (
                <div
                  key={t.doc_type}
                  style={{
                    ...styles.row,
                    ...(isSelected ? styles.rowSelected : {}),
                  }}
                  onClick={() => setSelectedType(t.doc_type)}
                >
                  <div style={styles.rowLeft}>
                    <div style={styles.rowTitle}>
                      {DOC_TYPE_LABELS[t.doc_type] ?? t.doc_type}
                    </div>
                    <div style={styles.rowSub}>
                      {t.exists
                        ? `Last edited ${fmtTimestamp(t.modified_unix)}`
                        : "Default (not yet customised)"}
                    </div>
                  </div>
                  <div style={styles.rowActions}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(t.doc_type);
                      }}
                      style={styles.btnGhost}
                      disabled={busy}
                      title="Open this template in the active slot"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReset(t.doc_type);
                      }}
                      style={styles.btnGhost}
                      disabled={busy}
                      title="Re-write the bundled default"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={styles.preview}>
            <div style={styles.previewHeader}>
              <span style={styles.previewLabel}>
                Preview —{" "}
                {selected
                  ? (DOC_TYPE_LABELS[selected.doc_type] ?? selected.doc_type)
                  : "(none)"}
              </span>
              <span style={styles.previewSampleHint}>
                rendered with sample values
              </span>
            </div>
            <pre style={styles.previewBody}>{previewBody}</pre>
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnGhost} disabled={busy}>
            Close
          </button>
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
    minWidth: "780px",
    maxWidth: "92vw",
    maxHeight: "84vh",
    display: "flex",
    flexDirection: "column",
    padding: "1.25rem 1.5rem 1rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
    overflow: "hidden",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.5rem",
  },
  heading: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.85rem",
    color: "var(--text-2)",
    cursor: "pointer",
  },
  toggleText: {
    userSelect: "none",
  },
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 38%) 1fr",
    gap: "1rem",
    minHeight: 0,
    flex: 1,
    overflow: "hidden",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    overflowY: "auto",
    paddingRight: "0.25rem",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.55rem 0.7rem",
    border: "1px solid var(--border-2)",
    borderRadius: "6px",
    cursor: "pointer",
    background: "var(--bg-deep)",
  },
  rowSelected: {
    borderColor: "var(--primary)",
    boxShadow: "0 0 0 1px var(--primary)",
  },
  rowLeft: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  rowTitle: {
    fontSize: "0.92rem",
    fontWeight: 600,
  },
  rowSub: {
    fontSize: "0.74rem",
    color: "var(--text-muted)",
  },
  rowActions: {
    display: "flex",
    gap: "0.35rem",
    flexShrink: 0,
  },
  preview: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    border: "1px solid var(--border-2)",
    borderRadius: "6px",
    overflow: "hidden",
  },
  previewHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.4rem 0.65rem",
    background: "var(--bg-deep)",
    borderBottom: "1px solid var(--border-2)",
    fontSize: "0.78rem",
  },
  previewLabel: {
    fontWeight: 600,
    color: "var(--text)",
  },
  previewSampleHint: {
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  previewBody: {
    flex: 1,
    margin: 0,
    padding: "0.65rem 0.85rem",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.78rem",
    lineHeight: 1.45,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text)",
    background: "var(--bg)",
  },
  hint: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    lineHeight: 1.45,
    margin: "0 0 0.6rem",
  },
  codeInline: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    background: "var(--code-bg)",
    padding: "1px 4px",
    borderRadius: "3px",
    fontSize: "0.85em",
  },
  error: {
    margin: "0.5rem 0 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  footer: {
    marginTop: "0.85rem",
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
  },
  btnGhost: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
};
