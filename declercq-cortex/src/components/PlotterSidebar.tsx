// PlotterSidebar — Cluster 27 v1.0 pass 1.
//
// Right vertical sidebar bound to a single focused cortexPlot node.
// Lives at App.tsx level (portaled outside any pane stacking context
// so its backdrop-filter doesn't get clipped). Owns the user-facing
// editing surface for plot type, data, series mapping, appearance,
// statistics, and export.
//
// State model:
//   - Sidebar receives a "binding" prop describing which plot is
//     active (notePath, plotId, plotType, configB64, dataB64, and
//     callbacks for attr updates).
//   - Internal state: deserialized PlotData + PlotConfig. Edits are
//     committed via debounced flush:
//       * configB64 → updateAttributes({ configB64 }) on every commit
//       * dataB64   → if inline-mode, updateAttributes({ dataB64 });
//                     else write to sidecar JSON via Tauri command
//                     and clear dataB64
//   - Storage cache: warms editor.storage.cortexPlot.dataCache[plotId]
//     so the NodeView re-renders after a sidebar edit without an
//     extra round-trip.
//
// Sections (pass 1):
//   1. Plot type tiles
//   2. Data grid + CSV import
//   3. Series mapping
//   4. Appearance (palette + axis basics)
//   5. Export (PNG/SVG/CSV)
//
// Pass 2 will add: statistics (trendline / refLines), interactions
// toggles, AI suggest button.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import {
  type CortexPlotType,
  type PlotData,
  type PlotConfig,
  type PlotPayload,
  decodePlotBlob,
  encodePlotBlob,
  emptyPlotPayload,
  shouldInlinePlotData,
} from "../editor/CortexPlotNode";
import { PlotDataGrid } from "./PlotDataGrid";
import { ALL_PALETTES } from "../editor/plotPalette";
import { parseCsv, serializeCsv } from "../editor/plotCsv";
import { topSuggestion, suggestPlotTypes } from "../editor/plotSuggest";
import {
  findPlotSvg,
  svgToPng,
  svgToClipboard,
  printPlot,
} from "../editor/plotExport";
import { OrphanPlotsModal } from "./OrphanPlotsModal";
// Pass 4.1 — embed a live plot preview in the modal's left pane.
import { PlotByType } from "./PlotRenderers";

/** Plot-type tile metadata. The labels and short descriptions are
 *  what users see in the tile grid. */
const PLOT_TYPE_TILES: Array<{
  type: CortexPlotType;
  label: string;
  hint: string;
  v1: boolean;
}> = [
  { type: "scatter", label: "Scatter", hint: "XY points", v1: true },
  { type: "line", label: "Line", hint: "Ordered XY", v1: true },
  { type: "area", label: "Area", hint: "Filled line", v1: true },
  { type: "bar", label: "Bar", hint: "Vertical bars", v1: true },
  {
    type: "bar-horizontal",
    label: "H. Bar",
    hint: "Horizontal bars",
    v1: true,
  },
  { type: "histogram", label: "Histogram", hint: "Distribution", v1: true },
  { type: "pie", label: "Pie", hint: "Proportions", v1: true },
  // Pass 4.9 — "Error bar" is no longer a top-level plot type; users
  // instead enable σ error bars as an overlay on scatter / line via
  // the Appearance section toggle, or tag cells as "Error bar — X / Y"
  // selections for per-point custom magnitudes. The renderer is kept
  // for backward compat with any existing plots that already chose
  // this type, but it's hidden from the tile picker.
  { type: "error-bar", label: "Error bar", hint: "(deprecated)", v1: false },
  // Pass 2 — statistical / time / multi-axis plot types, now live.
  { type: "ecdf", label: "ECDF", hint: "Cumulative", v1: true },
  { type: "qq", label: "Q-Q", hint: "vs. normal", v1: true },
  { type: "bland-altman", label: "B-Altman", hint: "Method cmp", v1: true },
  { type: "regression", label: "Regression", hint: "Fit + CI band", v1: true },
  { type: "residual", label: "Residual", hint: "Fit residuals", v1: true },
  { type: "timeseries", label: "Timeseries", hint: "Date X axis", v1: true },
  { type: "dual-y", label: "Dual Y", hint: "Two scales", v1: true },
];

export interface PlotterBinding {
  vaultPath: string;
  notePath: string;
  plotId: string;
  plotType: CortexPlotType;
  width: number;
  height: number;
  configB64: string;
  dataB64: string;
  /** Apply a patch to the node's attrs in the editor doc. */
  updateAttrs: (
    patch: Partial<{
      plotType: CortexPlotType;
      width: number;
      height: number;
      configB64: string;
      dataB64: string;
    }>,
  ) => void;
  /** Warm the editor's storage cache so the NodeView re-reads data. */
  warmDataCache: (data: PlotData) => void;
}

export interface PlotterSidebarProps {
  binding: PlotterBinding | null;
  /** Called when the sidebar's close-X is clicked. */
  onClose: () => void;
  /** Persisted width in pixels (controlled). */
  width: number;
  onWidthChange: (next: number) => void;
}

const MIN_W = 360;
const MAX_W = 640;

export function PlotterSidebar({
  binding,
  onClose,
  width,
  onWidthChange,
}: PlotterSidebarProps) {
  const [data, setData] = useState<PlotData>(() => emptyPlotPayload().data);
  const [config, setConfig] = useState<PlotConfig>(
    () => emptyPlotPayload().config,
  );
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  // Bug 1 fix: the binding's plotType only updates when the user
  // focus-clicks a plot. Clicking a tile in this sidebar dispatches
  // updateAttrs(plotType:...) to the editor doc but the binding prop
  // stays stale until a fresh focus event arrives. Track plotType
  // locally and drive the active-tile class from this state; resync
  // from binding via useEffect whenever the binding changes target.
  const [activePlotType, setActivePlotType] = useState<CortexPlotType>(
    () => binding?.plotType ?? "scatter",
  );
  // Pass 3.4 — orphan plots GC modal toggle.
  const [orphansOpen, setOrphansOpen] = useState(false);
  // Pass 4.11 — pendingSelection state removed alongside the
  // selections feature.
  // Pass 4.7 — Y-series range adder inline form state. When open, the
  // user types `from`/`to` column indices (1-based for friendliness)
  // and clicks Add to append every column in that range as a Y series.
  const [rangeAdderOpen, setRangeAdderOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  // Pass 4.8 — Auto-fit axis range helper. Computes [min, max] for the
  // requested axis. Preference order:
  //   1. If cell selections exist, use the numeric values inside those
  //      cells (so the user can drag-select a subset of cells and tell
  //      the axis to fit JUST those).
  //   2. Otherwise, use every numeric value in the X column (for X
  //      axis) or every numeric value across every active Y series
  //      (for Y axis).
  // Returns null when the axis can't be auto-fit (e.g., no numeric
  // data available).
  const computeAutoRange = useCallback(
    (axis: "x" | "y"): [number, number] | null => {
      const sels = data.cellSelections ?? [];
      const values: number[] = [];
      const pushNumeric = (raw: number | string | null) => {
        if (raw == null) return;
        const n = typeof raw === "number" ? raw : parseFloat(String(raw));
        if (Number.isFinite(n)) values.push(n);
      };
      if (sels.length > 0) {
        // Use cells from selections — every cell, regardless of role.
        // The user picked these cells deliberately so they want the
        // axis to bound them.
        for (const sel of sels) {
          for (const cell of sel.cells) {
            pushNumeric(data.rows[cell.row]?.[cell.col] ?? null);
          }
        }
      }
      if (values.length === 0) {
        // Fall back to all data in the relevant columns.
        if (axis === "x") {
          const xCol = config.mapping?.x ?? 0;
          for (const r of data.rows) pushNumeric(r[xCol] ?? null);
        } else {
          const ys =
            config.mapping?.ySeries && config.mapping.ySeries.length > 0
              ? config.mapping.ySeries
              : config.mapping?.y != null
                ? [config.mapping.y]
                : [];
          for (const yc of ys) {
            for (const r of data.rows) pushNumeric(r[yc] ?? null);
          }
        }
      }
      if (values.length === 0) return null;
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
      // Add a 5% padding on each side so points don't kiss the axes.
      const span = max - min || 1;
      const pad = span * 0.05;
      // Round to 4 significant digits for clean display.
      const round4 = (n: number) => {
        if (n === 0) return 0;
        const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 3);
        return Math.round(n / mag) * mag;
      };
      return [round4(min - pad), round4(max + pad)];
    },
    [data, config.mapping],
  );

  // ---- load on binding change ------------------------------------------
  useEffect(() => {
    if (!binding) return;
    setStatusMessage("");
    // Bug 1 fix: resync local active-tile state whenever the binding
    // changes target (e.g. user clicked a different plot in the doc).
    setActivePlotType(binding.plotType);
    // Decode config from the node's attr.
    const cfg = decodePlotBlob<PlotConfig>(binding.configB64);
    setConfig(cfg ?? emptyPlotPayload().config);
    // Decode data: inline first, then sidecar.
    if (binding.dataB64) {
      const inline = decodePlotBlob<PlotData>(binding.dataB64);
      setData(inline ?? emptyPlotPayload().data);
      return;
    }
    // Sidecar load.
    setLoading(true);
    invoke<PlotPayload | null>("read_plot_sidecar", {
      vaultPath: binding.vaultPath,
      notePath: binding.notePath,
      plotId: binding.plotId,
    })
      .then((payload) => {
        if (payload && payload.data) {
          setData(payload.data);
          binding.warmDataCache(payload.data);
        } else {
          setData(emptyPlotPayload().data);
        }
      })
      .catch((e) => setStatusMessage(`Load failed: ${e}`))
      .finally(() => setLoading(false));
  }, [binding]);

  // ---- commit config to the node attr (debounced) ----------------------
  const configFlushTimer = useRef<number | null>(null);
  const commitConfig = useCallback(
    (next: PlotConfig) => {
      setConfig(next);
      if (!binding) return;
      if (configFlushTimer.current)
        window.clearTimeout(configFlushTimer.current);
      configFlushTimer.current = window.setTimeout(() => {
        binding.updateAttrs({ configB64: encodePlotBlob(next) });
      }, 200);
    },
    [binding],
  );

  // ---- commit data (debounced, sidecar-or-inline) ----------------------
  const dataFlushTimer = useRef<number | null>(null);
  const commitData = useCallback(
    (next: PlotData) => {
      setData(next);
      if (!binding) return;
      binding.warmDataCache(next);
      if (dataFlushTimer.current) window.clearTimeout(dataFlushTimer.current);
      dataFlushTimer.current = window.setTimeout(async () => {
        const inline = shouldInlinePlotData(next);
        if (inline) {
          // Inline path: store in node attrs; remove sidecar if it exists.
          binding.updateAttrs({ dataB64: encodePlotBlob(next) });
          // Sidecar cleanup is non-fatal — best-effort.
          try {
            await invoke("delete_plot_sidecar", {
              vaultPath: binding.vaultPath,
              notePath: binding.notePath,
              plotId: binding.plotId,
            });
          } catch (_) {
            /* ignore */
          }
        } else {
          // Sidecar path: write the file, clear dataB64.
          try {
            const payload: PlotPayload = {
              schemaVersion: 1,
              data: next,
              config,
            };
            await invoke("update_plot_sidecar", {
              vaultPath: binding.vaultPath,
              notePath: binding.notePath,
              plotId: binding.plotId,
              payload,
            });
            binding.updateAttrs({ dataB64: "" });
          } catch (e) {
            setStatusMessage(`Sidecar write failed: ${e}`);
          }
        }
      }, 350);
    },
    [binding, config],
  );

  // ---- plot type swap --------------------------------------------------
  const setPlotType = useCallback(
    (t: CortexPlotType) => {
      if (!binding) return;
      // Bug 1 fix: drive local active-tile state optimistically so the
      // gradient highlight follows the click immediately. The node-attr
      // update via updateAttrs causes the NodeView to re-render the
      // chart for the new type; the binding prop stays stale until a
      // fresh focus event so we cannot rely on it for the active class.
      setActivePlotType(t);
      binding.updateAttrs({ plotType: t });
    },
    [binding],
  );

  // ---- CSV import ------------------------------------------------------
  const importCsv = useCallback(async () => {
    if (!binding) return;
    setStatusMessage("");
    try {
      const picked = await openFileDialog({
        title: "Import CSV",
        filters: [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }],
        multiple: false,
      });
      if (!picked || typeof picked !== "string") return;
      // Reuse the existing markdown-file reader (it reads any text file).
      const text = await invoke<string>("read_markdown_file", { path: picked });
      const result = parseCsv(text);
      commitData(result.data);
      // Auto-map: first numeric column → X, second numeric → Y.
      const numericCols = result.data.columns
        .map((c, i) => ({ c, i }))
        .filter((p) => p.c.type === "number");
      const next: PlotConfig = {
        ...config,
        mapping: {
          ...config.mapping,
          x: numericCols[0]?.i ?? 0,
          y: numericCols[1]?.i ?? 1,
        },
      };
      commitConfig(next);
      // Pass 2.4 — auto-suggest a plot type when the user has not yet
      // committed to one (still on default scatter + empty data before
      // import). Switching now spares them an extra click.
      const isDefaultState =
        activePlotType === "scatter" && data.rows.length === 0;
      if (isDefaultState) {
        const suggestion = topSuggestion(result.data);
        if (suggestion && suggestion.plotType !== "scatter") {
          setPlotType(suggestion.plotType);
        }
      }
      const suggestion = topSuggestion(result.data);
      const suggestionLabel = suggestion
        ? ` · best fit: ${suggestion.plotType}`
        : "";
      setStatusMessage(
        `Imported ${result.data.rows.length} rows · ${result.data.columns.length} cols${
          result.warnings.length ? ` · ${result.warnings.length} warnings` : ""
        }${suggestionLabel}`,
      );
    } catch (e) {
      setStatusMessage(`Import failed: ${e}`);
    }
  }, [binding, commitData, commitConfig, config]);

  // ---- CSV export ------------------------------------------------------
  const exportCsv = useCallback(async () => {
    if (!binding) return;
    try {
      const dest = await saveFileDialog({
        title: "Export CSV",
        defaultPath: `${binding.plotId}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!dest || typeof dest !== "string") return;
      await invoke("write_text_file", {
        path: dest,
        contents: serializeCsv(data),
      });
      setStatusMessage(`Exported to ${dest}`);
    } catch (e) {
      setStatusMessage(`Export failed: ${e}`);
    }
  }, [binding, data]);

  // ---- PNG / SVG export ------------------------------------------------
  // Pass-1 approach: serialize the canvas's SVG via DOM, then write
  // it. PNG export requires rasterizing, deferred to pass 3.
  const exportSvg = useCallback(async () => {
    if (!binding) return;
    try {
      // Find the SVG in the editor doc for this plot. We look it up
      // by `data-plot-id` on the wrap div, since multiple plots could
      // be visible.
      const wrap = document.querySelector(
        `.cortex-plot-wrap[data-plot-id="${binding.plotId}"] svg.recharts-surface`,
      );
      if (!wrap) {
        setStatusMessage("No rendered chart found to export.");
        return;
      }
      const xml = new XMLSerializer().serializeToString(wrap);
      const dest = await saveFileDialog({
        title: "Export SVG",
        defaultPath: `${binding.plotId}.svg`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!dest || typeof dest !== "string") return;
      await invoke("write_text_file", {
        path: dest,
        contents:
          '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + xml,
      });
      setStatusMessage(`Exported SVG to ${dest}`);
    } catch (e) {
      setStatusMessage(`SVG export failed: ${e}`);
    }
  }, [binding]);

  // Pass 3.2 — PNG export. Rasterizes the live SVG at 2× DPR via
  // plotExport.svgToPng, then writes the PNG bytes via a small Rust
  // helper. write_text_file expects text, so we go through a JSON-
  // safe base64 string and a new write_binary_file path (added in
  // pass 3 to lib.rs).
  const exportPng = useCallback(async () => {
    if (!binding) return;
    try {
      const svg = findPlotSvg(binding.plotId);
      if (!svg) {
        setStatusMessage("No rendered chart found to export.");
        return;
      }
      const dest = await saveFileDialog({
        title: "Export PNG",
        defaultPath: `${binding.plotId}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (!dest || typeof dest !== "string") return;
      const blob = await svgToPng(svg);
      const buf = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      await invoke("write_binary_file", { path: dest, bytes });
      setStatusMessage(`Exported PNG to ${dest}`);
    } catch (e) {
      setStatusMessage(`PNG export failed: ${e}`);
    }
  }, [binding]);

  // Pass 3.2 — Copy to clipboard as PNG. navigator.clipboard.write is
  // gated on a user gesture (this button click satisfies that).
  const copyToClipboard = useCallback(async () => {
    if (!binding) return;
    try {
      const svg = findPlotSvg(binding.plotId);
      if (!svg) {
        setStatusMessage("No rendered chart found to copy.");
        return;
      }
      const ok = await svgToClipboard(svg);
      setStatusMessage(
        ok
          ? "Plot copied to clipboard."
          : "Clipboard not available in this context.",
      );
    } catch (e) {
      setStatusMessage(`Clipboard copy failed: ${e}`);
    }
  }, [binding]);

  // Pass 3.3 — Print. Opens a print-friendly child window with the
  // chart rasterized + a white background, then triggers print.
  const printActive = useCallback(async () => {
    if (!binding) return;
    try {
      const svg = findPlotSvg(binding.plotId);
      if (!svg) {
        setStatusMessage("No rendered chart found to print.");
        return;
      }
      await printPlot(svg, binding.plotId);
    } catch (e) {
      setStatusMessage(`Print failed: ${e}`);
    }
  }, [binding]);

  // ---- series mapping handlers ----------------------------------------
  const setMapping = useCallback(
    (key: keyof NonNullable<PlotConfig["mapping"]>, value: number | null) => {
      const next: PlotConfig = {
        ...config,
        mapping: { ...config.mapping, [key]: value },
      };
      commitConfig(next);
    },
    [config, commitConfig],
  );

  // ---- palette swap ---------------------------------------------------
  const setPalette = useCallback(
    (name: NonNullable<PlotConfig["palette"]>) => {
      commitConfig({ ...config, palette: name });
    },
    [config, commitConfig],
  );

  // ---- left-edge resize handle ---------------------------------------
  const resizeStateRef = useRef<{ startX: number; startW: number } | null>(
    null,
  );
  const onResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      resizeStateRef.current = { startX: e.clientX, startW: width };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );
  const onResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = resizeStateRef.current;
      if (!s) return;
      const dx = s.startX - e.clientX; // drag LEFT = wider
      const next = Math.max(MIN_W, Math.min(MAX_W, Math.round(s.startW + dx)));
      onWidthChange(next);
    },
    [onWidthChange],
  );
  const onResizeUp = useCallback(() => {
    resizeStateRef.current = null;
  }, []);

  // ---- render ----------------------------------------------------------
  const columnOptions = useMemo(
    () => [
      { label: "(none)", value: null as number | null },
      ...data.columns.map((c, i) => ({
        label: `${c.name} (${c.type})`,
        value: i,
      })),
    ],
    [data.columns],
  );

  // Pass 4.13 — legend position updates from the draggable
  // CortexLegend inside ScatterPlot. ScatterPlot dispatches
  // window CustomEvents because piping a callback through
  // PlotByType → renderer props would require a wide refactor.
  // We just listen here and forward to commitConfig.
  useEffect(() => {
    function onLegendPos(e: Event) {
      const ce = e as CustomEvent<{ position: { x: number; y: number } }>;
      const pos = ce.detail?.position;
      if (!pos) return;
      // Use a functional update via the latest config closed over.
      // Note: this directly fires commitConfig which mutates local
      // state + debounces the node-attr save. Drag generates many
      // pointermove events, so commitConfig's existing 200 ms
      // debounce keeps the disk write rate sane.
      commitConfig({ ...config, legendPosition: pos });
    }
    // Pass 4.14 — companion handler for resize events.
    function onLegendSize(e: Event) {
      const ce = e as CustomEvent<{ size: { w: number; h: number } }>;
      const sz = ce.detail?.size;
      if (!sz) return;
      commitConfig({ ...config, legendSize: sz });
    }
    window.addEventListener("cortex:plot-legend-position", onLegendPos);
    window.addEventListener("cortex:plot-legend-size", onLegendSize);
    return () => {
      window.removeEventListener("cortex:plot-legend-position", onLegendPos);
      window.removeEventListener("cortex:plot-legend-size", onLegendSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, commitConfig]);

  // Pass 4.1 — Esc closes the modal so the user can return to the
  // document without reaching for the mouse.
  //
  // ⚠️ Bug fix: this useEffect MUST live above the early-return below.
  // When `binding` flips from null to a value (the user clicks a plot
  // in the doc) the hook count would change between renders, which
  // breaks the Rules of Hooks and blanks the whole React tree with a
  // "rendered more hooks than during the previous render" error.
  useEffect(() => {
    if (!binding) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [binding, onClose]);

  if (!binding) return null;

  // Pass 4.1 (rewrite) — keep the modal layout as inline styles
  // exclusively so no CSS-cascade conflicts can hide content. We
  // proved with the original CSS-grid attempt that even small
  // cascade collisions blanked the whole screen; sticking to
  // styles defined locally here gives us a reliable baseline.
  return (
    <div
      data-cortex-modal=""
      data-cortex-scrim=""
      data-cortex-fullscreen=""
      role="dialog"
      aria-label="Plot editor"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        background: "rgba(0,0,0,0.5)",
        color: "var(--text)",
        fontSize: "0.9rem",
      }}
      // Pass 4.10 — close on mousedown directly on the scrim, NOT on
      // click. The earlier onClick handler closed the modal whenever
      // a click event landed on the outer div as the common ancestor
      // of mousedown + mouseup — which is exactly what happens when
      // the user drags from a cell and releases over the scrim. That
      // accidentally unmounted PlotterSidebar mid-drag, taking the
      // pending-selection popover with it before it could render.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          background: "var(--bg-elev)",
          backdropFilter: "var(--blur-chrome)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Plot
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.85rem",
              color: "var(--accent)",
            }}
          >
            {binding.plotId}
          </span>
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close plotter"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-2)",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-1)",
            cursor: "pointer",
            fontSize: "1.2rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </header>
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0, // critical for flex children to scroll
        }}
      >
        <div
          style={{
            flex: 1,
            background: "var(--bg-card)",
            backdropFilter: "var(--blur-chrome)",
            padding: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            borderRight: "1px solid var(--border)",
          }}
        >
          {data.rows.length === 0 ? (
            <div className="cortex-plotter-modal-empty">
              <div className="cortex-plotter-modal-empty-title">
                Add data to see your plot
              </div>
              <div className="cortex-plotter-modal-empty-hint">
                Type into the grid on the right, paste a TSV, or click "Import
                CSV…" to load a file.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                maxWidth: "100%",
              }}
            >
              {/* Pass 4.4 G01 — plot title + subtitle above the chart. */}
              {config.plotTitle && (
                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 500,
                    color: "var(--text)",
                    letterSpacing: "0.02em",
                    textAlign: "center",
                  }}
                >
                  {config.plotTitle}
                </div>
              )}
              {config.plotSubtitle && (
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "var(--text-2)",
                    marginBottom: 4,
                    textAlign: "center",
                  }}
                >
                  {config.plotSubtitle}
                </div>
              )}
              <PlotByType
                payload={{ schemaVersion: 1, data, config }}
                width={Math.max(360, Math.round(window.innerWidth * 0.46))}
                height={Math.max(
                  280,
                  Math.round(window.innerHeight * 0.78) -
                    (config.plotTitle ? 28 : 0) -
                    (config.plotSubtitle ? 22 : 0),
                )}
                plotType={activePlotType}
              />
            </div>
          )}
        </div>
        <aside
          className="cortex-view cortex-view-plotter"
          style={{
            flex: 1,
            background: "var(--bg-elev)",
            backdropFilter: "var(--blur-chrome)",
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Plot type</h3>
            {/* Pass 2.4 — Suggest button. Picks the highest-scoring plot
            type for the current data and applies it. Disabled when the
            data is empty (no signal to score against). */}
            <div className="cortex-plotter-data-actions">
              <button
                className="cortex-plotter-btn"
                disabled={data.rows.length === 0}
                onClick={() => {
                  const ranked = suggestPlotTypes(data);
                  if (ranked.length === 0) {
                    setStatusMessage("No suggestion — add data first.");
                    return;
                  }
                  const top = ranked[0];
                  setPlotType(top.plotType);
                  setStatusMessage(
                    `Suggested: ${top.plotType} — ${top.reason} (score ${top.score.toFixed(2)})`,
                  );
                }}
                title="Pick the best plot type for the current data"
              >
                ✨ Suggest
              </button>
            </div>
            <div className="cortex-plotter-tiles">
              {PLOT_TYPE_TILES.map((t) => (
                <button
                  key={t.type}
                  className={
                    "cortex-plotter-tile" +
                    (activePlotType === t.type
                      ? " cortex-plotter-tile-active"
                      : "") +
                    (!t.v1 ? " cortex-plotter-tile-deferred" : "")
                  }
                  onClick={() => t.v1 && setPlotType(t.type)}
                  disabled={!t.v1}
                  title={t.v1 ? t.hint : `${t.hint} — pass 2`}
                >
                  <span className="cortex-plotter-tile-label">{t.label}</span>
                  <span className="cortex-plotter-tile-hint">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Data</h3>
            <div className="cortex-plotter-data-actions">
              <button className="cortex-plotter-btn" onClick={importCsv}>
                Import CSV…
              </button>
              <button className="cortex-plotter-btn" onClick={exportCsv}>
                Export CSV
              </button>
            </div>
            {loading ? (
              <div className="cortex-plotter-loading">Loading…</div>
            ) : (
              <PlotDataGrid data={data} onChange={commitData} maxHeight={320} />
            )}
          </section>

          {/* Pass 4.11 — Selections feature removed. Per-Y-series
          ± σ error bars are now configured by picking a stddev
          column directly in each Y series row of the Series
          section. */}

          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Series</h3>
            <div className="cortex-plotter-form">
              <label className="cortex-plotter-field">
                <span>X column</span>
                <select
                  value={String(config.mapping?.x ?? 0)}
                  onChange={(e) =>
                    setMapping(
                      "x",
                      e.target.value === "null" ? null : Number(e.target.value),
                    )
                  }
                >
                  {columnOptions.map((o) => (
                    <option
                      key={o.value ?? "null"}
                      value={String(o.value ?? "null")}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Pass 3.1 — multi-Y series list with per-series L/R axis.
              Supported on line / area / bar (vertical). For the other
              plot types we still show a single Y dropdown since they
              are inherently single-series (or use group/color for
              multi-series, e.g. scatter). */}
              {activePlotType === "scatter" ||
              activePlotType === "line" ||
              activePlotType === "area" ||
              activePlotType === "bar" ||
              activePlotType === "timeseries" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span style={{ color: "var(--text-2)", fontSize: "0.78rem" }}>
                    Y columns
                  </span>
                  {(() => {
                    // Source of truth for the list: ySeries first, else
                    // fall back to the legacy single `y`. Old plots
                    // upgrade transparently on first edit.
                    const effective =
                      config.mapping?.ySeries &&
                      config.mapping.ySeries.length > 0
                        ? config.mapping.ySeries
                        : config.mapping?.y != null
                          ? [config.mapping.y]
                          : [];
                    const axisMap = config.mapping?.ySeriesAxis ?? {};
                    const updateSeries = (
                      next: number[],
                      nextAxis?: Record<number, "left" | "right">,
                    ) => {
                      commitConfig({
                        ...config,
                        mapping: {
                          ...config.mapping,
                          ySeries: next,
                          ySeriesAxis: nextAxis ?? axisMap,
                          // Keep legacy `y` aimed at the first series for
                          // downstream renderers that still read it.
                          y: next[0] ?? null,
                        },
                      });
                    };
                    return (
                      <>
                        {effective.map((yc, i) => {
                          // Pass 4.11 — per-series controls. Each Y series
                          // is a small two-row card: top row is column +
                          // axis toggle + delete; bottom row is σ column,
                          // trendline kind, CI band toggle.
                          const stddevMap = config.mapping?.stddevColumns ?? {};
                          const trendMap = config.seriesTrendline ?? {};
                          const trendCfg = trendMap[yc];
                          return (
                            <div
                              key={`y-${i}`}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                padding: "6px 8px",
                                background: "var(--bg-card)",
                                border: "1px solid var(--border)",
                                borderRadius: "var(--radius-1)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  alignItems: "center",
                                }}
                              >
                                <select
                                  value={String(yc)}
                                  onChange={(e) => {
                                    const newCol = Number(e.target.value);
                                    const next = effective.slice();
                                    const oldCol = next[i];
                                    next[i] = newCol;
                                    // Move axis assignment to the new column.
                                    const newAxis = { ...axisMap };
                                    if (axisMap[oldCol]) {
                                      newAxis[newCol] = axisMap[oldCol];
                                      delete newAxis[oldCol];
                                    }
                                    // Also move σ + trendline bindings to the
                                    // new column index so per-series settings
                                    // survive a column-swap.
                                    const nextStddev = { ...stddevMap };
                                    if (stddevMap[oldCol] != null) {
                                      nextStddev[newCol] = stddevMap[oldCol];
                                      delete nextStddev[oldCol];
                                    }
                                    const nextTrend = { ...trendMap };
                                    if (trendMap[oldCol]) {
                                      nextTrend[newCol] = trendMap[oldCol];
                                      delete nextTrend[oldCol];
                                    }
                                    commitConfig({
                                      ...config,
                                      mapping: {
                                        ...config.mapping,
                                        ySeries: next,
                                        ySeriesAxis: newAxis,
                                        stddevColumns: nextStddev,
                                        y: next[0] ?? null,
                                      },
                                      seriesTrendline: nextTrend,
                                    });
                                  }}
                                  style={{ flex: 1, minWidth: 0 }}
                                >
                                  {data.columns.map((c, ci) => (
                                    <option key={ci} value={String(ci)}>
                                      {c.name} ({c.type})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="cortex-plotter-btn"
                                  onClick={() => {
                                    const cur = axisMap[yc] ?? "left";
                                    const nextAxis = { ...axisMap };
                                    if (cur === "left") nextAxis[yc] = "right";
                                    else delete nextAxis[yc];
                                    updateSeries(effective, nextAxis);
                                  }}
                                  title={
                                    (axisMap[yc] ?? "left") === "right"
                                      ? "Plotted on the right Y axis — click for left"
                                      : "Plotted on the left Y axis — click for right"
                                  }
                                  style={{
                                    minWidth: 32,
                                    fontFamily: "var(--font-mono, monospace)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {(axisMap[yc] ?? "left") === "right"
                                    ? "R"
                                    : "L"}
                                </button>
                                <button
                                  className="cortex-plotter-btn"
                                  onClick={() => {
                                    const next = effective.slice();
                                    next.splice(i, 1);
                                    const nextAxis = { ...axisMap };
                                    delete nextAxis[yc];
                                    const nextStddev = { ...stddevMap };
                                    delete nextStddev[yc];
                                    const nextTrend = { ...trendMap };
                                    delete nextTrend[yc];
                                    commitConfig({
                                      ...config,
                                      mapping: {
                                        ...config.mapping,
                                        ySeries: next,
                                        ySeriesAxis: nextAxis,
                                        stddevColumns: nextStddev,
                                        y: next[0] ?? null,
                                      },
                                      seriesTrendline: nextTrend,
                                    });
                                  }}
                                  disabled={effective.length === 1}
                                  title="Remove this Y series"
                                >
                                  ×
                                </button>
                              </div>
                              {/* Bottom row — σ column + trendline kind + CI */}
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  alignItems: "center",
                                  fontSize: "0.78rem",
                                }}
                              >
                                <span style={{ color: "var(--text-2)" }}>
                                  σ:
                                </span>
                                <select
                                  value={String(stddevMap[yc] ?? "")}
                                  onChange={(e) => {
                                    const next = { ...stddevMap };
                                    if (e.target.value === "") {
                                      delete next[yc];
                                    } else {
                                      next[yc] = Number(e.target.value);
                                    }
                                    commitConfig({
                                      ...config,
                                      mapping: {
                                        ...config.mapping,
                                        stddevColumns: next,
                                      },
                                    });
                                  }}
                                  style={{ flex: 1, minWidth: 0 }}
                                  title="Column whose values are used as ± σ error magnitudes for this series"
                                >
                                  <option value="">— none —</option>
                                  {data.columns.map((c, ci) => (
                                    <option key={ci} value={String(ci)}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <span style={{ color: "var(--text-2)" }}>
                                  fit:
                                </span>
                                <select
                                  value={trendCfg?.kind ?? "none"}
                                  onChange={(e) => {
                                    const next = { ...trendMap };
                                    const kind = e.target.value as
                                      | "none"
                                      | "auto"
                                      | "linear"
                                      | "poly2"
                                      | "poly3"
                                      | "exponential"
                                      | "log"
                                      | "power";
                                    if (kind === "none") {
                                      delete next[yc];
                                    } else {
                                      next[yc] = {
                                        kind,
                                        showCi: next[yc]?.showCi ?? false,
                                      };
                                    }
                                    commitConfig({
                                      ...config,
                                      seriesTrendline: next,
                                    });
                                  }}
                                  style={{ flex: 1, minWidth: 0 }}
                                >
                                  <option value="none">none</option>
                                  <option value="auto">auto</option>
                                  <option value="linear">linear</option>
                                  <option value="poly2">poly²</option>
                                  <option value="poly3">poly³</option>
                                  <option value="exponential">exp</option>
                                  <option value="log">log</option>
                                  <option value="power">power</option>
                                </select>
                                {trendCfg && trendCfg.kind !== "none" && (
                                  <label
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 2,
                                      color: "var(--text-2)",
                                    }}
                                    title="Show 95% confidence band for this series' trendline"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={!!trendCfg.showCi}
                                      onChange={(e) => {
                                        const next = { ...trendMap };
                                        next[yc] = {
                                          kind: trendCfg.kind,
                                          showCi: e.target.checked,
                                        };
                                        commitConfig({
                                          ...config,
                                          seriesTrendline: next,
                                        });
                                      }}
                                    />
                                    CI
                                  </label>
                                )}
                              </div>
                              {/* Pass 4.12 — third row: marker shape picker.
                            Scatter-specific (other plot types don't
                            show series-level markers). */}
                              {activePlotType === "scatter" && (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    alignItems: "center",
                                    fontSize: "0.78rem",
                                  }}
                                >
                                  <span style={{ color: "var(--text-2)" }}>
                                    shape:
                                  </span>
                                  <select
                                    value={config.seriesShape?.[yc] ?? "circle"}
                                    onChange={(e) => {
                                      const next = {
                                        ...(config.seriesShape ?? {}),
                                      };
                                      const v = e.target.value as
                                        | "circle"
                                        | "square"
                                        | "diamond"
                                        | "triangle"
                                        | "cross"
                                        | "plus"
                                        | "star";
                                      if (v === "circle") delete next[yc];
                                      else next[yc] = v;
                                      commitConfig({
                                        ...config,
                                        seriesShape: next,
                                      });
                                    }}
                                    style={{ flex: 1, minWidth: 0 }}
                                    title="Marker shape for this series' dots"
                                  >
                                    <option value="circle">● circle</option>
                                    <option value="square">■ square</option>
                                    <option value="diamond">◆ diamond</option>
                                    <option value="triangle">▲ triangle</option>
                                    <option value="cross">✕ cross</option>
                                    <option value="plus">+ plus</option>
                                    <option value="star">★ star</option>
                                  </select>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <div
                          style={{
                            display: "flex",
                            gap: 4,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            className="cortex-plotter-btn"
                            onClick={() => {
                              // Pick the first numeric column not already in
                              // the list, else the first column.
                              const used = new Set(effective);
                              let cand = data.columns.findIndex(
                                (c, i) => c.type === "number" && !used.has(i),
                              );
                              if (cand < 0)
                                cand = data.columns.findIndex(
                                  (_, i) => !used.has(i),
                                );
                              if (cand < 0) cand = 0;
                              updateSeries([...effective, cand]);
                            }}
                            disabled={effective.length >= data.columns.length}
                          >
                            + Y series
                          </button>
                          {/* Pass 4.7 — Range adder. Toggles an inline form for
                          adding multiple Y series at once by column range.
                          Column indices are shown 1-based in the UI for
                          consistency with the row numbers in the grid. */}
                          <button
                            className="cortex-plotter-btn"
                            onClick={() => {
                              setRangeAdderOpen((v) => !v);
                              // Pre-fill From with the column just past the
                              // current last Y series, and To with the last
                              // column — sensible defaults.
                              if (!rangeAdderOpen) {
                                const last =
                                  effective[effective.length - 1] ?? 0;
                                const from = Math.min(
                                  last + 1,
                                  data.columns.length - 1,
                                );
                                setRangeFrom(String(from + 1));
                                setRangeTo(String(data.columns.length));
                              }
                            }}
                            disabled={effective.length >= data.columns.length}
                          >
                            {rangeAdderOpen ? "Hide range" : "Range…"}
                          </button>
                        </div>
                        {rangeAdderOpen && (
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              alignItems: "center",
                              padding: "6px 8px",
                              background: "var(--bg-card)",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-1)",
                              fontSize: "0.78rem",
                            }}
                          >
                            <span style={{ color: "var(--text-2)" }}>From</span>
                            <input
                              type="number"
                              min={1}
                              max={data.columns.length}
                              value={rangeFrom}
                              onChange={(e) => setRangeFrom(e.target.value)}
                              style={{ width: 56 }}
                            />
                            <span style={{ color: "var(--text-2)" }}>to</span>
                            <input
                              type="number"
                              min={1}
                              max={data.columns.length}
                              value={rangeTo}
                              onChange={(e) => setRangeTo(e.target.value)}
                              style={{ width: 56 }}
                            />
                            <button
                              className="cortex-plotter-btn"
                              onClick={() => {
                                // Parse + clamp. UI shows 1-based, internal is 0-based.
                                const f1 = parseInt(rangeFrom, 10);
                                const t1 = parseInt(rangeTo, 10);
                                if (
                                  !Number.isFinite(f1) ||
                                  !Number.isFinite(t1)
                                )
                                  return;
                                const lo = Math.max(
                                  0,
                                  Math.min(
                                    data.columns.length - 1,
                                    Math.min(f1, t1) - 1,
                                  ),
                                );
                                const hi = Math.max(
                                  0,
                                  Math.min(
                                    data.columns.length - 1,
                                    Math.max(f1, t1) - 1,
                                  ),
                                );
                                const used = new Set(effective);
                                const additions: number[] = [];
                                for (let i = lo; i <= hi; i++) {
                                  if (!used.has(i)) {
                                    additions.push(i);
                                    used.add(i);
                                  }
                                }
                                if (additions.length > 0) {
                                  updateSeries([...effective, ...additions]);
                                }
                                setRangeAdderOpen(false);
                              }}
                            >
                              Add{" "}
                              {Math.max(
                                0,
                                (() => {
                                  const f1 = parseInt(rangeFrom, 10);
                                  const t1 = parseInt(rangeTo, 10);
                                  if (
                                    !Number.isFinite(f1) ||
                                    !Number.isFinite(t1)
                                  )
                                    return 0;
                                  const lo = Math.max(
                                    0,
                                    Math.min(
                                      data.columns.length - 1,
                                      Math.min(f1, t1) - 1,
                                    ),
                                  );
                                  const hi = Math.max(
                                    0,
                                    Math.min(
                                      data.columns.length - 1,
                                      Math.max(f1, t1) - 1,
                                    ),
                                  );
                                  let n = 0;
                                  for (let i = lo; i <= hi; i++)
                                    if (!effective.includes(i)) n++;
                                  return n;
                                })(),
                              )}
                            </button>
                          </div>
                        )}
                        {effective.some(
                          (c) => (axisMap[c] ?? "left") === "right",
                        ) && (
                          <span
                            style={{
                              color: "var(--text-2)",
                              fontSize: "0.7rem",
                              fontStyle: "italic",
                            }}
                          >
                            Right-axis series share an independent scale.
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <label className="cortex-plotter-field">
                  <span>Y column</span>
                  <select
                    value={String(config.mapping?.y ?? 1)}
                    onChange={(e) =>
                      setMapping(
                        "y",
                        e.target.value === "null"
                          ? null
                          : Number(e.target.value),
                      )
                    }
                  >
                    {columnOptions.map((o) => (
                      <option
                        key={o.value ?? "null"}
                        value={String(o.value ?? "null")}
                      >
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="cortex-plotter-field">
                <span>Group / color</span>
                <select
                  value={String(config.mapping?.group ?? "null")}
                  onChange={(e) =>
                    setMapping(
                      "group",
                      e.target.value === "null" ? null : Number(e.target.value),
                    )
                  }
                >
                  {columnOptions.map((o) => (
                    <option
                      key={o.value ?? "null"}
                      value={String(o.value ?? "null")}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {activePlotType === "error-bar" && (
                <>
                  <label className="cortex-plotter-field">
                    <span>Error up</span>
                    <select
                      value={String(config.mapping?.errorUp ?? "null")}
                      onChange={(e) =>
                        setMapping(
                          "errorUp",
                          e.target.value === "null"
                            ? null
                            : Number(e.target.value),
                        )
                      }
                    >
                      {columnOptions.map((o) => (
                        <option
                          key={o.value ?? "null"}
                          value={String(o.value ?? "null")}
                        >
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cortex-plotter-field">
                    <span>Error down</span>
                    <select
                      value={String(config.mapping?.errorDown ?? "null")}
                      onChange={(e) =>
                        setMapping(
                          "errorDown",
                          e.target.value === "null"
                            ? null
                            : Number(e.target.value),
                        )
                      }
                    >
                      {columnOptions.map((o) => (
                        <option
                          key={o.value ?? "null"}
                          value={String(o.value ?? "null")}
                        >
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </section>

          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Appearance</h3>
            <div className="cortex-plotter-form">
              {/* Pass 3.14 — width / height inputs removed. The corner
              drag handle on the in-document plot is the canonical
              affordance for sizing; duplicating it here was visually
              noisy and clashed when both sources tried to write. */}
              <label className="cortex-plotter-field">
                <span>Palette</span>
                <select
                  value={config.palette ?? "aurora"}
                  onChange={(e) => setPalette(e.target.value as any)}
                >
                  {ALL_PALETTES.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Pass 3.10 — dot / line size controls. */}
              <label className="cortex-plotter-field">
                <span>Dot size</span>
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={config.dotSize ?? 4}
                  onChange={(e) =>
                    commitConfig({ ...config, dotSize: Number(e.target.value) })
                  }
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Line width</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={
                    // Take the first numeric line width found, default 2.
                    (() => {
                      const sl = config.seriesLine ?? {};
                      for (const k of Object.keys(sl)) {
                        const w = sl[Number(k)]?.width;
                        if (w != null) return w;
                      }
                      return 2;
                    })()
                  }
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    // Apply uniformly to every active Y series.
                    const ys =
                      config.mapping?.ySeries &&
                      config.mapping.ySeries.length > 0
                        ? config.mapping.ySeries
                        : [config.mapping?.y ?? 1];
                    const nextLine = { ...(config.seriesLine ?? {}) };
                    for (const c of ys) {
                      nextLine[c] = { ...nextLine[c], width: w };
                    }
                    commitConfig({ ...config, seriesLine: nextLine });
                  }}
                />
              </label>
              {/* Pass 3.7 — scatter-only: connect dots with lines. */}
              {activePlotType === "scatter" && (
                <label className="cortex-plotter-field">
                  <span>Connect points</span>
                  <input
                    type="checkbox"
                    checked={!!config.connectPoints}
                    onChange={(e) =>
                      commitConfig({
                        ...config,
                        connectPoints: e.target.checked,
                      })
                    }
                  />
                </label>
              )}
              <label className="cortex-plotter-field">
                <span>Show grid</span>
                <input
                  type="checkbox"
                  checked={config.axis?.showGrid !== false}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, showGrid: e.target.checked },
                    })
                  }
                />
              </label>
              {/* Pass 4.12 — Show-legend toggle moved to the new Legend
              section alongside its fine-grained item checkboxes. */}
              {/* Pass 4.9 — σ-based error bars overlay. Each Y series gets
              a vertical error bar of magnitude = stdev of that series'
              Y values. Available on plot types that show points
              (scatter / line). For per-point custom error magnitudes,
              tag cells as "Error bar — X / Y" in the Selections
              section. */}
              {(activePlotType === "scatter" ||
                activePlotType === "line" ||
                activePlotType === "regression") && (
                <label className="cortex-plotter-field">
                  <span>± σ error bars</span>
                  <input
                    type="checkbox"
                    checked={!!config.showStdDevErrorBars}
                    onChange={(e) =>
                      commitConfig({
                        ...config,
                        showStdDevErrorBars: e.target.checked,
                      })
                    }
                  />
                </label>
              )}
              {activePlotType === "pie" && (
                <label className="cortex-plotter-field">
                  <span>Donut</span>
                  <input
                    type="checkbox"
                    checked={!!config.pie?.donut}
                    onChange={(e) =>
                      commitConfig({
                        ...config,
                        pie: { ...config.pie, donut: e.target.checked },
                      })
                    }
                  />
                </label>
              )}
              {activePlotType === "bar" && (
                <label className="cortex-plotter-field">
                  <span>Layout</span>
                  <select
                    value={config.bar?.layout ?? "grouped"}
                    onChange={(e) =>
                      commitConfig({
                        ...config,
                        bar: {
                          ...config.bar,
                          layout: e.target.value as "grouped" | "stacked",
                        },
                      })
                    }
                  >
                    <option value="grouped">Grouped</option>
                    <option value="stacked">Stacked</option>
                  </select>
                </label>
              )}
              {activePlotType === "histogram" && (
                <label className="cortex-plotter-field">
                  <span>Bin count</span>
                  <input
                    type="number"
                    min={2}
                    max={200}
                    value={config.histogram?.binCount ?? ""}
                    placeholder="auto"
                    onChange={(e) =>
                      commitConfig({
                        ...config,
                        histogram: {
                          ...config.histogram,
                          binCount:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}

              {/* Pass 4.4 G01 — plot title + subtitle. */}
              <label className="cortex-plotter-field">
                <span>Plot title</span>
                <input
                  type="text"
                  value={config.plotTitle ?? ""}
                  placeholder="(none)"
                  onChange={(e) =>
                    commitConfig({ ...config, plotTitle: e.target.value })
                  }
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Subtitle</span>
                <input
                  type="text"
                  value={config.plotSubtitle ?? ""}
                  placeholder="(none)"
                  onChange={(e) =>
                    commitConfig({ ...config, plotSubtitle: e.target.value })
                  }
                />
              </label>
              {/* G01 — X / Y axis labels. */}
              <label className="cortex-plotter-field">
                <span>X axis title</span>
                <input
                  type="text"
                  value={config.axis?.xLabel ?? ""}
                  placeholder="(column header)"
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, xLabel: e.target.value },
                    })
                  }
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Y axis title</span>
                <input
                  type="text"
                  value={config.axis?.yLabel ?? ""}
                  placeholder="(column header)"
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, yLabel: e.target.value },
                    })
                  }
                />
              </label>
              {/* G02 — log scale toggles per axis. */}
              <label className="cortex-plotter-field">
                <span>X scale</span>
                <select
                  value={config.axis?.xScale ?? "linear"}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: {
                        ...config.axis,
                        xScale: e.target.value as
                          | "linear"
                          | "log"
                          | "category"
                          | "date",
                      },
                    })
                  }
                >
                  <option value="linear">Linear</option>
                  <option value="log">Log</option>
                  <option value="category">Categorical</option>
                  <option value="date">Date</option>
                </select>
              </label>
              <label className="cortex-plotter-field">
                <span>Y scale</span>
                <select
                  value={config.axis?.yScale ?? "linear"}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: {
                        ...config.axis,
                        yScale: e.target.value as "linear" | "log",
                      },
                    })
                  }
                >
                  <option value="linear">Linear</option>
                  <option value="log">Log</option>
                </select>
              </label>
              {/* G03 — custom axis ranges. Two inputs per axis. Empty =
              auto (recharts default). */}
              <label className="cortex-plotter-field">
                <span>X range</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <input
                    type="number"
                    placeholder="min"
                    value={config.axis?.xRange?.[0] ?? ""}
                    onChange={(e) => {
                      const v =
                        e.target.value === "" ? null : Number(e.target.value);
                      commitConfig({
                        ...config,
                        axis: {
                          ...config.axis,
                          xRange: [v, config.axis?.xRange?.[1] ?? null],
                        },
                      });
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    placeholder="max"
                    value={config.axis?.xRange?.[1] ?? ""}
                    onChange={(e) => {
                      const v =
                        e.target.value === "" ? null : Number(e.target.value);
                      commitConfig({
                        ...config,
                        axis: {
                          ...config.axis,
                          xRange: [config.axis?.xRange?.[0] ?? null, v],
                        },
                      });
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  {/* Pass 4.8 — Auto button: fit the X range to either the
                  currently selected cells (when present) or all data
                  in the X column. */}
                  <button
                    className="cortex-plotter-btn"
                    onClick={() => {
                      const r = computeAutoRange("x");
                      if (!r) {
                        setStatusMessage("No numeric X data to auto-fit yet.");
                        return;
                      }
                      commitConfig({
                        ...config,
                        axis: { ...config.axis, xRange: r },
                      });
                      setStatusMessage(
                        `X auto-fit to [${r[0]}, ${r[1]}]${
                          (data.cellSelections ?? []).length > 0
                            ? " (from selections)"
                            : ""
                        }`,
                      );
                    }}
                    title="Auto-fit X range from selected cells (or all data)"
                    style={{ padding: "4px 8px" }}
                  >
                    Auto
                  </button>
                </span>
              </label>
              <label className="cortex-plotter-field">
                <span>Y range</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <input
                    type="number"
                    placeholder="min"
                    value={config.axis?.yRange?.[0] ?? ""}
                    onChange={(e) => {
                      const v =
                        e.target.value === "" ? null : Number(e.target.value);
                      commitConfig({
                        ...config,
                        axis: {
                          ...config.axis,
                          yRange: [v, config.axis?.yRange?.[1] ?? null],
                        },
                      });
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    placeholder="max"
                    value={config.axis?.yRange?.[1] ?? ""}
                    onChange={(e) => {
                      const v =
                        e.target.value === "" ? null : Number(e.target.value);
                      commitConfig({
                        ...config,
                        axis: {
                          ...config.axis,
                          yRange: [config.axis?.yRange?.[0] ?? null, v],
                        },
                      });
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    className="cortex-plotter-btn"
                    onClick={() => {
                      const r = computeAutoRange("y");
                      if (!r) {
                        setStatusMessage("No numeric Y data to auto-fit yet.");
                        return;
                      }
                      commitConfig({
                        ...config,
                        axis: { ...config.axis, yRange: r },
                      });
                      setStatusMessage(
                        `Y auto-fit to [${r[0]}, ${r[1]}]${
                          (data.cellSelections ?? []).length > 0
                            ? " (from selections)"
                            : ""
                        }`,
                      );
                    }}
                    title="Auto-fit Y range from selected cells (or all data)"
                    style={{ padding: "4px 8px" }}
                  >
                    Auto
                  </button>
                </span>
              </label>
              {/* Pass 4.9 — Right Y range. Renders only when at least one
              Y series is bound to the right axis. */}
              {(() => {
                const ySeries = config.mapping?.ySeries ?? [];
                const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
                const usesRight = ySeries.some(
                  (c) => ySeriesAxis[c] === "right",
                );
                if (!usesRight) return null;
                return (
                  <label className="cortex-plotter-field">
                    <span>Y right range</span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <input
                        type="number"
                        placeholder="min"
                        value={config.axis?.yRangeRight?.[0] ?? ""}
                        onChange={(e) => {
                          const v =
                            e.target.value === ""
                              ? null
                              : Number(e.target.value);
                          commitConfig({
                            ...config,
                            axis: {
                              ...config.axis,
                              yRangeRight: [
                                v,
                                config.axis?.yRangeRight?.[1] ?? null,
                              ],
                            },
                          });
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        placeholder="max"
                        value={config.axis?.yRangeRight?.[1] ?? ""}
                        onChange={(e) => {
                          const v =
                            e.target.value === ""
                              ? null
                              : Number(e.target.value);
                          commitConfig({
                            ...config,
                            axis: {
                              ...config.axis,
                              yRangeRight: [
                                config.axis?.yRangeRight?.[0] ?? null,
                                v,
                              ],
                            },
                          });
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        className="cortex-plotter-btn"
                        onClick={() => {
                          // Auto-fit only across series bound to the
                          // right axis (so the right scale isn't
                          // skewed by left-axis data).
                          const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
                          const rightCols = (
                            config.mapping?.ySeries ?? []
                          ).filter((c) => ySeriesAxis[c] === "right");
                          if (rightCols.length === 0) return;
                          const values: number[] = [];
                          for (const col of rightCols) {
                            for (const r of data.rows) {
                              const v = r[col];
                              const n =
                                typeof v === "number"
                                  ? v
                                  : typeof v === "string"
                                    ? parseFloat(v)
                                    : NaN;
                              if (Number.isFinite(n)) values.push(n);
                            }
                          }
                          if (values.length === 0) {
                            setStatusMessage(
                              "No numeric data on right-axis series.",
                            );
                            return;
                          }
                          const lo = Math.min(...values);
                          const hi = Math.max(...values);
                          const pad = (hi - lo || 1) * 0.05;
                          const round4 = (n: number) => {
                            if (n === 0) return 0;
                            const mag = Math.pow(
                              10,
                              Math.floor(Math.log10(Math.abs(n))) - 3,
                            );
                            return Math.round(n / mag) * mag;
                          };
                          const r: [number, number] = [
                            round4(lo - pad),
                            round4(hi + pad),
                          ];
                          commitConfig({
                            ...config,
                            axis: { ...config.axis, yRangeRight: r },
                          });
                          setStatusMessage(
                            `Right Y auto-fit to [${r[0]}, ${r[1]}]`,
                          );
                        }}
                        title="Auto-fit right-Y range across right-bound series"
                        style={{ padding: "4px 8px" }}
                      >
                        Auto
                      </button>
                    </span>
                  </label>
                );
              })()}
              {/* G23 — reverse axis. */}
              <label className="cortex-plotter-field">
                <span>Reverse X</span>
                <input
                  type="checkbox"
                  checked={!!config.axis?.xReverse}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, xReverse: e.target.checked },
                    })
                  }
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Reverse Y</span>
                <input
                  type="checkbox"
                  checked={!!config.axis?.yReverse}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, yReverse: e.target.checked },
                    })
                  }
                />
              </label>
              {/* G04 — D3-style tick format. */}
              <label className="cortex-plotter-field">
                <span>X tick format</span>
                <input
                  type="text"
                  placeholder=".0f / .2e / .1% / $.0f"
                  value={config.axis?.xTickFormat ?? ""}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, xTickFormat: e.target.value },
                    })
                  }
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Y tick format</span>
                <input
                  type="text"
                  placeholder=".0f / .2e / .1% / $.0f"
                  value={config.axis?.yTickFormat ?? ""}
                  onChange={(e) =>
                    commitConfig({
                      ...config,
                      axis: { ...config.axis, yTickFormat: e.target.value },
                    })
                  }
                />
              </label>
              {/* Pass 4.16 — tick step (Excel "major unit"). Numeric axes
              only; ignored when blank or 0. Each side has its own
              field so dual-Y plots can have different granularities. */}
              <label className="cortex-plotter-field">
                <span>X tick step</span>
                <input
                  type="number"
                  step="any"
                  placeholder="auto"
                  value={config.axis?.xTickStep ?? ""}
                  onChange={(e) => {
                    const s = e.target.value.trim();
                    const n = s === "" ? undefined : Number(s);
                    commitConfig({
                      ...config,
                      axis: {
                        ...config.axis,
                        xTickStep:
                          n != null && Number.isFinite(n) && n > 0
                            ? n
                            : undefined,
                      },
                    });
                  }}
                  title="Emit a tick every N units (e.g. 2 = ticks at 0, 2, 4, ...). Leave blank for auto."
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Y tick step</span>
                <input
                  type="number"
                  step="any"
                  placeholder="auto"
                  value={config.axis?.yTickStep ?? ""}
                  onChange={(e) => {
                    const s = e.target.value.trim();
                    const n = s === "" ? undefined : Number(s);
                    commitConfig({
                      ...config,
                      axis: {
                        ...config.axis,
                        yTickStep:
                          n != null && Number.isFinite(n) && n > 0
                            ? n
                            : undefined,
                      },
                    });
                  }}
                  title="Emit a tick every N units on the left Y axis. Leave blank for auto."
                />
              </label>
              <label className="cortex-plotter-field">
                <span>Y tick step (right)</span>
                <input
                  type="number"
                  step="any"
                  placeholder="auto"
                  value={config.axis?.yTickStepRight ?? ""}
                  onChange={(e) => {
                    const s = e.target.value.trim();
                    const n = s === "" ? undefined : Number(s);
                    commitConfig({
                      ...config,
                      axis: {
                        ...config.axis,
                        yTickStepRight:
                          n != null && Number.isFinite(n) && n > 0
                            ? n
                            : undefined,
                      },
                    });
                  }}
                  title="Emit a tick every N units on the right Y axis (multi-Y plots only)."
                />
              </label>
              {/* G44 — reset to default config. */}
              <button
                className="cortex-plotter-btn"
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  commitConfig({
                    ...emptyPlotPayload().config,
                    // Keep the user's data mapping intact — only reset
                    // visual / appearance / axis / annotations.
                    mapping: config.mapping,
                  })
                }
                title="Reset every appearance / axis / annotation field to defaults. Data + series mapping are kept."
              >
                ↺ Reset to defaults
              </button>
              {/* Pass 3.10 — per-series color pickers. One row per active
              Y series; resets to the palette default when cleared. The
              picker uses a native <input type="color"> for now; pass 4
              may upgrade to a swatched popover that surfaces palette
              suggestions. */}
              {(() => {
                const ys =
                  config.mapping?.ySeries && config.mapping.ySeries.length > 0
                    ? config.mapping.ySeries
                    : config.mapping?.y != null
                      ? [config.mapping.y]
                      : [];
                if (ys.length === 0) return null;
                // Resolve the effective color for the picker swatch.
                // Native <input type="color"> requires a 6-digit hex; we
                // pre-resolve CSS-var defaults to a neutral hex so the
                // picker has something to anchor on.
                const resolveColor = (col: number, idx: number): string => {
                  const override = config.seriesColors?.[col];
                  if (override && /^#[0-9a-fA-F]{6}$/.test(override))
                    return override;
                  // Read computed value of the CSS var for the chrome to
                  // get a sensible starting hex. Falls back to a neutral.
                  const FALLBACKS = [
                    "#7aa2ff",
                    "#a98bff",
                    "#f5b54a",
                    "#f06969",
                    "#9bd0a8",
                    "#56b4e9",
                  ];
                  return FALLBACKS[idx % FALLBACKS.length];
                };
                return (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    <span
                      style={{ color: "var(--text-2)", fontSize: "0.78rem" }}
                    >
                      Series colors
                    </span>
                    {ys.map((yc, i) => {
                      const yName = data.columns[yc]?.name ?? `series ${i + 1}`;
                      return (
                        <div
                          key={`color-${i}`}
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="color"
                            value={resolveColor(yc, i)}
                            onChange={(e) => {
                              const next = { ...(config.seriesColors ?? {}) };
                              next[yc] = e.target.value;
                              commitConfig({ ...config, seriesColors: next });
                            }}
                            style={{
                              width: 28,
                              height: 22,
                              padding: 0,
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-1)",
                              background: "transparent",
                              cursor: "pointer",
                            }}
                            title={`Color for ${yName}`}
                          />
                          <span
                            style={{
                              flex: 1,
                              color: "var(--text-2)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {yName}
                          </span>
                          {config.seriesColors?.[yc] && (
                            <button
                              className="cortex-plotter-btn"
                              onClick={() => {
                                const next = { ...(config.seriesColors ?? {}) };
                                delete next[yc];
                                commitConfig({ ...config, seriesColors: next });
                              }}
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.7rem",
                              }}
                              title="Reset to palette default"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </section>

          {/* Pass 4.12 — Legend section. Master "Show legend" toggle plus
          fine-grained checkboxes for what appears: series entries,
          trendline labels, equation, R², and a stub for timelapse
          entries (reserved for the future timelapse feature). */}
          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Legend</h3>
            <div className="cortex-plotter-form">
              <label className="cortex-plotter-field">
                <span>Show legend</span>
                <input
                  type="checkbox"
                  checked={config.showLegend !== false}
                  onChange={(e) =>
                    commitConfig({ ...config, showLegend: e.target.checked })
                  }
                />
              </label>
              {/* Fine-grained items below. Disabled when the master is off
              since they'd have no effect. */}
              {(() => {
                const ld = config.legendDisplay ?? {};
                const masterOn = config.showLegend !== false;
                const setLd = (
                  patch: Partial<NonNullable<PlotConfig["legendDisplay"]>>,
                ) =>
                  commitConfig({
                    ...config,
                    legendDisplay: { ...ld, ...patch },
                  });
                const cbRow = (
                  key: string,
                  label: string,
                  flagKey: keyof NonNullable<PlotConfig["legendDisplay"]>,
                  hint?: string,
                ) => (
                  <label
                    key={key}
                    className="cortex-plotter-field"
                    title={hint}
                  >
                    <span style={{ opacity: masterOn ? 1 : 0.5 }}>{label}</span>
                    <input
                      type="checkbox"
                      disabled={!masterOn}
                      checked={ld[flagKey] !== false}
                      onChange={(e) => setLd({ [flagKey]: e.target.checked })}
                    />
                  </label>
                );
                return [
                  cbRow(
                    "ld-series",
                    "Series & colors",
                    "showSeries",
                    "Show each Y series name with its corresponding color marker",
                  ),
                  cbRow(
                    "ld-trendlines",
                    "Trendlines",
                    "showTrendlines",
                    "Include trendline overlays as legend entries",
                  ),
                  cbRow(
                    "ld-equation",
                    "Trendline equation",
                    "showEquation",
                    "When a trendline is shown, include its `y = …` equation",
                  ),
                  cbRow(
                    "ld-r2",
                    "Trendline R²",
                    "showR2",
                    "When a trendline is shown, include its R² value",
                  ),
                  cbRow(
                    "ld-timelapses",
                    "Timelapses & colors",
                    "showTimelapses",
                    "Reserved for the upcoming timelapse feature; no effect yet",
                  ),
                ];
              })()}
            </div>
          </section>

          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Statistics</h3>
            <div className="cortex-plotter-form">
              {/* Pass 3.7 / 3.8 / 3.13 — trendline picker. Available on
              every plot type that visualizes (x, y) pairs with a
              meaningful X axis: scatter, line, area, bar, time-series,
              dual-Y, regression, residual. "Auto" runs every fit
              kind and keeps the highest R² (Excel-style best fit).
              The CI band toggle ships on scatter / regression / line /
              area / dual-Y — residual already plots residuals against
              a zero reference line so a band would be redundant. */}
              {(activePlotType === "scatter" ||
                activePlotType === "line" ||
                activePlotType === "area" ||
                activePlotType === "timeseries" ||
                activePlotType === "dual-y" ||
                activePlotType === "regression" ||
                activePlotType === "residual") && (
                <>
                  <label className="cortex-plotter-field">
                    <span>Trendline</span>
                    <select
                      value={config.trendline?.kind ?? "none"}
                      onChange={(e) =>
                        commitConfig({
                          ...config,
                          trendline: {
                            ...config.trendline,
                            kind: e.target.value as
                              | "none"
                              | "auto"
                              | "linear"
                              | "poly2"
                              | "poly3"
                              | "exponential"
                              | "log"
                              | "power",
                          },
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="auto">Auto (best fit)</option>
                      <option value="linear">Linear</option>
                      <option value="poly2">Quadratic</option>
                      <option value="poly3">Cubic</option>
                      <option value="exponential">Exponential</option>
                      <option value="log">Logarithmic</option>
                      <option value="power">Power</option>
                    </select>
                  </label>
                  {(activePlotType === "regression" ||
                    activePlotType === "scatter" ||
                    activePlotType === "line" ||
                    activePlotType === "area" ||
                    activePlotType === "dual-y") &&
                    config.trendline?.kind &&
                    config.trendline.kind !== "none" && (
                      <label className="cortex-plotter-field">
                        <span>Confidence band</span>
                        <input
                          type="checkbox"
                          checked={
                            // Default ON for regression, OFF for scatter
                            // (scatter is busy enough already).
                            activePlotType === "regression"
                              ? config.trendline?.showCi !== false
                              : !!config.trendline?.showCi
                          }
                          onChange={(e) =>
                            commitConfig({
                              ...config,
                              trendline: {
                                ...config.trendline,
                                showCi: e.target.checked,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                </>
              )}
              {/* Reference lines — apply to any plot type. List + add/remove. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ color: "var(--text-2)", fontSize: "0.78rem" }}>
                  Reference lines
                </span>
                {(config.refLines ?? []).map((rl, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", gap: 4, alignItems: "center" }}
                  >
                    <select
                      value={rl.axis}
                      onChange={(e) => {
                        const next = (config.refLines ?? []).slice();
                        next[i] = {
                          ...next[i],
                          axis: e.target.value as "x" | "y",
                        };
                        commitConfig({ ...config, refLines: next });
                      }}
                      style={{ flex: "0 0 48px" }}
                    >
                      <option value="x">x</option>
                      <option value="y">y</option>
                    </select>
                    <input
                      type="text"
                      value={String(rl.value)}
                      placeholder="value or mean / median"
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        let parsed: number | "mean" | "median" = 0;
                        if (v === "mean" || v === "median") parsed = v;
                        else if (Number.isFinite(parseFloat(v)))
                          parsed = parseFloat(v);
                        const next = (config.refLines ?? []).slice();
                        next[i] = { ...next[i], value: parsed };
                        commitConfig({ ...config, refLines: next });
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="text"
                      value={rl.label ?? ""}
                      placeholder="label"
                      onChange={(e) => {
                        const next = (config.refLines ?? []).slice();
                        next[i] = { ...next[i], label: e.target.value };
                        commitConfig({ ...config, refLines: next });
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      className="cortex-plotter-btn"
                      onClick={() => {
                        const next = (config.refLines ?? []).slice();
                        next.splice(i, 1);
                        commitConfig({ ...config, refLines: next });
                      }}
                      title="Remove reference line"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="cortex-plotter-btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    const next = (config.refLines ?? []).slice();
                    next.push({ axis: "y", value: "mean", label: "mean" });
                    commitConfig({ ...config, refLines: next });
                  }}
                >
                  + Reference line
                </button>
              </div>
            </div>
          </section>

          <section className="cortex-plotter-section">
            <h3 className="cortex-plotter-section-title">Export</h3>
            <div
              className="cortex-plotter-data-actions"
              style={{ flexWrap: "wrap" }}
            >
              <button className="cortex-plotter-btn" onClick={exportPng}>
                PNG
              </button>
              <button className="cortex-plotter-btn" onClick={exportSvg}>
                SVG
              </button>
              <button className="cortex-plotter-btn" onClick={exportCsv}>
                CSV
              </button>
              <button className="cortex-plotter-btn" onClick={copyToClipboard}>
                Copy
              </button>
              <button className="cortex-plotter-btn" onClick={printActive}>
                Print…
              </button>
              <button
                className="cortex-plotter-btn"
                onClick={() => setOrphansOpen(true)}
                title="Find sidecar JSON files whose plot is no longer in any note"
              >
                Orphans…
              </button>
            </div>
          </section>

          {statusMessage && (
            <div className="cortex-plotter-status">{statusMessage}</div>
          )}
        </aside>
      </div>
      {/* Pass 3.4 — Orphan plots GC. Top-level so its scrim covers
          the entire modal, not just the controls pane. */}
      <OrphanPlotsModal
        isOpen={orphansOpen}
        vaultPath={binding.vaultPath}
        onClose={() => setOrphansOpen(false)}
      />
    </div>
  );
}
