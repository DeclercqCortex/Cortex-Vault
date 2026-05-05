// OrphanAttachmentsModal — Cluster 19 v1.2; bulk-select added v1.3.
//
// Vault-maintenance modal: lists files inside `<note-stem>-attachments/`
// directories that aren't referenced from their parent note's content.
// User can per-row delete, multi-select via checkboxes and "Delete
// selected", or sweep with "Delete all". Triggered by Ctrl+Shift+O
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
// "Delete selected" / "Delete all".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Cluster 19 v1.3 — set of `attachment_path` strings the user has
  // checked. Cleared on every successful delete + on every refresh
  // (the underlying paths may have changed). The header checkbox
  // ties to a tri-state derived from this set vs the current orphan
  // list.
  const [selected, setSelected] = useState<Set<string>>(new Set<string>());
  const headerCheckRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!vaultPath) return;
    setError(null);
    setOrphans(null);
    setSelected(new Set<string>());
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

  // Cluster 19 v1.3 — tri-state header checkbox.
  // unchecked  : selected.size === 0
  // checked    : selected.size === orphans.length (and orphans.length > 0)
  // indeterminate : 0 < selected.size < orphans.length
  // Native checkboxes don't have an HTML attribute for indeterminate;
  // we set it imperatively via a ref.
  const allChecked = useMemo(
    () => !!orphans && orphans.length > 0 && selected.size === orphans.length,
    [orphans, selected],
  );
  const noneChecked = selected.size === 0;
  useEffect(() => {
    const el = headerCheckRef.current;
    if (!el) return;
    el.indeterminate = !allChecked && !noneChecked;
  }, [allChecked, noneChecked]);

  if (!isOpen) return null;

  const totalBytes = orphans?.reduce((sum, o) => sum + o.file_size, 0) ?? 0;
  const selectedBytes = orphans
    ? orphans.reduce(
        (sum, o) => (selected.has(o.attachment_path) ? sum + o.file_size : sum),
        0,
      )
    : 0;

  function toggleRow(o: OrphanAttachment) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(o.attachment_path)) next.delete(o.attachment_path);
      else next.add(o.attachment_path);
      return next;
    });
  }

  function toggleAll() {
    if (!orphans) return;
    if (allChecked) {
      setSelected(new Set<string>());
    } else {
      setSelected(new Set(orphans.map((o) => o.attachment_path)));
    }
  }

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
      // Drop from the selected set so a follow-up "Delete selected"
      // doesn't try to re-delete a now-gone path.
      setSelected((cur) => {
        if (!cur.has(o.attachment_path)) return cur;
        const next = new Set(cur);
        next.delete(o.attachment_path);
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Cluster 19 v1.3 — delete every orphan whose attachment_path is in
  // `selected`. Confirms first; sequences the deletes; surfaces
  // errors. Optimistic local update on each success so partial
  // failures still leave the rest of the list correct.
  async function deleteSelected() {
    if (!orphans || selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} selected orphan attachment${
          selected.size === 1 ? "" : "s"
        } (${formatBytes(selectedBytes)})? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    // Snapshot the targets so the ordered iteration is stable even as
    // setOrphans optimistic updates fire in between awaits.
    const targets = orphans.filter((o) => selected.has(o.attachment_path));
    for (const o of targets) {
      try {
        await invoke("delete_orphan_attachment", {
          vaultPath,
          attachmentPath: o.attachment_path,
        });
        setOrphans((cur) =>
          cur
            ? cur.filter((x) => x.attachment_path !== o.attachment_path)
            : cur,
        );
        setSelected((cur) => {
          const next = new Set(cur);
          next.delete(o.attachment_path);
          return next;
        });
      } catch (e) {
        failed.push(`${o.attachment_relative}: ${e}`);
      }
    }
    setBusy(false);
    if (failed.length > 0) {
      setError(`Some deletes failed:\n${failed.join("\n")}`);
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
          {/* Cluster 19 v1.3 — delete just the checked subset. Disabled
              when nothing is selected. Sits between Refresh and Delete
              all so the user sees the scoped option before the sweep. */}
          {orphans && orphans.length > 0 && (
            <button
              onClick={deleteSelected}
              style={styles.btnDanger}
              disabled={busy || selected.size === 0}
              title="Delete every orphan you've checked"
            >
              Delete selected ({selected.size})
            </button>
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
                  {/* Cluster 19 v1.3 — header tri-state checkbox.
                      Native indeterminate set imperatively via ref. */}
                  <th style={{ ...styles.th, width: "28px" }}>
                    <input
                      ref={headerCheckRef}
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      disabled={busy}
                      aria-label={
                        allChecked ? "Deselect all" : "Select all orphans"
                      }
                    />
                  </th>
                  <th style={styles.th}>Parent note</th>
                  <th style={styles.th}>Attachment</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Size</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.attachment_path}>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(o.attachment_path)}
                        onChange={() => toggleRow(o)}
                        disabled={busy}
                        aria-label={`Select ${o.attachment_relative}`}
                      />
                    </td>
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
