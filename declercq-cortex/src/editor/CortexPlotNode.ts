// CortexPlot — Cluster 27 v1.0 (pass 1).
//
// Custom TipTap atom node for interactive plots embedded in markdown
// notes. Mirrors the CortexImage pattern (Cluster 19): stores plot
// state as `data-*` attrs on a placeholder <div>, round-trips through
// tiptap-markdown's `html: true`, and delegates rendering to a React
// NodeView (`src/components/CortexPlotNodeView.tsx`) which mounts a
// Recharts canvas + corner handles + Aurora-themed chrome.
//
// On-disk shape inside markdown (sidecar JSON mode — default):
//
//   <div data-cortex-plot="1"
//        data-plot-id="plot-2sLk93xQ"
//        data-plot-type="scatter"
//        data-width="640"
//        data-height="380"
//        data-align="break"
//        data-config="<base64-json>"></div>
//
// On-disk shape inside markdown (inline-data mode — small datasets):
//
//   <div data-cortex-plot="1"
//        data-plot-id="plot-2sLk93xQ"
//        data-plot-type="scatter"
//        data-width="640"
//        data-height="380"
//        data-align="break"
//        data-config="<base64-json>"
//        data-data="<base64-json>"></div>
//
// The `data-data` attr is present only when the dataset is ≤ 50 rows
// × 4 cols (the F103 inline threshold). For larger datasets the data
// lives in `<note-stem>-plots/<plot-id>.json` and `data-data` is
// absent. The NodeView resolves the sidecar path via
// `editor.storage.cortexPlot.notePath` (set by Editor.tsx).
//
// The `data-config` blob carries styling + series mapping + axis
// settings + annotations. Encoded as base64-JSON to keep the
// markdown clean (no escaped quotes, no embedded newlines).
//
// Other markdown viewers render an empty <div> with `display: none`
// styling (via .cortex-plot CSS); they ignore the data-* attrs. On
// Cortex re-open, parseHTML rebuilds the attrs and the NodeView
// re-renders the chart.

import { Node, mergeAttributes } from "@tiptap/core";

// =====================================================================
// Public types
// =====================================================================

/**
 * All plot types in the v1.0 scope (see cluster_27_interactive_plotter.md
 * §11 for the locked list). v1.1+ adds three statistical types that ride
 * on the same node attrs.
 */
export type CortexPlotType =
  // Core 2D (pass 1 must support all 8)
  | "scatter"
  | "line"
  | "area"
  | "bar"
  | "bar-horizontal"
  | "histogram"
  | "pie"
  | "error-bar"
  // Statistical / scientific (pass 2)
  | "ecdf"
  | "qq"
  | "bland-altman"
  | "regression"
  | "residual"
  // Time / multi-axis (pass 2)
  | "timeseries"
  | "dual-y";

export const PLOT_TYPES_V1: ReadonlyArray<CortexPlotType> = [
  "scatter",
  "line",
  "area",
  "bar",
  "bar-horizontal",
  "histogram",
  "pie",
  "error-bar",
  "ecdf",
  "qq",
  "bland-altman",
  "regression",
  "residual",
  "timeseries",
  "dual-y",
];

/** Alignment in surrounding prose. Mirrors cortexImage's wrapMode for
 *  consistency, minus the "free" mode (plots are large enough that
 *  free-positioning would visually conflict with prose flow; the
 *  draggable layout-grid panes already give layout control). */
export type CortexPlotAlign = "break" | "left" | "right";

const ALIGNMENTS: ReadonlyArray<CortexPlotAlign> = ["break", "left", "right"];

function clampAlign(input: unknown): CortexPlotAlign {
  if (typeof input === "string") {
    const s = input.trim().toLowerCase();
    if ((ALIGNMENTS as ReadonlyArray<string>).includes(s)) {
      return s as CortexPlotAlign;
    }
  }
  return "break";
}

function clampPlotType(input: unknown): CortexPlotType {
  if (typeof input === "string") {
    const s = input.trim().toLowerCase();
    if ((PLOT_TYPES_V1 as ReadonlyArray<string>).includes(s)) {
      return s as CortexPlotType;
    }
  }
  return "scatter";
}

function parseIntAttr(input: unknown, fallback: number | null): number | null {
  if (input == null || input === "") return fallback;
  const n = typeof input === "number" ? input : parseInt(String(input), 10);
  return Number.isFinite(n) ? n : fallback;
}

// =====================================================================
// Schema: data + config blobs
// =====================================================================

/** Column type discriminator. Drives the data grid editor and the
 *  axis scale auto-pick. Date is stored as ISO 8601 strings; numeric
 *  as JS numbers; categorical as strings. */
export type PlotColumnType = "number" | "category" | "date";

export interface PlotColumn {
  /** Header name shown in the grid + axis label. */
  name: string;
  type: PlotColumnType;
  /** If non-null, this column is computed from a `:=`-prefixed
   *  expression that runs through the Cluster 18 formula engine.
   *  The raw cells in `PlotData.rows` for this column are ignored
   *  on render (recomputed each time). */
  formula?: string | null;
}

export interface PlotData {
  columns: PlotColumn[];
  /** Row-major: each row is an array of cells, one per column. Cells
   *  are typed by the column's `type`. */
  rows: Array<Array<number | string | null>>;
  /** Pass 4 — tagged cell selections. The user drag-selects a range
   *  of cells in the data grid, picks a role for the selection (error
   *  bar X, error bar Y, shaded region, color group, etc.), and the
   *  selection is persisted here. The grid renders the cells with the
   *  selection's color; the plot renderers consume selections by role
   *  to draw error bars / shaded regions / color-coded points. */
  cellSelections?: PlotCellSelection[];
}

/**
 * One tagged selection. `cells` is a sparse list of (row, col) pairs
 * the user picked (typically contiguous, but Ctrl+drag can extend a
 * selection across non-contiguous ranges). The `role` drives how the
 * plot interprets these cells.
 */
export interface PlotCellSelection {
  /** Stable ID (generated via generatePlotId-like alphabet). */
  id: string;
  /** Hex color (or CSS var string) the cells render with in the grid. */
  color: string;
  /** Human-readable label shown in the role picker + sidebar list. */
  label: string;
  /** Role: how the plot interprets these cells. */
  role: PlotSelectionRole;
  /** Cells in this selection. */
  cells: Array<{ row: number; col: number }>;
  /** Optional binding to a Y-series column when role is error-x /
   *  error-y / shaded-region — tells the plot which series the
   *  error bars or band attaches to. */
  boundColumn?: number;
}

export type PlotSelectionRole =
  | "variable" // a new categorical / numeric variable derived from selection
  | "timelapse" // time-series binding
  | "stddev-x" // selection of cells that aggregate to σ on X
  | "stddev-y" // selection of cells that aggregate to σ on Y
  | "error-x" // X error magnitudes per row, applied to a Y series
  | "error-y" // Y error magnitudes per row, applied to a Y series
  | "shaded-region-lo" // lower bound of a shaded region between two cell sets
  | "shaded-region-hi" // upper bound of a shaded region
  | "color-group"; // categorical coloring for the rows in the selection

/**
 * Visual + interaction config. All optional — sensible defaults apply
 * when a field is absent. Persisted as base64-JSON in `data-config`.
 * v1.1+ additions go on this struct (forward-compatible).
 */
export interface PlotConfig {
  title?: string;
  subtitle?: string;
  /** Series mapping. Field is "axis role" → column index.
   *  Multi-Y plots use `ySeries` (array of column indices). Pass 3
   *  adds `ySeriesAxis` — a per-series side mapping so any series
   *  can be plotted against an independent right-side Y axis. The
   *  key is the column index (same key used in `ySeries`); absent
   *  entries default to "left". Useful when two metrics have very
   *  different scales (e.g. count vs. percentage). */
  mapping?: {
    x?: number | null;
    y?: number | null;
    ySeries?: number[];
    ySeriesAxis?: Record<number, "left" | "right">;
    /** Pass 4.11 — per-series standard-deviation column binding.
     *  Key is the Y series column index; value is the column index
     *  whose per-row values become the σ magnitudes for that
     *  series' error bars. When set on a series, ScatterPlot /
     *  LinePlot render ± σ error bars on Y using those magnitudes.
     *  Replaces the older selection-based "error-y" role. */
    stddevColumns?: Record<number, number>;
    color?: number | null;
    size?: number | null;
    group?: number | null;
    errorUp?: number | null;
    errorDown?: number | null;
  };
  /** Aurora palette by default; user can pick a preset (viridis,
   *  magma, plasma, cividis, RdBu, accessible, grayscale). */
  palette?:
    | "aurora"
    | "viridis"
    | "magma"
    | "plasma"
    | "cividis"
    | "RdBu"
    | "accessible"
    | "grayscale";
  /** Per-series color overrides — keyed by column index. */
  seriesColors?: Record<number, string>;
  /** Per-series marker shape (scatter/line). */
  seriesMarker?: Record<
    number,
    "circle" | "square" | "diamond" | "triangle" | "cross" | "plus" | "star"
  >;
  /** Per-series line style (line/area). */
  seriesLine?: Record<
    number,
    { style?: "solid" | "dashed" | "dotted"; width?: number }
  >;
  axis?: {
    /** G02 — axis scale. "linear" / "log" toggle per axis; "category"
     *  and "date" are auto-detected from the column type today and
     *  shouldn't need manual override in v1.1. */
    xScale?: "linear" | "log" | "category" | "date";
    yScale?: "linear" | "log";
    /** G03 — manual axis range. null/undefined entries fall back to
     *  the data's auto-domain. */
    xRange?: [number | null, number | null];
    yRange?: [number | null, number | null];
    /** Pass 4.9 — separate range for the right Y axis when a series
     *  is plotted against it (multi-Y with L/R assignment). Mirrors
     *  yRange's semantics. */
    yRangeRight?: [number | null, number | null];
    /** G01 — axis labels (rendered as axis titles by recharts). */
    xLabel?: string;
    yLabel?: string;
    /** G04 — d3-format tick spec ("$.2f", ".0%", ".3e", etc.). */
    xTickFormat?: string;
    yTickFormat?: string;
    /** Pass 4.16 — tick step (a.k.a. "major unit" in Excel). When set,
     *  the axis emits ticks at exactly that interval starting from
     *  the effective domain minimum. When unset, recharts auto-chooses
     *  tick count. Applies only to numeric axes; ignored on categorical
     *  X. Right Y has its own step so dual-Y plots can have different
     *  granularities per side. */
    xTickStep?: number;
    yTickStep?: number;
    yTickStepRight?: number;
    showGrid?: boolean;
    showMinorGrid?: boolean;
    showOrigin?: boolean;
    /** G23 — reverse axis direction (max → min). */
    xReverse?: boolean;
    yReverse?: boolean;
  };
  /** Histogram-specific. */
  histogram?: {
    binCount?: number | null; // null = auto (Freedman-Diaconis)
    density?: boolean;
  };
  /** Bar-specific. */
  bar?: {
    layout?: "grouped" | "stacked";
  };
  /** Pie/donut-specific. */
  pie?: {
    donut?: boolean; // donut = ring with hole
    innerRadius?: number; // 0..1 fraction of outer
  };
  /** Error-bar-specific — symmetric flag + which mode. */
  errorBars?: {
    mode?: "absolute" | "sd" | "sem" | "ci95";
    symmetric?: boolean;
  };
  /** Trendline + reference lines (pass 2). Pass 3.8 adds "auto" — the
   *  Excel-style best-fit pick that runs all six candidates and keeps
   *  the one with the highest R². */
  trendline?: {
    kind?:
      | "none"
      | "auto"
      | "linear"
      | "poly2"
      | "poly3"
      | "exponential"
      | "log"
      | "power";
    showCi?: boolean;
    showEquation?: boolean;
  };
  /** Pass 4.11 — per-Y-series trendline config. Each entry's key is
   *  the Y series column index. When set, ScatterPlot draws one
   *  trendline per series; the old global `config.trendline` is kept
   *  only for back-compat with existing plots. */
  seriesTrendline?: Record<
    number,
    {
      kind:
        | "none"
        | "auto"
        | "linear"
        | "poly2"
        | "poly3"
        | "exponential"
        | "log"
        | "power";
      showCi?: boolean;
    }
  >;
  /** Pass 3.7 — connect scatter points with a line. Defaults to false. */
  connectPoints?: boolean;
  /** Pass 3.10 — global dot radius for scatter/line plots. Defaults to 3. */
  dotSize?: number;
  /** Pass 3.11 — show the chart legend below the plot. Defaults to true. */
  showLegend?: boolean;
  /** Pass 4.13 / 4.15 — legend position as fractions of the chart
   *  wrapper's width and height (0–1). Storing fractions instead of
   *  raw pixels means the legend stays in the same RELATIVE spot when
   *  the plot resizes (e.g. when toggling between the small inline
   *  preview and the full-screen popup editor). Legacy plots saved
   *  with pixel values are migrated on read (any value > 1 is treated
   *  as a pixel position relative to current bounds and converted on
   *  the user's next drag). */
  legendPosition?: { x: number; y: number };
  /** Pass 4.14 / 4.15 — legend size as fractions of the chart
   *  wrapper's width and height (0–1). When undefined the legend
   *  uses content-based auto-sizing. Stored as fractions for the
   *  same resize-stability reason as legendPosition. */
  legendSize?: { w: number; h: number };
  /** Pass 4.12 — fine-grained control over what appears in the
   *  legend. Each flag defaults to true when the master `showLegend`
   *  is on. Lets the user prune verbose trendline strings or hide
   *  series labels when the colors alone are enough. */
  legendDisplay?: {
    /** Per-series legend entries (Scatter/Line names with their
     *  color markers). */
    showSeries?: boolean;
    /** Whether trendline overlays appear in the legend at all. */
    showTrendlines?: boolean;
    /** When a trendline is in the legend, include its equation. */
    showEquation?: boolean;
    /** When a trendline is in the legend, include its R². */
    showR2?: boolean;
    /** Reserved for the upcoming timelapse feature (currently a stub
     *  so the schema doesn't change shape later). */
    showTimelapses?: boolean;
  };
  /** Pass 4.9 — σ-based error bars overlaid on every Y series of the
   *  scatter / line plot. Magnitudes are computed automatically as
   *  the standard deviation of each series' Y values. When toggled
   *  on by the user, the dedicated "error-bar" plot type is no
   *  longer the only way to surface error bars. */
  showStdDevErrorBars?: boolean;
  // ============================ Pass 4 additions ============================
  /** G05 — per-series marker shape (scatter, line dot fallback). */
  seriesShape?: Record<
    number,
    "circle" | "square" | "diamond" | "triangle" | "cross" | "plus" | "star"
  >;
  /** G08 — per-series data labels (numeric values next to points). */
  seriesShowLabels?: Record<number, boolean>;
  /** G11 — reference areas (shaded ranges across the chart). One per
   *  entry; rendered as a translucent rect spanning [from,to] on the
   *  named axis. Companion to `refLines`. */
  refBands?: Array<{
    axis: "x" | "y";
    from: number | "min" | "mean" | "median";
    to: number | "max" | "mean" | "median";
    label?: string;
    color?: string;
  }>;
  /** G17 — control whether the trendline legend shows the equation,
   *  R², both, or neither. Default both. */
  trendlineDisplay?: {
    showEquation?: boolean;
    showR2?: boolean;
  };
  /** G22 — hollow markers: render the inner fill as the background
   *  color so only the marker outline shows. Per-series toggle. */
  seriesHollow?: Record<number, boolean>;
  /** Plot title shown above the chart (G01). */
  plotTitle?: string;
  /** Subtitle shown below the title in smaller type (Tier 5 G41). */
  plotSubtitle?: string;
  /** G24 — rotation angle of axis titles in degrees. */
  axisTitleRotation?: { x?: number; y?: number };
  refLines?: Array<{
    axis: "x" | "y";
    value: number | "mean" | "median";
    label?: string;
    color?: string;
    style?: "solid" | "dashed" | "dotted";
  }>;
  /** Interaction toggles. */
  interaction?: {
    zoom?: boolean;
    pan?: boolean;
    crosshair?: boolean;
    brush?: boolean;
    legendToggle?: boolean;
  };
}

/** Top-level payload that goes either inline (data-data) or to the
 *  sidecar JSON file. */
export interface PlotPayload {
  schemaVersion: 1;
  data: PlotData;
  config: PlotConfig;
}

export function emptyPlotPayload(): PlotPayload {
  return {
    schemaVersion: 1,
    data: {
      columns: [
        { name: "x", type: "number" },
        { name: "y", type: "number" },
      ],
      rows: [],
    },
    config: {
      palette: "aurora",
      mapping: { x: 0, y: 1 },
      axis: {
        xScale: "linear",
        yScale: "linear",
        showGrid: true,
        showMinorGrid: false,
        showOrigin: false,
      },
      interaction: {
        zoom: true,
        pan: true,
        crosshair: true,
        brush: false,
        legendToggle: true,
      },
    },
  };
}

// =====================================================================
// Base64 codecs (URL-safe, browser-native)
// =====================================================================
//
// We encode the config + (optional) inline data as base64-JSON. The
// reason: putting raw JSON in a data-* attribute means HTML-escaping
// every `"` and `&` and `<`, and tiptap-markdown's html-serialiser
// would have to round-trip those escapes losslessly. Base64 sidesteps
// that entirely — only ASCII letters, digits, and `+`/`/`/`=`.

export function encodePlotBlob(obj: unknown): string {
  const json = JSON.stringify(obj);
  // btoa requires latin-1; JSON may contain unicode. Convert via
  // TextEncoder → base64.
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodePlotBlob<T = unknown>(input: string): T | null {
  if (!input) return null;
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// =====================================================================
// Inline-data threshold (F103)
// =====================================================================
//
// Datasets at or below this size embed `data-data` inline. Above this,
// the data lives in the sidecar JSON file and `data-data` is absent.
// Picking conservatively: a 50×4 dataset of doubles is ~3 KB JSON →
// ~4 KB base64 → fine to keep in the markdown body.

export const INLINE_DATA_MAX_ROWS = 50;
export const INLINE_DATA_MAX_COLS = 4;

export function shouldInlinePlotData(data: PlotData): boolean {
  return (
    data.rows.length <= INLINE_DATA_MAX_ROWS &&
    data.columns.length <= INLINE_DATA_MAX_COLS
  );
}

// =====================================================================
// Stable IDs
// =====================================================================
//
// Nanoid-style: 8 chars, URL-safe alphabet, ~47 bits of entropy. Good
// enough for in-vault uniqueness (collision probability negligible at
// any realistic plot count per note).

const ID_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generatePlotId(): string {
  let out = "plot-";
  const rand = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < rand.length; i++)
      rand[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < rand.length; i++)
    out += ID_ALPHABET[rand[i] % ID_ALPHABET.length];
  return out;
}

// =====================================================================
// The TipTap extension
// =====================================================================

/**
 * CortexPlot — block-level atom node. Block (not inline like
 * cortexImage) because a chart claims its own line; embedding inline
 * inside a paragraph would visually misfire.
 *
 * The default extension defined here ships *without* a NodeView so
 * it can be unit-tested headless. Wire the React NodeView in via
 * `CortexPlot.extend({ addNodeView() { … } })` from Editor.tsx.
 */
export const CortexPlot = Node.create({
  name: "cortexPlot",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      /** Stable per-plot ID. Doubles as the sidecar JSON filename
       *  stem: `<note-stem>-plots/<plotId>.json`. Auto-generated on
       *  insert; never changes thereafter. */
      plotId: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-plot-id") ?? "",
        renderHTML: (attrs) => {
          if (!attrs.plotId) return {};
          return { "data-plot-id": String(attrs.plotId) };
        },
      },
      /** Active plot type. */
      plotType: {
        default: "scatter" as CortexPlotType,
        parseHTML: (el) => clampPlotType(el.getAttribute("data-plot-type")),
        renderHTML: (attrs) => ({
          "data-plot-type": clampPlotType(attrs.plotType),
        }),
      },
      /** Display width in pixels (the canvas wrapper). null = full
       *  available width (responsive). */
      width: {
        default: 640 as number | null,
        parseHTML: (el) => parseIntAttr(el.getAttribute("data-width"), 640),
        renderHTML: (attrs) => {
          if (attrs.width == null) return {};
          return { "data-width": String(Math.round(attrs.width)) };
        },
      },
      /** Display height in pixels. */
      height: {
        default: 380 as number | null,
        parseHTML: (el) => parseIntAttr(el.getAttribute("data-height"), 380),
        renderHTML: (attrs) => {
          if (attrs.height == null) return {};
          return { "data-height": String(Math.round(attrs.height)) };
        },
      },
      /** Alignment in surrounding prose. */
      align: {
        default: "break" as CortexPlotAlign,
        parseHTML: (el) => clampAlign(el.getAttribute("data-align")),
        renderHTML: (attrs) => ({ "data-align": clampAlign(attrs.align) }),
      },
      /** Base64-encoded JSON config (PlotConfig). Always present;
       *  empty config encodes to a few chars so this is cheap. */
      configB64: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-config") ?? "",
        renderHTML: (attrs) => {
          if (!attrs.configB64) return {};
          return { "data-config": String(attrs.configB64) };
        },
      },
      /** Optional inline-data blob (base64 JSON of PlotData). Present
       *  only when the dataset fits the inline threshold; otherwise
       *  the data lives in the sidecar JSON file. */
      dataB64: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-data") ?? "",
        renderHTML: (attrs) => {
          if (!attrs.dataB64) return {};
          return { "data-data": String(attrs.dataB64) };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-cortex-plot]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return null;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Emit a marker div with all data-* attrs. The NodeView replaces
    // this in-app; on-disk markdown carries the raw element. Other
    // markdown viewers see an empty div (which `.cortex-plot { display:
    // none }` hides until Cortex re-opens it).
    return [
      "div",
      mergeAttributes(
        { "data-cortex-plot": "1", class: "cortex-plot" },
        HTMLAttributes,
      ),
    ];
  },
});

/** Fresh attrs for inserting a brand-new plot. The plotId is auto-
 *  generated. The caller is responsible for kicking off the sidecar
 *  creation (or for choosing inline mode for empty/small starting
 *  datasets). */
export function defaultCortexPlotAttrs(plotType: CortexPlotType = "scatter"): {
  plotId: string;
  plotType: CortexPlotType;
  width: number;
  height: number;
  align: CortexPlotAlign;
  configB64: string;
  dataB64: string;
} {
  const payload = emptyPlotPayload();
  payload.config.mapping = { x: 0, y: 1 };
  return {
    plotId: generatePlotId(),
    plotType,
    width: 640,
    height: 380,
    align: "break",
    configB64: encodePlotBlob(payload.config),
    // Empty starting dataset fits inline; emit the empty data
    // structure so consumers always see something parseable.
    dataB64: encodePlotBlob(payload.data),
  };
}
