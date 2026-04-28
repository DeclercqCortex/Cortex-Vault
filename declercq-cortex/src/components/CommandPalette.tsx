import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Result {
  path: string;
  title: string;
  snippet?: string;
}

interface CommandPaletteProps {
  vaultPath: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

/**
 * Fuzzy-find / full-text search modal triggered by Ctrl+K.
 *
 * Behaviour:
 *  - Empty query → list_all_notes (alphabetical by title), capped at 50.
 *  - Non-empty query → search_notes (FTS5), top 30 by rank, with snippet.
 *
 * Two tabs filter the underlying queries server-side via the `kind`
 * argument on both Tauri commands:
 *    - "all"  — markdown notes + PDFs (default)
 *    - "md"   — only `.md` files
 *    - "pdf"  — only `.pdf` files
 *  Server-side filtering matters because the FTS5 LIMIT cuts off at 30,
 *  and a vault with 200+ files in each kind would otherwise lose results
 *  behind that cap. Switching tabs re-runs the query.
 *
 * The snippet uses `<<` and `>>` delimiters which we replace with <mark>
 * for highlighting. Because that involves dangerouslySetInnerHTML, we
 * never inject anything but server-controlled snippets.
 */
type PaletteKind = "all" | "md" | "pdf";

export function CommandPalette({
  vaultPath,
  isOpen,
  onClose,
  onOpenFile,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const [kind, setKind] = useState<PaletteKind>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when opening; focus input.
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
      setKind("all");
      return;
    }
    // Defer focus to the next tick so the input has mounted.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Run the query (debounced lightly via the natural event ordering — FTS5
  // queries are fast enough that an explicit debounce isn't necessary
  // for vaults under ~5000 notes).
  useEffect(() => {
    if (!isOpen) return;
    setSearching(true);

    const trimmed = query.trim();
    const kindArg = kind === "all" ? null : kind;

    let cancelled = false;
    const handle = async () => {
      try {
        if (trimmed.length === 0) {
          const all = await invoke<Result[]>("list_all_notes", {
            vaultPath,
            kind: kindArg,
          });
          if (!cancelled) {
            setResults(all.slice(0, 50));
            setSelectedIdx(0);
          }
        } else {
          // FTS5 needs at least one full token; prefix-search for
          // partial input by appending '*' to the LAST token.
          const ftsQuery = toFtsQuery(trimmed);
          const found = await invoke<Result[]>("search_notes", {
            vaultPath,
            query: ftsQuery,
            limit: 30,
            kind: kindArg,
          });
          if (!cancelled) {
            setResults(found);
            setSelectedIdx(0);
          }
        }
      } catch (e) {
        console.warn("search failed:", e);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    };
    handle();
    return () => {
      cancelled = true;
    };
  }, [query, isOpen, vaultPath, kind]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[selectedIdx];
      if (r) {
        onOpenFile(r.path);
        onClose();
      }
    }
  }

  if (!isOpen) return null;

  const placeholder =
    kind === "pdf"
      ? "Search PDFs…"
      : kind === "md"
        ? "Search notes…"
        : "Search notes & PDFs…";

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.tabRow} role="tablist" aria-label="Search scope">
          {(["all", "md", "pdf"] as const).map((k) => {
            const label = k === "all" ? "All" : k === "md" ? "Notes" : "PDFs";
            const active = kind === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setKind(k);
                  // Send focus back to the search input after click — the
                  // user is mid-search, the tab is just a filter.
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
                style={{
                  ...styles.tab,
                  ...(active ? styles.tabActive : null),
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          style={styles.input}
        />
        <div style={styles.results}>
          {searching && results.length === 0 ? (
            <div style={styles.empty}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={styles.empty}>No results</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.path}
                onClick={() => {
                  onOpenFile(r.path);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  ...styles.row,
                  background:
                    i === selectedIdx ? "var(--accent-bg-2)" : "transparent",
                }}
              >
                <div style={styles.title}>{r.title}</div>
                {r.snippet && (
                  <div
                    style={styles.snippet}
                    dangerouslySetInnerHTML={{
                      __html: highlightSnippet(r.snippet),
                    }}
                  />
                )}
                <div style={styles.path}>{r.path}</div>
              </div>
            ))
          )}
        </div>
        <div style={styles.footer}>↑↓ navigate · Enter open · Esc close</div>
      </div>
    </div>
  );
}

/**
 * Sanitize a user query for FTS5 and add a prefix-wildcard on the last
 * token so partial input still matches. We strip syntactically meaningful
 * characters that would otherwise turn the query into an FTS5 syntax
 * error (`"`, `(`, `)`, `*`, `^`, etc.).
 */
function toFtsQuery(raw: string): string {
  const cleaned = raw.replace(/["()*^:]/g, " ").trim();
  if (cleaned.length === 0) return raw;
  const parts = cleaned.split(/\s+/);
  const last = parts.pop()!;
  // Only add wildcard if the token has at least 2 chars — single-char
  // wildcards are slow on a porter-stemmed FTS5 index.
  const lastQ = last.length >= 2 ? `${last}*` : last;
  return [...parts, lastQ].join(" ");
}

/** Replace <<...>> markers (as configured in the snippet() call) with <mark>. */
function highlightSnippet(snippet: string): string {
  return snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;&lt;/g, "<mark>")
    .replace(/&gt;&gt;/g, "</mark>");
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "12vh",
    zIndex: 1000,
  },
  panel: {
    width: "min(640px, 90vw)",
    maxHeight: "70vh",
    background: "var(--bg-elev)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
    border: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  input: {
    width: "100%",
    padding: "1rem 1.1rem",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: "1rem",
    outline: "none",
  },
  results: {
    flex: 1,
    overflowY: "auto",
  },
  row: {
    padding: "0.65rem 1.1rem",
    cursor: "pointer",
    borderBottom: "1px solid var(--border)",
    fontSize: "0.9rem",
  },
  title: {
    color: "var(--text)",
    marginBottom: "2px",
  },
  snippet: {
    fontSize: "0.78rem",
    color: "var(--text-2)",
    lineHeight: 1.45,
    marginBottom: "2px",
  },
  path: {
    fontSize: "0.68rem",
    color: "var(--text-muted)",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    wordBreak: "break-all",
  },
  empty: {
    padding: "1rem 1.1rem",
    color: "var(--text-muted)",
    fontSize: "0.9rem",
  },
  footer: {
    padding: "0.5rem 1.1rem",
    borderTop: "1px solid var(--border)",
    fontSize: "0.7rem",
    color: "var(--text-muted)",
  },
  tabRow: {
    display: "flex",
    gap: "2px",
    padding: "6px 8px 0",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-deep)",
  },
  tab: {
    padding: "6px 14px",
    fontSize: "0.78rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid transparent",
    borderRadius: "4px 4px 0 0",
    borderBottom: "none",
    marginBottom: "-1px",
  },
  tabActive: {
    background: "var(--bg-elev)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderBottom: "1px solid var(--bg-elev)",
  },
};
