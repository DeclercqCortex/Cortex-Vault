import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EventCategory } from "./Calendar";

interface CategoriesSettingsProps {
  vaultPath: string;
  isOpen: boolean;
  onClose: () => void;
}

const SOFT_LIMIT = 8;

/**
 * Cluster 11 v1.0 — manage event categories.
 *
 * The cluster doc decision: 5 starter categories shipped seeded by
 * the Rust side on first open. The user can edit colours / labels,
 * add new categories, or delete unused ones. We softly warn past 8
 * (the visual-noise threshold called out in the user's spec).
 *
 * Delete refuses if any event still references the category — the
 * user must reassign first. v1's stance is "fail loudly" rather
 * than orphaning events.
 */
export function CategoriesSettings({
  vaultPath,
  isOpen,
  onClose,
}: CategoriesSettingsProps) {
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventCategory | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("#3b82f6");

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const c = await invoke<EventCategory[]>("list_event_categories", {
        vaultPath,
      });
      setCategories(c);
    } catch (e) {
      setError(`Couldn't load categories: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(cat: EventCategory | null) {
    if (cat) {
      setEditing(cat);
      setEditLabel(cat.label);
      setEditColor(cat.color);
    } else {
      // New category — generate an id from the label on save
      setEditing({
        id: "",
        label: "",
        color: "#3b82f6",
        sort_order: categories.length,
      });
      setEditLabel("");
      setEditColor("#3b82f6");
    }
  }

  function cancelEdit() {
    setEditing(null);
    setEditLabel("");
    setEditColor("#3b82f6");
  }

  async function saveEdit() {
    if (!editing) return;
    const label = editLabel.trim();
    if (!label) {
      setError("Category label can't be empty.");
      return;
    }
    const id = editing.id || slugifyLabel(label);
    if (!id) {
      setError("Couldn't derive an id from the label.");
      return;
    }
    try {
      await invoke("upsert_event_category", {
        vaultPath,
        id,
        label,
        color: editColor,
        sortOrder: editing.sort_order,
      });
      cancelEdit();
      refresh();
    } catch (e) {
      setError(`Save failed: ${e}`);
    }
  }

  async function remove(cat: EventCategory) {
    if (
      !window.confirm(
        `Delete category "${cat.label}"? Events using it must be reassigned first.`,
      )
    ) {
      return;
    }
    try {
      await invoke("delete_event_category", { vaultPath, id: cat.id });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  if (!isOpen) return null;

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Manage categories"
      >
        <h2 style={styles.heading}>Event categories</h2>
        <p style={styles.hint}>
          Color is information, not decoration — the user spec calls for 5–8
          categories max. {categories.length} configured
          {categories.length > SOFT_LIMIT
            ? " (above the recommended 8 — visual signal degrades past this)"
            : ""}
          .
        </p>

        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : (
          <div style={styles.list}>
            {categories.map((cat) => (
              <div key={cat.id} style={styles.row}>
                <span
                  style={{
                    ...styles.swatch,
                    background: cat.color,
                  }}
                  aria-hidden="true"
                />
                <span style={styles.label}>{cat.label}</span>
                <span style={styles.id}>{cat.id}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => startEdit(cat)} style={styles.btnGhost}>
                  Edit
                </button>
                <button onClick={() => remove(cat)} style={styles.btnDanger}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {editing ? (
          <div style={styles.editPanel}>
            <strong style={styles.editTitle}>
              {editing.id ? `Editing "${editing.label}"` : "New category"}
            </strong>
            <label style={styles.fieldLabel}>
              <span style={styles.fieldLabelText}>Label</span>
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                style={styles.input}
                placeholder="e.g. Reading"
              />
            </label>
            <label style={styles.fieldLabel}>
              <span style={styles.fieldLabelText}>Color</span>
              <input
                type="color"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
                style={styles.colorInput}
              />
              <span style={styles.fieldHint}>{editColor}</span>
            </label>
            <div style={styles.editActions}>
              <button onClick={cancelEdit} style={styles.btnGhost}>
                Cancel
              </button>
              <button onClick={saveEdit} style={styles.btnPrimary}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.actions}>
            <button onClick={() => startEdit(null)} style={styles.btnGhost}>
              + Add category
            </button>
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnPrimary}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1400,
  },
  panel: {
    minWidth: "480px",
    maxWidth: "560px",
    maxHeight: "calc(100vh - 4rem)",
    overflowY: "auto",
    padding: "1.25rem 1.5rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
  },
  heading: { margin: "0 0 0.4rem", fontSize: "1.05rem", fontWeight: 600 },
  hint: {
    margin: "0 0 1rem",
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    lineHeight: 1.45,
  },
  list: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "6px 8px",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
  },
  swatch: {
    width: "20px",
    height: "20px",
    borderRadius: "4px",
    flexShrink: 0,
  },
  label: { fontWeight: 500 },
  id: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.72rem",
    color: "var(--text-muted)",
  },
  actions: { marginTop: "0.85rem" },
  editPanel: {
    marginTop: "0.85rem",
    padding: "0.7rem 0.85rem",
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  editTitle: {
    display: "block",
    fontSize: "0.85rem",
    marginBottom: "0.4rem",
  },
  fieldLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    marginBottom: "0.5rem",
  },
  fieldLabelText: {
    fontSize: "0.78rem",
    color: "var(--text-2)",
    minWidth: "60px",
  },
  fieldHint: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.78rem",
    color: "var(--text-muted)",
  },
  input: {
    flex: 1,
    padding: "0.4rem 0.6rem",
    fontSize: "0.85rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    outline: "none",
    boxSizing: "border-box",
  },
  colorInput: {
    width: "44px",
    height: "26px",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    background: "transparent",
    cursor: "pointer",
  },
  editActions: {
    display: "flex",
    gap: "0.4rem",
    justifyContent: "flex-end",
    marginTop: "0.4rem",
  },
  error: {
    margin: "0.6rem 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  footer: {
    marginTop: "1rem",
    display: "flex",
    justifyContent: "flex-end",
  },
  muted: { color: "var(--text-muted)", fontSize: "0.85rem" },
  btnGhost: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "4px 14px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  btnDanger: {
    padding: "4px 10px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
};
