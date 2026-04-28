import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust `FileNode` enum exactly. The tagged union via the `type`
// field lets TypeScript narrow inside switch / if statements.
export type FileNode =
  | { type: "file"; name: string; path: string }
  | { type: "folder"; name: string; path: string; children: FileNode[] };

/**
 * Click options forwarded to the consumer. Used by App.tsx to route
 * Ctrl+Click into slot 2 in the dual layout.
 */
export type SelectFileOpts = { ctrlClick?: boolean };

interface FileTreeProps {
  vaultPath: string;
  onSelectFile: (path: string, opts?: SelectFileOpts) => void;
  selectedPath: string | null;
  /**
   * Bumping this (e.g., `setRefreshKey(k => k + 1)`) forces a tree re-fetch.
   * Used by the manual refresh button, and in Day 4 by the filesystem watcher.
   */
  refreshKey?: number;
}

export function FileTree({
  vaultPath,
  onSelectFile,
  selectedPath,
  refreshKey = 0,
}: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  // `loading` is only used for the very first fetch (when the tree is
  // still empty). Subsequent refetches keep the previous tree visible
  // until the new data arrives, so the sidebar doesn't flash to a
  // "Loading…" placeholder every time the watcher fires.
  const [loading, setLoading] = useState(true);
  const hasData = tree.length > 0;

  useEffect(() => {
    if (!hasData) setLoading(true);
    setError(null);
    invoke<FileNode[]>("read_vault_tree", { vaultPath })
      .then((nodes) => {
        setTree(nodes);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, refreshKey]);

  if (loading && !hasData) {
    return <div style={styles.muted}>Loading…</div>;
  }
  if (error && !hasData) {
    return <div style={styles.error}>Error: {error}</div>;
  }
  if (!hasData) {
    return <div style={styles.muted}>Vault is empty.</div>;
  }

  return (
    <div style={styles.root}>
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  onSelectFile: (path: string, opts?: SelectFileOpts) => void;
  selectedPath: string | null;
}

function TreeNode({ node, depth, onSelectFile, selectedPath }: TreeNodeProps) {
  // Expansion state is persisted per-path in localStorage.
  //   - Key includes the absolute path, so two vaults never collide.
  //   - File rows have no expansion, but we still compute the key for
  //     folder nodes only below.
  //   - Default when there's no saved value: top level expanded, deeper
  //     levels collapsed. Matches the Day 2 behaviour.
  const storageKey =
    node.type === "folder" ? `cortex:expanded:${node.path}` : null;

  const [expanded, setExpanded] = useState<boolean>(() => {
    if (!storageKey) return false;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "true";
    } catch {
      // localStorage can throw in strict privacy modes; fall through.
    }
    return depth < 1;
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(expanded));
    } catch {
      // no-op — see above
    }
  }, [expanded, storageKey]);

  const indent: React.CSSProperties = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.type === "file") {
    const isSelected = selectedPath === node.path;
    return (
      <div
        onClick={(e) =>
          // Cluster 6 v1.5: forward ctrl-click so the multi-tab layout
          // can route to slot 2 in the dual layout. Meta is treated the
          // same so macOS works.
          onSelectFile(node.path, { ctrlClick: e.ctrlKey || e.metaKey })
        }
        // Drag-and-drop: tri/quad layouts use this as the primary way
        // to drop a file into a non-active slot. The data type is
        // namespaced so we don't collide with anything else the
        // browser might support.
        //
        // We deliberately DO NOT set `text/plain` — TipTap's editor
        // accepts text drops and would insert the filename as a
        // string if our capture-phase intercept ever misses. With
        // only `text/cortex-path` set, ProseMirror has nothing to
        // consume and silently no-ops.
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/cortex-path", node.path);
          e.dataTransfer.effectAllowed = "copy";
        }}
        style={{
          ...styles.row,
          ...indent,
          background: isSelected ? "var(--accent-bg-2)" : "transparent",
        }}
        title={node.path}
      >
        <span style={styles.icon}>📄</span>
        <span style={styles.label}>{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ ...styles.row, ...indent, opacity: 0.92 }}
        title={node.path}
      >
        <span style={styles.caret}>{expanded ? "▾" : "▸"}</span>
        <span style={styles.icon}>📁</span>
        <span style={styles.label}>{node.name}</span>
      </div>
      {expanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelectFile={onSelectFile}
            selectedPath={selectedPath}
          />
        ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: "0.25rem 0",
    fontSize: "0.875rem",
    lineHeight: 1.4,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 6px",
    cursor: "pointer",
    userSelect: "none",
    borderRadius: "3px",
  },
  caret: {
    width: "10px",
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    textAlign: "center",
  },
  icon: {
    width: "16px",
    fontSize: "0.85rem",
    flexShrink: 0,
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: {
    padding: "0.5rem 0.75rem",
    fontSize: "0.85rem",
    color: "var(--text-muted)",
  },
  error: {
    padding: "0.5rem 0.75rem",
    fontSize: "0.85rem",
    color: "var(--danger)",
  },
};
