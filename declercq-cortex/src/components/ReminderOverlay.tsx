import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ReminderOverlayProps {
  vaultPath: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a save so other UI (notification bell) can refresh. */
  onChanged?: () => void;
  /** Open the reminders file in the editor — used by the "Edit in pane"
   *  button. The host (App) routes through selectFileInSlot. */
  onOpenInPane?: (filePath: string) => void;
}

/**
 * Cluster 15 — pop-up reminder overlay.
 *
 * Modal-style overlay (like the command palette / search bubble),
 * NOT a slot view — opens on top of whatever the user was doing
 * with `Ctrl+Shift+M`. The textarea shows the verbatim contents
 * of `<vault>/Reminders.md`; saving writes the file back. Quick-add
 * input at the top prepends a new line on Enter so capture is one
 * keystroke + type + Enter + Esc.
 *
 * The full reminders file is shown (including past-due lines that
 * haven't been resolved yet) so the user can clean up rather than
 * having stale entries linger silently.
 */
export function ReminderOverlay({
  vaultPath,
  isOpen,
  onClose,
  onChanged,
  onOpenInPane,
}: ReminderOverlayProps) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [quickAdd, setQuickAdd] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Load the file when the overlay opens. Each open is a fresh read
  // so the user sees the current on-disk state — even if they
  // edited the file in the editor pane between opens.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setQuickAdd("");
    setLoading(true);
    invoke<string>("read_reminders", { vaultPath })
      .then((c) => {
        setContent(c);
        setOriginalContent(c);
      })
      .catch((e) => setError(`Couldn't load reminders: ${e}`))
      .finally(() => {
        setLoading(false);
        setTimeout(() => quickRef.current?.focus(), 0);
      });
  }, [isOpen, vaultPath]);

  if (!isOpen) return null;

  const dirty = content !== originalContent;

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Esc closes without saving. Browser-style.
      onClose();
    }
  }

  function quickAddSubmit() {
    const line = quickAdd.trim();
    if (!line) return;
    // Prepend so the most-recently-added reminder is visible at the
    // top of the textarea — easier to verify the parse landed
    // correctly without scrolling.
    const next = content ? `${line}\n${content}` : line;
    setContent(next);
    setQuickAdd("");
    setTimeout(() => quickRef.current?.focus(), 0);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await invoke("write_reminders", { vaultPath, content });
      setOriginalContent(content);
      onChanged?.();
    } catch (e) {
      setError(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    if (dirty) {
      await save();
    }
    onClose();
  }

  function openInEditor() {
    if (!onOpenInPane) return;
    // Save first if dirty, then open the file in the active pane.
    if (dirty) {
      void save();
    }
    const sep = vaultPath.includes("\\") ? "\\" : "/";
    onOpenInPane(`${vaultPath}${sep}Reminders.md`);
    onClose();
  }

  return (
    <div style={styles.scrim} onClick={saveAndClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Reminders"
      >
        <header style={styles.header}>
          <h2 style={styles.heading}>Reminders</h2>
          <span style={styles.muted}>Ctrl+Shift+M</span>
        </header>

        <p style={styles.hint}>
          One reminder per line. Format:{" "}
          <code>YYYY-MM-DD HH:MM Description</code> — date and time are
          optional. Lines with no date/time stay pending until resolved.
        </p>

        <div style={styles.quickRow}>
          <input
            ref={quickRef}
            type="text"
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                quickAddSubmit();
                // After prepending, hand focus straight back so
                // the user can keep adding rapid-fire.
                setTimeout(() => quickRef.current?.focus(), 0);
              }
            }}
            placeholder="Quick-add: 2026-04-29 14:30 Meeting with advisor"
            style={styles.input}
            disabled={loading}
          />
          <button
            type="button"
            onClick={quickAddSubmit}
            style={styles.btnPrimary}
            disabled={loading || !quickAdd.trim()}
          >
            Add
          </button>
        </div>

        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : (
          <textarea
            ref={textRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="(no reminders yet — start with the quick-add above)"
            style={styles.textarea}
            spellCheck={false}
          />
        )}

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          {onOpenInPane && (
            <button
              onClick={openInEditor}
              style={styles.btnGhost}
              title="Open Reminders.md in the active pane for full editing"
            >
              Open in pane
            </button>
          )}
          <div style={{ flex: 1 }} />
          <span style={styles.muted}>
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button
            onClick={onClose}
            style={styles.btnGhost}
            disabled={saving}
            title="Close without saving"
          >
            Cancel
          </button>
          <button
            onClick={saveAndClose}
            style={styles.btnPrimary}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save & close"}
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
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "8vh",
    zIndex: 1500,
  },
  panel: {
    width: "min(720px, 92vw)",
    maxHeight: "calc(100vh - 12vh)",
    display: "flex",
    flexDirection: "column",
    padding: "1rem 1.25rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: "0.4rem",
  },
  heading: { margin: 0, fontSize: "1.05rem", fontWeight: 600 },
  hint: {
    margin: "0 0 0.85rem",
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  quickRow: {
    display: "flex",
    gap: "0.4rem",
    marginBottom: "0.6rem",
  },
  input: {
    flex: 1,
    padding: "0.45rem 0.7rem",
    fontSize: "0.9rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  textarea: {
    flex: 1,
    minHeight: "240px",
    maxHeight: "60vh",
    padding: "0.7rem 0.85rem",
    fontSize: "0.88rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    resize: "vertical",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    boxSizing: "border-box",
  },
  error: {
    margin: "0.6rem 0 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  footer: {
    marginTop: "0.85rem",
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
  },
  btnPrimary: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  muted: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
  },
};
