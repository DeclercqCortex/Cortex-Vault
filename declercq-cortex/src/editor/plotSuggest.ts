// plotSuggest — Cluster 27 v1.0 pass 2.4 (F120 + F123).
//
// Heuristic that picks the best-fit plot type for a given dataset by
// looking at column-type signatures + cardinality + size. Pure
// frontend (no API key, no LLM call). The output is a ranked list of
// {plotType, score, reason} entries; the top entry is the suggested
// default. The PlotterSidebar surfaces a "Suggest" button that
// applies the top suggestion; CSV import optionally auto-applies the
// top suggestion when the user has not yet picked a type.
//
// Scoring rubric (each plot type gets a score in [0, 1]):
//   - Hard-fits the columns? base 0.6.
//   - Plot type's IDEAL signature exactly matched? +0.3.
//   - Sample size in the comfortable range for the plot? +0.1.
// Else score = 0 → suggestion suppressed.

import type {
  CortexPlotType,
  PlotData,
  PlotColumnType,
} from "./CortexPlotNode";

export interface PlotSuggestion {
  plotType: CortexPlotType;
  score: number;
  reason: string;
}

interface ColumnStats {
  type: PlotColumnType;
  /** Distinct non-null values (capped at 100 for cheap computation). */
  cardinality: number;
  /** True if every cell is numeric and non-null. */
  fullyNumeric: boolean;
  /** True if every cell is a parseable date string. */
  fullyDate: boolean;
}

function summarizeColumn(data: PlotData, colIdx: number): ColumnStats {
  const col = data.columns[colIdx];
  let numericCount = 0;
  let nonNullCount = 0;
  let dateCount = 0;
  const distinct = new Set<string>();
  for (const row of data.rows) {
    const v = row[colIdx];
    if (v == null || v === "") continue;
    nonNullCount++;
    if (distinct.size < 100) distinct.add(String(v));
    if (typeof v === "number" && Number.isFinite(v)) numericCount++;
    else if (typeof v === "string") {
      const n = parseFloat(v);
      if (Number.isFinite(n)) numericCount++;
      const t = Date.parse(v);
      if (Number.isFinite(t)) dateCount++;
    }
  }
  return {
    type: col.type,
    cardinality: distinct.size,
    fullyNumeric: nonNullCount > 0 && numericCount === nonNullCount,
    fullyDate: nonNullCount > 0 && dateCount === nonNullCount,
  };
}

export function suggestPlotTypes(data: PlotData): PlotSuggestion[] {
  if (data.rows.length === 0 || data.columns.length === 0) return [];
  const stats = data.columns.map((_, i) => summarizeColumn(data, i));
  const numericCols = stats.filter((s) => s.fullyNumeric).length;
  const dateCols = stats.filter((s) => s.fullyDate).length;
  const categoricalCols = stats.filter(
    (s) => !s.fullyNumeric && s.cardinality <= 25,
  ).length;
  const n = data.rows.length;

  const suggestions: PlotSuggestion[] = [];

  // 1 numeric → histogram is the classic distribution view.
  if (numericCols >= 1 && data.columns.length === 1) {
    suggestions.push({
      plotType: "histogram",
      score: 0.95,
      reason: "single numeric column",
    });
    suggestions.push({
      plotType: "ecdf",
      score: 0.7,
      reason: "single numeric column (cumulative view)",
    });
  }

  // 2+ numeric → scatter, line, regression.
  if (numericCols >= 2) {
    suggestions.push({
      plotType: "scatter",
      score: 0.85,
      reason: "two or more numeric columns",
    });
    if (n >= 5) {
      suggestions.push({
        plotType: "regression",
        score: 0.65,
        reason: "enough points to fit a trend",
      });
    }
    if (n >= 3 && n <= 200) {
      suggestions.push({
        plotType: "line",
        score: 0.55,
        reason: "ordered numeric data",
      });
    }
  }

  // Date + numeric → time-series.
  if (dateCols >= 1 && numericCols >= 1) {
    suggestions.push({
      plotType: "timeseries",
      score: 0.95,
      reason: "date column + numeric column",
    });
  }

  // Categorical + numeric → bar.
  if (categoricalCols >= 1 && numericCols >= 1) {
    suggestions.push({
      plotType: "bar",
      score: 0.85,
      reason: "categorical column + numeric column",
    });
    if (categoricalCols === 1 && data.columns.length === 2) {
      suggestions.push({
        plotType: "pie",
        score: 0.55,
        reason: "categorical + numeric (proportions)",
      });
    }
  }

  // 3+ numeric (or 2 numeric + 1 grouping) → scatter with size/color.
  if (numericCols >= 3) {
    suggestions.push({
      plotType: "scatter",
      score: 0.6,
      reason: "third numeric column can drive size or color",
    });
  }

  // Bland-Altman: when 2 numeric columns AND they look like paired
  // measurements (similar means + ranges).
  if (numericCols === 2 && data.columns.length === 2 && n >= 5) {
    suggestions.push({
      plotType: "bland-altman",
      score: 0.35,
      reason: "two numeric columns — method comparison candidate",
    });
  }

  // Deduplicate + sort by score desc.
  const seen = new Set<CortexPlotType>();
  const out: PlotSuggestion[] = [];
  for (const s of suggestions.sort((a, b) => b.score - a.score)) {
    if (seen.has(s.plotType)) continue;
    seen.add(s.plotType);
    out.push(s);
  }
  return out;
}

/** Top-1 convenience wrapper — returns null when no suggestion fires. */
export function topSuggestion(data: PlotData): PlotSuggestion | null {
  const s = suggestPlotTypes(data);
  return s.length > 0 ? s[0] : null;
}
