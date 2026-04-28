import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MarkWithSource {
  id: number;
  kind: string;
  text: string;
  context: string;
  line_number: number;
  resolved: boolean;
  injected_at: number | null;
  source_path: string;
  source_title: string;
  source_modified: number;
}

interface MarkQueueViewProps {
  vaultPath: string;
  /** The mark color to query. */
  kind: "yellow" | "green" | "pink" | "blue" | "orange" | "red" | "purple";
  /** Window in days. Yellow → 7. Green → 30. Etc. */
  ageDays?: number;
  /** Title shown in the header. */
  title: string;
  /** Subtitle / explainer below the title. */
  blurb: string;
  /** Bumped when marks may have changed (e.g., on save). */
  refreshKey?: number;
  /** Open the source note. */
  onOpenFile: (path: string) => void;
  /** Close this view (return to editor). */
  onClose: () => void;
}

/**
 * Virtual destination view used by the Weekly Review (yellow), Monthly
 * Review (green), and (later) Advisor Meeting Prep destinations. Reads
 * from the marks table and groups by source note.
 *
 * Replaces the editor pane while open. The "Back" button returns to
 * whatever was previously in the main pane.
 */
export function MarkQueueView({
  vaultPath,
  kind,
  ageDays,
  title,
  blurb,
  refreshKey = 0,
  onOpenFile,
  onClose,
}: MarkQueueViewProps) {
  const [marks, setMarks] = useState<MarkWithSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<MarkWithSource[]>("query_marks", {
      vaultPath,
      kind,
      maxAgeDays: ageDays ?? null,
      includeResolved: false,
      onlyUninjected: false,
    })
      .then((rows) => {
        setMarks(rows);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [vaultPath, kind, ageDays, refreshKey]);

  // Group marks by source path, preserving the "most-recent first" order
  // from the SQL query.
  const groups: {
    path: string;
    title: string;
    modified: number;
    items: MarkWithSource[];
  }[] = [];
  for (const m of marks) {
    let g = groups.find((gg) => gg.path === m.source_path);
    if (!g) {
      g = {
        path: m.source_path,
        title: m.source_title,
        modified: m.source_modified,
        items: [],
      };
      groups.push(g);
    }
    g.items.push(m);
  }

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>{title}</h2>
          <button
            onClick={onClose}
            style={styles.backBtn}
            title="Back to editor"
          >
            ← Back
          </button>
        </div>
        <p style={styles.blurb}>{blurb}</p>
      </header>

      {loading ? (
        <div style={styles.muted}>Loading marks…</div>
      ) : error ? (
        <div style={styles.error}>Error: {error}</div>
      ) : groups.length === 0 ? (
        <div style={styles.muted}>
          No {kind} marks {ageDays ? `in the last ${ageDays} days` : ""}.
          Highlight some text in your notes with the matching shortcut to
          populate this view.
        </div>
      ) : (
        <ul style={styles.groupList}>
          {groups.map((g) => (
            <li key={g.path} style={styles.group}>
              <button
                onClick={() => onOpenFile(g.path)}
                style={styles.groupHeader}
              >
                {g.title}{" "}
                <span style={styles.groupCount}>({g.items.length})</span>
              </button>
              <ul style={styles.itemList}>
                {g.items.map((it) => (
                  <li key={it.id} style={styles.item}>
                    <code style={styles.line}>L{it.line_number}</code>{" "}
                    <span style={styles.context}>
                      {stripMarkTags(it.context)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Drop `<mark class="mark-X">` and `</mark>` from a string. */
function stripMarkTags(s: string): string {
  return s.replace(/<mark[^>]*>/g, "").replace(/<\/mark>/g, "");
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    maxWidth: "780px",
    margin: "0 auto",
  },
  header: {
    paddingBottom: "0.75rem",
    marginBottom: "1.25rem",
    borderBottom: "1px solid var(--border)",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  },
  title: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 600,
    color: "var(--text)",
  },
  backBtn: {
    fontSize: "0.8rem",
    padding: "4px 12px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  blurb: {
    margin: "0.4rem 0 0",
    fontSize: "0.85rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  muted: {
    color: "var(--text-muted)",
    fontSize: "0.9rem",
    padding: "1rem 0",
  },
  error: {
    color: "var(--danger)",
    fontSize: "0.85rem",
    padding: "1rem 0",
  },
  groupList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  group: {
    marginBottom: "1.5rem",
    paddingBottom: "1rem",
    borderBottom: "1px solid var(--border)",
  },
  groupHeader: {
    background: "none",
    border: "none",
    color: "var(--accent)",
    cursor: "pointer",
    padding: 0,
    fontSize: "1rem",
    fontWeight: 500,
    marginBottom: "0.4rem",
  },
  groupCount: {
    color: "var(--text-muted)",
    fontWeight: 400,
    fontSize: "0.85rem",
  },
  itemList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  item: {
    padding: "0.25rem 0",
    fontSize: "0.9rem",
    color: "var(--text)",
    lineHeight: 1.5,
  },
  line: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    background: "var(--code-bg)",
    padding: "1px 5px",
    borderRadius: "3px",
    marginRight: "4px",
  },
  context: {
    color: "var(--text)",
  },
};
