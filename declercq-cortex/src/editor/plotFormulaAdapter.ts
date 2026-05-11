// plotFormulaAdapter — Cluster 27 v1.0.
//
// Thin wrapper around the Cluster 18 formula engine
// (`src/editor/formulaEngine.ts`) so the plotter's PlotDataGrid can
// reuse the exact same lexer / parser / evaluator. Differences:
//
//   1. The plotter context uses `:=` as the formula prefix instead
//      of bare `=`. This avoids colliding with Cluster 18's
//      in-document table cells (which DO use bare `=`) and lets the
//      grid distinguish "literal cell that happens to start with =,
//      e.g. a heading" from "this is a formula." The adapter strips
//      `:=` and forwards `=…` to evaluateFormula().
//
//   2. The TableContext for a plot data grid is rectangular and
//      simple — no NodeView lookups, no mark walks, just a 2D array
//      of cells. We project the grid into the (col, row) addressing
//      scheme the engine expects.
//
//   3. Formula columns: a column with `formula: ":= sin(A1)"` runs
//      the formula once per row, using `A` as a special bound name
//      (= the value in the SAME row of column 0). Cluster 18's
//      engine uses A1-style refs where the letter is the COLUMN
//      and the number is the ROW; we keep that grammar verbatim and
//      simply tell each row "pretend you are row 1" so `A1` resolves
//      to the same-row value in column A.
//
// On-disk persistence: the formula string is stored on the
// PlotColumn.formula field; it round-trips through the sidecar JSON.

import {
  evaluateFormula,
  type TableContext,
  type FormulaResult,
} from "./formulaEngine";
import type { PlotColumn, PlotData } from "./CortexPlotNode";

/** Plotter prefix that marks a column-header expression as a formula. */
export const PLOT_FORMULA_PREFIX = ":=";

/**
 * Is this raw column-header / cell input a formula? True iff it starts
 * with `:=` (after trimming).
 */
export function isPlotFormula(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  return raw.trim().startsWith(PLOT_FORMULA_PREFIX);
}

/**
 * Strip the `:=` prefix and return the bare `=…` form that Cluster 18's
 * engine accepts. Returns null if `raw` isn't a plot formula.
 */
export function toEngineFormula(raw: string | null | undefined): string | null {
  if (!isPlotFormula(raw)) return null;
  const trimmed = (raw as string).trim();
  return "=" + trimmed.slice(PLOT_FORMULA_PREFIX.length).trim();
}

// =====================================================================
// Per-row formula evaluation
// =====================================================================
//
// A formula column computes a value for each row. The user's formula
// can reference other columns by letter (A, B, C, …) — the SAME row
// in those columns. We give each row a synthetic 1-row TableContext
// so that `A1` resolves to "column A, this row."
//
// Cross-row references (e.g. SUM(A1:A5)) work naturally: we expose
// the full column data through the TableContext (rowCount = full
// dataset, cellAt(col, row) = value at that grid position). The
// engine resolves ranges over the real coordinates.

/**
 * Build a TableContext that views the entire PlotData as a 2D grid.
 * Computed columns (other formula columns) are resolved RECURSIVELY
 * up to depth `maxDepth`, with a visited-set keyed by (col, row) so
 * the engine's circular-ref detection catches loops.
 */
export function makePlotTableContext(
  data: PlotData,
  /** Cached cell values for already-evaluated formula columns. Avoids
   *  re-running an expensive formula chain for every consumer of the
   *  same column. Keyed by `col:row`. */
  cache: Map<string, string> = new Map(),
): TableContext {
  return {
    columnCount: data.columns.length,
    rowCount: data.rows.length,
    cellAt(col: number, row: number, visited: Set<string>): string {
      if (col < 0 || col >= data.columns.length) return "";
      if (row < 0 || row >= data.rows.length) return "";
      const key = `${col}:${row}`;
      // Cycle detection: if we're being asked for a cell that's already
      // on the eval stack, bail out (engine returns ERR via visited
      // contract).
      if (visited.has(key)) return "";
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const column = data.columns[col];
      const cell = data.rows[row]?.[col];

      // Computed column? Evaluate its formula once, with row = the
      // requested row (engine grammar uses A1-style refs; the row
      // number is positional). We don't have a single "row formula"
      // since the engine's formulas reference cells by full (col,
      // row) coordinates. Approach: for a computed column with
      // formula `:= A`, we run the engine but rewrite the implicit
      // row context — i.e. interpret `A` as `A{row+1}` for THIS
      // call. The engine doesn't currently support that rewrite;
      // for v1.0 we keep it explicit: users write `:= A{row}` or
      // similar. Pass 2 backlog: add a "current-row alias" so `A`
      // alone means "same row as the computed cell."
      if (column.formula && isPlotFormula(column.formula)) {
        const engineFormula = toEngineFormula(column.formula) ?? "";
        // Synthesize a row-local formula: replace bare column letters
        // (not followed by a digit) with the current row+1. e.g.
        // `:= sin(A) * B` becomes `=sin(A${row+1}) * B${row+1}`.
        const rewritten = rewriteBareColumnLettersToCurrentRow(
          engineFormula,
          row + 1,
        );
        visited.add(key);
        const result = evaluateFormula(rewritten, this, visited);
        visited.delete(key);
        const display =
          result.kind === "ok" ? result.displayed : `#ERR ${result.message}`;
        cache.set(key, display);
        return display;
      }

      // Plain cell — return its textual representation.
      if (cell == null) return "";
      return String(cell);
    },
  };
}

/**
 * Rewrite bare column letters (e.g. `A`, `AB`) NOT already followed
 * by a digit into row-anchored cell refs (`A${row}`, `AB${row}`). Used
 * to give computed-column formulas a "current row" context.
 *
 * Limitations (v1.0): doesn't handle column letters inside string
 * literals or function names. Cluster 18's engine recognizes function
 * names (SUM, AVG, …) as IDENTs not CELLREFs, so the parser disambig-
 * uates them; this regex pass runs BEFORE the lexer, so it can wrongly
 * append a row to e.g. `SUM(A:B)`. We avoid that by only rewriting
 * single-letter / two-letter sequences that aren't part of a longer
 * identifier (i.e. not preceded by [A-Za-z]). Acceptable tradeoff for
 * pass 1; pass 2 will lift this into the engine itself as a proper
 * "current-row aliasing" feature.
 */
export function rewriteBareColumnLettersToCurrentRow(
  formula: string,
  currentRow: number,
): string {
  // Strategy: walk left-to-right, accumulate output, recognize tokens.
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    // String literal — copy verbatim.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n && formula[i] !== quote) {
        out += formula[i];
        i++;
      }
      if (i < n) {
        out += formula[i];
        i++;
      }
      continue;
    }
    // Letter — start of an identifier or cell ref.
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z]/.test(formula[j])) j++;
      const letters = formula.slice(i, j);
      // Check what follows.
      const next = formula[j] ?? "";
      if (/[0-9]/.test(next)) {
        // Already a cell ref like A1 — copy letters AND digits.
        let k = j;
        while (k < n && /[0-9]/.test(formula[k])) k++;
        out += formula.slice(i, k);
        i = k;
        continue;
      }
      if (next === "(") {
        // Function call — copy letters verbatim.
        out += letters;
        i = j;
        continue;
      }
      // Bare letters not followed by digit or paren — treat as a
      // column ref needing the current row appended.
      out += letters + String(currentRow);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Convenience: evaluate a single computed-column formula for a given
 * row. Returns the displayed result (or null on error).
 */
export function evaluateComputedCell(
  column: PlotColumn,
  row: number,
  data: PlotData,
): FormulaResult | null {
  if (!column.formula || !isPlotFormula(column.formula)) return null;
  const engineFormula = toEngineFormula(column.formula) ?? "";
  const rewritten = rewriteBareColumnLettersToCurrentRow(
    engineFormula,
    row + 1,
  );
  return evaluateFormula(rewritten, makePlotTableContext(data));
}
