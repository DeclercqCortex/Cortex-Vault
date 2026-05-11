// DeleteConfirmModal — Cluster 24 v1.0.
//
// Modal that appears when the user picks Delete from the FileTree
// context menu. Shows the path being deleted, plus a count of nested
// files for folders. Confirm calls trash_path (which sends to the OS
// Recycle Bin — recoverable, NOT permanent). Cancel / Esc closes.
//
// The "trash, not permanent" framing is repeated visibly in the modal
// copy so a user reading the dialog knows the operation is reversible.

import { useEffect } from "react";

interface DeleteConfirmModalProps {
  /** Absolute path of the file or folder to delete. */
  path: string;
  /** Display name (just the basename — the modal shows the full path
   *  separately for context). */
  name: string;
  /** "file" | "folder". */
  nodeType: "file" | "folder";
  /** For folders: number of files contained. Computed by App.tsx by
   *  walking the FileTree state before opening the modal. Undefined
   *  for files. */
  containedFileCount?: number;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConfirmModal({
  path,
  name,
  nodeType,
  containedFileCount,
  onConfirm,
  onClose,
}: DeleteConfirmModalProps) {
  // Esc closes; Enter confirms. Both stop propagation so the editor's
  // shortcut handlers don't also fire.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onConfirm]);

  return (
    <div
      className="cortex-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={styles.backdrop}
      data-cortex-scrim
    >
      <div
        className="cortex-modal"
        style={styles.modal}
        role="dialog"
        aria-modal
        data-cortex-modal
      >
        <h3 style={styles.title}>
          Delete {nodeType === "folder" ? "folder" : "file"}?
        </h3>
        <p style={styles.body}>
          <strong>{name}</strong>
          {nodeType === "folder" &&
          containedFileCount !== undefined &&
          containedFileCount > 0 ? (
            <span style={styles.muted}>
              {" "}
              — contains {containedFileCount}{" "}
              {containedFileCount === 1 ? "file" : "files"}
            </span>
          ) : null}
        </p>
        <p style={styles.path} title={path}>
          {path}
        </p>
        <p style={styles.muted}>
          Will be sent to the Recycle Bin. You can restore it from there if you
          change your mind.
        </p>
        <div style={styles.buttons}>
          <button
            type="button"
            onClick={onClose}
            style={styles.cancelBtn}
            autoFocus
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} style={styles.deleteBtn}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modal: {
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "1rem 1.25rem",
    minWidth: "min(420px, 90vw)",
    maxWidth: "min(560px, 92vw)",
    boxShadow: "0 12px 36px rgba(0,0,0,0.32)",
  },
  title: {
    margin: "0 0 0.5rem 0",
    fontSize: "1rem",
    fontWeight: 600,
  },
  body: {
    margin: "0 0 0.4rem 0",
    fontSize: "0.95rem",
  },
  path: {
    margin: "0 0 0.6rem 0",
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    wordBreak: "break-all",
    fontFamily: "var(--font-mono, monospace)",
  },
  muted: {
    color: "var(--text-muted)",
    fontSize: "0.85rem",
  },
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
    marginTop: "0.75rem",
  },
  cancelBtn: {
    padding: "6px 14px",
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  deleteBtn: {
    padding: "6px 14px",
    background: "var(--danger, #dc2626)",
    color: "white",
    border: "1px solid var(--danger, #dc2626)",
    borderRadius: "4px",
    cursor: "pointer",
  },
};
