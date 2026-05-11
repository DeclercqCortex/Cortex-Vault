// OrphanPlotsModal — Cluster 27 v1.0 pass 3.4 (F102).
//
// Vault-maintenance modal: lists JSON sidecar files inside
// `<note-stem>-plots/` directories whose plot id no longer appears in
// any markdown file's `data-plot-id` attribute. Mirrors the Cluster 19
// OrphanAttachmentsModal in spirit but simpler — sidecars are smaller
// and rarer than image files, so per-row delete + a "Delete all"
// sweep is enough.
//
// Backend wiring lives in `find_orphan_plots` and `delete_plot_sidecar`
// (registered in src-tauri/src/lib.rs at pass-1 time).

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface OrphanPlot {
  note_path: string;
  plot_id: string;
  sidecar_path: string;
  size_bytes: number;
}

export interface OrphanPlotsModalProps {
  isOpen: boolean;
  vaultPath: string;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function OrphanPlotsModal({
  isOpen,
  vaultPath,
  onClose,
}: OrphanPlotsModalProps) {
  const [orphans, setOrphans] = useState<OrphanPlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!vaultPath) return;
    setError(null);
    setBusy(true);
    try {
      const result = await invoke<OrphanPlot[]>("find_orphan_plots", {
        vaultPath,
      });
      setOrphans(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultPath]);

  useEffect(() => {
    if (isOpen) {
      setOrphans(null);
      void refresh();
    }
  }, [isOpen, refresh]);

  const deleteOne = useCallback(
    async (o: OrphanPlot) => {
      if (!confirm(`Delete sidecar for ${o.plot_id}?`)) return;
      try {
        await invoke("delete_plot_sidecar", {
          vaultPath,
          notePath: o.note_path,
          plotId: o.plot_id,
        });
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [vaultPath, refresh],
  );

  const deleteAll = useCallback(async () => {
    if (!orphans || orphans.length === 0) return;
    if (
      !confirm(
        `Delete all ${orphans.length} orphan plot sidecar${
          orphans.length === 1 ? "" : "s"
        }? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      for (const o of orphans) {
        try {
          await invoke("delete_plot_sidecar", {
            vaultPath,
            notePath: o.note_path,
            plotId: o.plot_id,
          });
        } catch (e) {
          // Surface but continue — best-effort sweep.
          console.warn("[orphan-plots] delete failed:", o.plot_id, e);
        }
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [orphans, vaultPath, refresh]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
      data-cortex-scrim=""
    >
      <div
        style={{
          width: "min(680px, 92vw)",
          maxHeight: "82vh",
          background: "var(--bg-card)",
          color: "var(--text)",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Orphan plots"
        data-cortex-modal=""
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 500 }}>
            Orphan plot sidecars
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-1)",
              cursor: "pointer",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div style={{ padding: "12px 18px", flex: 1, overflow: "auto" }}>
          {error && (
            <div
              style={{
                color: "var(--danger)",
                marginBottom: 8,
                fontSize: "0.85rem",
              }}
            >
              {error}
            </div>
          )}
          {busy && orphans == null ? (
            <div style={{ color: "var(--text-2)", fontStyle: "italic" }}>
              Scanning vault…
            </div>
          ) : orphans == null ? null : orphans.length === 0 ? (
            <div style={{ color: "var(--text-2)" }}>
              No orphan plot sidecars found — every JSON file is referenced by a
              plot in some note.
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.85rem",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>
                    Plot id
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>
                    Note (expected)
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>
                    Size
                  </th>
                  <th style={{ padding: "6px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr
                    key={o.sidecar_path}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td
                      style={{
                        padding: "6px 8px",
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--accent)",
                      }}
                    >
                      {o.plot_id}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-2)",
                        wordBreak: "break-all",
                      }}
                    >
                      {o.note_path.replace(vaultPath, "").replace(/^[\\/]/, "")}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        color: "var(--text-2)",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {formatBytes(o.size_bytes)}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      <button
                        onClick={() => void deleteOne(o)}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--danger)",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-1)",
                          cursor: "pointer",
                          fontSize: "0.78rem",
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: "var(--text-2)", fontSize: "0.78rem" }}>
            {orphans
              ? `${orphans.length} orphan${orphans.length === 1 ? "" : "s"}`
              : ""}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => void refresh()}
              disabled={busy}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                padding: "4px 12px",
                borderRadius: "var(--radius-1)",
                cursor: "pointer",
                fontSize: "0.82rem",
              }}
            >
              Refresh
            </button>
            <button
              onClick={() => void deleteAll()}
              disabled={busy || !orphans || orphans.length === 0}
              style={{
                background: "transparent",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
                padding: "4px 12px",
                borderRadius: "var(--radius-1)",
                cursor: "pointer",
                fontSize: "0.82rem",
              }}
            >
              Delete all
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
