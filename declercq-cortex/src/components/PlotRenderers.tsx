// PlotRenderers — Cluster 27 v1.0 pass 1.
//
// React components that render each plot type using Recharts. All
// renderers share the same {payload, width, height} props contract
// so the NodeView can swap between them without re-mounting the
// wrapper. Aurora-themed via CSS vars on stroke/fill (modern browsers
// resolve `var(--accent)` inside SVG attributes natively).
//
// Pass-1 set: scatter, line, area, bar (grouped/stacked), horizontal
// bar, histogram, pie/donut, error-bar. Statistical plots (ecdf, qq,
// bland-altman, regression, residual) + timeseries + dual-y land in
// pass 2.

import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ScatterChart,
  Scatter,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ErrorBar,
  ReferenceLine,
  LabelList,
  ComposedChart,
} from "recharts";
import { bin as d3bin } from "d3-array";
import type {
  PlotPayload,
  PlotData,
  PlotConfig,
  CortexPlotType,
} from "../editor/CortexPlotNode";
import { colorForSeries, discreteColors } from "../editor/plotPalette";
import {
  mean as statMean,
  median as statMedian,
  normalInvCdf,
  fitRegression,
  evaluateFit,
  regressionBand,
  blandAltman,
  formatNum,
  type RegressionKind,
} from "../editor/plotStats";
import type {
  PlotCellSelection,
  PlotSelectionRole,
} from "../editor/CortexPlotNode";

// =====================================================================
// Pass 4.3 — Selection-driven overlays (error bars, shaded regions)
// =====================================================================
//
// Given a Y column index and a selection role, return a per-row array
// of numeric magnitudes pulled from the selection's tagged cells.
// Rows without a tagged cell get null, which Recharts' ErrorBar
// treats as "no error bar for this point."

function resolveSelectionByRow(
  selections: PlotCellSelection[] | undefined,
  rowCount: number,
  role: PlotSelectionRole,
  boundColumn: number,
  rows: Array<Array<number | string | null>>,
): Array<number | null> {
  if (!selections || selections.length === 0) {
    return Array(rowCount).fill(null);
  }
  const out: Array<number | null> = Array(rowCount).fill(null);
  for (const s of selections) {
    if (s.role !== role) continue;
    if (s.boundColumn != null && s.boundColumn !== boundColumn) continue;
    for (const c of s.cells) {
      if (c.row < 0 || c.row >= rowCount) continue;
      const raw = rows[c.row]?.[c.col];
      if (raw == null || raw === "") continue;
      const n = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (Number.isFinite(n)) out[c.row] = n;
    }
  }
  return out;
}

/** Extract paired lo/hi values for a shaded region, indexed by row.
 *  Returns null on either side when the selection doesn't cover that
 *  row. Caller filters incomplete rows. */
function resolveShadedRegion(
  selections: PlotCellSelection[] | undefined,
  rowCount: number,
  boundColumn: number,
  rows: Array<Array<number | string | null>>,
): Array<{ lo: number | null; hi: number | null }> {
  const lo = resolveSelectionByRow(
    selections,
    rowCount,
    "shaded-region-lo",
    boundColumn,
    rows,
  );
  const hi = resolveSelectionByRow(
    selections,
    rowCount,
    "shaded-region-hi",
    boundColumn,
    rows,
  );
  return lo.map((l, i) => ({ lo: l, hi: hi[i] }));
}

// =====================================================================
// Props
// =====================================================================

export interface PlotRendererProps {
  payload: PlotPayload;
  width: number;
  height: number;
  /** Pass-2 backlog: pass through interaction handlers (point click,
   *  brush region, etc.). For pass 1 the renderers are read-only. */
}

// =====================================================================
// Helpers
// =====================================================================

/** Coerce row[col] → number or null. Used for any numeric axis. */
function num(
  row: Array<number | string | null>,
  col: number | null | undefined,
): number | null {
  if (col == null) return null;
  const v = row[col];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cat(
  row: Array<number | string | null>,
  col: number | null | undefined,
): string {
  if (col == null) return "";
  const v = row[col];
  if (v == null) return "";
  return String(v);
}

/** Project the data into Recharts' object-per-row shape, keyed by
 *  column NAME (so multi-series, label, and tooltip configs just refer
 *  to the column header). */
function toObjects(
  data: PlotData,
): Array<Record<string, number | string | null>> {
  return data.rows.map((row) => {
    const obj: Record<string, number | string | null> = {};
    for (let c = 0; c < data.columns.length; c++) {
      obj[data.columns[c].name] = row[c];
    }
    return obj;
  });
}

/**
 * Pass 3.9 — Custom Recharts Tooltip content. The default behaviour
 * on ScatterChart only surfaces the series name; users expect both
 * axis values when hovering a point. This component reads the active
 * payload + label, distinguishes scatter (per-point payload entries
 * carry the full data object via `payload`) from cartesian
 * (per-series entries keyed by dataKey), and renders a glass card
 * with one row per data dimension. Multi-Y plots render all Y series
 * for the hovered X.
 */
interface CortexTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string | null;
    dataKey?: string;
    color?: string;
    fill?: string;
    payload?: Record<string, unknown>;
    unit?: string;
  }>;
  label?: number | string;
  /** Recharts injects label-formatting hint when a labelFormatter is
   *  set; not currently used but reserved for date-axis charts. */
  labelFormatter?: (value: unknown) => string;
}

function formatTipValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v)) return v.toString();
    const abs = Math.abs(v);
    if (abs >= 1e6 || (abs < 0.001 && abs !== 0)) return v.toExponential(3);
    return parseFloat(v.toFixed(4)).toString();
  }
  return String(v);
}

function CortexTooltip(props: CortexTooltipProps) {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }
  // Detect scatter mode: the payload entries each carry a `payload`
  // record containing both x and y, AND most often have name="x" /
  // name="y" via the XAxis/YAxis name= props. We surface the raw
  // (x, y) pair instead of a per-series list.
  const firstPayload = props.payload[0]?.payload;
  const hasXY =
    firstPayload &&
    typeof firstPayload === "object" &&
    "x" in firstPayload &&
    "y" in firstPayload;

  const rows: Array<{ label: string; value: string; color?: string }> = [];

  if (hasXY) {
    // ScatterChart path: pull x + y from the first payload, plus any
    // extra fields (e.g. size, group) that show up as additional
    // payload entries. Each Scatter series gets its own card row.
    const seen = new Set<string>();
    // First-pass: extract x/y from the underlying data row.
    const row = firstPayload as Record<string, unknown>;
    const xName =
      props.payload.find((p) => p.dataKey === "x" || p.name === "x")?.name ??
      "x";
    const yName =
      props.payload.find((p) => p.dataKey === "y" || p.name === "y")?.name ??
      "y";
    rows.push({
      label: xName === "x" ? "x" : xName,
      value: formatTipValue(row.x),
    });
    rows.push({
      label: yName === "y" ? "y" : yName,
      value: formatTipValue(row.y),
      color: props.payload[0]?.color ?? props.payload[0]?.fill,
    });
    seen.add("x");
    seen.add("y");
    // Extra series + ZAxis values land here.
    for (const p of props.payload) {
      const key = p.dataKey ?? "";
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        label: p.name ?? key,
        value: formatTipValue(p.value),
        color: p.color ?? p.fill,
      });
    }
  } else {
    // Cartesian path: one row per series. label is the X value.
    if (props.label !== undefined) {
      rows.push({
        label: "x",
        value: formatTipValue(props.label),
      });
    }
    for (const p of props.payload) {
      rows.push({
        label: p.name ?? p.dataKey ?? "value",
        value: formatTipValue(p.value),
        color: p.color ?? p.fill,
      });
    }
  }

  return (
    <div
      style={{
        background: "var(--bg-card)",
        backdropFilter: "var(--blur-modal)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-2)",
        boxShadow: "var(--shadow-2)",
        color: "var(--text)",
        fontSize: 12,
        padding: "8px 10px",
        minWidth: 120,
        pointerEvents: "none",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              color: r.color ?? "var(--text-2)",
              fontWeight: 500,
            }}
          >
            {r.label}
          </span>
          <span style={{ color: "var(--text)" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// Pass 4.9 — Axis prop helpers shared across every renderer
// =====================================================================
//
// Before pass 4.9, only ScatterPlot honored the full set of axis
// config fields (G02 log scale, G03 manual range, G04 tick format,
// G23 reverse, G01 axis labels). Every other plot just rendered
// `<XAxis ... />` with default props. Factor the lot into helpers
// that return a spreadable prop object so each renderer just does
// `{...buildXAxisProps(config, xAxisType, xName)}`.

/** Tiny d3-format-ish formatter parser. Supports the most common
 *  specs without pulling in d3-format as a dependency. */
function buildTickFormatter(
  spec: string | undefined,
): ((v: number | string) => string) | undefined {
  if (!spec || spec.trim() === "") return undefined;
  return (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isFinite(n)) return String(v);
    const s = spec.trim();
    let m = s.match(/^\.(\d+)f$/);
    if (m) return n.toFixed(parseInt(m[1], 10));
    m = s.match(/^\.(\d+)e$/);
    if (m) return n.toExponential(parseInt(m[1], 10));
    m = s.match(/^\.(\d+)%$/);
    if (m) return (n * 100).toFixed(parseInt(m[1], 10)) + "%";
    m = s.match(/^\$\.(\d+)f$/);
    if (m) return "$" + n.toFixed(parseInt(m[1], 10));
    if (s === ",") return n.toLocaleString();
    return String(v);
  };
}

interface AxisProps {
  scale?: string;
  domain?: [number | string, number | string];
  reversed?: boolean;
  tickFormatter?: (v: number | string) => string;
  /** allowDataOverflow tells recharts to clip data outside the manual
   *  domain instead of auto-expanding to include it. Critical for
   *  manual range to actually clip the plot — pass 4 found this bug
   *  the hard way. */
  allowDataOverflow?: boolean;
  label?: Record<string, unknown>;
  /** Pass 4.16 — explicit ticks array (computed from xTickStep /
   *  yTickStep config). When present, recharts skips its own tick
   *  auto-generation and uses exactly these values. */
  ticks?: number[];
  /** Caller still owns dataKey, type, stroke, tick, name. */
}

/** Pass 4.16 — compute explicit tick positions from a step and a
 *  bounded domain. Used to honor user-set "tick every N units". We
 *  walk from min to max stepping by `step`, rounding the start to a
 *  multiple of step so the ticks look clean (e.g. with step=2 from
 *  -3.1 to 9.8 we emit [-4, -2, 0, 2, 4, 6, 8, 10] — bracketing the
 *  data so labels line up with nice round numbers). */
function computeTicksFromStep(
  domain: [number, number] | null,
  step: number | undefined,
): number[] | undefined {
  if (!step || step <= 0 || !domain) return undefined;
  const [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo)
    return undefined;
  // Round start DOWN to the nearest multiple of step, end UP.
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Guard against runaway loops for tiny steps relative to range.
  const maxTicks = 200;
  for (
    let v = start, i = 0;
    v <= end + step * 1e-9 && i < maxTicks;
    v += step, i++
  ) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks.length >= 2 ? ticks : undefined;
}

function buildXAxisProps(
  config: PlotConfig,
  xAxisType: "number" | "category" | undefined,
  /** Pass 4.16 — caller-provided data extent for tick-step computation
   *  when the axis is on auto-range. Optional; without it, tick-step
   *  is only honored on manual ranges. */
  dataExtent?: [number, number] | null,
): AxisProps {
  const ax = config.axis ?? {};
  const out: AxisProps = {};
  // Manual range only meaningful for numeric X.
  let effectiveDomain: [number, number] | null = null;
  if (
    xAxisType === "number" &&
    ax.xRange &&
    (ax.xRange[0] != null || ax.xRange[1] != null)
  ) {
    out.domain = [ax.xRange[0] ?? "auto", ax.xRange[1] ?? "auto"];
    out.allowDataOverflow = true;
    if (
      typeof out.domain[0] === "number" &&
      typeof out.domain[1] === "number"
    ) {
      effectiveDomain = [out.domain[0], out.domain[1]];
    } else if (dataExtent) {
      // Mixed auto + manual — fall back to data extent for the auto side
      // so tick computation has both endpoints.
      const lo =
        typeof out.domain[0] === "number" ? out.domain[0] : dataExtent[0];
      const hi =
        typeof out.domain[1] === "number" ? out.domain[1] : dataExtent[1];
      effectiveDomain = [lo, hi];
    }
  } else if (xAxisType === "number") {
    out.domain = ["auto", "auto"];
    if (dataExtent) effectiveDomain = dataExtent;
  }
  if (ax.xScale === "log") out.scale = "log";
  if (ax.xReverse) out.reversed = true;
  const fmt = buildTickFormatter(ax.xTickFormat);
  if (fmt) out.tickFormatter = fmt;
  const stepTicks = computeTicksFromStep(effectiveDomain, ax.xTickStep);
  if (stepTicks) out.ticks = stepTicks;
  if (ax.xLabel) {
    out.label = {
      value: ax.xLabel,
      position: "insideBottom",
      offset: -8,
      fill: "var(--text-2)",
      fontSize: 11,
    };
  }
  return out;
}

function buildYAxisProps(
  config: PlotConfig,
  side: "left" | "right" = "left",
  /** Pass 4.16 — data extent (min, max of the y values on this side)
   *  for tick-step computation when on auto-range. */
  dataExtent?: [number, number] | null,
): AxisProps {
  const ax = config.axis ?? {};
  const out: AxisProps = {};
  const range = side === "right" ? ax.yRangeRight : ax.yRange;
  let effectiveDomain: [number, number] | null = null;
  if (range && (range[0] != null || range[1] != null)) {
    out.domain = [range[0] ?? "auto", range[1] ?? "auto"];
    out.allowDataOverflow = true;
    if (
      typeof out.domain[0] === "number" &&
      typeof out.domain[1] === "number"
    ) {
      effectiveDomain = [out.domain[0], out.domain[1]];
    } else if (dataExtent) {
      const lo =
        typeof out.domain[0] === "number" ? out.domain[0] : dataExtent[0];
      const hi =
        typeof out.domain[1] === "number" ? out.domain[1] : dataExtent[1];
      effectiveDomain = [lo, hi];
    }
  } else {
    out.domain = ["auto", "auto"];
    if (dataExtent) effectiveDomain = dataExtent;
  }
  if (ax.yScale === "log") out.scale = "log";
  if (ax.yReverse) out.reversed = true;
  const fmt = buildTickFormatter(ax.yTickFormat);
  if (fmt) out.tickFormatter = fmt;
  const step = side === "right" ? ax.yTickStepRight : ax.yTickStep;
  const stepTicks = computeTicksFromStep(effectiveDomain, step);
  if (stepTicks) out.ticks = stepTicks;
  // Y label only on the left axis; the right axis usually carries its
  // own series name from the Series row, not a global Y label.
  if (side === "left" && ax.yLabel) {
    out.label = {
      value: ax.yLabel,
      angle: -90,
      position: "insideLeft",
      offset: 4,
      fill: "var(--text-2)",
      fontSize: 11,
      style: { textAnchor: "middle" },
    };
  }
  return out;
}

/** Pass 4.16 — compute per-axis numeric extents from a PlotData payload.
 *  Returns null on a side when there's no finite data. Used by every
 *  multi-Y plot type to drive axis-color and tick-step computation. */
function computeAxisExtents(
  data: { rows: any[][]; columns: any[] },
  xCol: number,
  ySeries: number[],
  ySeriesAxis: Record<number, "left" | "right">,
  xIsNumeric: boolean,
): {
  x: [number, number] | null;
  yLeft: [number, number] | null;
  yRight: [number, number] | null;
} {
  let xLo = Infinity,
    xHi = -Infinity;
  let lLo = Infinity,
    lHi = -Infinity;
  let rLo = Infinity,
    rHi = -Infinity;
  for (const r of data.rows) {
    if (xIsNumeric) {
      const v = r[xCol];
      const n =
        typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
      if (Number.isFinite(n)) {
        if (n < xLo) xLo = n;
        if (n > xHi) xHi = n;
      }
    }
    for (const c of ySeries) {
      const v = r[c];
      const n =
        typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
      if (!Number.isFinite(n)) continue;
      const side = ySeriesAxis[c] === "right" ? "right" : "left";
      if (side === "right") {
        if (n < rLo) rLo = n;
        if (n > rHi) rHi = n;
      } else {
        if (n < lLo) lLo = n;
        if (n > lHi) lHi = n;
      }
    }
  }
  return {
    x:
      xIsNumeric && Number.isFinite(xLo) && Number.isFinite(xHi)
        ? [xLo, xHi]
        : null,
    yLeft: Number.isFinite(lLo) && Number.isFinite(lHi) ? [lLo, lHi] : null,
    yRight: Number.isFinite(rLo) && Number.isFinite(rHi) ? [rLo, rHi] : null,
  };
}

/** Pass 4.16 — derive the color for an axis line / ticks / labels from
 *  the series that plot against it. When exactly one series claims this
 *  side, the axis adopts that series' color (Excel-style); otherwise we
 *  fall back to the neutral text color so the axis stays readable when
 *  multiple series share it. */
function axisColorForSide(
  config: PlotConfig,
  ySeries: number[],
  side: "left" | "right",
): string {
  const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
  const claiming = ySeries.filter((c) =>
    side === "right" ? ySeriesAxis[c] === "right" : ySeriesAxis[c] !== "right",
  );
  if (claiming.length !== 1) return "var(--text-2)";
  const col = claiming[0];
  const explicit = config.seriesColors?.[col];
  if (explicit) return explicit;
  // Match the renderer's color-for-series fallback. seriesIndex is the
  // ordinal position in ySeries, which is how the renderers pick from
  // the palette.
  const idx = ySeries.indexOf(col);
  return colorForSeries(idx, config);
}

/** Standard tooltip + grid + axis styling, applied to every plot for
 *  a unified Aurora look. Pass 3.11 adds an explicit legend toggle so
 *  users can hide it when the plot is small. */
function CommonChartElements({
  config,
  customLegend = false,
}: {
  config: PlotConfig;
  /** Pass 4.13 — when true, skip rendering recharts' built-in Legend
   *  because the host plot is mounting its own draggable
   *  CortexLegend. Only ScatterPlot uses this today. */
  customLegend?: boolean;
}) {
  const showGrid = config.axis?.showGrid !== false;
  const showMinor = !!config.axis?.showMinorGrid;
  const showLegend = config.showLegend !== false && !customLegend;
  return (
    <>
      {showGrid && (
        <CartesianGrid
          stroke="var(--text-2)"
          strokeOpacity={showMinor ? 0.45 : 0.25}
          strokeDasharray="3 3"
        />
      )}
      <Tooltip
        content={<CortexTooltip />}
        cursor={{
          stroke: "var(--accent)",
          strokeOpacity: 0.5,
          strokeWidth: 1,
        }}
      />
      {showLegend && (
        <Legend
          iconType="circle"
          wrapperStyle={{
            fontSize: 12,
            color: "var(--text-2)",
            paddingTop: 8,
          }}
        />
      )}
    </>
  );
}

// =====================================================================
// Scatter (F10)
// =====================================================================

/**
 * Pass 4.12 — render a marker glyph for a Scatter series. ScatterPlot
 * passes the desired shape; this helper emits the corresponding SVG
 * primitive(s). Geometry is sized off the supplied `r` (intended dot
 * radius) so all shapes occupy a consistent visual area.
 */
type MarkerShape =
  | "circle"
  | "square"
  | "diamond"
  | "triangle"
  | "cross"
  | "plus"
  | "star";

function renderMarkerShape(
  shape: MarkerShape,
  cx: number,
  cy: number,
  r: number,
  fill: string,
): React.ReactElement {
  const stroke = "var(--bg)";
  const strokeWidth = 0.75;
  switch (shape) {
    case "circle":
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "square":
      return (
        <rect
          x={cx - r}
          y={cy - r}
          width={2 * r}
          height={2 * r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "triangle": {
      // Equilateral triangle pointing up, centered on (cx, cy).
      const h = r * 1.15;
      const w = r * Math.sqrt(3) * 0.65;
      return (
        <polygon
          points={`${cx},${cy - h} ${cx + w},${cy + h * 0.5} ${cx - w},${cy + h * 0.5}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }
    case "cross": {
      // × — two diagonal strokes. No fill since stroke does the work.
      const arm = r * 0.85;
      return (
        <g stroke={fill} strokeWidth={1.6} strokeLinecap="round">
          <line x1={cx - arm} y1={cy - arm} x2={cx + arm} y2={cy + arm} />
          <line x1={cx - arm} y1={cy + arm} x2={cx + arm} y2={cy - arm} />
        </g>
      );
    }
    case "plus": {
      // + — two perpendicular strokes.
      const arm = r * 0.95;
      return (
        <g stroke={fill} strokeWidth={1.6} strokeLinecap="round">
          <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy} />
          <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm} />
        </g>
      );
    }
    case "star": {
      // Classic five-pointed star, alternating outer/inner radii.
      const points: string[] = [];
      const outerR = r * 1.15;
      const innerR = r * 0.5;
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        points.push(
          `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`,
        );
      }
      return (
        <polygon
          points={points.join(" ")}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }
  }
}

// =====================================================================
// Pass 4.13 — Draggable custom legend
// =====================================================================
//
// Recharts' built-in <Legend> can sit only at one of nine preset
// positions (verticalAlign × align). The user wants arbitrary
// placement, so we render our own legend container as an
// absolutely-positioned sibling of the chart. The container is
// draggable via pointer events; its position persists to
// config.legendPosition.

interface CortexLegendItem {
  /** Visible label. */
  name: string;
  /** Marker color. */
  color: string;
  /** Marker glyph kind. Series chips use the per-series shape;
   *  trendline / band chips use lines + rects respectively. */
  glyph: MarkerShape | "line" | "rect";
}

function CortexLegend(props: {
  items: CortexLegendItem[];
  position: { x: number; y: number };
  onPositionChange: (p: { x: number; y: number }) => void;
  /** Pass 4.14 — explicit size + change callback. Undefined size =
   *  content auto-sizing (intrinsic width + height). */
  size?: { w: number; h: number };
  onSizeChange: (s: { w: number; h: number }) => void;
  /** Bounding box of the parent plot wrapper, used to clamp the
   *  legend so it can't be dragged off-screen. */
  bounds: { width: number; height: number };
}) {
  const { items, position, onPositionChange, size, onSizeChange, bounds } =
    props;
  const dragStart = useRef<{
    startMouse: { x: number; y: number };
    startPos: { x: number; y: number };
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Pass 4.14 — resize state. When the user grabs one of the eight
  // resize handles, we record the starting cursor + starting box
  // (x, y, w, h) and the direction that handle drags. pointer-move
  // mutates the size and (for top/left handles) the position so the
  // opposite anchor stays still. The 8 directions are:
  //
  //     nw  n  ne
  //      w  *  e
  //     sw  s  se
  type ResizeDir = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
  const resizeStart = useRef<{
    dir: ResizeDir;
    startMouse: { x: number; y: number };
    startBox: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const [resizing, setResizing] = useState<ResizeDir | null>(null);
  // We need the legend's intrinsic size as a fallback when the user
  // hasn't fixed a size yet but starts resizing. measuredRef captures
  // the rendered DOM rect.
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Pass 4.16 — auto-fit text inside the resized box. The legend items
  // live inside `contentRef`, which we scale via `transform: scale()`
  // so the text fills the user-chosen box exactly. scrollWidth /
  // scrollHeight report the intrinsic layout size (transforms apply
  // after layout) so we can measure natural content even while a
  // scale is applied. No scrollbars ever appear.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentScale, setContentScale] = useState(1);
  useLayoutEffect(() => {
    if (!cardRef.current || !contentRef.current) return;
    const measure = () => {
      const card = cardRef.current;
      const content = contentRef.current;
      if (!card || !content) return;
      const cw = content.scrollWidth;
      const ch = content.scrollHeight;
      if (cw === 0 || ch === 0) return;
      // Available area inside the card after padding (6 px top/bottom,
      // 10 px left/right).
      const availW = card.clientWidth - 20;
      const availH = card.clientHeight - 12;
      if (availW <= 0 || availH <= 0) return;
      // Clamp to a sane range so the text never disappears (min) or
      // becomes wall-art (max).
      const ratio = Math.max(
        0.3,
        Math.min(3.5, Math.min(availW / cw, availH / ch)),
      );
      setContentScale(ratio);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [items.length, size?.w, size?.h]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStart.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startPos: position,
      };
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStart.current;
      if (!s) return;
      const dx = e.clientX - s.startMouse.x;
      const dy = e.clientY - s.startMouse.y;
      // Soft clamp: keep at least 20 px of the legend visible inside
      // the plot wrapper on each edge.
      const nextX = Math.max(
        -bounds.width * 0.3,
        Math.min(bounds.width - 20, s.startPos.x + dx),
      );
      const nextY = Math.max(
        0,
        Math.min(bounds.height - 20, s.startPos.y + dy),
      );
      onPositionChange({ x: nextX, y: nextY });
    },
    [bounds, onPositionChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // Pass 4.14 — resize pointer handlers. We attach the move/up handlers
  // to window during a resize so the user can drag past the legend edge
  // without losing the gesture. The starting box uses `size` if the
  // user has previously resized; otherwise we read the rendered DOM
  // rect so the very first resize feels natural.
  const onResizeDown = useCallback(
    (dir: ResizeDir, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = cardRef.current?.getBoundingClientRect();
      const startW = size?.w ?? rect?.width ?? 120;
      const startH = size?.h ?? rect?.height ?? 60;
      resizeStart.current = {
        dir,
        startMouse: { x: e.clientX, y: e.clientY },
        startBox: {
          x: position.x,
          y: position.y,
          w: startW,
          h: startH,
        },
      };
      setResizing(dir);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position, size],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = resizeStart.current;
      if (!r) return;
      const dx = e.clientX - r.startMouse.x;
      const dy = e.clientY - r.startMouse.y;
      let { x, y, w, h } = r.startBox;
      const MIN_W = 60;
      const MIN_H = 30;
      // East/west edges adjust width (and x for west-side handles so
      // the opposite anchor stays still during the gesture).
      if (r.dir.includes("e")) {
        w = Math.max(MIN_W, r.startBox.w + dx);
      }
      if (r.dir.includes("w")) {
        const nextW = Math.max(MIN_W, r.startBox.w - dx);
        x = r.startBox.x + (r.startBox.w - nextW);
        w = nextW;
      }
      // North/south edges adjust height (and y for north-side handles).
      if (r.dir.includes("s")) {
        h = Math.max(MIN_H, r.startBox.h + dy);
      }
      if (r.dir.includes("n")) {
        const nextH = Math.max(MIN_H, r.startBox.h - dy);
        y = r.startBox.y + (r.startBox.h - nextH);
        h = nextH;
      }
      onSizeChange({ w, h });
      if (x !== r.startBox.x || y !== r.startBox.y) {
        onPositionChange({ x, y });
      }
    },
    [onSizeChange, onPositionChange],
  );

  const onResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeStart.current = null;
    setResizing(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // Shared handle styles — invisible thin strips on edges + 10px corner
  // squares. Each handle stops drag propagation so the user can resize
  // without simultaneously starting a drag.
  const HANDLE: Record<ResizeDir, React.CSSProperties> = {
    n: { top: -3, left: 6, right: 6, height: 6, cursor: "n-resize" },
    s: { bottom: -3, left: 6, right: 6, height: 6, cursor: "s-resize" },
    e: { top: 6, bottom: 6, right: -3, width: 6, cursor: "e-resize" },
    w: { top: 6, bottom: 6, left: -3, width: 6, cursor: "w-resize" },
    nw: { top: -3, left: -3, width: 10, height: 10, cursor: "nw-resize" },
    ne: { top: -3, right: -3, width: 10, height: 10, cursor: "ne-resize" },
    sw: { bottom: -3, left: -3, width: 10, height: 10, cursor: "sw-resize" },
    se: { bottom: -3, right: -3, width: 10, height: 10, cursor: "se-resize" },
  };
  const dirs: ResizeDir[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

  return (
    <div
      ref={cardRef}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: size?.w,
        height: size?.h,
        background: "var(--bg-card)",
        backdropFilter: "var(--blur-modal)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-1)",
        padding: "6px 10px",
        boxShadow: dragging || resizing ? "var(--shadow-3)" : "var(--shadow-1)",
        fontSize: 12,
        color: "var(--text-2)",
        userSelect: "none",
        cursor: dragging ? "grabbing" : "grab",
        zIndex: 10,
        minWidth: 60,
        minHeight: 30,
        // Pass 4.16 — never show scrollbars: text scales to fit (see
        // contentRef + transform: scale below).
        overflow: "hidden",
        boxSizing: "border-box",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title="Drag to reposition · grab any edge to resize"
      data-cortex-legend=""
    >
      {/* Content layer — scales via transform:scale() so it fits the
          user-chosen box exactly without scrollbars. transform-origin
          top-left so it stays anchored to the upper edge of the card. */}
      <div
        ref={contentRef}
        style={{
          transform: `scale(${contentScale})`,
          transformOrigin: "top left",
          // Use a wide max so single-line items keep their natural
          // width; the scale handles the visual fit.
          width: "max-content",
        }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              lineHeight: 1.6,
            }}
          >
            {/* Marker glyph — small SVG so we can render any shape. */}
            <svg
              width={14}
              height={14}
              viewBox="0 0 14 14"
              style={{ flexShrink: 0 }}
            >
              {item.glyph === "line" ? (
                <line
                  x1={1}
                  y1={7}
                  x2={13}
                  y2={7}
                  stroke={item.color}
                  strokeWidth={2}
                  strokeDasharray="3 2"
                />
              ) : item.glyph === "rect" ? (
                <rect
                  x={1}
                  y={1}
                  width={12}
                  height={12}
                  fill={item.color}
                  rx={1.5}
                />
              ) : (
                renderMarkerShape(item.glyph, 7, 7, 5, item.color)
              )}
            </svg>
            <span style={{ color: "var(--text)" }}>{item.name}</span>
          </div>
        ))}
      </div>
      {/* Pass 4.14 — 8 invisible resize handles. They sit on top of the
          card's edges and corners, intercepting pointer events so the
          drag-to-reposition gesture on the body still works. */}
      {dirs.map((d) => (
        <div
          key={d}
          onPointerDown={(e) => onResizeDown(d, e)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          style={{
            position: "absolute",
            ...HANDLE[d],
            // Slightly visible on hover to invite the gesture; the
            // box-shadow ring around the card also signals it's
            // interactive when actively resizing.
            background:
              resizing === d
                ? "color-mix(in oklab, var(--accent) 50%, transparent)"
                : "transparent",
            zIndex: 11,
            touchAction: "none",
          }}
          data-cortex-resize-handle={d}
        />
      ))}
    </div>
  );
}

function ScatterPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const sizeCol = config.mapping?.size ?? null;
  const groupCol = config.mapping?.group ?? null;
  const xName = data.columns[xCol]?.name ?? "x";
  const xColType = data.columns[xCol]?.type ?? "number";

  // Pass 3.7 / 3.12 — scatter supports the same multi-Y mapping as
  // line/area/bar. Pass 3.12 rewrite: chart-level data with
  // column-name keys (mirroring DualYPlot which works). Each Scatter
  // gets `dataKey={yColumnName}` and reads from chart-level data, so
  // recharts can auto-compute domains for both left + right YAxis
  // without us having to give those axes explicit dataKey props.
  const ySeries =
    config.mapping?.ySeries && config.mapping.ySeries.length > 0
      ? config.mapping.ySeries
      : [config.mapping?.y ?? 1];
  const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
  const usesRight = ySeries.some((c) => ySeriesAxis[c] === "right");
  const axisIdFor = (c: number) =>
    ySeriesAxis[c] === "right" ? "right" : "left";

  // The "group" mapping is meaningful only when there is exactly one
  // Y series — it pivots that Y into per-group columns so each group
  // can render as a separately-colored Scatter. With multi-Y the
  // group dimension is implicit (each Y is its own series).
  const singleYWithGroup = ySeries.length === 1 && groupCol != null;

  // seriesDefs: the legend + render plan, one entry per visible series.
  // - col is used for axis assignment (which YAxis) + color overrides.
  // - dataKey is the chart-level-data field carrying this series' Y values.
  // - name is the legend label.
  interface SeriesDef {
    name: string;
    dataKey: string;
    col: number;
    seriesIndex: number;
  }

  // chartRows: per-row objects keyed by xName + each series dataKey.
  // Built once via useMemo; chart-level data, NOT per-Scatter data.
  const { chartRows, seriesDefs, sizeKey } = useMemo<{
    chartRows: Array<Record<string, number | string | null>>;
    seriesDefs: SeriesDef[];
    sizeKey: string | null;
  }>(() => {
    const sKey =
      sizeCol != null ? (data.columns[sizeCol]?.name ?? "__cortex_z") : null;

    if (singleYWithGroup) {
      // Pivot the rows: each unique group becomes its own column.
      const yc = ySeries[0];
      const groups = new Set<string>();
      for (const r of data.rows) {
        const g = cat(r, groupCol!);
        if (g) groups.add(g);
      }
      const groupList = Array.from(groups).sort();
      const rs: Array<Record<string, number | string | null>> = [];
      for (const r of data.rows) {
        const x = num(r, xCol);
        if (x == null) continue;
        const g = cat(r, groupCol!);
        const y = num(r, yc);
        if (!g || y == null) continue;
        const obj: Record<string, number | string | null> = {};
        obj[xName] = x;
        obj[g] = y;
        if (sKey != null) obj[sKey] = num(r, sizeCol);
        rs.push(obj);
      }
      return {
        chartRows: rs,
        seriesDefs: groupList.map((g, i) => ({
          name: g,
          dataKey: g,
          col: yc, // axis + color override key
          seriesIndex: i,
        })),
        sizeKey: sKey,
      };
    }

    // Multi-Y mode: one row per data row, with the X column under
    // xName and each Y column under its own header.
    const series: SeriesDef[] = ySeries.map((yc, i) => {
      const yColName = data.columns[yc]?.name ?? `y${yc}`;
      return {
        name: yColName,
        dataKey: yColName,
        col: yc,
        seriesIndex: i,
      };
    });
    const rs: Array<Record<string, number | string | null>> = [];
    for (const r of data.rows) {
      const x = num(r, xCol);
      if (x == null) continue;
      const obj: Record<string, number | string | null> = {};
      obj[xName] = x;
      for (const s of series) {
        obj[s.dataKey] = num(r, s.col);
      }
      if (sKey != null) obj[sKey] = num(r, sizeCol);
      rs.push(obj);
    }
    return { chartRows: rs, seriesDefs: series, sizeKey: sKey };
  }, [data, xCol, sizeCol, groupCol, ySeries, xName, singleYWithGroup]);

  // Reference lines — computed across every visible Y value.
  const axisValues = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of chartRows) {
      const xv = r[xName];
      if (typeof xv === "number") xs.push(xv);
      for (const s of seriesDefs) {
        const yv = r[s.dataKey];
        if (typeof yv === "number") ys.push(yv);
      }
    }
    return { x: xs, y: ys };
  }, [chartRows, seriesDefs, xName]);
  const refLines = useMemo(
    // Pass 3.14: every ReferenceLine in a multi-Y-axis chart needs an
    // explicit yAxisId or recharts crashes. ScatterPlot always
    // declares the left axis, so anchor the lines there.
    () => referenceLineOverlay(config, axisValues, { yAxisId: "left" }),
    [config, axisValues],
  );

  // Pass 4.11 — per-series trendline overlay is now built inline at
  // render time. The old single-trendline `trendline` useMemo is
  // gone; each series consults config.seriesTrendline[col].
  const connect = !!config.connectPoints;
  const dotR = config.dotSize ?? 4;
  const xAxisType: "number" | "category" =
    xColType === "number" ? "number" : "category";

  // Pass 4.9 — axis props now flow through the shared
  // buildXAxisProps / buildYAxisProps helpers, which also set
  // allowDataOverflow=true whenever a manual range is in effect so
  // the manual range actually clips the chart (recharts otherwise
  // auto-expands to include out-of-range data, making the manual
  // range a no-op visually — which the user found in pass 4.8).
  // Pass 4.16 — compute data extents so tick-step works on auto-range
  // axes too (without an extent, computeTicksFromStep falls back to
  // "do nothing").
  const xExtent = useMemo<[number, number] | null>(() => {
    if (xAxisType !== "number") return null;
    let lo = Infinity,
      hi = -Infinity;
    for (const r of data.rows) {
      const v = r[xCol];
      const n =
        typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
      if (Number.isFinite(n)) {
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
  }, [data.rows, xCol, xAxisType]);
  const yExtents = useMemo<{
    left: [number, number] | null;
    right: [number, number] | null;
  }>(() => {
    const acc = {
      leftLo: Infinity,
      leftHi: -Infinity,
      rightLo: Infinity,
      rightHi: -Infinity,
    };
    for (const c of ySeries) {
      const side = ySeriesAxis[c] === "right" ? "right" : "left";
      for (const r of data.rows) {
        const v = r[c];
        const n =
          typeof v === "number"
            ? v
            : typeof v === "string"
              ? parseFloat(v)
              : NaN;
        if (!Number.isFinite(n)) continue;
        if (side === "right") {
          if (n < acc.rightLo) acc.rightLo = n;
          if (n > acc.rightHi) acc.rightHi = n;
        } else {
          if (n < acc.leftLo) acc.leftLo = n;
          if (n > acc.leftHi) acc.leftHi = n;
        }
      }
    }
    return {
      left:
        Number.isFinite(acc.leftLo) && Number.isFinite(acc.leftHi)
          ? [acc.leftLo, acc.leftHi]
          : null,
      right:
        Number.isFinite(acc.rightLo) && Number.isFinite(acc.rightHi)
          ? [acc.rightLo, acc.rightHi]
          : null,
    };
  }, [data.rows, ySeries, ySeriesAxis]);

  const scatterXAxisProps = buildXAxisProps(config, xAxisType, xExtent);
  const scatterYAxisLeftProps = buildYAxisProps(config, "left", yExtents.left);
  const scatterYAxisRightProps = buildYAxisProps(
    config,
    "right",
    yExtents.right,
  );

  // Pass 4.16 — color the Y axis to match its single series (Excel
  // style). Falls back to neutral when multiple series share a side.
  const yLeftColor = axisColorForSide(config, ySeries, "left");
  const yRightColor = axisColorForSide(config, ySeries, "right");

  // Pass 3.14: when "connect points" is on, the <Line> through the
  // scatter must draw monotonically left-to-right, otherwise an
  // unsorted dataset produces a zigzag that visually reads as
  // garbage. We build a sorted view of chartRows for the line, and
  // leave the unsorted chartRows for the Scatter dots (whose
  // positions are X-derived and don't care about row order).
  const sortedRows = useMemo(() => {
    if (!connect) return chartRows;
    return chartRows.slice().sort((a, b) => {
      const ax = a[xName];
      const bx = b[xName];
      if (typeof ax === "number" && typeof bx === "number") return ax - bx;
      if (typeof ax === "string" && typeof bx === "string")
        return ax.localeCompare(bx);
      return 0;
    });
  }, [chartRows, connect, xName]);

  // Pass 4.13 — build legend items for the custom draggable legend.
  // The recharts built-in Legend is suppressed via the `customLegend`
  // flag on CommonChartElements below.
  const legendDisplay = config.legendDisplay ?? {};
  const showLegendMaster = config.showLegend !== false;
  const showSeriesInLegend = legendDisplay.showSeries !== false;
  const showTrendlinesInLegend = legendDisplay.showTrendlines !== false;
  const showEquation = legendDisplay.showEquation !== false;
  const showR2 = legendDisplay.showR2 !== false;
  const cortexLegendItems: CortexLegendItem[] = [];
  if (showSeriesInLegend) {
    for (const s of seriesDefs) {
      const shape =
        (config.seriesShape?.[s.col] as MarkerShape | undefined) ?? "circle";
      const color =
        config.seriesColors?.[s.col] ?? colorForSeries(s.seriesIndex, config);
      cortexLegendItems.push({ name: s.name, color, glyph: shape });
    }
  }
  if (showTrendlinesInLegend) {
    for (const s of seriesDefs) {
      const cfg =
        config.seriesTrendline?.[s.col] ??
        (s.seriesIndex === 0 &&
        config.trendline?.kind &&
        config.trendline.kind !== "none"
          ? {
              kind: config.trendline.kind,
              showCi: config.trendline.showCi,
            }
          : null);
      if (!cfg || cfg.kind === "none") continue;
      // Re-compute the fit to put its equation/R² in the chip label.
      const xs: number[] = [];
      const ys: number[] = [];
      for (const r of data.rows) {
        const xRaw = r[xCol];
        const yRaw = r[s.col];
        const xn =
          typeof xRaw === "number"
            ? xRaw
            : typeof xRaw === "string"
              ? parseFloat(xRaw)
              : NaN;
        const yn =
          typeof yRaw === "number"
            ? yRaw
            : typeof yRaw === "string"
              ? parseFloat(yRaw)
              : NaN;
        if (Number.isFinite(xn) && Number.isFinite(yn)) {
          xs.push(xn);
          ys.push(yn);
        }
      }
      if (xs.length < 2) continue;
      const fit = fitRegression(xs, ys, cfg.kind);
      if (!fit) continue;
      const parts: string[] = [`${s.name} trend`];
      if (showEquation) parts.push(fit.equation);
      if (showR2) parts.push(`R² = ${formatNum(fit.r2, 3)}`);
      const trendColor =
        config.seriesColors?.[s.col] ?? colorForSeries(s.seriesIndex, config);
      cortexLegendItems.push({
        name: parts.join(" · "),
        color: trendColor,
        glyph: "line",
      });
    }
  }
  // Pass 4.15 — legend position + size live in config as FRACTIONS of
  // the plot wrapper's bounds (0–1). We convert to pixels at render
  // time and back when committing user gestures. Legacy plots may have
  // saved pixel values (any axis > 1); detect those and treat as
  // pixels for this render — the next save will normalize them.
  //
  // Default top-right placement is computed in fractional space so it
  // adapts to the current wrapper size automatically.
  const isFractional = (v: number) => v >= 0 && v <= 1.0001;
  const rawLegendPos = config.legendPosition;
  const legendPosFrac =
    rawLegendPos && isFractional(rawLegendPos.x) && isFractional(rawLegendPos.y)
      ? rawLegendPos
      : rawLegendPos
        ? // Legacy pixel values — interpret against current bounds.
          { x: rawLegendPos.x / width, y: rawLegendPos.y / height }
        : { x: Math.max(0, (width - 160) / width), y: 8 / height };
  const legendPos = {
    x: legendPosFrac.x * width,
    y: legendPosFrac.y * height,
  };

  const rawLegendSize = config.legendSize;
  const legendSizeFrac =
    rawLegendSize &&
    isFractional(rawLegendSize.w) &&
    isFractional(rawLegendSize.h)
      ? rawLegendSize
      : rawLegendSize
        ? { w: rawLegendSize.w / width, h: rawLegendSize.h / height }
        : undefined;
  const legendSize = legendSizeFrac
    ? { w: legendSizeFrac.w * width, h: legendSizeFrac.h * height }
    : undefined;

  return (
    <div
      style={{
        position: "relative",
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      <ResponsiveContainer width={width} height={height}>
        <ComposedChart
          data={chartRows}
          margin={{ top: 16, right: usesRight ? 32 : 24, bottom: 32, left: 8 }}
        >
          <CommonChartElements config={config} customLegend />
          <XAxis
            type={xAxisType}
            dataKey={xName}
            name={config.axis?.xLabel ?? xName}
            stroke="var(--text-2)"
            tick={{ fill: "var(--text-2)", fontSize: 11 }}
            {...(scatterXAxisProps as any)}
          />
          <YAxis
            yAxisId="left"
            type="number"
            name={config.axis?.yLabel}
            stroke={yLeftColor}
            tick={{ fill: yLeftColor, fontSize: 11 }}
            {...(scatterYAxisLeftProps as any)}
          />
          {usesRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              type="number"
              stroke={yRightColor}
              tick={{ fill: yRightColor, fontSize: 11 }}
              {...(scatterYAxisRightProps as any)}
            />
          )}
          {sizeKey != null && (
            <ZAxis dataKey={sizeKey} range={[40, 320]} name="size" />
          )}
          {refLines}

          {/* Connecting lines (optional). Rendered BEFORE the scatter
            dots so the dots paint on top. Pass 3.14: pass the
            X-sorted view of chartRows so the line draws
            monotonically — otherwise unsorted scatter data produces
            a tangled mess. */}
          {connect &&
            seriesDefs.map((s) => {
              const lineCfg = config.seriesLine?.[s.col];
              const stroke =
                config.seriesColors?.[s.col] ??
                colorForSeries(s.seriesIndex, config);
              return (
                <Line
                  key={`scatter-line-${s.seriesIndex}`}
                  yAxisId={axisIdFor(s.col)}
                  type="linear"
                  data={sortedRows}
                  dataKey={s.dataKey}
                  stroke={stroke}
                  strokeWidth={lineCfg?.width ?? 1.5}
                  strokeDasharray={
                    lineCfg?.style === "dashed"
                      ? "6 4"
                      : lineCfg?.style === "dotted"
                        ? "2 4"
                        : undefined
                  }
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType="none"
                  name={s.name}
                  connectNulls={true}
                />
              );
            })}

          {/* Scatter dots — one Scatter per series, all bound to the
            chart-level data via dataKey. Custom shape applies the
            configured dot size; ZAxis-driven size override still works.
            Pass 4.11 — per-series σ-column binding. Each Y series can
            point at a separate column whose per-row values become the
            error magnitudes for that series. Replaces the previous
            selection-based "error-y" role. */}
          {seriesDefs.map((s) => {
            const fill =
              config.seriesColors?.[s.col] ??
              colorForSeries(s.seriesIndex, config);
            // Per-series stddev column (pass 4.11). When set, read
            // per-row σ values from that column.
            const stddevCol = config.mapping?.stddevColumns?.[s.col];
            const errY: Array<number | null> = new Array(data.rows.length).fill(
              null,
            );
            if (stddevCol != null) {
              for (let i = 0; i < data.rows.length; i++) {
                const v = data.rows[i]?.[stddevCol];
                const n =
                  typeof v === "number"
                    ? v
                    : typeof v === "string"
                      ? parseFloat(v)
                      : NaN;
                if (Number.isFinite(n)) errY[i] = n;
              }
            }
            const hasErrY = errY.some((v) => v != null);
            // Splice synthetic error-magnitude field into chartRows.
            const rowsWithErr = hasErrY
              ? chartRows.map((row, i) => ({
                  ...row,
                  [`${s.dataKey}__ey`]: errY[i] ?? null,
                }))
              : null;
            // Pass 4.12 — per-series marker shape + legend visibility.
            const seriesShape: MarkerShape =
              (config.seriesShape?.[s.col] as MarkerShape) ?? "circle";
            const legendDisplay = config.legendDisplay ?? {};
            const showSeries = legendDisplay.showSeries !== false;
            return (
              <Scatter
                key={`scatter-${s.seriesIndex}`}
                yAxisId={axisIdFor(s.col)}
                name={s.name}
                dataKey={s.dataKey}
                data={rowsWithErr ?? undefined}
                fill={fill}
                isAnimationActive={false}
                line={false}
                legendType={showSeries ? "circle" : "none"}
                shape={(scatterProps: {
                  cx?: number;
                  cy?: number;
                  node?: { x?: number; y?: number; z?: number };
                }) => {
                  const { cx = 0, cy = 0, node } = scatterProps;
                  const r =
                    node && typeof node.z === "number"
                      ? Math.max(2, Math.sqrt(node.z / Math.PI))
                      : dotR;
                  return renderMarkerShape(seriesShape, cx, cy, r, fill);
                }}
              >
                {hasErrY && (
                  <ErrorBar
                    dataKey={`${s.dataKey}__ey`}
                    width={4}
                    strokeWidth={1.25}
                    stroke="var(--text)"
                    direction="y"
                  />
                )}
              </Scatter>
            );
          })}

          {/* Pass 4.11 — Per-Y-series trendlines + confidence bands.
            Each Y series can independently declare a trendline kind
            and a CI-band toggle via config.seriesTrendline[col]. The
            old global config.trendline is honored as a fallback for
            the FIRST series so existing plots continue to render.
            Rendering pattern: evaluate the fit at every chart-row's
            X and splice the result into chart-level data under a
            per-series key, so a normal Line (and optional Area pair
            for the CI band) reads via dataKey. */}
          {(() => {
            const overlays: React.ReactNode[] = [];
            for (const s of seriesDefs) {
              const cfg =
                config.seriesTrendline?.[s.col] ??
                // Fallback: apply global trendline to FIRST series.
                (s.seriesIndex === 0 &&
                config.trendline?.kind &&
                config.trendline.kind !== "none"
                  ? {
                      kind: config.trendline.kind,
                      showCi: config.trendline.showCi,
                    }
                  : null);
              if (!cfg || cfg.kind === "none") continue;
              // Build (x, y) pairs from the data for fitting.
              const xs: number[] = [];
              const ys: number[] = [];
              for (const r of data.rows) {
                const xRaw = r[xCol];
                const yRaw = r[s.col];
                const xn =
                  typeof xRaw === "number"
                    ? xRaw
                    : typeof xRaw === "string"
                      ? parseFloat(xRaw)
                      : NaN;
                const yn =
                  typeof yRaw === "number"
                    ? yRaw
                    : typeof yRaw === "string"
                      ? parseFloat(yRaw)
                      : NaN;
                if (Number.isFinite(xn) && Number.isFinite(yn)) {
                  xs.push(xn);
                  ys.push(yn);
                }
              }
              if (xs.length < 2) continue;
              const fit = fitRegression(xs, ys, cfg.kind);
              if (!fit) continue;
              const band = cfg.showCi ? regressionBand(fit, xs) : [];
              // Splice fit + band into a per-series augmented chartRows.
              const fitKey = `__trend_${s.col}`;
              const bandLoKey = `__trendLo_${s.col}`;
              const bandHiKey = `__trendBandH_${s.col}`;
              const augRows = chartRows
                .map((row) => {
                  const x = row[xName];
                  if (typeof x !== "number") return null;
                  const yhat = evaluateFit(fit, x);
                  if (!Number.isFinite(yhat)) return null;
                  const next: Record<string, number | string | null> = {
                    ...row,
                    [fitKey]: yhat,
                  };
                  if (cfg.showCi && band.length > 0) {
                    // For each row, find the closest band entry's lo/hi.
                    let bestIdx = 0;
                    let bestDiff = Infinity;
                    for (let i = 0; i < band.length; i++) {
                      const d = Math.abs(band[i].x - x);
                      if (d < bestDiff) {
                        bestDiff = d;
                        bestIdx = i;
                      }
                    }
                    const b = band[bestIdx];
                    next[bandLoKey] = b.lo;
                    next[bandHiKey] = b.hi - b.lo;
                  }
                  return next;
                })
                .filter(
                  (r): r is Record<string, number | string | null> => r != null,
                )
                .sort((a, b) => {
                  const ax = a[xName];
                  const bx = b[xName];
                  return typeof ax === "number" && typeof bx === "number"
                    ? ax - bx
                    : 0;
                });
              const axisId = axisIdFor(s.col);
              const trendColor =
                config.seriesColors?.[s.col] ??
                colorForSeries(s.seriesIndex, config);
              // CI band: stacked Area pair. The lo base is invisible;
              // the bandHeight overlay paints the visible band.
              if (cfg.showCi && band.length > 0) {
                overlays.push(
                  <Area
                    key={`band-lo-${s.col}`}
                    yAxisId={axisId}
                    data={augRows}
                    dataKey={bandLoKey}
                    stackId={`trend-band-${s.col}`}
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                    legendType="none"
                  />,
                );
                overlays.push(
                  <Area
                    key={`band-hi-${s.col}`}
                    yAxisId={axisId}
                    data={augRows}
                    dataKey={bandHiKey}
                    stackId={`trend-band-${s.col}`}
                    stroke="none"
                    fill={`color-mix(in oklab, ${trendColor} 18%, transparent)`}
                    isAnimationActive={false}
                    // Inherit the trendline's legend-visibility decision
                    // so band + trendline appear / disappear together.
                    legendType={
                      config.legendDisplay?.showTrendlines !== false
                        ? "rect"
                        : "none"
                    }
                    name={`${s.name} 95% band`}
                  />,
                );
              }
              // The trendline itself. Pass 4.12 — legend label respects
              // legendDisplay flags: pruning the equation and/or R²
              // keeps the legend readable for plots with several fits.
              const ld = config.legendDisplay ?? {};
              const showTrendlines = ld.showTrendlines !== false;
              const showEq = ld.showEquation !== false;
              const showR2v = ld.showR2 !== false;
              const labelParts: string[] = [`${s.name} trend`];
              if (showEq) labelParts.push(fit.equation);
              if (showR2v) labelParts.push(`R² = ${formatNum(fit.r2, 3)}`);
              const trendLabel = labelParts.join(" · ");
              overlays.push(
                <Line
                  key={`trend-${s.col}`}
                  yAxisId={axisId}
                  data={augRows}
                  dataKey={fitKey}
                  type="monotone"
                  stroke={trendColor}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType={showTrendlines ? "plainline" : "none"}
                  name={trendLabel}
                />,
              );
            }
            return overlays;
          })()}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Pass 4.13 — custom draggable legend, mounted as an
        absolutely-positioned sibling of the chart so users can move
        it anywhere within the plot. Master "Show legend" toggle
        controls visibility; legendDisplay flags prune which entries
        appear. */}
      {showLegendMaster && cortexLegendItems.length > 0 && (
        <CortexLegend
          items={cortexLegendItems}
          position={legendPos}
          onPositionChange={(p) => {
            // Pass 4.15 — CortexLegend works in pixels, but storage is
            // fractions of bounds so the legend stays put when the plot
            // resizes between inline + popup contexts.
            const frac = {
              x: p.x / width,
              y: p.y / height,
            };
            const evt = new CustomEvent("cortex:plot-legend-position", {
              detail: { position: frac },
              bubbles: true,
            });
            window.dispatchEvent(evt);
          }}
          size={legendSize}
          onSizeChange={(s) => {
            // Pass 4.14 / 4.15 — same fractions-vs-pixels conversion as
            // position. The user resized in pixels; we persist in
            // fractions so the resize survives the plot bounds changing.
            const frac = { w: s.w / width, h: s.h / height };
            const evt = new CustomEvent("cortex:plot-legend-size", {
              detail: { size: frac },
              bubbles: true,
            });
            window.dispatchEvent(evt);
          }}
          bounds={{ width, height }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Line (F11)
// =====================================================================

function LinePlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const ySeries = config.mapping?.ySeries ?? [config.mapping?.y ?? 1];
  const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
  const xName = data.columns[xCol]?.name ?? "x";
  const xColType = data.columns[xCol]?.type ?? "category";
  const rows = toObjects(data);
  // Pass 3.1 — render a right-side YAxis only when at least one
  // series claims it. Recharts requires an explicit yAxisId on every
  // chart child as soon as we declare more than one YAxis, hence the
  // axisIdFor helper below.
  const usesRight = ySeries.some((c) => ySeriesAxis[c] === "right");
  const axisIdFor = (c: number) =>
    ySeriesAxis[c] === "right" ? "right" : "left";

  const dotR = config.dotSize ?? 3;

  // Pass 4.16 — extents drive auto-range tick-step + axis color match.
  const lineExt = useMemo(
    () =>
      computeAxisExtents(
        data,
        xCol,
        ySeries,
        ySeriesAxis,
        xColType === "number",
      ),
    [data, xCol, ySeries, ySeriesAxis, xColType],
  );
  const lineColorL = axisColorForSide(config, ySeries, "left");
  const lineColorR = axisColorForSide(config, ySeries, "right");

  // Pass 3.13 — trendline overlay fit against the FIRST Y series.
  const trendline = useMemo(
    () =>
      ySeries.length > 0
        ? computeTrendlineSeries({
            data,
            xCol,
            yCol: ySeries[0],
            xColType,
            xKeyName: xName,
            config,
          })
        : null,
    [data, xCol, ySeries, xColType, xName, config],
  );
  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart
        data={rows}
        margin={{ top: 16, right: usesRight ? 32 : 24, bottom: 32, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          dataKey={xName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          {...(buildXAxisProps(
            config,
            xColType === "number" ? "number" : "category",
            lineExt.x,
          ) as any)}
        />
        <YAxis
          yAxisId="left"
          stroke={lineColorL}
          tick={{ fill: lineColorL, fontSize: 11 }}
          {...(buildYAxisProps(config, "left", lineExt.yLeft) as any)}
        />
        {usesRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke={lineColorR}
            tick={{ fill: lineColorR, fontSize: 11 }}
            {...(buildYAxisProps(config, "right", lineExt.yRight) as any)}
          />
        )}
        {ySeries.map((yc, i) => {
          const yName = data.columns[yc]?.name ?? `y${i}`;
          const lineCfg = config.seriesLine?.[yc];
          const color = config.seriesColors?.[yc] ?? colorForSeries(i, config);
          return (
            <Line
              key={yName + i}
              yAxisId={axisIdFor(yc)}
              type="monotone"
              name={yName}
              dataKey={yName}
              stroke={color}
              strokeWidth={lineCfg?.width ?? 2}
              strokeDasharray={
                lineCfg?.style === "dashed"
                  ? "6 4"
                  : lineCfg?.style === "dotted"
                    ? "2 4"
                    : undefined
              }
              // Pass 3.14 — line plot reads as pure lines, no dots.
              // Hover still surfaces a dot via `activeDot` for the
              // tooltip anchor. Use scatter for points; use line for
              // lines.
              dot={false}
              activeDot={{ r: dotR + 2, fill: color }}
              isAnimationActive={false}
            />
          );
        })}
        {trendline &&
          renderTrendlineChildren({
            trendline,
            axisId: axisIdFor(ySeries[0]),
            xKeyName: xName,
          })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Area (F12)
// =====================================================================

function AreaPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const ySeries = config.mapping?.ySeries ?? [config.mapping?.y ?? 1];
  const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
  const xName = data.columns[xCol]?.name ?? "x";
  const xColType = data.columns[xCol]?.type ?? "category";
  const stacked = config.bar?.layout === "stacked";
  const rows = toObjects(data);
  const usesRight = ySeries.some((c) => ySeriesAxis[c] === "right");
  const axisIdFor = (c: number) =>
    ySeriesAxis[c] === "right" ? "right" : "left";

  // Pass 3.13 — trendline overlay against the first Y series.
  const trendline = useMemo(
    () =>
      ySeries.length > 0
        ? computeTrendlineSeries({
            data,
            xCol,
            yCol: ySeries[0],
            xColType,
            xKeyName: xName,
            config,
          })
        : null,
    [data, xCol, ySeries, xColType, xName, config],
  );

  // Pass 4.16 — axis extents + colors.
  const areaExt = useMemo(
    () =>
      computeAxisExtents(
        data,
        xCol,
        ySeries,
        ySeriesAxis,
        xColType === "number",
      ),
    [data, xCol, ySeries, ySeriesAxis, xColType],
  );
  const areaColorL = axisColorForSide(config, ySeries, "left");
  const areaColorR = axisColorForSide(config, ySeries, "right");

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart
        data={rows}
        margin={{ top: 16, right: usesRight ? 32 : 24, bottom: 32, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          dataKey={xName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          {...(buildXAxisProps(
            config,
            xColType === "number" ? "number" : "category",
            areaExt.x,
          ) as any)}
        />
        <YAxis
          yAxisId="left"
          stroke={areaColorL}
          tick={{ fill: areaColorL, fontSize: 11 }}
          {...(buildYAxisProps(config, "left", areaExt.yLeft) as any)}
        />
        {usesRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke={areaColorR}
            tick={{ fill: areaColorR, fontSize: 11 }}
            {...(buildYAxisProps(config, "right", areaExt.yRight) as any)}
          />
        )}
        {ySeries.map((yc, i) => {
          const yName = data.columns[yc]?.name ?? `y${i}`;
          const color = colorForSeries(i, config);
          return (
            <Area
              key={yName + i}
              yAxisId={axisIdFor(yc)}
              type="monotone"
              dataKey={yName}
              stroke={color}
              fill={color}
              fillOpacity={0.35}
              stackId={stacked ? "stack" : undefined}
              isAnimationActive={false}
            />
          );
        })}
        {trendline &&
          renderTrendlineChildren({
            trendline,
            axisId: axisIdFor(ySeries[0]),
            xKeyName: xName,
          })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Bar (F13) — vertical, with grouped/stacked variants
// =====================================================================

function BarPlot({
  payload,
  width,
  height,
  horizontal = false,
}: PlotRendererProps & { horizontal?: boolean }) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const ySeries = config.mapping?.ySeries ?? [config.mapping?.y ?? 1];
  const ySeriesAxis = config.mapping?.ySeriesAxis ?? {};
  const xName = data.columns[xCol]?.name ?? "x";
  const stacked = config.bar?.layout === "stacked";
  const rows = toObjects(data);
  // Pass 3.1 — multi-Y with per-series axis. Bar charts only support
  // the secondary axis in vertical (horizontal=false) layout; in
  // horizontal layout the value axis is X, so left/right doesn't
  // apply. We honor the assignment in vertical mode and ignore it
  // in horizontal mode.
  const usesRight =
    !horizontal && ySeries.some((c) => ySeriesAxis[c] === "right");
  const axisIdFor = (c: number) =>
    !horizontal && ySeriesAxis[c] === "right" ? "right" : "left";

  // Pass 4.16 — axis extents + colors. Bar X is always categorical
  // (false to computeAxisExtents); the helper still returns yLeft/yRight.
  const barExt = useMemo(
    () => computeAxisExtents(data, xCol, ySeries, ySeriesAxis, false),
    [data, xCol, ySeries, ySeriesAxis],
  );
  const barColorL = axisColorForSide(config, ySeries, "left");
  const barColorR = axisColorForSide(config, ySeries, "right");

  // For horizontal layout: switch X/Y axis types — categorical Y,
  // numeric X. Recharts handles via `layout="vertical"` (yes, the
  // recharts naming is inverted; vertical layout = horizontal bars).
  return (
    <ResponsiveContainer width={width} height={height}>
      <BarChart
        data={rows}
        margin={{ top: 16, right: usesRight ? 32 : 24, bottom: 24, left: 8 }}
        layout={horizontal ? "vertical" : "horizontal"}
      >
        <CommonChartElements config={config} />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              stroke={barColorL}
              tick={{ fill: barColorL, fontSize: 11 }}
              {...(buildXAxisProps(config, "number", barExt.yLeft) as any)}
            />
            <YAxis
              type="category"
              dataKey={xName}
              stroke="var(--text-2)"
              tick={{ fill: "var(--text-2)", fontSize: 11 }}
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xName}
              stroke="var(--text-2)"
              tick={{ fill: "var(--text-2)", fontSize: 11 }}
              {...(buildXAxisProps(config, "category") as any)}
            />
            <YAxis
              yAxisId="left"
              stroke={barColorL}
              tick={{ fill: barColorL, fontSize: 11 }}
              {...(buildYAxisProps(config, "left", barExt.yLeft) as any)}
            />
            {usesRight && (
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={barColorR}
                tick={{ fill: barColorR, fontSize: 11 }}
                {...(buildYAxisProps(config, "right", barExt.yRight) as any)}
              />
            )}
          </>
        )}
        {ySeries.map((yc, i) => {
          const yName = data.columns[yc]?.name ?? `y${i}`;
          return (
            <Bar
              key={yName + i}
              {...(horizontal ? {} : { yAxisId: axisIdFor(yc) })}
              dataKey={yName}
              fill={colorForSeries(i, config)}
              stackId={stacked ? "stack" : undefined}
              isAnimationActive={false}
              radius={[4, 4, 0, 0]}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Histogram (F15) — d3-array bin → BarChart
// =====================================================================

function HistogramPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const values = useMemo(
    () =>
      data.rows.map((r) => num(r, xCol)).filter((v): v is number => v != null),
    [data, xCol],
  );

  const histRows = useMemo(() => {
    if (values.length === 0) return [];
    const binCount =
      config.histogram?.binCount ??
      Math.max(5, Math.ceil(Math.sqrt(values.length)));
    const binner = d3bin<number, number>().thresholds(binCount);
    const bins = binner(values);
    const total = values.length;
    return bins.map((b) => {
      const x0 = b.x0 ?? 0;
      const x1 = b.x1 ?? 0;
      const w = x1 - x0;
      const count = b.length;
      const density = config.histogram?.density
        ? w > 0
          ? count / (total * w)
          : 0
        : count;
      return {
        bin: `${x0.toFixed(2)}–${x1.toFixed(2)}`,
        count: density,
      };
    });
  }, [values, config.histogram]);

  return (
    <ResponsiveContainer width={width} height={height}>
      <BarChart
        data={histRows}
        margin={{ top: 16, right: 24, bottom: 32, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          dataKey="bin"
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 10 }}
          angle={-30}
          textAnchor="end"
          interval={0}
          {...(buildXAxisProps(config, "category") as any)}
        />
        <YAxis
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          {...(buildYAxisProps(config, "left") as any)}
        />
        <Bar
          dataKey="count"
          fill={colorForSeries(0, config)}
          isAnimationActive={false}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Pie / donut (F17)
// =====================================================================

function PiePlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const labelCol = config.mapping?.x ?? 0;
  const valueCol = config.mapping?.y ?? 1;
  const slices = useMemo(
    () =>
      data.rows
        .map((r) => ({
          name: cat(r, labelCol) || "(empty)",
          value: num(r, valueCol) ?? 0,
        }))
        .filter((s) => s.value > 0),
    [data, labelCol, valueCol],
  );
  const colors = discreteColors(slices.length, config.palette ?? "aurora");
  const donut = !!config.pie?.donut;
  const innerR = donut ? (config.pie?.innerRadius ?? 0.55) : 0;

  return (
    <ResponsiveContainer width={width} height={height}>
      <PieChart margin={{ top: 12, right: 24, bottom: 24, left: 24 }}>
        <CommonChartElements config={config} />
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="78%"
          innerRadius={`${innerR * 78}%`}
          isAnimationActive={false}
          stroke="var(--bg)"
          strokeWidth={2}
        >
          {slices.map((_, i) => (
            <Cell key={i} fill={colors[i]} />
          ))}
          <LabelList
            dataKey="name"
            position="outside"
            style={{ fill: "var(--text-2)", fontSize: 11 }}
          />
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Error-bar (F18)
// =====================================================================

function ErrorBarPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const yCol = config.mapping?.y ?? 1;
  const errUpCol = config.mapping?.errorUp;
  const errDownCol = config.mapping?.errorDown;
  const xName = data.columns[xCol]?.name ?? "x";
  const yName = data.columns[yCol]?.name ?? "y";

  const rows = useMemo(() => {
    return data.rows
      .map((r) => {
        const y = num(r, yCol);
        const up = num(r, errUpCol);
        const down = errDownCol != null ? num(r, errDownCol) : up;
        return {
          x: cat(r, xCol),
          y,
          // Recharts ErrorBar accepts [low, high] absolute deltas from y.
          err:
            up != null && down != null ? [Math.abs(down), Math.abs(up)] : null,
        };
      })
      .filter((p) => p.y != null);
  }, [data, xCol, yCol, errUpCol, errDownCol]);

  return (
    <ResponsiveContainer width={width} height={height}>
      <BarChart
        data={rows}
        margin={{ top: 16, right: 24, bottom: 24, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          dataKey="x"
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          name={xName}
        />
        <YAxis
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          name={yName}
        />
        <Bar
          dataKey="y"
          fill={colorForSeries(0, config)}
          isAnimationActive={false}
          radius={[4, 4, 0, 0]}
        >
          <ErrorBar
            dataKey="err"
            width={6}
            strokeWidth={1.5}
            stroke="var(--text)"
            direction="y"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Dispatcher
// =====================================================================

// =====================================================================
// Trendline + reference-line overlay helpers (pass 2.3)
// =====================================================================
//
// These are NOT renderers themselves — they return arrays of recharts
// children that the scatter/line plots splice into their JSX. Keeping
// them as helpers means the trendline+CI band logic stays in one place
// and is reused by ScatterPlot, Regression, Residual, etc.

function trendlineOverlay(
  xs: number[],
  ys: number[],
  config: PlotConfig,
  options?: { showBandFallback?: boolean },
): React.ReactNode[] {
  const kind = (config.trendline?.kind ?? "none") as RegressionKind | "none";
  if (kind === "none" || xs.length < 2) return [];
  const fit = fitRegression(xs, ys, kind);
  if (!fit) return [];
  const showBand =
    config.trendline?.showCi ?? options?.showBandFallback ?? false;
  const band = showBand ? regressionBand(fit, xs) : [];
  const fitLine = regressionBand(fit, xs, 0); // band with zero margin = pure curve
  const accentLight = "color-mix(in oklab, var(--accent) 35%, transparent)";
  const out: React.ReactNode[] = [];
  if (showBand && band.length > 1) {
    // Render the lower/upper edges as a filled area between them.
    // Recharts' `Area` with two `dataKey`s and a `baseLine` is too
    // fiddly across chart types; we approximate via two Lines + an
    // implicit fill rendered as a back-to-back area in ComposedChart
    // contexts. For ScatterChart we just draw two thin lines.
    out.push(
      <Line
        key="trend-band-hi"
        type="monotone"
        data={band as unknown as Array<Record<string, number>>}
        dataKey="hi"
        xAxisId={0}
        yAxisId={0}
        stroke={accentLight}
        strokeWidth={1}
        strokeDasharray="2 3"
        dot={false}
        legendType="none"
        isAnimationActive={false}
      />,
    );
    out.push(
      <Line
        key="trend-band-lo"
        type="monotone"
        data={band as unknown as Array<Record<string, number>>}
        dataKey="lo"
        xAxisId={0}
        yAxisId={0}
        stroke={accentLight}
        strokeWidth={1}
        strokeDasharray="2 3"
        dot={false}
        legendType="none"
        isAnimationActive={false}
      />,
    );
  }
  out.push(
    <Line
      key="trend-fit"
      type="monotone"
      data={fitLine as unknown as Array<Record<string, number>>}
      dataKey="y"
      xAxisId={0}
      yAxisId={0}
      stroke="var(--accent-2)"
      strokeWidth={2}
      dot={false}
      name={`${fit.equation}  ·  R² = ${formatNum(fit.r2, 3)}`}
      isAnimationActive={false}
    />,
  );
  return out;
}

/** Build ReferenceLine children for every entry in config.refLines.
 *  Resolves "mean"/"median" values against the supplied series.
 *
 *  Pass 3.14 fix: in a chart with multiple YAxes (any multi-Y plot,
 *  scatter with dual-axis, dual-Y, etc.) recharts requires every
 *  cartesian child to declare which axis it anchors to via yAxisId.
 *  Calling ReferenceLine without one throws and blanks the React
 *  tree. The caller passes the host axis id (typically "left") and
 *  we splice it into every ReferenceLine. For charts with only one
 *  YAxis (histogram, plain BarChart, etc.) the caller passes
 *  undefined and recharts auto-resolves. */
function referenceLineOverlay(
  config: PlotConfig,
  axisValues: { x: number[]; y: number[] },
  options?: { yAxisId?: string },
): React.ReactNode[] {
  const refs = config.refLines ?? [];
  if (refs.length === 0) return [];
  return refs.map((r, i) => {
    const series = r.axis === "x" ? axisValues.x : axisValues.y;
    let value: number | null = null;
    if (typeof r.value === "number") value = r.value;
    else if (r.value === "mean") value = statMean(series);
    else if (r.value === "median") value = statMedian(series);
    if (value == null || !Number.isFinite(value)) return null;
    const props: Record<string, unknown> = {
      stroke: r.color ?? "var(--accent-2)",
      strokeDasharray:
        r.style === "dotted" ? "2 4" : r.style === "dashed" ? "6 4" : undefined,
      strokeWidth: 1.5,
      label: r.label
        ? { value: r.label, fill: "var(--text-2)", fontSize: 11 }
        : undefined,
      isFront: false,
    };
    if (options?.yAxisId) props.yAxisId = options.yAxisId;
    if (r.axis === "x") props.x = value;
    else props.y = value;
    return <ReferenceLine key={`ref-${i}`} {...props} />;
  });
}

// =====================================================================
// Pass 3.13 — shared trendline helpers for non-scatter plots
// =====================================================================
//
// Every plot type that visualizes (x, y) pairs can host an overlay
// trendline. The math (fitRegression + regressionBand from plotStats)
// is the same; the only per-chart difference is how the fit's X
// values get back into chart-aligned points. Excel-style behaviour:
//
//   - If the X column is numeric → fit against the actual X values.
//     The chart's XAxis is numeric, so the fit Line plots at the
//     correct positions.
//   - If the X column is categorical (or any non-number type) → fit
//     against the row positional index (0, 1, 2, ...). The chart's
//     XAxis is categorical, so the fit Line plots at the same
//     positions as the data rows.
//
// computeTrendlineSeries returns null when a fit cannot be produced
// (fewer than 2 valid points, singular system, domain violation).
// Otherwise: { fit, fitPoints, bandPoints } where fitPoints align to
// the chart's xKey scheme via the xKeyName + xKeyValues mapping.

export interface TrendlineSeries {
  fit: ReturnType<typeof fitRegression>;
  /** Points along the fit curve, keyed so the chart's XAxis can find
   *  them. Each entry has `[xKeyName]: xValueOrCategory` + `__trend:
   *  yValue`. Always rendered on the same axis as the primary series. */
  fitPoints: Array<Record<string, number | string>>;
  /** Optional 95% prediction band — only populated when config
   *  requests it. Same xKey alignment as fitPoints; each entry has
   *  `lo` and `bandHeight` so the band can be drawn as a stacked Area
   *  (two Areas: invisible base at `lo`, filled overlay of height
   *  `bandHeight`). */
  bandPoints: Array<Record<string, number | string>>;
}

export function computeTrendlineSeries(params: {
  data: PlotData;
  xCol: number;
  yCol: number;
  xColType: "number" | "category" | "date";
  /** The key under which the chart's data rows store the X value
   *  (e.g. column name for line plots, "__t" for time-series). The
   *  returned fitPoints will use this same key so chart-level
   *  data-key matching works. */
  xKeyName: string;
  config: PlotConfig;
}): TrendlineSeries | null {
  const { data, xCol, yCol, xColType, xKeyName, config } = params;
  const kind = config.trendline?.kind ?? "none";
  if (kind === "none") return null;

  // Build aligned (xVal, yVal, xKey) triples. xVal is the numeric
  // value used by fitRegression; xKey is what gets serialized into
  // chart-level data (the X-axis cares about xKey, the fit cares
  // about xVal).
  const useNumericX = xColType === "number";
  const xs: number[] = [];
  const ys: number[] = [];
  const xKeys: Array<number | string> = [];
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i];
    const y = num(row, yCol);
    if (y == null) continue;
    if (useNumericX) {
      const x = num(row, xCol);
      if (x == null) continue;
      xs.push(x);
      ys.push(y);
      xKeys.push(x);
    } else {
      // Categorical or date: fit against the positional index, but
      // store the category string as xKey so the chart can match.
      xs.push(i);
      ys.push(y);
      const k = cat(row, xCol);
      xKeys.push(k || String(i));
    }
  }
  if (xs.length < 2) return null;
  const fit = fitRegression(xs, ys, kind);
  if (!fit) return null;

  // Evaluate the fit at every original x position so the curve
  // perfectly aligns with the chart's existing data. For curvature
  // (poly2, poly3, exp, log, power) we ALSO densify with a few
  // interpolated points BETWEEN the originals so the curve reads
  // smoothly — only meaningful for numeric X (categorical positions
  // are integers).
  const densify = useNumericX && kind !== "linear" && kind !== "none";
  const fitPoints: Array<Record<string, number | string>> = [];
  if (densify) {
    // Sort original xs ascending so interpolation is monotone.
    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const sortedXs = order.map((i) => xs[i]);
    const STEPS_PER_GAP = 6;
    for (let k = 0; k < sortedXs.length - 1; k++) {
      const a = sortedXs[k];
      const b = sortedXs[k + 1];
      for (let s = 0; s < STEPS_PER_GAP; s++) {
        const t = s / STEPS_PER_GAP;
        const x = a + t * (b - a);
        const yhat = evaluateFit(fit, x);
        if (Number.isFinite(yhat)) {
          fitPoints.push({ [xKeyName]: x, __trend: yhat });
        }
      }
    }
    // Last point.
    const lastX = sortedXs[sortedXs.length - 1];
    const lastY = evaluateFit(fit, lastX);
    if (Number.isFinite(lastY)) {
      fitPoints.push({ [xKeyName]: lastX, __trend: lastY });
    }
  } else {
    // Pass 3.14: sort points by X ascending so the trend line draws
    // monotonically left-to-right. Without this, scatter data fed in
    // random order would produce a back-and-forth zigzag that
    // recharts cannot render correctly.
    const order = xs
      .map((_, i) => i)
      .sort((a, b) => {
        if (typeof xs[a] === "number" && typeof xs[b] === "number") {
          return (xs[a] as number) - (xs[b] as number);
        }
        return 0;
      });
    for (const i of order) {
      const yhat = evaluateFit(fit, xs[i]);
      if (!Number.isFinite(yhat)) continue;
      fitPoints.push({ [xKeyName]: xKeys[i], __trend: yhat });
    }
  }

  let bandPoints: Array<Record<string, number | string>> = [];
  if (config.trendline?.showCi && useNumericX) {
    const band = regressionBand(fit, xs);
    bandPoints = band.map((b) => ({
      [xKeyName]: b.x,
      __trendLo: b.lo,
      __trendBandH: b.hi - b.lo,
    }));
  }

  return { fit, fitPoints, bandPoints };
}

/**
 * Build the trendline JSX children to be spliced into a chart. Caller
 * passes the result inline inside the chart's children list:
 *
 *   {trendline && renderTrendlineChildren({trendline, axisId, xKeyName})}
 *
 * Returns a React.Fragment containing one optional pair of Area
 * components (for the 95% CI band) plus a Line for the fit curve.
 * Recharts flattens fragments when traversing children, so this
 * works inside LineChart / AreaChart / ComposedChart / ScatterChart.
 */
export function renderTrendlineChildren(params: {
  trendline: TrendlineSeries;
  axisId: "left" | "right";
  /** The key the chart's XAxis reads. Used as a dataKey hint when
   *  the chart-level data uses categorical X. */
  xKeyName: string;
}): React.ReactNode {
  const { trendline, axisId } = params;
  if (!trendline.fit) return null;
  const showBand = trendline.bandPoints.length > 0;
  const trendName = `${trendline.fit.equation} · R² = ${formatNum(trendline.fit.r2, 3)}`;
  return (
    <>
      {showBand && (
        <>
          <Area
            yAxisId={axisId}
            data={trendline.bandPoints}
            dataKey="__trendLo"
            stackId="cortex-trend-band"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            yAxisId={axisId}
            data={trendline.bandPoints}
            dataKey="__trendBandH"
            stackId="cortex-trend-band"
            stroke="none"
            fill="color-mix(in oklab, var(--accent) 18%, transparent)"
            isAnimationActive={false}
            name="95% band"
          />
        </>
      )}
      <Line
        yAxisId={axisId}
        data={trendline.fitPoints}
        dataKey="__trend"
        type="monotone"
        stroke="var(--accent-2)"
        strokeWidth={2}
        // Pass 3.14 — Excel/Tableau convention: trendlines are dashed
        // so they read as overlays rather than another data series.
        strokeDasharray="6 4"
        dot={false}
        activeDot={false}
        isAnimationActive={false}
        name={trendName}
      />
    </>
  );
}

// =====================================================================
// ECDF (F23) — empirical cumulative distribution
// =====================================================================

function EcdfPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const col = config.mapping?.x ?? config.mapping?.y ?? 0;
  const colName = data.columns[col]?.name ?? "value";

  const points = useMemo(() => {
    const vals = data.rows
      .map((r) => num(r, col))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return vals.map((x, i) => ({ x, cdf: (i + 1) / vals.length }));
  }, [data, col]);

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart
        data={points}
        margin={{ top: 16, right: 24, bottom: 24, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          type="number"
          dataKey="x"
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
          name={colName}
        />
        <YAxis
          type="number"
          dataKey="cdf"
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={[0, 1]}
          tickFormatter={(v) => v.toFixed(2)}
          name="P(X ≤ x)"
        />
        <Line
          type="stepAfter"
          dataKey="cdf"
          stroke={colorForSeries(0, config)}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name="ECDF"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Q-Q plot vs normal (F24)
// =====================================================================
//
// Plots (theoretical normal quantile, sample value). A 45° reference
// line through the mean ± stdev would land at the data; we instead
// fit the visual rule line via least-squares so it lands cleanly even
// for non-zero mean / non-unit variance distributions.

function QQPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const col = config.mapping?.x ?? config.mapping?.y ?? 0;
  const colName = data.columns[col]?.name ?? "value";

  const { points, fit } = useMemo(() => {
    const sorted = data.rows
      .map((r) => num(r, col))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const n = sorted.length;
    const pts = sorted.map((y, i) => {
      // Blom plotting position: (i + 1 - 3/8) / (n + 1/4).
      const p = (i + 1 - 0.375) / (n + 0.25);
      const theo = normalInvCdf(p);
      return { x: theo, y };
    });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const f = fitRegression(xs, ys, "linear");
    return { points: pts, fit: f };
  }, [data, col]);

  const fitLine = useMemo(() => {
    if (!fit) return [];
    return regressionBand(
      fit,
      points.map((p) => p.x),
      0,
    ).map((b) => ({
      x: b.x,
      y: b.y,
    }));
  }, [fit, points]);

  return (
    <ResponsiveContainer width={width} height={height}>
      <ComposedChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        <CommonChartElements config={config} />
        <XAxis
          type="number"
          dataKey="x"
          name="Theoretical quantile"
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={colName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        {fitLine.length > 0 && (
          <Line
            type="linear"
            data={fitLine as unknown as Array<Record<string, number>>}
            dataKey="y"
            stroke="var(--accent-2)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            dot={false}
            name="Reference (linear fit)"
            isAnimationActive={false}
          />
        )}
        <Scatter
          data={points as unknown as Array<Record<string, number>>}
          fill={colorForSeries(0, config)}
          isAnimationActive={false}
          name={colName}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Bland-Altman (F25) — method-comparison plot
// =====================================================================

function BlandAltmanPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const m1Col = config.mapping?.x ?? 0;
  const m2Col = config.mapping?.y ?? 1;
  const m1Name = data.columns[m1Col]?.name ?? "method 1";
  const m2Name = data.columns[m2Col]?.name ?? "method 2";

  const stats = useMemo(() => {
    const m1 = data.rows
      .map((r) => num(r, m1Col))
      .filter((v): v is number => v != null);
    const m2 = data.rows
      .map((r) => num(r, m2Col))
      .filter((v): v is number => v != null);
    return blandAltman(m1, m2);
  }, [data, m1Col, m2Col]);

  return (
    <ResponsiveContainer width={width} height={height}>
      <ScatterChart margin={{ top: 16, right: 32, bottom: 24, left: 8 }}>
        <CommonChartElements config={config} />
        <XAxis
          type="number"
          dataKey="x"
          name={`mean(${m1Name}, ${m2Name})`}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={`${m1Name} − ${m2Name}`}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        <ReferenceLine
          y={stats.meanDiff}
          stroke="var(--accent)"
          strokeWidth={1.5}
          label={{
            value: `Mean = ${formatNum(stats.meanDiff)}`,
            fill: "var(--accent)",
            fontSize: 11,
            position: "right",
          }}
        />
        <ReferenceLine
          y={stats.upper}
          stroke="var(--accent-2)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          label={{
            value: `+1.96σ = ${formatNum(stats.upper)}`,
            fill: "var(--accent-2)",
            fontSize: 11,
            position: "right",
          }}
        />
        <ReferenceLine
          y={stats.lower}
          stroke="var(--accent-2)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          label={{
            value: `−1.96σ = ${formatNum(stats.lower)}`,
            fill: "var(--accent-2)",
            fontSize: 11,
            position: "right",
          }}
        />
        <Scatter
          data={stats.points as unknown as Array<Record<string, number>>}
          fill={colorForSeries(0, config)}
          isAnimationActive={false}
          name="agreement"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Regression with fit + CI band (F26)
// =====================================================================

function RegressionPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const yCol = config.mapping?.y ?? 1;
  const xName = data.columns[xCol]?.name ?? "x";
  const yName = data.columns[yCol]?.name ?? "y";
  const kind: RegressionKind = (
    config.trendline?.kind === "none" || !config.trendline?.kind
      ? "linear"
      : config.trendline.kind
  ) as RegressionKind;

  const { points, fit, band, fitLine } = useMemo(() => {
    const pts = data.rows
      .map((r) => ({ x: num(r, xCol), y: num(r, yCol) }))
      .filter((p): p is { x: number; y: number } => p.x != null && p.y != null);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const f = fitRegression(xs, ys, kind);
    const b = f ? regressionBand(f, xs) : [];
    const fl = f ? regressionBand(f, xs, 0) : [];
    return { points: pts, fit: f, band: b, fitLine: fl };
  }, [data, xCol, yCol, kind]);

  // Merge fitLine and band into one structure for the ComposedChart.
  // Each entry holds { x, fit, lo, hi } so a single LineChart can show
  // the fit curve and a stacked area / dashed bounds for the band.
  const merged = useMemo(() => {
    return fitLine.map((p, i) => ({
      x: p.x,
      fit: p.y,
      lo: band[i]?.lo ?? p.y,
      hi: band[i]?.hi ?? p.y,
      bandHeight: (band[i]?.hi ?? p.y) - (band[i]?.lo ?? p.y),
    }));
  }, [fitLine, band]);

  const showBand = config.trendline?.showCi !== false;

  return (
    <ResponsiveContainer width={width} height={height}>
      <ComposedChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        <CommonChartElements config={config} />
        <XAxis
          type="number"
          dataKey="x"
          name={xName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        {/* Confidence band as a stacked Area: invisible base at `lo`
            and a filled overlay of height (hi - lo). */}
        {showBand && merged.length > 0 && (
          <>
            <Area
              data={merged as unknown as Array<Record<string, number>>}
              dataKey="lo"
              stackId="band"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
            />
            <Area
              data={merged as unknown as Array<Record<string, number>>}
              dataKey="bandHeight"
              stackId="band"
              stroke="none"
              fill="color-mix(in oklab, var(--accent) 18%, transparent)"
              isAnimationActive={false}
              name="95% band"
            />
          </>
        )}
        <Line
          data={merged as unknown as Array<Record<string, number>>}
          dataKey="fit"
          type="monotone"
          stroke="var(--accent-2)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name={
            fit ? `${fit.equation}  ·  R² = ${formatNum(fit.r2, 3)}` : "fit"
          }
        />
        <Scatter
          data={points as unknown as Array<Record<string, number>>}
          fill={colorForSeries(0, config)}
          isAnimationActive={false}
          name={yName}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Residual plot (F27)
// =====================================================================

function ResidualPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const yCol = config.mapping?.y ?? 1;
  const xName = data.columns[xCol]?.name ?? "x";
  const kind: RegressionKind = (
    config.trendline?.kind === "none" || !config.trendline?.kind
      ? "linear"
      : config.trendline.kind
  ) as RegressionKind;

  const residuals = useMemo(() => {
    const pts = data.rows
      .map((r) => ({ x: num(r, xCol), y: num(r, yCol) }))
      .filter((p): p is { x: number; y: number } => p.x != null && p.y != null);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const fit = fitRegression(xs, ys, kind);
    if (!fit) return [];
    return pts.map((p) => ({ x: p.x, y: p.y - evaluateFit(fit, p.x) }));
  }, [data, xCol, yCol, kind]);

  return (
    <ResponsiveContainer width={width} height={height}>
      <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        <CommonChartElements config={config} />
        <XAxis
          type="number"
          dataKey="x"
          name={xName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="residual"
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          domain={["auto", "auto"]}
        />
        <ReferenceLine
          y={0}
          stroke="var(--accent-2)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        <Scatter
          data={residuals as unknown as Array<Record<string, number>>}
          fill={colorForSeries(0, config)}
          isAnimationActive={false}
          name="residual"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Time-series (F28) — date-aware X axis
// =====================================================================

function TimeseriesPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const ySeries = config.mapping?.ySeries ?? [config.mapping?.y ?? 1];
  const xName = data.columns[xCol]?.name ?? "date";

  // Coerce dates into ms-since-epoch so Recharts can plot them on a
  // numeric axis with smart tick formatting. Non-parseable rows drop.
  const rows = useMemo(() => {
    return data.rows
      .map((r) => {
        const raw = r[xCol];
        let t: number | null = null;
        if (typeof raw === "number") t = raw;
        else if (typeof raw === "string") {
          const parsed = Date.parse(raw);
          t = Number.isFinite(parsed) ? parsed : null;
        }
        if (t == null) return null;
        const obj: Record<string, number | string | null> = { __t: t };
        for (const yc of ySeries) {
          obj[data.columns[yc]?.name ?? `y${yc}`] = num(r, yc);
        }
        return obj;
      })
      .filter((p): p is Record<string, number | string | null> => p != null)
      .sort((a, b) => ((a.__t as number) ?? 0) - ((b.__t as number) ?? 0));
  }, [data, xCol, ySeries]);

  const tickFmt = (t: number) => {
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    return d.toISOString().slice(0, 10);
  };

  // Pass 3.11: explicit name props on every series so the legend has
  // unambiguous labels. Bottom margin bumped to make room for the
  // legend (the rotated date ticks already eat ~24 px alone).
  const dotR = config.dotSize ?? 2.5;

  // Pass 3.13 — trendline against the first Y series. We pass
  // xColType: "number" so the fit uses the actual timestamps
  // (ms since epoch). xKeyName is "__t" — the same numeric key
  // the chart's XAxis reads, so the trend Line aligns perfectly.
  const trendline = useMemo(
    () =>
      ySeries.length > 0
        ? computeTrendlineSeries({
            data: {
              ...data,
              // Replace the X column's type with "number" for the
              // trendline math, since we coerce date strings to
              // numeric timestamps in the chart's rows mapping below.
              columns: data.columns.map((c, i) =>
                i === xCol ? { ...c, type: "number" } : c,
              ),
              // And replace each row's X cell with the parsed
              // timestamp so num() returns it as a number.
              rows: data.rows.map((r) => {
                const next = r.slice();
                const raw = r[xCol];
                if (typeof raw === "string") {
                  const t = Date.parse(raw);
                  if (Number.isFinite(t)) next[xCol] = t;
                }
                return next;
              }),
            },
            xCol,
            yCol: ySeries[0],
            xColType: "number",
            xKeyName: "__t",
            config,
          })
        : null,
    [data, xCol, ySeries, config],
  );
  // Pass 4.16 — axis extents + colors. Timeseries always uses numeric
  // X (ms since epoch), single left Y (no right axis).
  const tsYExt = useMemo<[number, number] | null>(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const r of rows) {
      for (const yc of ySeries) {
        const v = r[data.columns[yc]?.name ?? `y${yc}`];
        const n = typeof v === "number" ? v : NaN;
        if (Number.isFinite(n)) {
          if (n < lo) lo = n;
          if (n > hi) hi = n;
        }
      }
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
  }, [rows, ySeries, data.columns]);
  const tsXExt = useMemo<[number, number] | null>(() => {
    if (rows.length === 0) return null;
    let lo = Infinity,
      hi = -Infinity;
    for (const r of rows) {
      const t = r.__t as number;
      if (Number.isFinite(t)) {
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
  }, [rows]);
  const tsColorL = axisColorForSide(config, ySeries, "left");

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart
        data={rows}
        margin={{ top: 16, right: 24, bottom: 40, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          type="number"
          dataKey="__t"
          domain={["dataMin", "dataMax"]}
          tickFormatter={tickFmt}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          name={xName}
          {...(buildXAxisProps(config, "number", tsXExt) as any)}
        />
        <YAxis
          stroke={tsColorL}
          tick={{ fill: tsColorL, fontSize: 11 }}
          {...(buildYAxisProps(config, "left", tsYExt) as any)}
        />
        {ySeries.map((yc, i) => {
          const yName = data.columns[yc]?.name ?? `y${i}`;
          const color = config.seriesColors?.[yc] ?? colorForSeries(i, config);
          const lineCfg = config.seriesLine?.[yc];
          return (
            <Line
              key={yName + i}
              type="monotone"
              name={yName}
              dataKey={yName}
              stroke={color}
              strokeWidth={lineCfg?.width ?? 2}
              dot={{ r: dotR, fill: color }}
              activeDot={{ r: dotR + 2 }}
              isAnimationActive={false}
            />
          );
        })}
        {trendline &&
          renderTrendlineChildren({
            trendline,
            axisId: "left",
            xKeyName: "__t",
          })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// =====================================================================
// Dual-Y axis (F29) — two metrics on different scales
// =====================================================================

function DualYPlot({ payload, width, height }: PlotRendererProps) {
  const { data, config } = payload;
  const xCol = config.mapping?.x ?? 0;
  const ySeries = config.mapping?.ySeries ?? [
    config.mapping?.y ?? 1,
    config.mapping?.y ?? 2,
  ];
  const yLeft = ySeries[0] ?? 1;
  const yRight = ySeries[1] ?? 2;
  const xName = data.columns[xCol]?.name ?? "x";
  const xColType = data.columns[xCol]?.type ?? "category";
  const yLeftName = data.columns[yLeft]?.name ?? "left";
  const yRightName = data.columns[yRight]?.name ?? "right";
  const rows = toObjects(data);

  // Pass 3.13 — trendline against the LEFT-axis series. Dual-Y plots
  // have two independent scales by definition; fitting a single
  // trendline only makes sense for one of them, and the left series
  // is the conventional "primary" choice (Excel does the same).
  const trendline = useMemo(
    () =>
      computeTrendlineSeries({
        data,
        xCol,
        yCol: yLeft,
        xColType,
        xKeyName: xName,
        config,
      }),
    [data, xCol, yLeft, xColType, xName, config],
  );

  // Pass 4.16 — extents + colors. Dual-Y forces ySeriesAxis assignment
  // (first series = left, second = right) so axisColorForSide sees a
  // single-series-per-side mapping and returns the series color.
  const dualAxisOverride: Record<number, "left" | "right"> = {
    [yLeft]: "left",
    [yRight]: "right",
  };
  const dualExt = useMemo(
    () =>
      computeAxisExtents(
        data,
        xCol,
        [yLeft, yRight],
        dualAxisOverride,
        xColType === "number",
      ),
    [data, xCol, yLeft, yRight, dualAxisOverride, xColType],
  );
  const dualColorL = config.seriesColors?.[yLeft] ?? colorForSeries(0, config);
  const dualColorR = config.seriesColors?.[yRight] ?? colorForSeries(1, config);

  return (
    <ResponsiveContainer width={width} height={height}>
      <ComposedChart
        data={rows}
        margin={{ top: 16, right: 32, bottom: 32, left: 8 }}
      >
        <CommonChartElements config={config} />
        <XAxis
          dataKey={xName}
          stroke="var(--text-2)"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          {...(buildXAxisProps(
            config,
            xColType === "number" ? "number" : "category",
            dualExt.x,
          ) as any)}
        />
        <YAxis
          yAxisId="left"
          orientation="left"
          stroke={dualColorL}
          tick={{ fill: dualColorL, fontSize: 11 }}
          {...(buildYAxisProps(config, "left", dualExt.yLeft) as any)}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke={dualColorR}
          tick={{ fill: dualColorR, fontSize: 11 }}
          {...(buildYAxisProps(config, "right", dualExt.yRight) as any)}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey={yLeftName}
          stroke={colorForSeries(0, config)}
          strokeWidth={2}
          dot={{ r: 3, fill: colorForSeries(0, config) }}
          isAnimationActive={false}
          name={yLeftName}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey={yRightName}
          stroke={colorForSeries(1, config)}
          strokeWidth={2}
          dot={{ r: 3, fill: colorForSeries(1, config) }}
          isAnimationActive={false}
          name={yRightName}
        />
        {trendline &&
          renderTrendlineChildren({
            trendline,
            axisId: "left",
            xKeyName: xName,
          })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface PlotByTypeProps extends PlotRendererProps {
  plotType: CortexPlotType;
}

/**
 * Main entry point — dispatches to the right renderer for the active
 * plot type. Each renderer owns its own `ResponsiveContainer` and
 * receives the real `width` + `height` so the underlying recharts
 * chart sizes correctly. (Earlier attempt wrapped a custom component
 * in ResponsiveContainer and relied on React.cloneElement to inject
 * width/height into the wrapper — that injection landed on the
 * wrapper's props instead of reaching the recharts chart inside, and
 * the chart never rendered. Each renderer now ResponsiveContainer-s
 * its own ScatterChart / LineChart / etc. directly, which is what
 * cloneElement expects.)
 */
export function PlotByType({
  payload,
  width,
  height,
  plotType,
}: PlotByTypeProps) {
  switch (plotType) {
    case "scatter":
      return <ScatterPlot payload={payload} width={width} height={height} />;
    case "line":
      return <LinePlot payload={payload} width={width} height={height} />;
    case "area":
      return <AreaPlot payload={payload} width={width} height={height} />;
    case "bar":
      return <BarPlot payload={payload} width={width} height={height} />;
    case "bar-horizontal":
      return (
        <BarPlot payload={payload} width={width} height={height} horizontal />
      );
    case "histogram":
      return <HistogramPlot payload={payload} width={width} height={height} />;
    case "pie":
      return <PiePlot payload={payload} width={width} height={height} />;
    case "error-bar":
      return <ErrorBarPlot payload={payload} width={width} height={height} />;
    // Pass 2 — statistical / time / multi-axis plot types
    case "ecdf":
      return <EcdfPlot payload={payload} width={width} height={height} />;
    case "qq":
      return <QQPlot payload={payload} width={width} height={height} />;
    case "bland-altman":
      return (
        <BlandAltmanPlot payload={payload} width={width} height={height} />
      );
    case "regression":
      return <RegressionPlot payload={payload} width={width} height={height} />;
    case "residual":
      return <ResidualPlot payload={payload} width={width} height={height} />;
    case "timeseries":
      return <TimeseriesPlot payload={payload} width={width} height={height} />;
    case "dual-y":
      return <DualYPlot payload={payload} width={width} height={height} />;
    default:
      return <ScatterPlot payload={payload} width={width} height={height} />;
  }
}

// Re-export overlay helpers so the sidebar Statistics section can
// surface trendline + reference-line controls. The helpers themselves
// are consumed inside scatter/line for inline overlay rendering.
export { trendlineOverlay, referenceLineOverlay };

// Pass-2 features (preview lines for reference-line / trendline) live
// outside this file to keep the renderers focused. The wrapping
// NodeView in CortexPlotNodeView.tsx layers them on top of the
// ResponsiveContainer when config.refLines or config.trendline is set.
export const REFERENCE_LINE_HOOK = ReferenceLine;
