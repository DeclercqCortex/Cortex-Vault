// cellTypeFormat — Cluster 18 v1.1.
//
// Per-cell display formatters. Each cell can carry a `cellType` attr
// (one of the supported types below); the formatter for that type
// transforms the cell's raw text into a user-facing display string. The
// raw text stays as-is on disk and in the cell's body — display happens
// via a `data-cell-display` attribute (or `data-formula-result` for
// formula cells) that CSS surfaces via an `::after` pseudo-element.
//
// Rules
// -----
// - Formatters are pure: (raw, type) → string. No side effects.
// - Empty / whitespace-only raw values pass through unchanged regardless
//   of type.
// - Invalid input for a numeric type (`number`, `money`, `percent`)
//   passes through as-is rather than showing "NaN" or hiding the user's
//   typo. The user can fix it.
// - Date format is ISO YYYY-MM-DD per the v1.0 cluster-doc decision.
//   Anything `Date` can parse is accepted; invalid dates pass through.
// - Percent uses Excel-style semantics: 0.5 → 50.00%. The user chose
//   this in the v1.1 scoping question because it composes correctly
//   with formulas (e.g. `=A1/B1` in a percent cell shows the right
//   percentage).

export type CellType = "text" | "number" | "money" | "percent" | "date";

/**
 * The canonical list of cell types in v1.1. Used by the right-click
 * menu and by parseHTML to validate the on-disk attribute value.
 */
export const CELL_TYPES: readonly CellType[] = [
  "text",
  "number",
  "money",
  "percent",
  "date",
];

/**
 * User-facing labels for the right-click menu's "Cell type" submenu.
 */
export const CELL_TYPE_LABELS: Record<CellType, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  percent: "Percent",
  date: "Date",
};

/**
 * Coerce a string to one of the known cell types, or `null` if it's
 * not a recognised value. Used by parseHTML to defend against typos
 * or hand-edited HTML.
 */
export function coerceCellType(v: string | null | undefined): CellType | null {
  if (!v) return null;
  return (CELL_TYPES as readonly string[]).includes(v) ? (v as CellType) : null;
}

/**
 * Apply the formatter for `type` to `raw`. Returns the display string
 * (always non-null; falls back to `raw` when formatting can't apply).
 *
 * For formula cells the caller passes the formula's evaluated result
 * (e.g. `"150"` from `=SUM(A1:A5)`) as `raw`, so the formatter sees
 * the same kind of input either way.
 */
export function formatCellValue(raw: string, type: CellType | null): string {
  if (type == null || type === "text") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  switch (type) {
    case "number":
      return formatNumber(trimmed, raw);
    case "money":
      return formatMoney(trimmed, raw);
    case "percent":
      return formatPercent(trimmed, raw);
    case "date":
      return formatDate(trimmed, raw);
  }
}

function parseNumber(s: string): number | null {
  // Tolerate values that already include a leading $ or trailing %
  // (the user might be re-typing into a cell that already had a money
  // or percent format applied). Strip those before parsing.
  const cleaned = s
    .replace(/^\s*\$\s*/, "")
    .replace(/\s*%\s*$/, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(trimmed: string, raw: string): string {
  const n = parseNumber(trimmed);
  if (n == null) return raw;
  // Locale-formatted with thousands separators. Up to 6 fractional
  // digits to match the formula engine's display precision; trailing
  // zeros trimmed.
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
  return formatted;
}

function formatMoney(trimmed: string, raw: string): string {
  const n = parseNumber(trimmed);
  if (n == null) return raw;
  // US-style dollar formatting. v1.2 could add a per-vault preference
  // for currency code; v1.1 keeps it simple.
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(trimmed: string, raw: string): string {
  const n = parseNumber(trimmed);
  if (n == null) return raw;
  // Excel-style: the raw value is a fraction (0.5 → 50%). Locked in by
  // the v1.1 scoping decision. Two fractional digits.
  return `${(n * 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatDate(trimmed: string, raw: string): string {
  // Already ISO? Pass it through unchanged — saves a Date round-trip
  // and avoids any timezone shenanigans for the most common case.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return raw;
  // Use UTC components to dodge DST / timezone shifts that would alter
  // the date for users near midnight.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
