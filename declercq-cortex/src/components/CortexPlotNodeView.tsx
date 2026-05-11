// CortexPlotNodeView — Cluster 27 v1.0 pass 1.
//
// React NodeView for the cortexPlot atom node. Renders the chart via
// PlotRenderers, hosts a resize handle, surfaces click/right-click to
// the editor host (so App.tsx can open the PlotterSidebar bound to
// this plot), and resolves the sidecar JSON path through the editor's
// storage namespace.
//
// CustomEvents emitted on `editor.view.dom`:
//   - cortex:focus-plot         → App.tsx opens the PlotterSidebar
//   - cortex:plot-context-menu  → App.tsx opens the right-click menu
//                                  (pass 2 backlog)
//
// Inline-data fast path: when the node's `dataB64` attr carries the
// base64-encoded PlotData, we decode and render immediately — no
// Tauri round-trip needed. This is the default for new + small plots
// (< 50 rows × 4 cols).
//
// Sidecar fast path: when `dataB64` is empty, we look up
// `editor.storage.cortexPlot.dataCache[plotId]` for an already-loaded
// PlotData (the PlotterSidebar warms this cache when it saves). If
// the cache is cold, we render a placeholder until the user clicks
// the plot (which opens the sidebar, which loads + caches the data).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { invoke } from "@tauri-apps/api/core";
import {
  type CortexPlotType,
  type PlotData,
  type PlotConfig,
  type PlotPayload,
  decodePlotBlob,
  emptyPlotPayload,
} from "../editor/CortexPlotNode";
import { PlotByType } from "./PlotRenderers";

/** Dispatched when the user clicks a plot — App.tsx opens the
 *  PlotterSidebar bound to it. */
export const FOCUS_PLOT_EVENT = "cortex:focus-plot";

export interface FocusPlotDetail {
  pos: number;
  plotId: string;
  plotType: CortexPlotType;
  /** Live attrs from the node — sidebar uses these to seed its
   *  controls. */
  width: number;
  height: number;
  configB64: string;
  dataB64: string;
}

/** Dispatched on right-click — pass 2 will wire the context menu. */
export const PLOT_CONTEXT_MENU_EVENT = "cortex:plot-context-menu";

export interface PlotContextMenuDetail {
  pos: number;
  x: number;
  y: number;
  plotId: string;
}

export function CortexPlotNodeView(props: NodeViewProps) {
  const { node, editor, getPos, updateAttributes, selected } = props;
  const plotId = (node.attrs.plotId as string) || "";
  const plotType = (node.attrs.plotType as CortexPlotType) || "scatter";
  const width = (node.attrs.width as number) || 640;
  const height = (node.attrs.height as number) || 380;
  const align = (node.attrs.align as string) || "break";
  const configB64 = (node.attrs.configB64 as string) || "";
  const dataB64 = (node.attrs.dataB64 as string) || "";

  // ---- decode inline blobs ----------------------------------------------
  const config = useMemo<PlotConfig>(() => {
    if (!configB64) return emptyPlotPayload().config;
    return decodePlotBlob<PlotConfig>(configB64) ?? emptyPlotPayload().config;
  }, [configB64]);

  // ---- resolve data: inline first, else storage cache, else placeholder
  const storage =
    (editor.storage as Record<string, unknown>)["cortexPlot"] ??
    ({} as Record<string, unknown>);
  const dataCache =
    ((storage as { dataCache?: Map<string, PlotData> }).dataCache as
      | Map<string, PlotData>
      | undefined) ?? null;

  const [resolvedData, setResolvedData] = useState<PlotData | null>(null);
  // Bug 3 fix: track sidecar load state so the empty placeholder does
  // not flash during a fetch (after Ctrl+R the cache is cold for
  // sidecar-mode plots, and waiting for the user to click-to-focus
  // before loading is what made imported CSVs appear lost).
  const [sidecarLoading, setSidecarLoading] = useState(false);

  // The note path lives in storage; we need it to compute the sidecar
  // path on the Rust side. The plotId on the node identifies the file.
  const notePath = (storage as { notePath?: string }).notePath ?? "";
  // The vault root is needed for the read_plot_sidecar command; it
  // comes from the editor's storage too (set by Editor.tsx alongside
  // notePath). Fall back to scanning notePath if absent.
  const vaultPath = (storage as { vaultPath?: string }).vaultPath ?? "";

  useEffect(() => {
    let cancelled = false;
    // Priority 1: inline data on the node.
    if (dataB64) {
      const parsed = decodePlotBlob<PlotData>(dataB64);
      if (parsed) {
        setResolvedData(parsed);
        setSidecarLoading(false);
        return;
      }
    }
    // Priority 2: storage cache (warmed by the sidebar after sidecar
    // load + save, OR by a sibling NodeView that already fetched).
    if (dataCache && dataCache.has(plotId)) {
      setResolvedData(dataCache.get(plotId)!);
      setSidecarLoading(false);
      return;
    }
    // Priority 3 (Bug 3 fix): the sidecar JSON file. Fetch it via
    // Tauri so manually saved + reloaded notes show their imported
    // CSV data without requiring the user to re-open the sidebar.
    // We need both vaultPath and notePath to compute the file path.
    if (!plotId || !notePath || !vaultPath) {
      setResolvedData(null);
      setSidecarLoading(false);
      return;
    }
    setSidecarLoading(true);
    invoke<{ data?: PlotData } | null>("read_plot_sidecar", {
      vaultPath,
      notePath,
      plotId,
    })
      .then((payload) => {
        if (cancelled) return;
        const incoming = payload?.data ?? null;
        if (incoming) {
          setResolvedData(incoming);
          // Warm the cache so sibling NodeViews skip the fetch.
          if (dataCache) dataCache.set(plotId, incoming);
        } else {
          setResolvedData(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[cortexPlot] sidecar load failed:", err);
          setResolvedData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSidecarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataB64, dataCache, plotId, notePath, vaultPath]);

  // Re-read when the storage cache changes (the sidebar bumps a
  // version counter to signal updates after an edit).
  const cacheVersion = (storage as { cacheVersion?: number }).cacheVersion ?? 0;
  useEffect(() => {
    if (dataB64) return; // inline mode — no need
    if (dataCache && dataCache.has(plotId)) {
      setResolvedData(dataCache.get(plotId)!);
    }
  }, [cacheVersion, dataCache, plotId, dataB64]);

  // ---- payload for the renderer -----------------------------------------
  const payload: PlotPayload = useMemo(
    () => ({
      schemaVersion: 1,
      data: resolvedData ?? emptyPlotPayload().data,
      config,
    }),
    [resolvedData, config],
  );

  // ---- resize handle ----------------------------------------------------
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const resizeStateRef = useRef<{
    startMouse: { x: number; y: number };
    startSize: { w: number; h: number };
  } | null>(null);

  const onResizeDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStateRef.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startSize: { w: width, h: height },
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [width, height],
  );

  const onResizeMove = useCallback(
    (e: PointerEvent) => {
      const s = resizeStateRef.current;
      if (!s) return;
      const dx = e.clientX - s.startMouse.x;
      const dy = e.clientY - s.startMouse.y;
      const nextW = Math.max(280, Math.round(s.startSize.w + dx));
      const nextH = Math.max(180, Math.round(s.startSize.h + dy));
      updateAttributes({ width: nextW, height: nextH });
    },
    [updateAttributes],
  );

  const onResizeUp = useCallback(() => {
    setDragging(false);
    resizeStateRef.current = null;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeUp);
    window.addEventListener("pointercancel", onResizeUp);
    return () => {
      window.removeEventListener("pointermove", onResizeMove);
      window.removeEventListener("pointerup", onResizeUp);
      window.removeEventListener("pointercancel", onResizeUp);
    };
  }, [dragging, onResizeMove, onResizeUp]);

  // ---- click → focus + open sidebar ------------------------------------
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't swallow clicks inside the Recharts SVG — let interaction
      // (hover tooltip, brush, etc.) work. Use a special "outside the
      // svg" gate via the resize-handle/empty-region check.
      const target = e.target as HTMLElement;
      // If the click landed on a Recharts internal element, let it
      // propagate to that handler instead.
      if (target.closest(".recharts-wrapper")) {
        // But also fire focus: clicking the plot at all opens the
        // sidebar. Recharts doesn't preventDefault on its events,
        // so we can do both.
      }
      const pos = typeof getPos === "function" ? getPos() : 0;
      const detail: FocusPlotDetail = {
        pos,
        plotId,
        plotType,
        width,
        height,
        configB64,
        dataB64,
      };
      const evt = new CustomEvent<FocusPlotDetail>(FOCUS_PLOT_EVENT, {
        detail,
        bubbles: true,
      });
      editor.view.dom.dispatchEvent(evt);
    },
    [editor, getPos, plotId, plotType, width, height, configB64, dataB64],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof getPos === "function" ? getPos() : 0;
      const evt = new CustomEvent<PlotContextMenuDetail>(
        PLOT_CONTEXT_MENU_EVENT,
        {
          detail: { pos, x: e.clientX, y: e.clientY, plotId },
          bubbles: true,
        },
      );
      editor.view.dom.dispatchEvent(evt);
    },
    [editor, getPos, plotId],
  );

  // ---- empty / loading state -------------------------------------------
  // Bug 3 fix: distinguish "still fetching sidecar" from "truly empty"
  // so the placeholder does not flash on every Ctrl+R for sidecar-mode
  // plots.
  const empty = !resolvedData || resolvedData.rows.length === 0;
  const loadingSidecar = sidecarLoading && !resolvedData;

  return (
    <NodeViewWrapper
      as="div"
      className={
        "cortex-plot-wrap" +
        ` cortex-plot-align-${align}` +
        (selected ? " cortex-plot-selected" : "")
      }
      data-plot-id={plotId}
      data-plot-type={plotType}
    >
      <div
        ref={wrapRef}
        className="cortex-plot-canvas"
        style={{ width: `${width}px`, height: `${height}px` }}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {loadingSidecar ? (
          <div className="cortex-plot-empty">
            <div className="cortex-plot-empty-title">Loading plot data…</div>
            <div className="cortex-plot-empty-subtitle">
              {plotType[0].toUpperCase() + plotType.slice(1)}
            </div>
          </div>
        ) : empty ? (
          <div className="cortex-plot-empty">
            <div className="cortex-plot-empty-title">
              Empty plot · click to edit
            </div>
            <div className="cortex-plot-empty-subtitle">
              {plotType[0].toUpperCase() + plotType.slice(1)}
              {" · "}
              <span style={{ opacity: 0.6 }}>Ctrl+Alt+P</span>
            </div>
          </div>
        ) : (
          <PlotByType
            payload={payload}
            width={width}
            height={height}
            plotType={plotType}
          />
        )}
      </div>
      {/* Resize handle — bottom-right corner */}
      <span
        className="cortex-plot-handle cortex-plot-handle-resize"
        onPointerDown={onResizeDown}
        title="Drag to resize"
      >
        ⤡
      </span>
    </NodeViewWrapper>
  );
}
