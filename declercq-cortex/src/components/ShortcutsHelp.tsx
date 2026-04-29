interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Row {
  keys: string;
  action: string;
}

const ALWAYS: Row[] = [
  { keys: "Ctrl+S", action: "Save current note (active tab only)" },
  { keys: "Ctrl+R", action: "Reload current note from disk (active tab only)" },
  { keys: "Ctrl+D", action: "Open today's daily log (in active tab)" },
  { keys: "Ctrl+K", action: "Search notes / command palette" },
  { keys: "Ctrl+/", action: "Show this help" },
  { keys: "Ctrl+L", action: "Toggle the colour legend" },
  { keys: "Ctrl+Shift+B", action: "Insert ::experiment block in editor" },
  { keys: "Ctrl+Shift+T", action: "Insert a table at the cursor" },
  { keys: "Ctrl+Shift+G", action: "Insert today's GitHub summary at cursor" },
  { keys: "Ctrl+Shift+C", action: "Switch active slot to the Calendar view" },
  {
    keys: "Ctrl+Shift+M",
    action: "Open Reminders overlay (memo / quick-capture)",
  },
  { keys: "Ctrl+,", action: "Open Integrations settings (GitHub)" },
  { keys: "Click", action: "(Tree) Open file in slot 1 (single/dual layout)" },
  { keys: "Ctrl+Click", action: "(Tree) Open file in slot 2 (dual layout)" },
  { keys: "Drag", action: "(Tree) Drop file into a specific slot (tri/quad)" },
  { keys: "Esc", action: "Close any modal" },
];

const SIDEBAR_MODE: Row[] = [
  { keys: "Ctrl+N", action: "New note" },
  { keys: "Ctrl+Shift+P", action: "New project" },
  { keys: "Ctrl+Shift+E", action: "New experiment" },
  { keys: "Ctrl+Shift+I", action: "New iteration" },
  { keys: "↑↓ + Enter", action: "Navigate / open in palette" },
];

const EDITOR_MODE: Row[] = [
  { keys: "Ctrl+B", action: "Bold" },
  { keys: "Ctrl+I", action: "Italic" },
  { keys: "Ctrl+U", action: "Underline" },
  { keys: "Ctrl+Shift+X", action: "Strikethrough (also resolves a mark)" },
  { keys: "Ctrl+Shift+L", action: "Align left" },
  { keys: "Ctrl+Shift+E", action: "Align centre" },
  { keys: "Ctrl+Shift+R", action: "Align right" },
  { keys: "Ctrl+1", action: "Mark selection — yellow (weekly review)" },
  { keys: "Ctrl+2", action: "Mark selection — green (monthly review)" },
  { keys: "Ctrl+3", action: "Mark selection — pink (tomorrow's daily)" },
  { keys: "Ctrl+4", action: "Mark selection — blue (concept inbox)" },
  { keys: "Ctrl+5", action: "Mark selection — orange (anti-hype)" },
  { keys: "Ctrl+6", action: "Mark selection — red (bottlenecks)" },
  { keys: "Ctrl+7", action: "Mark selection — purple (citations)" },
  { keys: "Tab / Shift+Tab", action: "Next/previous cell when inside a table" },
  {
    keys: "Right-click",
    action: "Table operations menu (insert/add/delete row/column/etc.)",
  },
  { keys: "Ctrl+Click", action: "Follow [[wikilink]] under cursor" },
  { keys: "Double-click", action: "Select the whole highlighted range" },
];

const PLANNED: Row[] = [
  {
    keys: "Ctrl+Shift+Q",
    action: "Advisor mark ==text== (Cluster 3 follow-up)",
  },
];

export function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps) {
  if (!isOpen) return null;
  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <h2 style={styles.heading}>Keyboard shortcuts</h2>

        <div style={styles.subhead}>Always active</div>
        <table style={styles.table}>
          <tbody>
            {ALWAYS.map((s) => (
              <tr key={s.keys}>
                <td style={styles.keyCell}>
                  <kbd style={styles.kbd}>{s.keys}</kbd>
                </td>
                <td style={styles.actionCell}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.subhead}>
          Sidebar mode{" "}
          <span style={styles.subheadHint}>
            (when the editor isn&apos;t focused)
          </span>
        </div>
        <table style={styles.table}>
          <tbody>
            {SIDEBAR_MODE.map((s) => (
              <tr key={s.keys}>
                <td style={styles.keyCell}>
                  <kbd style={styles.kbd}>{s.keys}</kbd>
                </td>
                <td style={styles.actionCell}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.subhead}>
          Editor mode{" "}
          <span style={styles.subheadHint}>(when typing in a note)</span>
        </div>
        <table style={styles.table}>
          <tbody>
            {EDITOR_MODE.map((s) => (
              <tr key={s.keys}>
                <td style={styles.keyCell}>
                  <kbd style={styles.kbd}>{s.keys}</kbd>
                </td>
                <td style={styles.actionCell}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.subhead}>Coming later</div>
        <table style={styles.table}>
          <tbody>
            {PLANNED.map((s) => (
              <tr key={s.keys} style={{ opacity: 0.55 }}>
                <td style={styles.keyCell}>
                  <kbd style={styles.kbd}>{s.keys}</kbd>
                </td>
                <td style={styles.actionCell}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.closeBtn}>
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
    minWidth: "420px",
    maxWidth: "560px",
    // Constrain so the panel fits in the viewport with margin; overflow
    // scrolls inside the panel rather than letting it grow off-screen.
    maxHeight: "calc(100vh - 6rem)",
    overflowY: "auto",
    padding: "1.5rem 1.75rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
  },
  heading: {
    margin: "0 0 1rem",
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  subhead: {
    marginTop: "1rem",
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  },
  subheadHint: {
    marginLeft: "0.4rem",
    textTransform: "none",
    letterSpacing: "0",
    fontSize: "0.7rem",
    fontStyle: "italic",
    color: "var(--text-muted)",
    fontWeight: 400,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  keyCell: {
    padding: "5px 0",
    width: "30%",
    verticalAlign: "top",
  },
  actionCell: {
    padding: "5px 0",
    color: "var(--text-2)",
    fontSize: "0.9rem",
  },
  kbd: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.75rem",
    color: "var(--accent)",
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    padding: "1px 6px",
  },
  footer: {
    marginTop: "1.25rem",
    display: "flex",
    justifyContent: "flex-end",
  },
  closeBtn: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
};
