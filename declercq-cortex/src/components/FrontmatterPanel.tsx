import { useState } from "react";

interface FrontmatterPanelProps {
  frontmatter: Record<string, unknown>;
}

/**
 * Collapsible summary of the file's YAML frontmatter.
 *
 * Phase 1 is read-only: the panel shows what's there and lets the user
 * verify values, but doesn't let them edit. Full frontmatter editing
 * lands in Phase 2 alongside the Project/Experiment schema.
 */
export function FrontmatterPanel({ frontmatter }: FrontmatterPanelProps) {
  const entries = Object.entries(frontmatter);
  const [collapsed, setCollapsed] = useState(true);

  if (entries.length === 0) return null;

  return (
    <div style={styles.panel}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={styles.header}
        aria-expanded={!collapsed}
      >
        <span style={styles.caret}>{collapsed ? "▸" : "▾"}</span>
        <span>Frontmatter ({entries.length})</span>
      </button>
      {!collapsed && (
        <div style={styles.body}>
          {entries.map(([key, value]) => (
            <div key={key} style={styles.row}>
              <span style={styles.key}>{key}:</span>
              <span style={styles.value}>{formatValue(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginBottom: "1rem",
    background: "var(--accent-bg)",
    border: "1px solid var(--accent-bg-2)",
    borderRadius: "5px",
    fontSize: "0.8rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    padding: "6px 10px",
    background: "transparent",
    color: "var(--text-2)",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    userSelect: "none",
  },
  caret: {
    width: "10px",
    fontSize: "0.7rem",
    color: "var(--text-muted)",
  },
  body: {
    padding: "0 10px 8px 28px",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    color: "var(--text)",
  },
  row: {
    display: "flex",
    gap: "6px",
    marginBottom: "2px",
    lineHeight: 1.45,
  },
  key: {
    color: "var(--text-muted)",
    minWidth: "5em",
  },
  value: {
    flex: 1,
    wordBreak: "break-all",
  },
};
