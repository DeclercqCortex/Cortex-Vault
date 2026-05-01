# verify-cluster-18-v1.1.ps1
# Phase 3 Cluster 18 v1.1 — cell type formatting + freeze rows/cols.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new schema attrs + plugin)
#   .\verify-cluster-18-v1.1.ps1
#
# v1.0 shipped the custom drag-resize plugin and the formula engine.
# v1.0.1 added the CortexTableView nodeView so drag/equalize apply
# live and the focused-cell decoration so click-to-edit reveals raw
# formulas. v1.1 layers per-cell type formatting and table-level
# freeze on top.
#
# What ships
# ----------
#
#   1. Cell-type formatter (src/editor/cellTypeFormat.ts).
#      Pure (raw, type) → string registry for the five v1.1 types:
#      `text` (default passthrough), `number` (locale-formatted with
#      thousands separator), `money` (US dollar `$1,234.56`),
#      `percent` (Excel-style 0.5 → 50.00%), `date` (ISO YYYY-MM-DD).
#      Empty / unparseable input passes through unchanged so the user
#      can fix typos visibly. Date parsing uses UTC to dodge timezone
#      shenanigans near midnight.
#
#   2. Per-cell `cellType` and `cellDisplay` attributes
#      (src/editor/FormulaCells.ts). Both round-trip via
#      `data-cell-type` and `data-cell-display` HTML attrs through
#      the existing HtmlTable serializer. The FormulaEvaluator plugin
#      now applies the formatter:
#        - For non-formula cells with a cellType: writes
#          formatCellValue(cellText, cellType) into cellDisplay.
#        - For formula cells with a cellType: applies the formatter
#          to the formula's evaluated result, stores in
#          formulaResult (so the existing CSS path renders the
#          formatted value without changes).
#      Cells with neither retain a passthrough render.
#
#   3. Table-level `frozenRows` and `frozenCols` attributes
#      (Editor.tsx HtmlTable.addAttributes). Default 0; round-trip via
#      `data-frozen-rows` / `data-frozen-cols`.
#
#   4. buildFrozenCellsPlugin in FormulaCells.ts. Walks every table on
#      every state change, reads frozenRows / frozenCols, and emits
#      Decoration.node attributes (`data-frozen-row="<rowIdx>"` /
#      `data-frozen-col="<colIdx>"`) on cells in the frozen region.
#      CSS uses these data-* attrs with `position: sticky` to keep
#      frozen cells visible while the rest of the table scrolls.
#
#   5. Right-click menu (src/components/TableContextMenu.tsx).
#      New "Cell type" submenu: Text / Number / Money / Percent /
#      Date — sets the cellType attr on the active cell (or all cells
#      covered by a CellSelection). Two new "Freeze rows" / "Freeze
#      columns" submenus offer Off / 1 / 2 / 3 (depth chosen via
#      v1.1 scoping question).
#
#   6. CSS (src/index.css). New selectors:
#        - `td[data-cell-display]:not([data-formula-result]):not(.cortex-cell-editing)`
#          paints the cellDisplay value via ::after on non-formula
#          typed cells; click-to-edit reveals raw text.
#        - `td[data-frozen-row]` and `td[data-frozen-col]` get
#          `position: sticky` with z-index layering (corner cells at
#          z-index 3, edge cells at 2).
#        - `.tableWrapper` gets `overflow: auto; max-height: 70vh`
#          so the scroll surface exists for sticky to be meaningful.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Cell type: number:
#   1. Insert a table. Type 1234567 in a cell. Tab out.
#   2. Right-click the cell → Cell type → Number. Cell now displays
#      `1,234,567` in italic-style overlay. Click into the cell — the
#      raw 1234567 appears for editing.
#   3. Edit to 1234.5678. Tab out. Cell shows `1,234.5678` (up to 6
#      fractional digits, trailing zeros trimmed).
#
# Pass B — Cell type: money:
#   1. Type 1234.5 in a cell, mark as Money. Cell displays `$1,234.50`.
#   2. Type 0.05 in another cell, mark as Money. Displays `$0.05`.
#   3. Type "abc" in a third cell, mark as Money. Displays `abc` (raw
#      passthrough — no NaN, no error).
#
# Pass C — Cell type: percent (Excel-style):
#   1. Type 0.5 in a cell, mark as Percent. Cell displays `50.00%`.
#   2. Type 0.075. Displays `7.50%`.
#   3. =A1+0.1 in a percent cell where A1 is also percent (0.5).
#      Displays `60.00%` — math composes correctly.
#
# Pass D — Cell type: date:
#   1. Type `2026-04-29` in a cell, mark as Date. Cell displays
#      `2026-04-29` (ISO passthrough).
#   2. Type `April 29, 2026` and mark as Date. Displays `2026-04-29`.
#   3. Type `not a date` and mark as Date. Displays `not a date`
#      (unparseable → passthrough).
#
# Pass E — Cell type composes with formulas:
#   1. Column A has numbers 100, 200, 300. In B1 type =SUM(A1:A3).
#      Tab out — B1 displays `600`.
#   2. Right-click B1 → Cell type → Money. B1 now displays
#      `$600.00`. Click in: `=SUM(A1:A3)` is visible for editing
#      (raw formula, not the formatted result).
#
# Pass F — Cell type round-trips:
#   1. Save the file. Open in a plain markdown viewer outside Cortex.
#   2. Cells with cellType are `<td data-cell-type="money"
#      data-cell-display="$600.00">…</td>`.
#   3. Reopen in Cortex. Display matches; raw text on focus is the
#      original (text or formula).
#
# Pass G — Freeze rows:
#   1. Insert a table with at least 8 rows. Row 0 has bold headers.
#   2. Right-click → Freeze rows → 1 row. Scroll the page (or the
#      table itself if it overflows). The header row stays visible at
#      the top of the table while body rows scroll under it.
#   3. Right-click → Freeze rows → 2 rows. The first two rows stick.
#   4. Off → frozen rows are released; everything scrolls together.
#
# Pass H — Freeze columns:
#   1. Same table, with row labels in column 0.
#   2. Right-click → Freeze columns → 1 column. The leftmost column
#      stays visible when the table scrolls horizontally.
#   3. 2 / 3 columns scale up. Off releases.
#
# Pass I — Both freeze rows and columns:
#   1. Right-click → Freeze rows → 1 + Freeze columns → 1. The
#      top-left cell pins at both edges (z-index 3); the row pins at
#      top (z-index 2); the column pins at left (z-index 2). No
#      overlap artifacts.
#
# Pass J — Round-trip on disk:
#   1. Save a doc with frozen rows + a typed money column. Reload.
#      Both the freeze and the cell types persist.
#   2. Open the file in a text editor. The table HTML is
#      `<table data-frozen-rows="1" ...><col ...><tbody>...
#      <td data-cell-type="money" data-cell-display="...">...</td>`.
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
    git commit -m "Cluster 18 v1.1 - cell-type formatting + freeze rows/cols. New cellTypeFormat.ts (~150 lines): pure (raw, type) -> string registry for text/number/money/percent/date. Empty / unparseable input passes through unchanged. Date parsing uses UTC to dodge timezone shifts. Excel-style percent semantics (0.5 -> 50.00%) per v1.1 scoping decision. FormulaCells.ts: per-cell cellType (CellType | null) and cellDisplay (string | null) attrs round-tripping via data-cell-type / data-cell-display through HtmlTable. FormulaEvaluator plugin extended to apply formatCellValue: for non-formula cells with cellType, writes formatted display into cellDisplay; for formula cells with cellType, applies formatter to formula result before storing in formulaResult. New buildFrozenCellsPlugin: walks every table on state change, reads table-level frozenRows / frozenCols attrs, emits Decoration.node with data-frozen-row=<rowIdx> / data-frozen-col=<colIdx> on cells in the frozen region (uses TableMap.findCell for grid coords). Editor.tsx: HtmlTable.addAttributes now declares frozenRows / frozenCols (default 0) round-tripping via data-frozen-rows / data-frozen-cols. runTableAction handles five new cellType cases (cellTypeText / Number / Money / Percent / Date) and four-way freeze submenus (freezeRows 0/1/2/3 + freezeCols 0/1/2/3) via updateAttributes calls on tableCell / tableHeader / table. TableContextMenu.tsx: new TableAction union members; new MenuItemHeader sections for Cell type and Freeze rows / Freeze columns with indented sub-items. CSS: data-cell-display swap mirrors the formula-result swap (transparent body color when not focused, ::after pseudo-element with attr(data-cell-display) overlay), excludes cells that have data-formula-result so the two paths don't fight when a cell has both. Subtle accent tint on data-cell-type cells. .tableWrapper gains overflow: auto + max-height: 70vh so sticky positioning has a scroll surface. data-frozen-row cells get position: sticky / top: 0; data-frozen-col cells get position: sticky / left: 0; corner cells (both attrs) get z-index: 3; edge cells z-index: 2. The v1.0 cell-growth fix and v1.0.1 live-update + click-to-edit fixes all carry forward unchanged."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-18-v1.1-complete" -ForegroundColor Cyan
git tag -f cluster-18-v1.1-complete

Write-Host ""
Write-Host "Done. Cluster 18 v1.1 (cell types + freeze) shipped:" -ForegroundColor Green
Write-Host "  - Cell types: text / number / money / percent / date (Excel-style %)" -ForegroundColor Green
Write-Host "  - Per-cell cellType + cellDisplay attrs round-tripping via data-* HTML attrs" -ForegroundColor Green
Write-Host "  - Cell types compose with formulas (formula result is cellType-formatted)" -ForegroundColor Green
Write-Host "  - Freeze rows: 0 / 1 / 2 / 3 (right-click submenu)" -ForegroundColor Green
Write-Host "  - Freeze columns: 0 / 1 / 2 / 3 (right-click submenu)" -ForegroundColor Green
Write-Host "  - Decoration plugin emits per-cell data-frozen-* attrs; CSS sticky" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.2):" -ForegroundColor DarkGray
Write-Host "  - Sort columns ascending/descending" -ForegroundColor DarkGray
Write-Host "  - Filter rows" -ForegroundColor DarkGray
Write-Host "  - Comparison operators in formulas (>, <, =, !=)" -ForegroundColor DarkGray
