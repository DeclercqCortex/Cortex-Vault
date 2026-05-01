# verify-cluster-18-v1.2.ps1
# Phase 3 Cluster 18 v1.2 — sort columns + filter rows + comparison
# operators in formulas.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new schema attrs, new plugin)
#   .\verify-cluster-18-v1.2.ps1
#
# What ships
# ----------
#
#   1. Comparison operators in the formula engine
#      (src/editor/formulaEngine.ts). New tokens: `<`, `<=`, `>`, `>=`,
#      `==`, `!=`. Bare `=` mid-formula is also accepted as `==`
#      (Excel-compat — the leading formula `=` is consumed before the
#      lexer runs). New parser level `comparison` sits above `add`,
#      non-chainable. Evaluator returns 1 (true) or 0 (false), so
#      comparisons compose with arithmetic and feed `IF` cleanly.
#      Closes the v1.0 limitation that `IF(condition, …)` couldn't
#      use natural conditions like `A1>10`.
#
#   2. Sort columns ascending / descending
#      (src/components/Editor.tsx — sortTableColumn helper).
#      Right-click in a cell → Sort column ▸ Ascending / Descending.
#      Walks the table's body rows (skipping any row containing a
#      tableHeader cell, plus rows in the frozen region per
#      frozenRows), sorts by the clicked column's text value with
#      cell-type-aware comparison (number / money / percent → numeric,
#      date → chronological, text → localeCompare with numeric
#      collation), dispatches one transaction that replaces the
#      table's content with the sorted rows. NaN-safe: unparseable
#      numeric values bubble to the end regardless of direction.
#      Stable sort. Modifies the doc, so the new order persists on
#      save and is reflected in formulas referencing cell positions.
#
#   3. Filter rows
#      (src/editor/FormulaCells.ts buildFilteredRowsPlugin +
#      src/components/Editor.tsx setTableFilter helper).
#      Right-click → Filter rows ▸ Match this cell / Clear filter.
#      Sets table-level `filterCol` + `filterValue` attrs. A new
#      decoration plugin walks every table on every state change,
#      compares each row's cell at filterCol against filterValue
#      (case-insensitive substring), and emits a Decoration.node
#      with `data-filtered="true"` on rows that don't match. CSS
#      hides those rows via `display: none`. Header rows + frozen
#      rows are exempt (always visible regardless of filter).
#      Round-trips via `data-filter-col` + `data-filter-value` on
#      the `<table>` element through HtmlTable's parseHTML /
#      renderHTML.
#
#   4. Right-click menu (src/components/TableContextMenu.tsx).
#      Two new submenus added at the bottom of the in-table block:
#        - Sort column: Ascending / Descending
#        - Filter rows: Match this cell / Clear filter
#      Four new TableAction union members: sortAsc, sortDesc,
#      filterMatch, filterClear.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Comparison operators in formulas:
#   1. In a cell, =IF(A1>10, "big", "small"). With A1=5 → "small";
#      with A1=20 → "big".
#   2. =A1>=B1 in a cell. Returns 1 if A1>=B1 else 0.
#   3. =SUM(A1:A5) > 100 — comparison composed with a function call.
#   4. Bare = mid-formula: =IF(A1=10, "ten", "other"). Also works.
#   5. Chained comparison ERROR: =1<2<3 → "Error: Unexpected token
#      after expression". Documented limitation.
#
# Pass B — Sort ascending:
#   1. Insert a 5-row table. Type values in column A:
#      "Zebra", "Apple", "Mango", "Banana", "Cherry".
#   2. Right-click a cell in column A → Sort column → Ascending.
#   3. Rows reorder to: Apple / Banana / Cherry / Mango / Zebra.
#   4. Save, close, reopen → sort persists (sorted rows are now the
#      doc's actual row order).
#
# Pass C — Sort descending with cell-type:
#   1. In column B, set Cell type → Money. Type 100, 25, 1234, 50, 0.
#   2. Right-click a cell in column B → Sort column → Descending.
#   3. Rows reorder by numeric value: 1234 / 100 / 50 / 25 / 0
#      (displayed as $1,234.00 / $100.00 / etc.).
#   4. Confirm: lexicographic sort would have produced
#      "1234" / "100" / "25" / "50" / "0" — different. The numeric
#      sort proves cellType is honoured.
#
# Pass D — Sort respects header + frozen rows:
#   1. Same table. Toggle header row (row 0 cells become
#      tableHeader). Type "Name" / "Price" headers.
#   2. Sort either column. The header row stays at the top; only
#      body rows reorder.
#   3. Set Freeze rows → 2. Rows 0 + 1 stay in place; sort
#      reorders rows 2+.
#
# Pass E — Filter to a value:
#   1. Insert a table with rows like: Apple-Red, Apple-Green,
#      Banana-Yellow, Cherry-Red, Apple-Yellow.
#   2. Right-click on the cell containing "Red" in any row →
#      Filter rows → Match this cell.
#   3. Only rows where the filter column contains "Red" remain
#      visible. Apple-Green, Banana-Yellow, Apple-Yellow are
#      hidden.
#   4. Filter clear: right-click → Filter rows → Clear filter.
#      All rows visible again.
#
# Pass F — Filter survives reload:
#   1. With a filter active, save and close the file.
#   2. Open the file in a plain markdown viewer. The <table>
#      element has `data-filter-col="N"` and
#      `data-filter-value="..."` attrs.
#   3. Reopen in Cortex. The filter is still active; the same
#      rows are hidden as before.
#
# Pass G — Filter exempts header + frozen rows:
#   1. In a table with a header row + freezeRows=1, apply a
#      filter that would otherwise hide the header.
#   2. The header row stays visible regardless. Only body rows
#      can be filtered.
#
# Pass H — Filter + sort interact correctly:
#   1. Sort a column descending.
#   2. Apply a filter on a different column.
#   3. The visible rows are: filtered (only matching rows) AND
#      sorted (in the order the doc currently has — sort modified
#      the doc, filter is purely a render layer).
#   4. Clear filter. Full sorted table visible.
#   5. Sort the column again ascending. Re-sorts the rows in
#      doc order; filter (if reapplied) still works.
#
# Pass I — Edge cases:
#   1. Sort an empty table or a 1-row table → no-op (stable sort
#      with one element).
#   2. Filter a column that doesn't exist (manually edit
#      data-filter-col to a huge number) → plugin sees filterCol
#      out of range, no rows hidden.
#   3. Sort a column with mixed numeric + text values → numeric
#      values sort by value, text passes through (the cellType
#      determines the comparator; if the column is text, all rows
#      sort lexicographically).
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 3/4  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Cluster 18 v1.2 - sort columns + filter rows + comparison operators in formulas. (1) Formula engine (formulaEngine.ts): new comparison operators >, >=, <, <=, ==, != with two-character lex (peek next char to disambiguate), plus bare = mid-formula treated as == for Excel-compat. New parser precedence level `comparison` above `add`, non-chainable (so 1<2<3 errors rather than silent surprise). Evaluator returns 1/0 numerically — composes with arithmetic and feeds IF cleanly. Closes v1.0 limitation where IF couldn't use natural >/< conditions. (2) Sort columns (Editor.tsx sortTableColumn helper): right-click → Sort column ▸ Ascending / Descending. Walks body rows (skips any row containing a tableHeader cell + rows in the frozen region per frozenRows), sorts by the clicked column's text via cell-type-aware comparator (number/money/percent → numeric with NaN-bubbling, date → chronological via Date.getTime, else localeCompare with numeric collation). Stable sort, single transaction, modifies the doc so order persists on save. (3) Filter rows (FormulaCells.ts buildFilteredRowsPlugin + Editor.tsx setTableFilter helper): table-level filterCol + filterValue attrs round-trip via data-filter-col + data-filter-value on the <table>. New decoration plugin emits data-filtered=\"true\" on rows whose cell at filterCol doesn't case-insensitive-substring-match filterValue (header rows + frozen rows exempt — always visible). CSS hides filtered rows via display: none. Right-click → Filter rows ▸ Match this cell sets filter to the clicked cell's column + text; Clear filter resets attrs to null. (4) TableContextMenu.tsx: 4 new TableAction union members (sortAsc / sortDesc / filterMatch / filterClear) and two new submenus rendered at the bottom of the in-table block. All v1.0 + v1.0.1 + v1.1 features carry forward unchanged."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-18-v1.2-complete" -ForegroundColor Cyan
git tag -f cluster-18-v1.2-complete

Write-Host ""
Write-Host "Done. Cluster 18 v1.2 (sort + filter + comparison ops) shipped:" -ForegroundColor Green
Write-Host "  - Comparison operators: > >= < <= == != (and bare = as Excel-compat ==)" -ForegroundColor Green
Write-Host "  - IF(condition, ...) now works with natural conditions" -ForegroundColor Green
Write-Host "  - Sort column ascending/descending (cell-type-aware, modifies doc)" -ForegroundColor Green
Write-Host "  - Filter rows by matching a cell's value (case-insensitive substring)" -ForegroundColor Green
Write-Host "  - Header + frozen rows exempt from filter (always visible)" -ForegroundColor Green
Write-Host "  - Filter round-trips via data-filter-col + data-filter-value on the <table>" -ForegroundColor Green
