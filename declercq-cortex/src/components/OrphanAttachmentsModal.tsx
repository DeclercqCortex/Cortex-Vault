// OrphanAttachmentsModal — Cluster 19 v1.2.
//
// Vault-maintenance modal: lists files inside `<note-stem>-attachments/`
// directories that aren't referenced from their parent note's content.
// User can per-row delete or "Delete all". Triggered by Ctrl+Shift+O
// from App.tsx (and listed in ShortcutsHelp).
//
// Detection rule mirrors the backend (`find_orphan_attachments`): an
// attachment is orphaned when its relative path (`<stem>-attachments/
// <file>`) does NOT appear as a substring in the parent note's
// content. Recently-dropped images that haven't been saved yet would
// flag as orphans — the modal's footer notes that.
//
// Safety: delete_orphan_attachment refuses paths outside the vault
// (the backend re-validates). The modal asks for confirmation before
// "Delete all".

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface OrphanAttachment {
  note_path: string;
  note_relative: string;
  attachment_path: string;
  attachment_relative: string;
  file_size: number;
}

export interface OrphanAttachmentsModalProps {
  isOpen: boolean;
  vaultPath: string;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function OrphanAttachmentsModal({
  isOpen,
  vaultPath,
  onClose,
}: OrphanAttachmentsModalProps) {
  const [orphans, setOrphans] = useState<OrphanAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!vaultPath) return;
    setError(null);
    setOrphans(null);
    try {
      const list = await invoke<OrphanAttachment[]>("find_orphan_attachments", {
        vaultPath,
      });
      setOrphans(list);
    } catch (e) {
      setError(String(e));
    }
  }, [vaultPath]);

  useEffect(() => {
    if (isOpen) refresh();
    // ESC closes
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, refresh, onClose]);

  if (!isOpen) return null;

  const totalBytes = orphans?.reduce((sum, o) => sum + o.file_size, 0) ?? 0;

  async function deleteOne(o: OrphanAttachment) {
    setBusy(true);
    setError(null);
    try {
      await invoke("delete_orphan_attachment", {
        vaultPath,
        attachmentPath: o.attachment_path,
      });
      // Optimistic update — remove from the list locally instead of a
      // full refresh, which is faster and avoids re-walking the whole
      // vault for one delete.
      setOrphans((cur) =>
        cur ? cur.filter((x) => x.attachment_path !== o.attachment_path) : cur,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    if (!orphans || orphans.length === 0) return;
    if (
      !window.confirm(
        `Delete ${orphans.length} orphan attachment${
          orphans.length === 1 ? "" : "s"
        } (${formatBytes(totalBytes)})? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    // Sequence the deletes so a single failure doesn't blow up the
    // rest. Collect errors to surface after.
    const failed: string[] = [];
    for (const o of orphans) {
      try {
        await invoke("delete_orphan_attachment", {
          vaultPath,
          attachmentPath: o.attachment_path,
        });
      } catch (e) {
        failed.push(`${o.attachment_relative}: ${e}`);
      }
    }
    setBusy(false);
    if (failed.length > 0) {
      setError(`Some deletes failed:\n${failed.join("\n")}`);
    }
    refresh();
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Orphan attachments</h2>
          <button onClick={onClose} style={styles.closeBtn} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div style={styles.subtitle}>
          Files in <code>&lt;note&gt;-attachments/</code> that aren't referenced
          from their parent note. Save unsaved notes first — recently-dropped
          images that haven't been written to disk yet will flag here.
        </div>

        <div style={styles.toolbar}>
          <button onClick={refresh} style={styles.btn} disabled={busy}>
            ⟳ Refresh
          </button>
          <div style={{ flex: 1 }} />
          {orphans && orphans.length > 0 && (
            <span style={styles.summary}>
              {orphans.length} orphan
              {orphans.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
            </span>
          )}
          {orphans && orphans.length > 0 && (
            <button
              onClick={deleteAll}
              style={styles.btnDanger}
              disabled={busy}
              title="Delete every orphan listed below"
            >
              Delete all
            </button>
          )}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {orphans === null && !error && (
          <div style={styles.empty}>Scanning vault…</div>
        )}
        {orphans && orphans.length === 0 && !error && (
          <div style={styles.empty}>
            No orphans. Every file in every <code>-attachments/</code> directory
            is referenced from its parent note.
          </div>
        )}

        {orphans && orphans.length > 0 && (
          <div style={styles.listWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Parent note</th>
                  <th style={styles.th}>Attachment</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Size</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.attachment_path}>
                    <td style={styles.td}>
                      <code style={styles.code}>{o.note_relative}</code>
                    </td>
                    <td style={styles.td}>
                      <code style={styles.code}>{o.attachment_relative}</code>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatBytes(o.file_size)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      <button
                        onClick={() => deleteOne(o)}
                        style={styles.btnRowDanger}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
    width: "min(820px, 92vw)",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column",
    padding: "1.25rem 1.25rem 1rem",
    gap: "0.75rem",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "1rem",
  },
  title: { margin: 0, fontSize: "1.05rem", fontWeight: 600 },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-2)",
    fontSize: "1.05rem",
    cursor: "pointer",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "var(--text-2)",
    lineHeight: 1.4,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  summary: {
    fontSize: "0.8rem",
    color: "var(--text-2)",
    marginRight: "0.5rem",
  },
  btn: {
    background: "var(--bg-elev)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "4px 10px",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  btnDanger: {
    background: "var(--danger)",
    color: "white",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    padding: "4px 12px",
    fontSize: "0.85rem",
    cursor: "pointer",
    fontWeight: 600,
  },
  btnRowDanger: {
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    padding: "2px 10px",
    fontSize: "0.78rem",
    cursor: "pointer",
  },
  error: {
    background: "var(--danger-bg, #ffe6e6)",
    color: "var(--danger)",
    padding: "0.5rem 0.75rem",
    borderRadius: "4px",
    fontSize: "0.85rem",
    whiteSpace: "pre-wrap" as const,
  },
  empty: {
    padding: "1rem 0",
    color: "var(--text-2)",
    fontSize: "0.9rem",
  },
  listWrap: {
    overflowY: "auto" as const,
    flex: 1,
    border: "1px solid var(--border)",
    borderRadius: "4px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "0.82rem",
  },
  th: {
    textAlign: "left" as const,
    padding: "6px 8px",
    background: "var(--bg-elev)",
    borderBottom: "1px solid var(--border)",
    fontWeight: 600,
    color: "var(--text-2)",
    position: "sticky" as const,
    top: 0,
  },
  td: {
    padding: "5px 8px",
    borderBottom: "1px solid var(--border-2, var(--border))",
  },
  code: {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: "0.78rem",
  },
};
