// FileTreeContextMenu — Cluster 24 v1.0.
//
// Right-click menu for file and folder rows in the vault sidebar.
// Mirrors the BlockContextMenu / TableContextMenu shape used elsewhere
// in the codebase: the menu is mounted by App.tsx and dispatches a
// single action `kind` back via onAction; App.tsx routes the action
// (rename / new file / new folder / delete) into FileTree's pendingEdit
// state or the DeleteConfirmModal.
//
// Item set differs by node type:
//   - folder: New file here / New folder here / Rename / Delete
//   - file:   Rename / Delete
//
// The menu is a fixed-position absolute panel. clientX/clientY of the
// triggering contextmenu event fix the top-left corner; the overflow
// guard nudges the panel left/up when it would clip the viewport.

import { useEffect, useRef } from "react";

export type FileTreeAction = "newFile" | "newFolder" | "rename" | "delete";

interface FileTreeContextMenuProps {
  x: number;
  y: number;
  /** "folder" → all four items; "file" → rename + delete only. */
  nodeType: "file" | "folder";
  onAction: (kind: FileTreeAction) => void;
  onClose: () => void;
}

export function FileTreeContextMenu({
  x,
  y,
  nodeType,
  onAction,
  onClose,
}: FileTreeContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click. Capture-phase so we beat any pointerdown
  // handler the children install.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  // Close on Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Viewport-clip guard: if the menu would clip off the right or bottom
  // edge, anchor it from the opposite corner instead. We can't measure
  // the menu's size before render, so we use conservative estimates.
  const ESTIMATE_W = 200;
  const ESTIMATE_H = nodeType === "folder" ? 160 : 88;
  const left = Math.min(x, Math.max(8, window.innerWidth - ESTIMATE_W - 8));
  const top = Math.min(y, Math.max(8, window.innerHeight - ESTIMATE_H - 8));

  return (
    <div
      ref={ref}
      className="cortex-filetree-ctxmenu"
      role="menu"
      style={{
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 950,
      }}
    >
      {nodeType === "folder" && (
        <>
          <Item
            label="New file here"
            shortcut=""
            onClick={() => {
              onAction("newFile");
              onClose();
            }}
          />
          <Item
            label="New folder here"
            shortcut=""
            onClick={() => {
              onAction("newFolder");
              onClose();
            }}
          />
          <Divider />
        </>
      )}
      <Item
        label="Rename"
        shortcut="F2"
        onClick={() => {
          onAction("rename");
          onClose();
        }}
      />
      <Item
        label="Delete"
        shortcut="Del"
        danger
        onClick={() => {
          onAction("delete");
          onClose();
        }}
      />
    </div>
  );
}

interface ItemProps {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}

function Item({ label, shortcut, danger, onClick }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        "cortex-filetree-ctxmenu-item" +
        (danger ? " cortex-filetree-ctxmenu-item-danger" : "")
      }
    >
      <span>{label}</span>
      {shortcut ? (
        <span className="cortex-filetree-ctxmenu-shortcut">{shortcut}</span>
      ) : null}
    </button>
  );
}

function Divider() {
  return <div className="cortex-filetree-ctxmenu-divider" />;
}
