// TimeTracking — Cluster 14 v1.0.
//
// Per-category planned-vs-actual analytics for calendar events. Shows
// total planned minutes (computed from end_at - start_at), total actual
// minutes (summed from each event's `actual_minutes` post-hoc field),
// the ratio, and a count of events.
//
// Date range presets: 7 days / 30 days / 90 days / All time. Anchored
// at "now" (so "30 days" is the rolling 30-day window ending today).
//
// Three view modes: a flat table (default), a large SVG pie chart
// with category-coloured slices (Cluster 14 v1.2), and a Trends tab
// (Cluster 14 v1.3) showing per-day planned vs actual time over the
// selected window via a hand-drawn SVG line chart. The pie has a
// sub-toggle for what the slices represent — "Planned" (every event
// contributes its scheduled duration) or "Actual" (recurring events
// auto-credit, non-recurring use the user's recorded actual_minutes).
//
// Cluster 14 v1.3 also adds a "Copy CSV" toolbar button that emits
// the current per-category aggregates (Category / Planned / Actual /
// Ratio / Events / Events with actual) as CSV to the clipboard.
//
// Rendered as a structured-view component in the same slot pattern as
// IdeaLog / MethodsArsenal / ProtocolsLog. Sidebar button in App.tsx
// switches the active slot's view to "time-tracking"; TabPane.tsx
// renders this component when activeView matches.
//
// Recurring events: each instance auto-credited as fully spent in
// both the planned and actual totals (Cluster 14 v1.1), with optional
// per-instance overrides (skip / different actual_minutes) honoured
// at expansion time (Cluster 14 v1.3).

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface TimeTrackingRow {
  category: string;
  planned_minutes_total: number;
  actual_minutes_total: number;
  events_count: number;
  events_with_actual_count: number;
}

interface TimeTrackingProps {
  vaultPath: string;
  /** Bumps from App when an event save lands; used to trigger refetch. */
  refreshKey: number;
  onClose: () => void;
}

type RangePreset = "7d" | "30d" | "90d" | "all";

const RANGE_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

/** Cluster 14 v1.2/v1.3 — view-mode tab toggle. */
type ViewMode = "table" | "pie" | "trends";

/** Cluster 14 v1.2 — which metric the pie slices size by. */
type PieMetric = "planned" | "actual";

/** Cluster 14 v1.3 — which line(s) the trends chart shows. */
type TrendsMetric = "planned" | "actual" | "both";

/** Cluster 14 v1.3 — one row from get_time_tracking_daily_rollup. */
interface DailyRollupRow {
  day_iso: string;
  category: string;
  planned_minutes: number;
  actual_minutes: number;
  events_count: number;
}

/**
 * Fixed palette of distinguishable colours for pie slices. Categories
 * map into this via a stable string hash so the same category always
 * renders in the same colour across reloads. 12 colours covers most
 * realistic vault sizes; collisions degrade gracefully (two categories
 * share a colour but stay separate slices).
 */
const PIE_PALETTE = [
  "#6ca0dc", // blue (matches accent)
  "#22a06b", // green
  "#f59e0b", // amber
  "#f87171", // coral
  "#a78bfa", // violet
  "#14b8a6", // teal
  "#ec4899", // pink
  "#fbbf24", // yellow
  "#60a5fa", // sky
  "#34d399", // mint
  "#fb923c", // orange
  "#c084fc", // purple
];

function categoryColour(category: string): string {
  // 32-bit FNV-1a hash — stable, fast, no deps.
  let h = 0x811c9dc5;
  for (let i = 0; i < category.length; i++) {
    h ^= category.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to unsigned 32-bit and index into the palette.
  return PIE_PALETTE[(h >>> 0) % PIE_PALETTE.length];
}

/**
 * Compute (rangeStartUnix, rangeEndUnix) for a preset, anchored at
 * "now". `all` returns a window so wide every event falls inside it.
 */
function computeRange(preset: RangePreset): { start: number; end: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  if (preset === "all") {
    // Unix epoch 0 → far future. ~year 9999 in seconds.
    return { start: 0, end: 253402300800 };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const start = nowSec - days * 86400;
  return { start, end: nowSec + 86400 }; // include today
}

function formatMinutes(min: number): string {
  if (min === 0) return "0m";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  const rem = min - hours * 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

/**
 * ratioColour returns a CSS variable for the ratio cell:
 *   - undefined planned or zero rows with actuals → muted
 *   - ratio < 0.9 (came in well under) → success-coloured
 *   - 0.9 ≤ ratio ≤ 1.2 → text colour (on track)
 *   - ratio > 1.2 (significantly over) → danger
 */
function ratioColour(
  planned: number,
  actual: number,
  withActual: number,
): string {
  if (planned === 0 || withActual === 0) return "var(--text-muted)";
  const ratio = actual / planned;
  if (ratio < 0.9) return "var(--success, #22a06b)";
  if (ratio > 1.2) return "var(--danger)";
  return "var(--text)";
}

function formatRatio(
  planned: number,
  actual: number,
  withActual: number,
): string {
  if (planned === 0 || withActual === 0) return "—";
  const ratio = actual / planned;
  return `${ratio.toFixed(2)}×`;
}

export function TimeTracking({
  vaultPath,
  refreshKey,
  onClose,
}: TimeTrackingProps) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [rows, setRows] = useState<TimeTrackingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Cluster 14 v1.2/v1.3 — tab toggle and per-tab metric selectors.
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [pieMetric, setPieMetric] = useState<PieMetric>("planned");
  const [trendsMetric, setTrendsMetric] = useState<TrendsMetric>("both");
  const [trendsRows, setTrendsRows] = useState<DailyRollupRow[] | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [csvCopied, setCsvCopied] = useState(false);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    const { start, end } = computeRange(preset);
    setLoading(true);
    setError(null);
    invoke<TimeTrackingRow[]>("get_time_tracking_aggregates", {
      vaultPath,
      rangeStartUnix: start,
      rangeEndUnix: end,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, preset, refreshKey]);

  // Cluster 14 v1.3 — fetch the per-day rollup whenever the user is
  // looking at the Trends tab. We only fetch when the tab is visible
  // so a user who never opens Trends doesn't pay the daily-bin cost.
  useEffect(() => {
    if (!vaultPath) return;
    if (viewMode !== "trends") return;
    let cancelled = false;
    const { start, end } = computeRange(preset);
    setTrendsError(null);
    invoke<DailyRollupRow[]>("get_time_tracking_daily_rollup", {
      vaultPath,
      rangeStartUnix: start,
      rangeEndUnix: end,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    })
      .then((res) => {
        if (cancelled) return;
        setTrendsRows(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setTrendsError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, preset, refreshKey, viewMode]);

  // Compute overall total at the top: sum across all rows.
  const overall = useMemo(() => {
    if (!rows || rows.length === 0) {
      return {
        planned: 0,
        actual: 0,
        eventsCount: 0,
        withActual: 0,
      };
    }
    return rows.reduce(
      (acc, r) => ({
        planned: acc.planned + r.planned_minutes_total,
        actual: acc.actual + r.actual_minutes_total,
        eventsCount: acc.eventsCount + r.events_count,
        withActual: acc.withActual + r.events_with_actual_count,
      }),
      { planned: 0, actual: 0, eventsCount: 0, withActual: 0 },
    );
  }, [rows]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Time tracking</h1>
          <div style={styles.subtitle}>
            Planned vs actual time per category. Recurring events auto-credit
            each instance as fully spent; for one-off events, fill in
            &quot;Actual minutes&quot; after they happen.
          </div>
        </div>
        <button onClick={onClose} style={styles.closeBtn} title="Close">
          ✕
        </button>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.rangePicker}>
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              style={{
                ...styles.rangeBtn,
                background: p === preset ? "var(--accent-bg-2)" : "transparent",
                borderColor: p === preset ? "var(--accent)" : "var(--border)",
                color: p === preset ? "var(--accent)" : "var(--text-2)",
              }}
            >
              {RANGE_LABELS[p]}
            </button>
          ))}
        </div>
        {/* Cluster 14 v1.2 — view-mode tab toggle. */}
        <div style={styles.tabPicker}>
          <button
            onClick={() => setViewMode("table")}
            style={{
              ...styles.rangeBtn,
              background:
                viewMode === "table" ? "var(--accent-bg-2)" : "transparent",
              borderColor:
                viewMode === "table" ? "var(--accent)" : "var(--border)",
              color: viewMode === "table" ? "var(--accent)" : "var(--text-2)",
            }}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode("pie")}
            style={{
              ...styles.rangeBtn,
              background:
                viewMode === "pie" ? "var(--accent-bg-2)" : "transparent",
              borderColor:
                viewMode === "pie" ? "var(--accent)" : "var(--border)",
              color: viewMode === "pie" ? "var(--accent)" : "var(--text-2)",
            }}
          >
            Pie chart
          </button>
          <button
            onClick={() => setViewMode("trends")}
            style={{
              ...styles.rangeBtn,
              background:
                viewMode === "trends" ? "var(--accent-bg-2)" : "transparent",
              borderColor:
                viewMode === "trends" ? "var(--accent)" : "var(--border)",
              color: viewMode === "trends" ? "var(--accent)" : "var(--text-2)",
            }}
          >
            Trends
          </button>
        </div>
        {viewMode === "pie" && rows && rows.length > 0 && (
          <div style={styles.metricPicker}>
            <button
              onClick={() => setPieMetric("planned")}
              style={{
                ...styles.smallBtn,
                background:
                  pieMetric === "planned"
                    ? "var(--accent-bg-2)"
                    : "transparent",
                borderColor:
                  pieMetric === "planned" ? "var(--accent)" : "var(--border)",
                color:
                  pieMetric === "planned" ? "var(--accent)" : "var(--text-2)",
              }}
            >
              By planned
            </button>
            <button
              onClick={() => setPieMetric("actual")}
              style={{
                ...styles.smallBtn,
                background:
                  pieMetric === "actual" ? "var(--accent-bg-2)" : "transparent",
                borderColor:
                  pieMetric === "actual" ? "var(--accent)" : "var(--border)",
                color:
                  pieMetric === "actual" ? "var(--accent)" : "var(--text-2)",
              }}
            >
              By actual
            </button>
          </div>
        )}
        {viewMode === "trends" && trendsRows && trendsRows.length > 0 && (
          <div style={styles.metricPicker}>
            {(["planned", "actual", "both"] as TrendsMetric[]).map((m) => (
              <button
                key={m}
                onClick={() => setTrendsMetric(m)}
                style={{
                  ...styles.smallBtn,
                  background:
                    trendsMetric === m ? "var(--accent-bg-2)" : "transparent",
                  borderColor:
                    trendsMetric === m ? "var(--accent)" : "var(--border)",
                  color: trendsMetric === m ? "var(--accent)" : "var(--text-2)",
                }}
              >
                {m === "planned"
                  ? "Planned"
                  : m === "actual"
                    ? "Actual"
                    : "Both"}
              </button>
            ))}
          </div>
        )}
        {/* Cluster 14 v1.3 — CSV export. Always available; emits the
            current per-category aggregates (the Table view's rows). */}
        {rows && rows.length > 0 && (
          <button
            onClick={async () => {
              const header = [
                "category",
                "planned_minutes",
                "actual_minutes",
                "ratio",
                "events",
                "events_with_actual",
              ].join(",");
              const lines = [
                `# Cortex time tracking — ${RANGE_LABELS[preset]} — ${rows!.length} categor${rows!.length === 1 ? "y" : "ies"}`,
                header,
                ...rows!.map((r) => {
                  const planned = r.planned_minutes_total;
                  const actual = r.actual_minutes_total;
                  const ratio =
                    planned > 0 && r.events_with_actual_count > 0
                      ? (actual / planned).toFixed(3)
                      : "";
                  // Quote values containing commas / quotes per RFC 4180.
                  const cat = /[,"\n]/.test(r.category)
                    ? `"${r.category.replace(/"/g, '""')}"`
                    : r.category || "(uncategorized)";
                  return [
                    cat,
                    planned,
                    actual,
                    ratio,
                    r.events_count,
                    r.events_with_actual_count,
                  ].join(",");
                }),
              ];
              const csv = lines.join("\n");
              try {
                await navigator.clipboard.writeText(csv);
                setCsvCopied(true);
                setTimeout(() => setCsvCopied(false), 1500);
              } catch (e) {
                console.warn("[TimeTracking] CSV copy failed:", e);
              }
            }}
            style={styles.smallBtn}
            title="Copy per-category aggregates as CSV to the clipboard"
          >
            {csvCopied ? "Copied ✓" : "Copy CSV"}
          </button>
        )}
        {loading && <span style={styles.loadingHint}>Loading…</span>}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {rows && rows.length === 0 && !loading && !error && (
        <div style={styles.empty}>
          No events in this window. Create calendar events (recurring ones are
          auto-credited; one-off events get an &quot;Actual minutes&quot; field
          you fill in post-hoc) and they will populate this view.
        </div>
      )}

      {rows && rows.length > 0 && viewMode === "table" && (
        <>
          <div style={styles.overallCard}>
            <div style={styles.overallStat}>
              <div style={styles.statLabel}>Planned</div>
              <div style={styles.statValue}>
                {formatMinutes(overall.planned)}
              </div>
            </div>
            <div style={styles.overallStat}>
              <div style={styles.statLabel}>Actual</div>
              <div style={styles.statValue}>
                {formatMinutes(overall.actual)}
              </div>
            </div>
            <div style={styles.overallStat}>
              <div style={styles.statLabel}>Ratio</div>
              <div
                style={{
                  ...styles.statValue,
                  color: ratioColour(
                    overall.planned,
                    overall.actual,
                    overall.withActual,
                  ),
                }}
              >
                {formatRatio(
                  overall.planned,
                  overall.actual,
                  overall.withActual,
                )}
              </div>
            </div>
            <div style={styles.overallStat}>
              <div style={styles.statLabel}>Events</div>
              <div style={styles.statValue}>
                {overall.eventsCount}
                <span style={styles.statSubLabel}>
                  {" "}
                  ({overall.withActual} with actual)
                </span>
              </div>
            </div>
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Category</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Planned</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Actual</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Ratio</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Events</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category}>
                  <td style={styles.td}>{r.category || "(uncategorized)"}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    {formatMinutes(r.planned_minutes_total)}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    {r.events_with_actual_count > 0
                      ? formatMinutes(r.actual_minutes_total)
                      : "—"}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      color: ratioColour(
                        r.planned_minutes_total,
                        r.actual_minutes_total,
                        r.events_with_actual_count,
                      ),
                      fontWeight: 600,
                    }}
                  >
                    {formatRatio(
                      r.planned_minutes_total,
                      r.actual_minutes_total,
                      r.events_with_actual_count,
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    {r.events_count}
                    <span style={styles.statSubLabel}>
                      {" "}
                      ({r.events_with_actual_count})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={styles.legend}>
            Ratio &lt; 0.9× → green (came in under estimate). Ratio &gt; 1.2× →
            red (significantly over). Counts in parentheses are the events with
            an &quot;Actual minutes&quot; recorded.
          </div>
        </>
      )}

      {rows && rows.length > 0 && viewMode === "pie" && (
        <PieChart rows={rows} metric={pieMetric} />
      )}

      {viewMode === "trends" && (
        <TrendsView
          rows={trendsRows}
          metric={trendsMetric}
          error={trendsError}
        />
      )}
    </div>
  );
}

/**
 * Cluster 14 v1.2 — large inline SVG pie chart over the per-category
 * rows. No external library; we compute slice arc paths by hand.
 *
 * Design choices:
 *   - Diameter is fixed at 360px (large enough to read; small enough
 *     to share the slot with the legend column on the right).
 *   - Slices sized by `metric` (planned or actual minutes).
 *   - Categories with zero contribution under the chosen metric are
 *     dropped from the chart (they'd render as zero-width slices and
 *     clutter the legend).
 *   - Colours are deterministic via categoryColour() — same category,
 *     same colour across reloads.
 *   - Each slice gets a <title> tooltip (browser native) for accessibility.
 *   - Legend is a stacked list to the right of the pie with the colour
 *     swatch, category name, percentage, and formatted minutes.
 */
function PieChart({
  rows,
  metric,
}: {
  rows: TimeTrackingRow[];
  metric: PieMetric;
}) {
  const slices = useMemo(() => {
    const filtered = rows
      .map((r) => ({
        category: r.category,
        value:
          metric === "planned"
            ? r.planned_minutes_total
            : r.actual_minutes_total,
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value); // largest first
    const total = filtered.reduce((sum, s) => sum + s.value, 0);
    return { items: filtered, total };
  }, [rows, metric]);

  if (slices.total === 0) {
    return (
      <div style={styles.empty}>
        No {metric} time recorded in this window. Switch metric or fill in
        &quot;Actual minutes&quot; on completed events.
      </div>
    );
  }

  const SIZE = 360;
  const RADIUS = SIZE / 2 - 10; // 10px breathing room
  const CX = SIZE / 2;
  const CY = SIZE / 2;

  // Build slice paths. SVG arcs need start point, end point, radius,
  // large-arc flag, sweep flag. We build each slice as a wedge from
  // the centre.
  let cursor = -Math.PI / 2; // start at 12 o'clock
  const paths: Array<{
    d: string;
    colour: string;
    category: string;
    pct: number;
    value: number;
  }> = [];
  for (const s of slices.items) {
    const fraction = s.value / slices.total;
    const angle = fraction * Math.PI * 2;
    const x1 = CX + RADIUS * Math.cos(cursor);
    const y1 = CY + RADIUS * Math.sin(cursor);
    const end = cursor + angle;
    const x2 = CX + RADIUS * Math.cos(end);
    const y2 = CY + RADIUS * Math.sin(end);
    const largeArc = angle > Math.PI ? 1 : 0;

    let d: string;
    if (slices.items.length === 1) {
      // A single 100% slice — render as a full circle (the wedge math
      // collapses to a point when start === end).
      d =
        `M ${CX - RADIUS},${CY} ` +
        `A ${RADIUS},${RADIUS} 0 1,1 ${CX + RADIUS},${CY} ` +
        `A ${RADIUS},${RADIUS} 0 1,1 ${CX - RADIUS},${CY} Z`;
    } else {
      d =
        `M ${CX},${CY} ` +
        `L ${x1.toFixed(2)},${y1.toFixed(2)} ` +
        `A ${RADIUS},${RADIUS} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    }

    paths.push({
      d,
      colour: categoryColour(s.category),
      category: s.category,
      pct: fraction * 100,
      value: s.value,
    });
    cursor = end;
  }

  return (
    <div style={styles.pieWrap}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${metric === "planned" ? "Planned" : "Actual"} time per category`}
        style={styles.pieSvg}
      >
        {paths.map((p) => (
          <path
            key={p.category}
            d={p.d}
            fill={p.colour}
            stroke="var(--bg)"
            strokeWidth={1.5}
          >
            <title>{`${p.category || "(uncategorized)"} — ${formatMinutes(p.value)} (${p.pct.toFixed(1)}%)`}</title>
          </path>
        ))}
      </svg>

      <div style={styles.pieLegend}>
        <div style={styles.pieLegendHeader}>
          {metric === "planned" ? "Planned time" : "Actual time"} —{" "}
          {formatMinutes(slices.total)} total
        </div>
        {paths.map((p) => (
          <div key={p.category} style={styles.pieLegendRow}>
            <span
              style={{ ...styles.pieSwatch, background: p.colour }}
              aria-hidden
            />
            <span style={styles.pieLegendLabel}>
              {p.category || "(uncategorized)"}
            </span>
            <span style={styles.pieLegendPct}>{p.pct.toFixed(1)}%</span>
            <span style={styles.pieLegendValue}>{formatMinutes(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Cluster 14 v1.3 — per-day rollup chart. Renders a hand-drawn SVG
 * line chart over the selected date window. One line per category,
 * coloured via categoryColour() (same FNV-1a hash used by the pie).
 *
 * Layout:
 *   - 760×320 viewBox, scales to container width via 100% styling.
 *   - 36px left padding for y-axis labels, 24px right for the last
 *     day label, 24px top, 32px bottom for x-axis labels.
 *   - X axis: one tick per unique day in the window. Labels are
 *     rotated 30° so a 30-day window stays readable.
 *   - Y axis: 0 → max(planned, actual) across the window with a
 *     small headroom; gridlines at 4 evenly-spaced steps.
 *   - Legend: same column layout as the pie's legend, on the right.
 *   - Lines: solid for the chosen metric (planned / actual / both).
 *     When metric === "both", planned is solid and actual is dashed.
 *
 * Empty states: separate copy for "no events in window" vs "no
 * actuals recorded yet" (Actual-only branch).
 */
function TrendsView({
  rows,
  metric,
  error,
}: {
  rows: DailyRollupRow[] | null;
  metric: TrendsMetric;
  error: string | null;
}) {
  // Build (day -> category -> {planned, actual}) bins.
  const series = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const days = Array.from(new Set(rows.map((r) => r.day_iso))).sort();
    const cats = Array.from(new Set(rows.map((r) => r.category))).sort();
    const cell: Record<string, Record<string, DailyRollupRow>> = {};
    for (const r of rows) {
      if (!cell[r.day_iso]) cell[r.day_iso] = {};
      cell[r.day_iso][r.category] = r;
    }
    let maxVal = 0;
    for (const r of rows) {
      if (metric === "planned" || metric === "both") {
        if (r.planned_minutes > maxVal) maxVal = r.planned_minutes;
      }
      if (metric === "actual" || metric === "both") {
        if (r.actual_minutes > maxVal) maxVal = r.actual_minutes;
      }
    }
    return { days, cats, cell, maxVal };
  }, [rows, metric]);

  if (error) {
    return <div style={trendsStyles.error}>{error}</div>;
  }
  if (!rows) {
    return <div style={trendsStyles.empty}>Loading trends…</div>;
  }
  if (!series || series.days.length === 0) {
    return (
      <div style={trendsStyles.empty}>
        No events with start times inside this window. Pick a wider range or add
        some calendar entries.
      </div>
    );
  }
  if (series.maxVal === 0) {
    return (
      <div style={trendsStyles.empty}>
        No {metric === "actual" ? "actual" : "time"} recorded in this window for
        the selected metric.
      </div>
    );
  }

  // SVG dimensions
  const W = 760;
  const H = 320;
  const PAD_L = 40;
  const PAD_R = 24;
  const PAD_T = 16;
  const PAD_B = 56;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Add ~10% headroom above the max so lines don't kiss the top edge.
  const yMax = Math.max(1, Math.ceil(series.maxVal * 1.1));
  const xCount = series.days.length;
  const xStep = xCount > 1 ? innerW / (xCount - 1) : 0;
  const xAt = (i: number) => PAD_L + (xCount > 1 ? i * xStep : innerW / 2);
  const yAt = (v: number) => PAD_T + innerH * (1 - v / yMax);

  // Build a pretty Y-axis tick set: 4 evenly spaced lines.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  // X-axis label every Nth day so we don't drown in labels for long ranges.
  const labelEvery = Math.max(1, Math.ceil(xCount / 10));

  return (
    <div style={trendsStyles.wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={trendsStyles.svg}
        role="img"
        aria-label={`${metric} time per category over ${xCount} day(s)`}
      >
        {/* gridlines + Y labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
            <text
              x={PAD_L - 6}
              y={yAt(t) + 3}
              fontSize="10"
              textAnchor="end"
              fill="var(--text-muted)"
            >
              {t}
            </text>
          </g>
        ))}
        {/* X labels */}
        {series.days.map((d, i) => {
          if (i % labelEvery !== 0 && i !== xCount - 1) return null;
          // Strip year for compactness ("05-12" instead of "2026-05-12")
          const short = d.length === 10 ? d.slice(5) : d;
          return (
            <text
              key={d}
              x={xAt(i)}
              y={H - PAD_B + 14}
              fontSize="10"
              textAnchor="end"
              fill="var(--text-muted)"
              transform={`rotate(-30 ${xAt(i)},${H - PAD_B + 14})`}
            >
              {short}
            </text>
          );
        })}
        {/* one line per category, per metric */}
        {series.cats.map((cat) => {
          const colour = categoryColour(cat);
          const buildPath = (key: "planned_minutes" | "actual_minutes") =>
            series.days
              .map((d, i) => {
                const v = series.cell[d]?.[cat]?.[key] ?? 0;
                return `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`;
              })
              .join(" ");
          const showPlanned = metric === "planned" || metric === "both";
          const showActual = metric === "actual" || metric === "both";
          return (
            <g key={cat}>
              {showPlanned && (
                <path
                  d={buildPath("planned_minutes")}
                  fill="none"
                  stroke={colour}
                  strokeWidth={2}
                />
              )}
              {showActual && (
                <path
                  d={buildPath("actual_minutes")}
                  fill="none"
                  stroke={colour}
                  strokeWidth={2}
                  strokeDasharray={metric === "both" ? "4 3" : undefined}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div style={trendsStyles.legend}>
        <div style={trendsStyles.legendHeader}>
          {xCount} day{xCount === 1 ? "" : "s"} · {series.cats.length} categor
          {series.cats.length === 1 ? "y" : "ies"}
          {metric === "both" && (
            <div style={trendsStyles.legendHint}>
              Solid = planned · dashed = actual
            </div>
          )}
        </div>
        {series.cats.map((cat) => (
          <div key={cat} style={trendsStyles.legendRow}>
            <span
              style={{
                ...trendsStyles.legendSwatch,
                background: categoryColour(cat),
              }}
              aria-hidden
            />
            <span style={trendsStyles.legendLabel}>
              {cat || "(uncategorized)"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const trendsStyles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    gap: "1.25rem",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginTop: "0.5rem",
  },
  svg: {
    flex: "1 1 600px",
    minWidth: "480px",
    maxWidth: "100%",
    height: "auto",
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  legend: {
    flex: "0 1 220px",
    minWidth: "180px",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    fontSize: "0.85rem",
  },
  legendHeader: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginBottom: "0.2rem",
  },
  legendHint: {
    marginTop: "0.3rem",
    textTransform: "none",
    fontSize: "0.72rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  legendRow: {
    display: "grid",
    gridTemplateColumns: "12px 1fr",
    alignItems: "center",
    gap: "0.5rem",
  },
  legendSwatch: {
    width: "12px",
    height: "12px",
    borderRadius: "2px",
    display: "inline-block",
  },
  legendLabel: {
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "1.5rem",
    background: "var(--bg-elev)",
    border: "1px dashed var(--border-2)",
    borderRadius: "6px",
    color: "var(--text-muted)",
    fontSize: "0.9rem",
    maxWidth: "60ch",
  },
  error: {
    padding: "0.6rem 0.8rem",
    background: "rgba(248, 113, 113, 0.12)",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    fontSize: "0.85rem",
    maxWidth: "60ch",
  },
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
    width: "100%",
    height: "100%",
    overflowY: "auto",
    color: "var(--text)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "1.25rem",
  },
  title: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 600,
  },
  subtitle: {
    marginTop: "0.4rem",
    fontSize: "0.85rem",
    color: "var(--text-muted)",
    maxWidth: "60ch",
  },
  closeBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    width: "28px",
    height: "28px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  rangePicker: {
    display: "flex",
    gap: "0.4rem",
  },
  rangeBtn: {
    padding: "4px 10px",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    fontSize: "0.8rem",
    cursor: "pointer",
    transition: "background 80ms, border-color 80ms",
  },
  loadingHint: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  error: {
    padding: "0.6rem 0.8rem",
    background: "rgba(248, 113, 113, 0.12)",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    marginBottom: "1rem",
    fontSize: "0.85rem",
  },
  empty: {
    padding: "1.5rem",
    background: "var(--bg-elev)",
    border: "1px dashed var(--border-2)",
    borderRadius: "6px",
    color: "var(--text-muted)",
    fontSize: "0.9rem",
    maxWidth: "60ch",
  },
  overallCard: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1rem",
    padding: "1rem",
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    marginBottom: "1.25rem",
  },
  overallStat: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
  },
  statLabel: {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  },
  statValue: {
    fontSize: "1.2rem",
    fontWeight: 600,
  },
  statSubLabel: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    fontWeight: 400,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
  },
  th: {
    padding: "8px 12px",
    borderBottom: "2px solid var(--border-2)",
    textAlign: "left",
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  },
  td: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text)",
  },
  legend: {
    marginTop: "0.75rem",
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    maxWidth: "60ch",
  },
  // Cluster 14 v1.2 additions
  tabPicker: {
    display: "flex",
    gap: "0.4rem",
    marginLeft: "0.5rem",
    paddingLeft: "0.5rem",
    borderLeft: "1px solid var(--border)",
  },
  metricPicker: {
    display: "flex",
    gap: "0.3rem",
    marginLeft: "0.5rem",
  },
  smallBtn: {
    padding: "3px 8px",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    fontSize: "0.75rem",
    cursor: "pointer",
    transition: "background 80ms, border-color 80ms",
  },
  pieWrap: {
    display: "flex",
    gap: "2rem",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginTop: "0.5rem",
  },
  pieSvg: {
    display: "block",
    flexShrink: 0,
  },
  pieLegend: {
    flex: "1 1 240px",
    minWidth: "240px",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    fontSize: "0.85rem",
  },
  pieLegendHeader: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginBottom: "0.2rem",
  },
  pieLegendRow: {
    display: "grid",
    gridTemplateColumns: "12px 1fr auto auto",
    alignItems: "center",
    gap: "0.6rem",
    padding: "2px 0",
  },
  pieSwatch: {
    width: "12px",
    height: "12px",
    borderRadius: "2px",
    display: "inline-block",
  },
  pieLegendLabel: {
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pieLegendPct: {
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.78rem",
    minWidth: "3.5em",
    textAlign: "right",
  },
  pieLegendValue: {
    color: "var(--text-2)",
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.78rem",
  },
};
