import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Backlink {
  path: string;
  title: string;
}

interface BacklinksPanelProps {
  vaultPath: string;
  /** H1 title of the current note. Used as the primary backlink key. */
  currentTitle: string;
  /**
   * Filename without `.md` of the current note. Used as a secondary
   * key — covers wikilinks of the form `[[NOTES]]` pointing at a file
   * whose H1 is something else like "Cortex — Project Notes".
   */
  currentFilename?: string;
  /** Re-fetch when the index has been updated externally (e.g., on save). */
  refreshKey?: number;
  onOpenFile: (path: string) => void;
}

export function BacklinksPanel({
  vaultPath,
  currentTitle,
  currentFilename,
  refreshKey = 0,
  onOpenFile,
}: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  useEffect(() => {
    if (!currentTitle && !currentFilename) {
      setBacklinks([]);
      return;
    }
    invoke<Backlink[]>("get_backlinks", {
      vaultPath,
      targetTitle: currentTitle,
      targetFilename: currentFilename ?? null,
    })
      .then(setBacklinks)
      .catch((e) => {
        console.warn("get_backlinks failed:", e);
        setBacklinks([]);
      });
  }, [vaultPath, currentTitle, currentFilename, refreshKey]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        Linked mentions <span style={styles.count}>({backlinks.length})</span>
      </div>
      {backlinks.length === 0 ? (
        <div style={styles.empty}>
          No notes link to this one yet. Type{" "}
          <code style={styles.codeInline}>[[{currentTitle || "title"}]]</code>{" "}
          in another note and save to create a backlink.
        </div>
      ) : (
        <ul style={styles.list}>
          {backlinks.map((b) => (
            <li key={b.path} style={styles.item}>
              <button onClick={() => onOpenFile(b.path)} style={styles.link}>
                {b.title}
              </button>
              <code style={styles.path}>{b.path}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: "2rem",
    paddingTop: "1rem",
    borderTop: "1px solid var(--border)",
  },
  header: {
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: "0.5rem",
  },
  count: { fontWeight: 400 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: {
    padding: "0.35rem 0",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  link: {
    background: "none",
    border: "none",
    color: "var(--accent)",
    cursor: "pointer",
    padding: 0,
    fontSize: "0.95rem",
    textAlign: "left",
  },
  path: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    wordBreak: "break-all",
  },
  empty: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  codeInline: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    background: "var(--code-bg)",
    padding: "1px 4px",
    borderRadius: "3px",
    fontSize: "0.85em",
    color: "var(--text)",
  },
};
