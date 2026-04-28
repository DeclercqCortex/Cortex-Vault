import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import matter from "gray-matter";

// -----------------------------------------------------------------------------
// Phase 3 — Cluster 8 — Protocols Log
//
// A read-only catalogue over notes whose frontmatter has `type: protocol`.
// Protocols are atomic units; Methods aggregate from them. Each protocol
// owns its own reagents/parts list, which Methods pull into a regenerated
// table whenever the user opens a Method file.
//
// The Protocols Log is intentionally simple — just a directory of what
// you've defined. The interesting aggregation happens inside Method
// files themselves.
// -----------------------------------------------------------------------------

interface NoteWithMetadata {
  path: string;
  title: string;
  frontmatter_yaml: string;
  modified_at: number;
}

interface ProtocolFrontmatter {
  domain?: string;
  duration?: string;
  [key: string]: unknown;
}

interface ProtocolRow extends NoteWithMetadata {
  frontmatter: ProtocolFrontmatter;
}

const DOMAIN_VALUES = [
  "modeling",
  "wet-lab",
  "dry-lab",
  "data-analysis",
  "writing",
] as const;
type Domain = (typeof DOMAIN_VALUES)[number];

const DOMAIN_ORDER: Record<Domain, number> = {
  modeling: 0,
  "wet-lab": 1,
  "dry-lab": 2,
  "data-analysis": 3,
  writing: 4,
};

type SortKey = "modified" | "domain" | "title";

interface ProtocolsLogProps {
  vaultPath: string;
  refreshKey?: number;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  onNewProtocol: () => void;
}

function formatRelative(unixSec: number): string {
  if (!unixSec) return "—";
  const now = Date.now() / 1000;
  const diff = now - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ProtocolsLog({
  vaultPath,
  refreshKey = 0,
  onOpenFile,
  onClose,
  onNewProtocol,
}: ProtocolsLogProps) {
  const [rows, setRows] = useState<ProtocolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<"all" | Domain>("all");
  const [sortKey, setSortKey] = useState<SortKey>("modified");

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<NoteWithMetadata[]>("query_notes_by_type", {
      vaultPath,
      noteType: "protocol",
    })
      .then((notes) => {
        const decorated: ProtocolRow[] = notes.map((n) => {
          let fm: ProtocolFrontmatter = {};
          if (n.frontmatter_yaml.length > 0) {
            try {
              const synthetic = `---\n${n.frontmatter_yaml}\n---\n`;
              fm = matter(synthetic).data as ProtocolFrontmatter;
            } catch (e) {
              console.warn("protocol frontmatter parse failed:", n.path, e);
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
  }, [vaultPath, refreshKey]);

  const visible = useMemo(() => {
    const filtered =
      domainFilter === "all"
        ? rows
        : rows.filter((r) => r.frontmatter.domain === domainFilter);

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "modified":
          return b.modified_at - a.modified_at;
        case "domain": {
          const da = DOMAIN_ORDER[a.frontmatter.domain as Domain] ?? 99;
          const db = DOMAIN_ORDER[b.frontmatter.domain as Domain] ?? 99;
          if (da !== db) return da - db;
          return a.title.localeCompare(b.title);
        }
        case "title":
          return a.title.localeCompare(b.title);
      }
    });
    return sorted;
  }, [rows, domainFilter, sortKey]);

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>Protocols Log</h2>
          <div style={styles.headerActions}>
            <button
              onClick={onNewProtocol}
              style={styles.newBtn}
              title="New protocol"
            >
              + New protocol
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
          Protocols are the atomic units that <strong>Methods</strong> compose
          from. Each row is a note in{" "}
          <code style={styles.codeInline}>06-Protocols/</code> with{" "}
          <code style={styles.codeInline}>type: protocol</code>. Edit the
          markdown table under each protocol's{" "}
          <strong>Reagents/Parts List</strong> heading; rows from there flow
          automatically into the Reagents/Parts table of any Method that
          wikilinks the protocol.
        </p>
      </header>

      <div style={styles.controls}>
        <label style={styles.controlLabel}>
          <span style={styles.controlText}>Domain</span>
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value as "all" | Domain)}
            style={styles.select}
          >
            <option value="all">All domains</option>
            {DOMAIN_VALUES.map((d) => (
              <option key={d} value={d}>
                {d}
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
            <option value="modified">Last modified</option>
            <option value="domain">Domain</option>
            <option value="title">Title</option>
          </select>
        </label>
        <span style={styles.count}>
          {visible.length} of {rows.length}
        </span>
      </div>

      {loading ? (
        <div style={styles.muted}>Loading protocols…</div>
      ) : error ? (
        <div style={styles.error}>Error: {error}</div>
      ) : rows.length === 0 ? (
        <div style={styles.muted}>
          No protocols catalogued yet. Click <strong>+ New protocol</strong>{" "}
          above (or use the sidebar's <strong>+ Protocol</strong> button) to add
          one. After filling in its Reagents/Parts table, you can link it from a
          Method.
        </div>
      ) : visible.length === 0 ? (
        <div style={styles.muted}>
          No protocols match the current filter. Try{" "}
          <button onClick={() => setDomainFilter("all")} style={styles.linkBtn}>
            All domains
          </button>
          .
        </div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Domain</th>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Last modified</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const domain = (row.frontmatter.domain ?? "—") as string;
              return (
                <tr key={row.path} style={styles.row}>
                  <td style={styles.tdMuted}>{domain}</td>
                  <td style={styles.td}>
                    <button
                      onClick={() => onOpenFile(row.path)}
                      style={styles.titleBtn}
                      title={row.path}
                    >
                      {row.title}
                    </button>
                  </td>
                  <td
                    style={styles.tdMuted}
                    title={new Date(row.modified_at * 1000).toLocaleString()}
                  >
                    {formatRelative(row.modified_at)}
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
  wrap: { maxWidth: "880px", margin: "0 auto" },
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
  headerActions: { display: "flex", gap: "0.5rem" },
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
  controlLabel: { display: "flex", alignItems: "baseline", gap: "0.4rem" },
  controlText: { fontSize: "0.78rem", color: "var(--text-2)" },
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
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" },
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
  row: { borderBottom: "1px solid var(--border)" },
  td: { padding: "8px 10px", verticalAlign: "top", color: "var(--text)" },
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
  muted: {
    color: "var(--text-muted)",
    fontSize: "0.9rem",
    padding: "1.5rem 0",
  },
  error: { color: "var(--danger)", fontSize: "0.85rem", padding: "1rem 0" },
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
