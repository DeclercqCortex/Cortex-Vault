import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HierarchyItem {
  path: string;
  name: string;
  iter_number: number | null;
  modeling: boolean | null;
}

interface HierarchyContext {
  kind: string; // 'project' | 'experiment' | 'iteration' | ''
  parent: HierarchyItem | null;
  siblings: HierarchyItem[];
}

interface Props {
  vaultPath: string;
  /** Absolute path of the currently-open file. */
  currentPath: string;
  /** Bumped on save / index updates so we re-fetch. */
  refreshKey?: number;
  onOpenFile: (path: string) => void;
}

/**
 * Hierarchy-aware navigation aid that sits above BacklinksPanel:
 *
 *   - On a PROJECT index.md          → "Experiments in this project"
 *   - On an EXPERIMENT index.md      → parent project + "Other experiments"
 *   - On an ITERATION iter-NN file   → parent experiment + "Other iterations"
 *   - On any other file              → renders nothing (returns null)
 *
 * Driven by Rust's `get_hierarchy_context` which reads the SQLite hierarchy
 * table populated during indexing.
 */
export function RelatedHierarchyPanel({
  vaultPath,
  currentPath,
  refreshKey = 0,
  onOpenFile,
}: Props) {
  const [ctx, setCtx] = useState<HierarchyContext | null>(null);

  useEffect(() => {
    if (!currentPath) {
      setCtx(null);
      return;
    }
    invoke<HierarchyContext>("get_hierarchy_context", {
      vaultPath,
      currentPath,
    })
      .then(setCtx)
      .catch((e) => {
        console.warn("get_hierarchy_context failed:", e);
        setCtx(null);
      });
  }, [vaultPath, currentPath, refreshKey]);

  if (!ctx || !ctx.kind) return null;

  // Choose labels per kind.
  let parentLabel = "";
  let parentPrefix = "";
  let siblingsLabel = "";
  if (ctx.kind === "project") {
    siblingsLabel = `Experiments in this project (${ctx.siblings.length})`;
  } else if (ctx.kind === "experiment") {
    parentLabel = "Project";
    parentPrefix = "↑";
    siblingsLabel = `Other experiments in this project (${ctx.siblings.length})`;
  } else if (ctx.kind === "iteration") {
    parentLabel = "Experiment";
    parentPrefix = "↑";
    siblingsLabel = `Other iterations (${ctx.siblings.length})`;
  } else {
    return null;
  }

  // Avoid rendering an empty panel when there's nothing to show.
  const hasParent = !!ctx.parent;
  const hasSiblings = ctx.siblings.length > 0;
  if (!hasParent && !hasSiblings) return null;

  return (
    <div style={styles.panel}>
      {ctx.parent && (
        <div style={styles.section}>
          <div style={styles.header}>{parentLabel}</div>
          <button
            onClick={() => onOpenFile(ctx.parent!.path)}
            style={styles.link}
          >
            <span style={styles.arrow}>{parentPrefix}</span>
            <span>{ctx.parent.name}</span>
          </button>
        </div>
      )}

      {hasSiblings && (
        <div style={styles.section}>
          <div style={styles.header}>{siblingsLabel}</div>
          <ul style={styles.list}>
            {ctx.siblings.map((s) => (
              <li key={s.path} style={styles.item}>
                <button onClick={() => onOpenFile(s.path)} style={styles.link}>
                  <span style={styles.arrow}>→</span>
                  <span>
                    {s.iter_number !== null ? (
                      <>
                        <span style={styles.iterTag}>
                          iter-{String(s.iter_number).padStart(2, "0")}
                        </span>{" "}
                        {s.name}
                      </>
                    ) : (
                      s.name
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: "2rem",
    paddingTop: "1rem",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  section: {},
  header: {
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: "0.4rem",
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  item: {
    padding: "0.2rem 0",
  },
  link: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "0.4rem",
    background: "none",
    border: "none",
    color: "var(--accent)",
    cursor: "pointer",
    padding: "2px 0",
    fontSize: "0.92rem",
    textAlign: "left",
  },
  arrow: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
    minWidth: "10px",
  },
  iterTag: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.78rem",
    background: "var(--code-bg)",
    color: "var(--text-2)",
    padding: "1px 6px",
    borderRadius: "3px",
    marginRight: "2px",
  },
};
