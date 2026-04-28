import { useState } from "react";
import type { DestinationChoice } from "./ReviewsMenu";

interface ColorLegendProps {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Routes legend clicks to the same handler the ReviewsMenu uses, so a
   * click on "Yellow" opens the Weekly Review view, etc.
   */
  onPickDestination: (choice: DestinationChoice) => void;
}

interface ColorEntry {
  color: "yellow" | "green" | "pink" | "blue" | "orange" | "red" | "purple";
  name: string;
  destination: string;
  shortcut: string;
  /** null = clickable as informational (e.g., pink has no direct view yet). */
  click: DestinationChoice | null;
}

interface SpecialEntry {
  glyph: string;
  name: string;
  destination: string;
  shortcut: string;
  /** Disabled rows render dim and ignore click. */
  disabled: boolean;
}

const COLOR_ENTRIES: ColorEntry[] = [
  {
    color: "yellow",
    name: "Yellow",
    destination: "Weekly review",
    shortcut: "Ctrl+1",
    click: { kind: "queue", queueKind: "yellow" },
  },
  {
    color: "green",
    name: "Green",
    destination: "Monthly review",
    shortcut: "Ctrl+2",
    click: { kind: "queue", queueKind: "green" },
  },
  {
    color: "pink",
    name: "Pink",
    destination: "Tomorrow (carryover)",
    shortcut: "Ctrl+3",
    // No virtual destination view — pink injects into the next daily.
    click: null,
  },
  {
    color: "blue",
    name: "Blue",
    destination: "Concept inbox",
    shortcut: "Ctrl+4",
    click: { kind: "persistent", persistentKind: "concepts" },
  },
  {
    color: "orange",
    name: "Orange",
    destination: "Anti-Hype",
    shortcut: "Ctrl+5",
    click: { kind: "persistent", persistentKind: "antihype" },
  },
  {
    color: "red",
    name: "Red",
    destination: "Bottlenecks",
    shortcut: "Ctrl+6",
    click: { kind: "persistent", persistentKind: "bottlenecks" },
  },
  {
    color: "purple",
    name: "Purple",
    destination: "Citations to use",
    shortcut: "Ctrl+7",
    click: { kind: "persistent", persistentKind: "citations" },
  },
];

const SPECIAL_ENTRIES: SpecialEntry[] = [
  {
    glyph: "~~ ~~",
    name: "Strikethrough",
    destination: "Resolved (filters from queues)",
    shortcut: "Ctrl+Shift+X",
    disabled: false,
  },
  {
    glyph: "==text==",
    name: "Advisor",
    destination: "Advisor prep (Cluster 3 follow-up)",
    shortcut: "Ctrl+Shift+Q",
    disabled: true,
  },
  {
    glyph: "::experiment",
    name: "Experiment block",
    destination: "Iteration routing (Cluster 4)",
    shortcut: "/experiment",
    disabled: true,
  },
  {
    glyph: "**bold**",
    name: "Bold",
    destination: "Tag (no routing)",
    shortcut: "Ctrl+B",
    disabled: true,
  },
];

/**
 * Always-visible (until dismissed) reference for the Mark System. Lives
 * in the bottom-right corner. Lets the user:
 *
 *   - Look up "what does yellow mean again?" without leaving the editor
 *   - Click any colored entry to jump to its destination
 *   - Collapse to a one-line header when they don't need the full reference
 *   - Session-dismiss with the ✕ button (re-open with Ctrl+L)
 *
 * The component returns null when not visible.
 */
export function ColorLegend({
  visible,
  onDismiss,
  onPickDestination,
}: ColorLegendProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!visible) return null;

  return (
    <aside style={styles.panel} role="complementary" aria-label="Mark legend">
      <header style={styles.header}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={styles.collapseBtn}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <span style={styles.caret}>{collapsed ? "▸" : "▾"}</span>
          <span style={styles.headerLabel}>Mark legend</span>
        </button>
        <button
          onClick={onDismiss}
          style={styles.dismissBtn}
          title="Hide for this session (Ctrl+L to re-open)"
          aria-label="Dismiss legend"
        >
          ✕
        </button>
      </header>

      {!collapsed && (
        <>
          <ul style={styles.list}>
            {COLOR_ENTRIES.map((e) => {
              const clickable = e.click !== null;
              return (
                <li
                  key={e.color}
                  onClick={
                    clickable ? () => onPickDestination(e.click!) : undefined
                  }
                  style={{
                    ...styles.row,
                    cursor: clickable ? "pointer" : "default",
                  }}
                  title={
                    clickable
                      ? `Open ${e.destination}`
                      : "No direct view — used in tomorrow's daily log carryover"
                  }
                >
                  <span
                    className={`mark-${e.color}`}
                    style={styles.swatch}
                    aria-hidden="true"
                  />
                  <span style={styles.name}>{e.name}</span>
                  <span style={styles.dest}>{e.destination}</span>
                  <kbd style={styles.kbd}>{e.shortcut}</kbd>
                </li>
              );
            })}
          </ul>

          <div style={styles.divider} />

          <ul style={styles.list}>
            {SPECIAL_ENTRIES.map((e) => (
              <li
                key={e.glyph}
                style={{
                  ...styles.row,
                  cursor: "default",
                  opacity: e.disabled ? 0.55 : 1,
                }}
                title={
                  e.disabled ? `${e.destination} — not built yet` : undefined
                }
              >
                <code style={styles.glyph}>{e.glyph}</code>
                <span style={styles.name}>{e.name}</span>
                <span style={styles.dest}>{e.destination}</span>
                <kbd style={styles.kbd}>{e.shortcut}</kbd>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "fixed",
    bottom: "12px",
    right: "12px",
    width: "320px",
    maxHeight: "calc(100vh - 24px)",
    overflowY: "auto",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow)",
    fontSize: "0.78rem",
    zIndex: 100,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "5px 8px 5px 10px",
    background: "var(--bg-elev)",
    borderBottom: "1px solid var(--border)",
  },
  collapseBtn: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    background: "transparent",
    color: "var(--text-2)",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: "0.78rem",
  },
  caret: {
    fontSize: "0.65rem",
    color: "var(--text-muted)",
  },
  headerLabel: {
    fontWeight: 500,
  },
  dismissBtn: {
    width: "20px",
    height: "20px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    cursor: "pointer",
    padding: 0,
  },
  list: {
    listStyle: "none",
    padding: "4px 0",
    margin: 0,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "20px 70px 1fr auto",
    columnGap: "8px",
    alignItems: "center",
    padding: "4px 10px",
  },
  swatch: {
    width: "14px",
    height: "14px",
    borderRadius: "3px",
    display: "inline-block",
  },
  glyph: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.7rem",
    background: "var(--code-bg)",
    color: "var(--text-2)",
    padding: "1px 4px",
    borderRadius: "3px",
    width: "fit-content",
    justifySelf: "start",
    minWidth: "14px",
  },
  name: {
    color: "var(--text)",
  },
  dest: {
    color: "var(--text-muted)",
    fontSize: "0.72rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  kbd: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.7rem",
    color: "var(--accent)",
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    padding: "1px 5px",
    whiteSpace: "nowrap",
  },
  divider: {
    height: "1px",
    background: "var(--border)",
    margin: "2px 0",
  },
};
