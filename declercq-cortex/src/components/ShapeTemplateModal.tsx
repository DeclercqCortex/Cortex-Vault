// Cluster 20 v1.0 — Shape Template modal.
//
// Two modes:
//   - "save"  : prompt for a template name; on Save the host writes
//               the template via `save_shape_template` and closes.
//   - "load"  : list existing templates with Load / Delete buttons;
//               on Load the host reads via `read_shape_template`
//               and additively merges into the current note's
//               sidecar.
//
// Templates are stored at <vault>/.cortex/shape-templates/<name>.json
// (path-sanitized to ASCII alphanum + - _ . space). Listed sorted by
// modified_at_unix DESC.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShapeTemplateInfo, ShapesDoc } from "../shapes/types";

export type ShapeTemplateMode =
  | { kind: "save"; doc: ShapesDoc }
  | { kind: "load" };

export interface ShapeTemplateModalProps {
  vaultPath: string;
  mode: ShapeTemplateMode;
  /** Called on Save with the chosen name. The host invokes
   *  save_shape_template and closes the modal. */
  onSave: (name: string) => Promise<void>;
  /** Called on Load with the chosen template name. The host fetches
   *  the template's shapes and additively merges them into the
   *  current sidecar. */
  onLoad: (name: string) => Promise<void>;
  onClose: () => void;
}

export function ShapeTemplateModal({
  vaultPath,
  mode,
  onSave,
  onLoad,
  onClose,
}: ShapeTemplateModalProps) {
  const [name, setName] = useState("");
  const [list, setList] = useState<ShapeTemplateInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (mode.kind !== "load" && mode.kind !== "save") return;
    if (!vaultPath) return;
    try {
      const items = await invoke<ShapeTemplateInfo[]>("list_shape_templates", {
        vaultPath,
      });
      setList(items);
    } catch (e) {
      setError(String(e));
      setList([]);
    }
  }, [vaultPath, mode.kind]);

  useEffect(() => {
    refresh();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, onClose]);

  async function handleSave() {
    if (mode.kind !== "save") return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(target: ShapeTemplateInfo) {
    setBusy(true);
    setError(null);
    try {
      await onLoad(target.name);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(target: ShapeTemplateInfo) {
    if (
      !window.confirm(
        `Delete template "${target.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke("delete_shape_template", { vaultPath, name: target.name });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {mode.kind === "save"
              ? "Save shape template"
              : "Load shape template"}
          </h2>
          <button onClick={onClose} style={styles.closeBtn} title="Close (Esc)">
            ✕
          </button>
        </div>

        {mode.kind === "save" && (
          <div style={styles.savePanel}>
            <label style={styles.label} htmlFor="cortex-shape-tpl-name">
              Template name
            </label>
            <input
              id="cortex-shape-tpl-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. arrow-callout"
              autoFocus
              style={styles.input}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            <div style={styles.hint}>
              Stored at{" "}
              <code>
                &lt;vault&gt;/.cortex/shape-templates/{name || "<name>"}.json
              </code>
              . {mode.doc.shapes.length} shape
              {mode.doc.shapes.length === 1 ? "" : "s"} will be saved.
            </div>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.footer}>
              <button onClick={onClose} style={styles.btnGhost} disabled={busy}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                style={styles.btnPrimary}
                disabled={busy || !name.trim()}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {mode.kind === "load" && (
          <div style={styles.loadPanel}>
            {list === null && <div style={styles.empty}>Loading…</div>}
            {list && list.length === 0 && (
              <div style={styles.empty}>
                No templates yet. Save your current shapes via Ctrl+T to make
                one.
              </div>
            )}
            {error && <div style={styles.error}>{error}</div>}
            {list && list.length > 0 && (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Shapes</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>
                      Modified
                    </th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.name}>
                      <td style={styles.td}>
                        <code>{t.name}</code>
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        {t.shape_count}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        {new Date(t.modified_at_unix * 1000).toLocaleString()}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <button
                          onClick={() => handleLoad(t)}
                          style={styles.btnPrimarySmall}
                          disabled={busy}
                          title="Append this template's shapes to the current note"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleDelete(t)}
                          style={styles.btnRowDanger}
                          disabled={busy}
                          title="Delete this template"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
  },
  modal: {
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
    width: "min(640px, 92vw)",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column",
    padding: "1.1rem 1.2rem 0.9rem",
    gap: "0.7rem",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: { margin: 0, fontSize: "1.05rem", fontWeight: 600 },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-2)",
    fontSize: "1.05rem",
    cursor: "pointer",
  },
  savePanel: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  label: { fontSize: "0.78rem", color: "var(--text-2)" },
  input: {
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "6px 8px",
    fontSize: "0.9rem",
  },
  hint: { fontSize: "0.78rem", color: "var(--text-2)" },
  error: {
    background: "var(--danger-bg, #ffe6e6)",
    color: "var(--danger)",
    padding: "0.4rem 0.7rem",
    borderRadius: "4px",
    fontSize: "0.82rem",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
    paddingTop: "0.4rem",
    borderTop: "1px solid var(--border)",
  },
  btnGhost: {
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  btnPrimary: {
    background: "var(--accent)",
    color: "white",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    padding: "5px 16px",
    fontSize: "0.85rem",
    cursor: "pointer",
    fontWeight: 600,
  },
  btnPrimarySmall: {
    background: "var(--accent)",
    color: "white",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    padding: "3px 10px",
    fontSize: "0.78rem",
    cursor: "pointer",
    fontWeight: 600,
    marginRight: "0.4rem",
  },
  btnRowDanger: {
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    padding: "2px 10px",
    fontSize: "0.78rem",
    cursor: "pointer",
  },
  loadPanel: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  empty: {
    padding: "1rem 0",
    color: "var(--text-2)",
    fontSize: "0.9rem",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.82rem",
  },
  th: {
    textAlign: "left",
    padding: "6px 8px",
    background: "var(--bg-elev)",
    borderBottom: "1px solid var(--border)",
    fontWeight: 600,
    color: "var(--text-2)",
  },
  td: {
    padding: "5px 8px",
    borderBottom: "1px solid var(--border-2, var(--border))",
  },
};
