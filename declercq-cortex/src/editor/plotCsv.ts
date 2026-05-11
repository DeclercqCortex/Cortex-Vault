// plotCsv — Cluster 27 v1.0.
//
// CSV import + parsing utilities for the Plotter. Pure-frontend (no
// Tauri command needed for parsing — the file is read once via the
// plugin-dialog or FileTree drag pathway, then parsed in-process).
//
// Features:
//   - Delimiter sniff (',', ';', '\t', '|') by trying each on the first
//     few non-empty lines and picking the delimiter with the highest
//     and most-consistent split count.
//   - Quoted fields (RFC 4180): `"foo, bar"` is one field.
//   - Header detection: first row is treated as the header iff it
//     contains AT LEAST one cell that's a string-but-not-a-number and
//     the next row has at least one numeric cell. Otherwise the
//     dataset has no header and columns get default names.
//   - Type inference per column: number / date / category.
//     - Numeric column = every cell parses as a JS number (with
//       optional decimal separator detection for `,` locales).
//     - Date column = every cell parses as a valid Date via
//       `Date.parse`.
//     - Otherwise = category.
//
// Output shape matches PlotData from CortexPlotNode.ts so the result
// drops directly into the node payload.

import type { PlotColumn, PlotColumnType, PlotData } from "./CortexPlotNode";

export interface CsvParseOptions {
  /** Override the delimiter detection. */
  delimiter?: "," | ";" | "\t" | "|" | null;
  /** Force-treat the first row as a header. null = auto-detect. */
  forceHeader?: boolean | null;
  /** Decimal separator. null = auto-detect ('.' vs ','). */
  decimal?: "." | "," | null;
}

export interface CsvParseResult {
  data: PlotData;
  /** What delimiter was used. */
  delimiter: string;
  /** Was the first row interpreted as a header? */
  hasHeader: boolean;
  /** Decimal separator used during numeric parsing. */
  decimal: "." | ",";
  /** Per-column inferred type. */
  inferredTypes: PlotColumnType[];
  /** Non-fatal warnings (mixed types, dropped rows, etc.). */
  warnings: string[];
}

const CANDIDATE_DELIMITERS: ReadonlyArray<"," | ";" | "\t" | "|"> = [
  ",",
  ";",
  "\t",
  "|",
];

// =====================================================================
// Delimiter detection
// =====================================================================

function sniffDelimiter(input: string): "," | ";" | "\t" | "|" {
  const sample = input
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 10);
  if (sample.length === 0) return ",";
  let best: (typeof CANDIDATE_DELIMITERS)[number] = ",";
  let bestScore = -Infinity;
  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) =>
      countDelimsRespectingQuotes(line, delim),
    );
    if (counts[0] === 0) continue;
    // Score = average split count − stddev (favours high + consistent).
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance =
      counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    const score = mean - Math.sqrt(variance);
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

function countDelimsRespectingQuotes(line: string, delim: string): number {
  let count = 0;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // RFC 4180: `""` inside a quoted field is an escaped quote.
      if (inQuote && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && ch === delim) count++;
  }
  return count;
}

// =====================================================================
// Line splitting (quote-aware)
// =====================================================================

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        buf += '"';
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && ch === delim) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

// =====================================================================
// Type inference
// =====================================================================

function looksLikeNumber(s: string, decimal: "." | ","): boolean {
  const trimmed = s.trim();
  if (trimmed === "") return false;
  // Strip thousands separator (the other separator).
  const thousands = decimal === "." ? "," : ".";
  const cleaned = trimmed.replace(new RegExp(`\\${thousands}`, "g"), "");
  const normalized = decimal === "," ? cleaned.replace(/,/g, ".") : cleaned;
  // Bug 2 fix: relax the integer-required prefix so values like ".5"
  // (no leading zero) and "1." (no trailing fraction) parse. Either
  // branch of the alternation must consume at least one digit so
  // strings like "." or "-" still reject.
  return /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized);
}

function parseNumber(s: string, decimal: "." | ","): number | null {
  if (!looksLikeNumber(s, decimal)) return null;
  const thousands = decimal === "." ? "," : ".";
  const cleaned = s.trim().replace(new RegExp(`\\${thousands}`, "g"), "");
  const normalized = decimal === "," ? cleaned.replace(/,/g, ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function looksLikeDate(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === "") return false;
  // Reject pure numbers (would also parse as Date if year-like).
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return false;
  const t = Date.parse(trimmed);
  return Number.isFinite(t);
}

function inferDecimal(input: string, delimiter: string): "." | "," {
  // Bug 2 fix: when the delimiter is "," there is no ambiguity to
  // resolve — values cannot use "," as decimal because every "," in
  // an unquoted numeric context would split a cell. Force "." in
  // that case; otherwise fall back to the heuristic.
  if (delimiter === ",") return ".";
  // Heuristic: if the file contains floats like `1,5` more often than
  // `1.5`, the decimal is `,`. Sample first ~2000 chars. Bias the
  // threshold heavily toward "." (the default) so a single misleading
  // comma-pair does not flip the decimal — the user can override via
  // CsvParseOptions if the heuristic is wrong.
  const sample = input.slice(0, 2000);
  const dotFloats = (sample.match(/\d\.\d/g) ?? []).length;
  const commaFloats = (sample.match(/\d,\d/g) ?? []).length;
  return commaFloats > dotFloats * 2 && commaFloats >= 3 ? "," : ".";
}

// =====================================================================
// Header detection
// =====================================================================

function detectHeader(rows: string[][], decimal: "." | ","): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  const second = rows[1];
  const firstHasNonNumeric = first.some(
    (c) => c.trim() !== "" && !looksLikeNumber(c, decimal),
  );
  const secondHasNumeric = second.some((c) => looksLikeNumber(c, decimal));
  return firstHasNonNumeric && secondHasNumeric;
}

// =====================================================================
// Main entry
// =====================================================================

export function parseCsv(
  input: string,
  opts: CsvParseOptions = {},
): CsvParseResult {
  const warnings: string[] = [];
  // Normalise line endings.
  const lines = input.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return {
      data: { columns: [], rows: [] },
      delimiter: ",",
      hasHeader: false,
      decimal: ".",
      inferredTypes: [],
      warnings: ["empty input"],
    };
  }
  const delimiter = opts.delimiter ?? sniffDelimiter(input);
  // Bug 2 fix: inferDecimal now takes the delimiter so it can enforce
  // the "delimiter=',' ⇒ decimal='.'" invariant.
  const decimal = opts.decimal ?? inferDecimal(input, delimiter);
  const rawRows = lines.map((line) => splitLine(line, delimiter));
  const hasHeader =
    opts.forceHeader == null
      ? detectHeader(rawRows, decimal)
      : opts.forceHeader;

  const headerRow = hasHeader ? rawRows[0] : null;
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  // Pad short rows / truncate long rows to the modal column count.
  const colCount = rawRows.reduce((m, r) => Math.max(m, r.length), 0);
  const normRows = dataRows.map((r) => {
    if (r.length === colCount) return r;
    if (r.length < colCount) {
      warnings.push(`row padded from ${r.length} to ${colCount} columns`);
      const padded = r.slice();
      while (padded.length < colCount) padded.push("");
      return padded;
    }
    warnings.push(`row truncated from ${r.length} to ${colCount} columns`);
    return r.slice(0, colCount);
  });

  // Per-column type inference.
  const inferredTypes: PlotColumnType[] = [];
  for (let c = 0; c < colCount; c++) {
    const values = normRows
      .map((r) => (r[c] ?? "").trim())
      .filter((v) => v !== "");
    if (values.length === 0) {
      inferredTypes.push("category");
      continue;
    }
    if (values.every((v) => looksLikeNumber(v, decimal))) {
      inferredTypes.push("number");
      continue;
    }
    if (values.every((v) => looksLikeDate(v))) {
      inferredTypes.push("date");
      continue;
    }
    inferredTypes.push("category");
  }

  // Build PlotColumn[].
  const columns: PlotColumn[] = [];
  for (let c = 0; c < colCount; c++) {
    const name = headerRow?.[c]?.trim() || defaultColumnName(c);
    columns.push({ name, type: inferredTypes[c] });
  }

  // Coerce typed values.
  const typedRows: Array<Array<number | string | null>> = normRows.map((r) =>
    r.map((cell, c) => coerceCell(cell, inferredTypes[c], decimal)),
  );

  return {
    data: { columns, rows: typedRows },
    delimiter,
    hasHeader,
    decimal,
    inferredTypes,
    warnings,
  };
}

function coerceCell(
  raw: string,
  type: PlotColumnType,
  decimal: "." | ",",
): number | string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (type === "number") {
    return parseNumber(trimmed, decimal);
  }
  if (type === "date") {
    return trimmed; // keep ISO-ish string; renderers parse via Date.parse.
  }
  return trimmed;
}

function defaultColumnName(index: number): string {
  // Excel-style A, B, …, Z, AA, AB, …
  let n = index;
  let out = "";
  while (true) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    if (n < 26) break;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

// =====================================================================
// CSV serialization (export)
// =====================================================================

export function serializeCsv(data: PlotData, delimiter = ","): string {
  const escape = (cell: number | string | null): string => {
    if (cell == null) return "";
    const s = String(cell);
    if (s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [];
  lines.push(data.columns.map((c) => escape(c.name)).join(delimiter));
  for (const row of data.rows) {
    lines.push(row.map(escape).join(delimiter));
  }
  return lines.join("\n");
}
