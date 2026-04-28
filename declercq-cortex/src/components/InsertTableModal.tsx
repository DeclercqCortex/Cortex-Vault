import { useEffect, useRef, useState } from "react";

interface InsertTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen dimensions if the user submits. */
  onConfirm: (rows: number, cols: number, withHeaderRow: boolean) => void;
}

const MIN_ROWS = 1;
const MAX_ROWS = 20;
const MIN_COLS = 1;
const MAX_COLS = 10;

/**
 * Dialog asking for new-table dimensions. Reachable from the editor's
 * right-click "Insert table…" item and from the Ctrl+Shift+T shortcut.
 *
 * Defaults: 3 rows × 3 cols, header row on. The header-row checkbox is
 * the cheapest path to a reasonable-looking table; users can flip it off
 * for a plain grid.
 */
export function InsertTableModal({
  isOpen,
  onClose,
  onConfirm,
}: InsertTableModalProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rowsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRows(3);
    setCols(3);
    setWithHeaderRow(true);
    setError(null);
    setTimeout(() => rowsRef.current?.focus(), 0);
  }, [isOpen]);

  if (!isOpen) return null;

  function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  function submit() {
    const r = clamp(rows, MIN_ROWS, MAX_ROWS);
    const c = clamp(cols, MIN_COLS, MAX_COLS);
    if (r < MIN_ROWS || c < MIN_COLS) {
      setError("Rows and columns must be at least 1.");
      return;
    }
    onConfirm(r, c, withHeaderRow);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Insert table"
      >
        <h2 style={styles.heading}>Insert table</h2>
        <p style={styles.hint}>
          Inserts at the cursor. Tab moves between cells once it's in. You can
          add or delete rows/columns later via right-click inside the table.
        </p>

        <div style={styles.row}>
          <label style={styles.label}>
            <span style={styles.labelText}>Rows</span>
            <input
              ref={rowsRef}
              type="number"
              min={MIN_ROWS}
              max={MAX_ROWS}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
              style={styles.input}
            />
          </label>
          <span style={styles.times}>×</span>
          <label style={styles.label}>
            <span style={styles.labelText}>Columns</span>
            <input
              type="number"
              min={MIN_COLS}
              max={MAX_COLS}
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
              style={styles.input}
            />
          </label>
        </div>

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={withHeaderRow}
            onChange={(e) => setWithHeaderRow(e.target.checked)}
          />
          <span style={styles.labelText}>With header row</span>
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnGhost}>
            Cancel
          </button>
          <button onClick={submit} style={styles.btnPrimary}>
            Insert
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
    minWidth: "400px",
    maxWidth: "480px",
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
  row: {
    display: "flex",
    alignItems: "flex-end",
    gap: "0.6rem",
    marginBottom: "0.85rem",
  },
  label: { display: "block", flex: 1 },
  labelText: {
    display: "block",
    fontSize: "0.78rem",
    color: "var(--text-2)",
    marginBottom: "0.25rem",
  },
  input: {
    width: "100%",
    padding: "0.45rem 0.6rem",
    fontSize: "0.95rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    boxSizing: "border-box",
  },
  times: {
    color: "var(--text-muted)",
    fontSize: "1.1rem",
    paddingBottom: "0.55rem",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    marginBottom: "0.4rem",
  },
  error: {
    margin: "0.5rem 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  footer: {
    marginTop: "1.25rem",
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
  },
  btnGhost: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
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
};
