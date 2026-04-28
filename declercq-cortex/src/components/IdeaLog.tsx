import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import matter from "gray-matter";
import { parseFrontmatter, serializeFrontmatter } from "../utils/frontmatter";

// -----------------------------------------------------------------------------
// Phase 3 — Cluster 8 — Idea Log
//
// A read-mostly table over notes whose frontmatter has `type: idea`. The one
// exception to "read-only" is the status field, which the spec calls out as
// the most-edited field — making it a one-click dropdown is justified.
// Everything else is click-through to the underlying note.
// -----------------------------------------------------------------------------

/** What Rust returns from `query_notes_by_type`. */
interface NoteWithMetadata {
  path: string;
  title: string;
  /** Raw YAML between the `---`s, no fences. May be "". */
  frontmatter_yaml: string;
  modified_at: number;
}

/** Idea-specific frontmatter shape. All fields optional; v1 is forgiving. */
interface IdeaFrontmatter {
  status?: string;
  date_conceived?: string;
  related_concepts?: string[];
  [key: string]: unknown;
}

/** Decorated row: parsed frontmatter merged with the note metadata. */
interface IdeaRow extends NoteWithMetadata {
  frontmatter: IdeaFrontmatter;
}

const STATUS_VALUES = ["raw", "promising", "abandoned", "promoted"] as const;
type IdeaStatus = (typeof STATUS_VALUES)[number];

/** "raw" if the value isn't one of the known states. */
function normaliseStatus(s: unknown): IdeaStatus {
  return STATUS_VALUES.includes(s as IdeaStatus) ? (s as IdeaStatus) : "raw";
}

const STATUS_ORDER: Record<IdeaStatus, number> = {
  raw: 0,
  promising: 1,
  promoted: 2,
  abandoned: 3,
};

const STATUS_COLOURS: Record<IdeaStatus, string> = {
  raw: "var(--text-muted)",
  promising: "var(--accent)",
  promoted: "var(--success, #22a06b)",
  abandoned: "var(--text-muted)",
};

type SortKey = "status" | "date_conceived" | "title" | "modified";

interface IdeaLogProps {
  vaultPath: string;
  /** Bumped when ideas may have changed (e.g., after creating one). */
  refreshKey?: number;
  /** Open the underlying note. */
  onOpenFile: (path: string) => void;
  /** Close this view (return to editor). */
  onClose: () => void;
  /** Open the New Idea modal. */
  onNewIdea: () => void;
}

/**
 * Idea Log view — table over `type: idea` notes with sort, status filter,
 * and inline status edit. Opens via the command palette / sidebar; replaces
 * the editor pane while open.
 */
export function IdeaLog({
  vaultPath,
  refreshKey = 0,
  onOpenFile,
  onClose,
  onNewIdea,
}: IdeaLogProps) {
  const [rows, setRows] = useState<IdeaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | IdeaStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [updating, setUpdating] = useState<string | null>(null);
  const [bumpFetch, setBumpFetch] = useState(0);

  // Fetch + parse frontmatter on the frontend. The Rust side gives us the
  // raw YAML block; gray-matter handles the parse — same library used for
  // the open-file frontmatter panel, so quirks are at least consistent.
  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<NoteWithMetadata[]>("query_notes_by_type", {
      vaultPath,
      noteType: "idea",
    })
      .then((notes) => {
        const decorated: IdeaRow[] = notes.map((n) => {
          let fm: IdeaFrontmatter = {};
          if (n.frontmatter_yaml.length > 0) {
            try {
              const synthetic = `---\n${n.frontmatter_yaml}\n---\n`;
              fm = matter(synthetic).data as IdeaFrontmatter;
            } catch (e) {
              console.warn("idea frontmatter parse failed:", n.path, e);
            }
          }
          return { ...n, frontmatter: fm };
        });
        setRows(decorated);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [vaultPath, refreshKey, bumpFetch]);

  // Filtered + sorted view of the rows.
  const visible = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? rows
        : rows.filter(
            (r) => normaliseStatus(r.frontmatter.status) === statusFilter,
          );

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "status": {
          const sa = STATUS_ORDER[normaliseStatus(a.frontmatter.status)];
          const sb = STATUS_ORDER[normaliseStatus(b.frontmatter.status)];
          if (sa !== sb) return sa - sb;
          // Tiebreak on most-recent first.
          return b.modified_at - a.modified_at;
        }
        case "date_conceived": {
          const da = a.frontmatter.date_conceived ?? "";
          const db = b.frontmatter.date_conceived ?? "";
          // Lexical comparison works for ISO YYYY-MM-DD; descending.
          return db.localeCompare(da);
        }
        case "title":
          return a.title.localeCompare(b.title);
        case "modified":
          return b.modified_at - a.modified_at;
      }
    });
    return sorted;
  }, [rows, statusFilter, sortKey]);

  // Inline status update — read, mutate frontmatter, write back, re-index.
  // We don't refetch the whole table; we just patch the row in-place to
  // avoid a flash of "Loading…", and bump fetch on the next refresh trigger.
  async function setRowStatus(row: IdeaRow, next: IdeaStatus) {
    if (updating) return;
    if (normaliseStatus(row.frontmatter.status) === next) return;
    setUpdating(row.path);
    setError(null);
    try {
      const raw = await invoke<string>("read_markdown_file", {
        path: row.path,
      });
      const { frontmatter, body } = parseFrontmatter(raw);
      const updated = { ...frontmatter, status: next };
      const newRaw = serializeFrontmatter(updated, body);
      await invoke("write_markdown_file", {
        path: row.path,
        content: newRaw,
      });
      await invoke("index_single_file", {
        vaultPath,
        filePath: row.path,
      });

      // Patch the local row so the dropdown reflects the change immediately.
      setRows((prev) =>
        prev.map((r) =>
          r.path === row.path
            ? { ...r, frontmatter: { ...r.frontmatter, status: next } }
            : r,
        ),
      );
    } catch (e) {
      console.error("status update failed:", e);
      setError(`Could not update status: ${e}`);
      // Force a refetch so the UI doesn't lie about state.
      setBumpFetch((b) => b + 1);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>Idea Log</h2>
          <div style={styles.headerActions}>
            <button onClick={onNewIdea} style={styles.newBtn} title="New idea">
              + New idea
            </button>
            <button
              onClick={onClose}
              style={styles.backBtn}
              title="Back to editor"
            >
              ← Back
            </button>
          </div>
        </div>
        <p style={styles.blurb}>
          Hypotheses, candidate directions, and half-formed thoughts. Each row
          is a note in <code style={styles.codeInline}>04-Ideas/</code> with{" "}
          <code style={styles.codeInline}>type: idea</code>. Click a title to
          open it; change status inline.
        </p>
      </header>

      <div style={styles.controls}>
        <label style={styles.controlLabel}>
          <span style={styles.controlText}>Filter</span>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | IdeaStatus)
            }
            style={styles.select}
          >
            <option value="all">All statuses</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.controlLabel}>
          <span style={styles.controlText}>Sort by</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={styles.select}
          >
            <option value="status">Status</option>
            <option value="date_conceived">Date conceived</option>
            <option value="title">Title</option>
            <option value="modified">Last modified</option>
          </select>
        </label>
        <span style={styles.count}>
          {visible.length} of {rows.length}
        </span>
      </div>

      {loading ? (
        <div style={styles.muted}>Loading ideas…</div>
      ) : error ? (
        <div style={styles.error}>Error: {error}</div>
      ) : rows.length === 0 ? (
        <div style={styles.muted}>
          No ideas yet. Click <strong>+ New idea</strong> above (or use the
          sidebar's <strong>+ Idea</strong> button) to create one.
        </div>
      ) : visible.length === 0 ? (
        <div style={styles.muted}>
          No ideas match the current filter. Try{" "}
          <button onClick={() => setStatusFilter("all")} style={styles.linkBtn}>
            All statuses
          </button>
          .
        </div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Conceived</th>
              <th style={styles.th}>Related concepts</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const status = normaliseStatus(row.frontmatter.status);
              const related = Array.isArray(row.frontmatter.related_concepts)
                ? row.frontmatter.related_concepts
                : [];
              const conceived = row.frontmatter.date_conceived ?? "";
              return (
                <tr key={row.path} style={styles.row}>
                  <td style={styles.td}>
                    <select
                      value={status}
                      onChange={(e) =>
                        setRowStatus(row, e.target.value as IdeaStatus)
                      }
                      disabled={updating === row.path}
                      style={{
                        ...styles.statusSelect,
                        color: STATUS_COLOURS[status],
                      }}
                      onClick={(e) => e.stopPropagation()}
                      title="Change status"
                    >
                      {STATUS_VALUES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => onOpenFile(row.path)}
                      style={styles.titleBtn}
                      title={row.path}
                    >
                      {row.title}
                    </button>
                  </td>
                  <td style={styles.tdMuted}>{conceived || "—"}</td>
                  <td style={styles.tdMuted}>
                    {related.length === 0
                      ? "—"
                      : related
                          .map((r) =>
                            typeof r === "string"
                              ? r.replace(/^\[\[/, "").replace(/\]\]$/, "")
                              : String(r),
                          )
                          .join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    maxWidth: "880px",
    margin: "0 auto",
  },
  header: {
    paddingBottom: "0.75rem",
    marginBottom: "1rem",
    borderBottom: "1px solid var(--border)",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  },
  headerActions: {
    display: "flex",
    gap: "0.5rem",
  },
  title: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 600,
    color: "var(--text)",
  },
  newBtn: {
    fontSize: "0.8rem",
    padding: "4px 12px",
    cursor: "pointer",
    background: "var(--primary)",
    color: "white",
    border: "none",
    borderRadius: "4px",
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
  codeInline: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    background: "var(--code-bg)",
    padding: "1px 4px",
    borderRadius: "3px",
    fontSize: "0.85em",
  },
  controls: {
    display: "flex",
    alignItems: "baseline",
    gap: "1rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  controlLabel: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.4rem",
  },
  controlText: {
    fontSize: "0.78rem",
    color: "var(--text-2)",
  },
  select: {
    padding: "3px 6px",
    fontSize: "0.85rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  count: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    marginLeft: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
  },
  th: {
    textAlign: "left",
    padding: "6px 10px",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: "1px solid var(--border)",
  },
  row: {
    borderBottom: "1px solid var(--border)",
  },
  td: {
    padding: "8px 10px",
    verticalAlign: "top",
    color: "var(--text)",
  },
  tdMuted: {
    padding: "8px 10px",
    verticalAlign: "top",
    color: "var(--text-muted)",
    fontSize: "0.85rem",
  },
  titleBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--accent)",
    fontSize: "0.95rem",
    fontWeight: 500,
    padding: 0,
    textAlign: "left",
  },
  statusSelect: {
    padding: "2px 4px",
    fontSize: "0.78rem",
    background: "var(--bg-deep)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    fontWeight: 500,
    textTransform: "lowercase",
  },
  muted: {
    color: "var(--text-muted)",
    fontSize: "0.9rem",
    padding: "1.5rem 0",
  },
  error: {
    color: "var(--danger)",
    fontSize: "0.85rem",
    padding: "1rem 0",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "var(--accent)",
    cursor: "pointer",
    padding: 0,
    fontSize: "inherit",
    textDecoration: "underline",
  },
};
