# verify-cluster-18.ps1
# Phase 3 Cluster 18 v1.0 — Excel layer for tables: custom drag-resize +
# formulas. Closes the v1.1.4 known issue "cell-height growth on hover
# for tables without explicit colwidths" by replacing prosemirror-tables's
# columnResizing plugin with a Cortex-specific one that doesn't run any
# per-hover view updates.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new TipTap extensions)
#   .\verify-cluster-18.ps1 # commit + tag
#
# v1.0 ships:
#
#   1. CortexColumnResize plugin (src/editor/CortexColumnResize.ts).
#      Replaces prosemirror-tables's built-in columnResizing. The
#      plugin only listens to mousedown/mousemove/mouseup events; it
#      never subscribes to view updates, so there's no per-hover
#      `updateColumnsOnResize` call and no `defaultCellMinWidth = 100px`
#      fallback path. Hit zone is 5px inside the right border + 3px
#      overshoot; visible 3px accent strip on hover (CSS, not the
#      hit-detection target). Min column width 30px clamp prevents
#      dragging a column to invisibility.
#
#      `Table.configure({ resizable: false })` disables the built-in
#      plugin; auto-equalize-on-insert from v1.1.4 stays as a
#      defensive measure for fresh tables.
#
#      🟢 The cell-height-growth-on-hover bug from Cluster 16 v1.1.4
#      is now FULLY RESOLVED — no workaround needed.
#
#   2. Formula engine (src/editor/formulaEngine.ts). ~670 lines.
#      Lexer + parser + evaluator. Excel-style A1 cell refs and ranges
#      (A1:B5). Functions: SUM, AVG/MEAN, COUNT, MIN, MAX, MEDIAN, IF.
#      Operators: + - * / ^. Unary minus. Parens. String literals.
#      Numeric literals (including scientific notation). Tagged
#      FormulaResult { kind: "ok" | "error", … }. Circular-ref
#      detection via a visited set.
#
#   3. FormulaCells extension (src/editor/FormulaCells.ts). Two pieces:
#      - FormulaTableCell + FormulaTableHeader extend the v1.1.4
#        ValignTableCell/ValignTableHeader with `formula` and
#        `formulaResult` attrs (parsed from / serialised to
#        `data-formula` and `data-formula-result` HTML attributes).
#      - FormulaEvaluator ProseMirror plugin walks every table cell on
#        every transaction (skipping the cell with the cursor) and
#        re-evaluates any cell whose text starts with `=`. Stores the
#        result in `data-formula-result`. Re-entry guarded via a
#        plugin-key meta flag.
#
#   4. CSS display swap (src/index.css). Cells with
#      `data-formula-result`:
#        - Body color → transparent when not focused.
#        - ::after pseudo-element overlays the result in italic.
#        - Focus reveals the raw formula text for editing; pseudo
#          hides.
#        - Errors render in --danger via attribute substring matching.
#
#   5. Visible 3px resize handle on every cell's right edge (CSS),
#      hover-driven opacity bump via .cortex-resize-hover body class
#      the plugin sets in mousemove.
#
# ---------------------------------------------------------------------------
# What this cluster doesn't include (deferred to v1.1+)
# ---------------------------------------------------------------------------
#
#   - Cell-type formatting (money, date, percent). v1.1.
#   - Freeze rows / freeze columns. v1.1.
#   - Sort / filter. v1.2.
#   - Cross-table cell references. Out of scope.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Drag-resize on a fresh table:
#   1. Insert a table (Ctrl+Shift+T).
#   2. Hover near a column boundary. Cursor → col-resize. The 3px
#      accent strip on the cell's right edge fades in to ~45% opacity.
#   3. Empty cells DO NOT GROW vertically. (This is the fix.)
#   4. Click and drag the boundary. The column resizes smoothly. Save
#      the file; close; reopen → widths persist (HtmlTable serializer).
#
# Pass B — Drag-resize on a pre-existing table without colwidths:
#   1. Open a protocol/method file with a markdown table predating
#      v1.1.4.
#   2. Hover near a column boundary. Cells DO NOT GROW (this was the
#      v1.1.4 unresolved bug; v1.0 of Cluster 18 closes it).
#   3. Drag-resize works without ever needing to right-click → Equalize.
#   4. After dragging, the cell carries an explicit colwidth that
#      persists on save.
#
# Pass C — Basic formula:
#   1. Insert a table with at least 5 rows. Type numbers in column A
#      (e.g. 10, 20, 30, 40, 50).
#   2. Click an empty cell. Type `=SUM(A1:A5)`. Tab out (or click another
#      cell).
#   3. The cell now displays "150" in italic. The cell background gets
#      a subtle accent tint to indicate "this is computed".
#   4. Click back into the cell. The raw formula `=SUM(A1:A5)` becomes
#      visible for editing. Tab out → re-evaluates.
#
# Pass D — Operators and ranges:
#   1. =A1+B1 → adds two cells.
#   2. =A1*2 → arithmetic with literals.
#   3. =MEAN(A1:A5) → average of the column. Equivalent to
#      =SUM(A1:A5)/COUNT(A1:A5).
#   4. =MIN(A1:A5), =MAX(A1:A5), =MEDIAN(A1:A5) all work.
#   5. =IF(A1>10, "big", "small") → conditional. Note: the cluster doc
#      uses IF(condition, then, else); for booleans we use 0 = false,
#      anything else = true (Excel-compat). Comparison operators
#      (>, <, =, !=) are NOT in v1.0 — Pass D's IF examples need
#      arithmetic to derive 0/non-zero (e.g. =IF(A1-10, "big", "small")).
#
# Pass E — Errors render with a tooltip:
#   1. Type `=A99` in a cell where A99 is out of range. The cell
#      displays "Error: Cell A99 out of range" in --danger color.
#   2. Type `=1/0`. Cell displays "Error: Division by zero".
#   3. Type `=BADFUNC(1)`. Cell displays "Error: Unknown function:
#      BADFUNC".
#   4. Type `=` only. Cell displays "Error: Empty formula".
#   5. Fix the formula → cell re-evaluates and the error clears.
#
# Pass F — Circular references:
#   1. In cell A1 type `=B1`. In cell B1 type `=A1`.
#   2. Both cells display "Error: Circular reference at A1" (or B1
#      depending on which the evaluator hits first). No infinite
#      loop / stack overflow.
#   3. Fix one of the cells → cycle clears, the other re-evaluates.
#
# Pass G — Round-trip on disk:
#   1. Save a doc with formulas. Open the file in a plain markdown
#      viewer outside Cortex.
#   2. The cell HTML is `<td data-formula="=SUM(A1:A5)"
#      data-formula-result="150">=SUM(A1:A5)</td>`.
#   3. Reopen in Cortex → the cell shows "150" italic, click reveals
#      the formula. Round-trip clean.
#
# Pass H — Formula doesn't fire while the cursor is in the cell:
#   1. Type `=` in a cell. The cell does NOT immediately show
#      "Error: Empty formula" — error display is suppressed while the
#      cursor is in the cell.
#   2. Type more characters. No flickering between intermediate parse
#      errors.
#   3. Tab out → final value evaluates, displays the result (or final
#      error).
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
    git commit -m "Cluster 18 v1.0 - Excel layer for tables: custom drag-resize plugin + formula engine. CortexColumnResize (src/editor/CortexColumnResize.ts) replaces prosemirror-tables's built-in columnResizing plugin: pure-DOM-event drag (mousedown to detect a 5px+3px hit zone near a cell's right border, window-level mousemove/mouseup to track), TableMap-aware buildResizeTransaction that updates colwidth across every cell spanning the dragged column in one transaction. NEVER subscribes to view updates so the v1.1.4 known issue 'cell-height growth on hover for tables without explicit colwidths' is FULLY RESOLVED — no per-hover layout shift regardless of whether cells have colwidths. Min width 30px clamp. HtmlTable.configure({ resizable: false }) disables the built-in plugin; auto-equalize-on-insert from v1.1.4 stays as a defensive measure. formulaEngine (src/editor/formulaEngine.ts, ~670 lines): lexer (numbers including scientific notation, strings with both quote styles, identifiers, A1-style cell refs, ranges via colon, +-*/^ operators, parens, commas) + parser (precedence climbing — expr / term / power / unary / primary, right-associative ^) + evaluator (TableContext interface for cell resolution, range evaluation returning Value[] arrays that flatten in numeric contexts, lazy IF arg evaluation matching Excel semantics, circular-ref detection via threaded visited set). Functions: SUM, AVG (alias MEAN), COUNT, MIN, MAX, MEDIAN, IF. Tagged FormulaResult { kind: ok|error }. FormulaCells (src/editor/FormulaCells.ts): FormulaTableCell + FormulaTableHeader extend ValignTableCell + ValignTableHeader with formula / formulaResult attrs (parseHTML from data-formula / data-formula-result, renderHTML writes them back). FormulaEvaluator ProseMirror plugin walks every table cell on every appendTransaction (skipping the cell currently containing the cursor) and re-evaluates any cell whose text starts with =, storing the result in data-formula-result. Re-entry guarded via plugin-key meta flag. CSS display swap (src/index.css): cells with data-formula-result hide their text (color: transparent on the contained <p>) and overlay the result in italic via ::after pseudo-element using attr(data-formula-result). :focus-within reveals the raw formula text. Errors with the 'Error:' prefix render in --danger. Formula-bearing cells get a subtle accent-bg tint. Visible 3px resize-handle accent strip on cell right edges, hover-driven opacity via .cortex-resize-hover body class the plugin sets on mousemove. Editor.tsx wiring: drops inline ValignTableCell + ValignTableHeader (now in FormulaCells.ts), imports the new symbols, swaps Table.configure to resizable: false, registers CortexColumnResize and FormulaEvaluator extensions. Closes user trigger 'I keep alt-tabbing to Excel for quick math'. Migration: existing tables don't have formula attrs — default to null and pass through unchanged on save."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-18-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-18-v1.0-complete

Write-Host ""
Write-Host "Done. Cluster 18 v1.0 (drag-resize + formulas) shipped:" -ForegroundColor Green
Write-Host "  - CortexColumnResize replaces prosemirror-tables's columnResizing" -ForegroundColor Green
Write-Host "  - 🟢 Cell-height-growth-on-hover bug from v1.1.4 is FULLY RESOLVED" -ForegroundColor Green
Write-Host "  - Formula engine: SUM / AVG / COUNT / MIN / MAX / MEDIAN / IF + arithmetic" -ForegroundColor Green
Write-Host "  - A1 cell refs + A1:B5 ranges" -ForegroundColor Green
Write-Host "  - Circular-ref detection" -ForegroundColor Green
Write-Host "  - Display swap: result italic when not focused, raw formula on focus" -ForegroundColor Green
Write-Host "  - Round-trips via data-formula + data-formula-result HTML attrs" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.1+):" -ForegroundColor DarkGray
Write-Host "  - Cell-type formatting (money / date / percent)" -ForegroundColor DarkGray
Write-Host "  - Freeze rows / freeze columns" -ForegroundColor DarkGray
Write-Host "  - Sort / filter" -ForegroundColor DarkGray
