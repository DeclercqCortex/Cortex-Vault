import { useEffect, useRef, useState } from "react";
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

/** Cluster 24 v1.0 — describes a row that's currently in inline edit mode.
 *  - `rename`: the existing row's text is replaced with an `<input>` seeded
 *    with the current name. Enter calls rename_path; Esc cancels.
 *  - `new-file` / `new-folder`: a phantom row appears under the target
 *    folder with an empty `<input>`. Enter calls create_file_in_folder /
 *    create_folder_in_folder. Esc cancels and removes the phantom row.
 */
export type PendingEdit =
  | {
      kind: "rename";
      targetPath: string;
      nodeType: "file" | "folder";
      draft: string;
    }
  | { kind: "new-file"; parentPath: string; draft: string }
  | { kind: "new-folder"; parentPath: string; draft: string };

interface FileTreeProps {
  vaultPath: string;
  onSelectFile: (path: string, opts?: SelectFileOpts) => void;
  selectedPath: string | null;
  /**
   * Bumping this (e.g., `setRefreshKey(k => k + 1)`) forces a tree re-fetch.
   * Used by the manual refresh button, and in Day 4 by the filesystem watcher.
   */
  refreshKey?: number;
  /** Cluster 24 v1.0 — right-click on a row opens the context menu via App.tsx. */
  onContextMenu?: (e: React.MouseEvent, node: FileNode) => void;
  /** Cluster 24 v1.0 — inline edit state. Owned by App.tsx so the menu
   *  can dispatch into it. */
  pendingEdit?: PendingEdit | null;
  onPendingEditChange?: (next: PendingEdit | null) => void;
  /** Called when the user commits an edit. App.tsx routes to the
   *  appropriate Tauri command, then refreshes the tree. */
  onCommitEdit?: (edit: PendingEdit) => void | Promise<void>;
  /** Cluster 26 — set of file paths that are currently dirty (open in
   *  any pane and have unsaved changes). FileTree renders a small
   *  accent-gradient dot on each dirty row's right edge. */
  dirtyPaths?: ReadonlySet<string>;
}

export function FileTree({
  vaultPath,
  onSelectFile,
  selectedPath,
  refreshKey = 0,
  onContextMenu,
  pendingEdit,
  onPendingEditChange,
  onCommitEdit,
  dirtyPaths,
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
          onContextMenu={onContextMenu}
          pendingEdit={pendingEdit ?? null}
          onPendingEditChange={onPendingEditChange}
          onCommitEdit={onCommitEdit}
          dirtyPaths={dirtyPaths}
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
  onContextMenu?: (e: React.MouseEvent, node: FileNode) => void;
  pendingEdit: PendingEdit | null;
  onPendingEditChange?: (next: PendingEdit | null) => void;
  onCommitEdit?: (edit: PendingEdit) => void | Promise<void>;
  dirtyPaths?: ReadonlySet<string>;
}

function TreeNode({
  node,
  depth,
  onSelectFile,
  selectedPath,
  onContextMenu,
  pendingEdit,
  onPendingEditChange,
  onCommitEdit,
  dirtyPaths,
}: TreeNodeProps) {
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

  // Cluster 24 v1.0 — when a new-file/new-folder is targeted at this folder
  // node, auto-expand so the inline phantom row is visible. We only force
  // expansion ON; the user's manual collapse later isn't fought.
  useEffect(() => {
    if (node.type !== "folder") return;
    if (!pendingEdit) return;
    if (
      (pendingEdit.kind === "new-file" || pendingEdit.kind === "new-folder") &&
      pendingEdit.parentPath === node.path &&
      !expanded
    ) {
      setExpanded(true);
    }
  }, [pendingEdit, node, expanded]);

  const indent: React.CSSProperties = { paddingLeft: `${depth * 14 + 8}px` };

  // Inline rename UI replaces this row's text with an input.
  const renaming =
    pendingEdit?.kind === "rename" && pendingEdit.targetPath === node.path;

  if (node.type === "file") {
    const isSelected = selectedPath === node.path;
    const isDirty = dirtyPaths?.has(node.path) ?? false;
    return (
      <div
        // Cluster 26 — class hooks let CSS layer hover / selected-bar /
        // dirty-dot affordances on top of the inline-style row layout.
        className={`cortex-filetree-row cortex-filetree-row--file${
          isSelected ? " cortex-filetree-row--selected" : ""
        }${isDirty ? " cortex-filetree-row--dirty" : ""}`}
        onClick={(e) => {
          if (renaming) return;
          // Cluster 6 v1.5: forward ctrl-click so the multi-tab layout
          // can route to slot 2 in the dual layout. Meta is treated the
          // same so macOS works.
          onSelectFile(node.path, { ctrlClick: e.ctrlKey || e.metaKey });
        }}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu(e, node);
        }}
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
        draggable={!renaming}
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
        {renaming ? (
          <InlineEditInput
            initialValue={
              pendingEdit!.kind === "rename" ? pendingEdit!.draft : ""
            }
            onChange={(v) => {
              if (pendingEdit?.kind === "rename") {
                onPendingEditChange?.({ ...pendingEdit, draft: v });
              }
            }}
            onCommit={() => {
              if (pendingEdit) onCommitEdit?.(pendingEdit);
            }}
            onCancel={() => onPendingEditChange?.(null)}
          />
        ) : (
          <span style={styles.label}>{node.name}</span>
        )}
        {/* Cluster 26 — dirty indicator. The design-system spec called
         *  for a yellow `f5c365` dot; the user requested the gradient
         *  accent instead. CSS .cortex-filetree-row--dirty paints a
         *  small accent-gradient circle on the right edge, only when
         *  the row's path is in dirtyPaths. */}
        {isDirty && !renaming && (
          <span className="cortex-filetree-dirty-dot" aria-label="unsaved" />
        )}
      </div>
    );
  }

  // Folder rendering. The phantom child rows for new-file / new-folder
  // pendingEdits appear at the bottom of the children list.
  const showPhantomNewFile =
    pendingEdit?.kind === "new-file" && pendingEdit.parentPath === node.path;
  const showPhantomNewFolder =
    pendingEdit?.kind === "new-folder" && pendingEdit.parentPath === node.path;

  return (
    <div>
      <div
        className="cortex-filetree-row cortex-filetree-row--folder"
        onClick={() => {
          if (!renaming) setExpanded((e) => !e);
        }}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu(e, node);
        }}
        style={{ ...styles.row, ...indent, opacity: 0.92 }}
        title={node.path}
      >
        <span style={styles.caret}>{expanded ? "▾" : "▸"}</span>
        <span style={styles.icon}>📁</span>
        {renaming ? (
          <InlineEditInput
            initialValue={
              pendingEdit!.kind === "rename" ? pendingEdit!.draft : ""
            }
            onChange={(v) => {
              if (pendingEdit?.kind === "rename") {
                onPendingEditChange?.({ ...pendingEdit, draft: v });
              }
            }}
            onCommit={() => {
              if (pendingEdit) onCommitEdit?.(pendingEdit);
            }}
            onCancel={() => onPendingEditChange?.(null)}
          />
        ) : (
          <span style={styles.label}>{node.name}</span>
        )}
      </div>
      {expanded && (
        <>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
              onContextMenu={onContextMenu}
              pendingEdit={pendingEdit}
              onPendingEditChange={onPendingEditChange}
              onCommitEdit={onCommitEdit}
              dirtyPaths={dirtyPaths}
            />
          ))}
          {(showPhantomNewFile || showPhantomNewFolder) && (
            <div
              style={{
                ...styles.row,
                paddingLeft: `${(depth + 1) * 14 + 8}px`,
              }}
            >
              <span style={styles.icon}>
                {showPhantomNewFile ? "📄" : "📁"}
              </span>
              <InlineEditInput
                initialValue={pendingEdit?.draft ?? ""}
                placeholder={
                  showPhantomNewFile ? "new file name…" : "new folder name…"
                }
                onChange={(v) => {
                  if (
                    pendingEdit?.kind === "new-file" ||
                    pendingEdit?.kind === "new-folder"
                  ) {
                    onPendingEditChange?.({ ...pendingEdit, draft: v });
                  }
                }}
                onCommit={() => {
                  if (pendingEdit) onCommitEdit?.(pendingEdit);
                }}
                onCancel={() => onPendingEditChange?.(null)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface InlineEditInputProps {
  initialValue: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function InlineEditInput({
  initialValue,
  placeholder,
  onChange,
  onCommit,
  onCancel,
}: InlineEditInputProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Local mirror so typing stays smooth even if the parent re-renders;
  // we still notify the parent on each change for App-level coordination.
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // For renames, select the basename portion (stem before the last
    // dot) so the user can immediately overwrite without re-selecting
    // the extension. For new files / folders the placeholder shows
    // through and there's nothing to select.
    //
    // CRITICAL: empty dependency array — this MUST run only once on
    // mount. The previous `[initialValue]` deps caused a re-select on
    // every keystroke (parent passes a new initialValue down on each
    // onChange, which re-fired this effect, which re-selected the
    // basename, which clobbered the cursor the user just established).
    if (initialValue) {
      const lastDot = initialValue.lastIndexOf(".");
      if (lastDot > 0) {
        el.setSelectionRange(0, lastDot);
      } else {
        el.select();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        // Blur cancels (matches OS file-explorer behavior — clicking
        // away abandons the edit). User who wants to commit hits Enter.
        onCancel();
      }}
      className="cortex-filetree-inline-input"
      style={styles.input}
    />
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
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: "inherit",
    fontFamily: "inherit",
    padding: "1px 4px",
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--accent)",
    borderRadius: "3px",
    outline: "none",
  },
};
