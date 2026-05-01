# verify-cluster-18-v1.0.1.ps1
# Phase 3 Cluster 18 v1.0.1 — three bug fixes after dogfooding v1.0.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new TableView nodeView)
#   .\verify-cluster-18-v1.0.1.ps1
#
# v1.0 shipped the custom drag-resize plugin and the formula engine,
# but three regressions surfaced during dogfooding. v1.0.1 closes all
# three.
#
# What changed
# ------------
#
# 1. NEW: src/editor/CortexTableView.ts
#    A minimal NodeView for the table node, modelled on prosemirror-
#    tables's built-in TableView but stripped of the columnResizing
#    integration. Ownership: <colgroup> + <col> elements with inline
#    widths read from each cell's `colwidth` attribute. update() runs
#    on every transaction-driven node update and re-syncs the colgroup;
#    deletes stale <col>s when the column count shrinks.
#
#    Wired into Editor.tsx via HtmlTable.extend({ addNodeView }) so
#    every <table> node gets a CortexTableView instance. The previous
#    v1.0 setup relied on prosemirror-tables's TableView, but
#    `Table.configure({ resizable: false })` (set in v1.0 to disable
#    columnResizing's per-hover spam) also took out that nodeView —
#    so cell colwidth attr changes only landed on next reload.
#
# 2. NEW: buildFocusedCellPlugin() in src/editor/FormulaCells.ts
#    Maintains a Decoration.node with a `cortex-cell-editing` class on
#    whichever cell currently contains the cursor. Replaces the
#    `:focus-within` CSS selector that v1.0 used, which never fired —
#    ProseMirror's `document.activeElement` is the .ProseMirror editor
#    root (an ancestor of the cell, not a descendant), so
#    `:focus-within` on a <td> ancestor of the cursor doesn't match.
#    The Decoration moves with the cursor on every selection change,
#    which is exactly the trigger we need.
#
# 3. UPDATED: src/index.css
#    The four formula-display selectors swap `:not(:focus-within)` for
#    `:not(.cortex-cell-editing)`. With the new decoration in place,
#    click-to-edit reveals the raw formula text and Tab-out hides it
#    again as designed in v1.0.
#
# Bugs closed
# -----------
#
# 🟢 Drag-resize and equalize-column-widths now apply LIVE.
#    Prior: visible only on next file reload. Root cause: no nodeView
#    after disabling columnResizing → colgroup never re-rendered.
#
# 🟢 No more white-line artifact when removing a column.
#    Prior: removing a column left a stale <col> in the colgroup, the
#    browser kept rendering the deleted column's space as empty. Root
#    cause: same as above — no view to clean up the colgroup. The new
#    CortexTableView.updateColgroup() trims extra <col>s.
#
# 🟢 Click-to-edit on a formula cell now reveals the raw formula.
#    Prior: clicking into the cell did nothing visible, the result kept
#    showing in italic with no way to edit. Root cause: `:focus-within`
#    on <td> doesn't match because the cursor's activeElement is the
#    editor root (ancestor of the cell, not descendant).
#
# Files touched (v1.0.1 only)
# ---------------------------
#
#   - src/editor/CortexTableView.ts       (NEW, 161 lines)
#   - src/editor/FormulaCells.ts          (added buildFocusedCellPlugin
#                                          + Decoration import)
#   - src/components/Editor.tsx           (HtmlTable.extend now adds
#                                          addNodeView; CortexTableView
#                                          import)
#   - src/index.css                       (four selectors swapped from
#                                          :focus-within to
#                                          :not(.cortex-cell-editing);
#                                          comment block updated)
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Drag-resize is live:
#   1. Insert a table. Drag a column boundary. The column resizes
#      smoothly under the cursor — no waiting for reload.
#   2. Empty cells DO NOT grow vertically (the v1.1.4 fix is intact).
#   3. Save, close, reopen → widths persist.
#
# Pass B — Equalize column widths is live:
#   1. Insert a table. Type some text in cells of varying lengths so
#      the columns auto-size to different widths.
#   2. Right-click → Equalize column widths. Columns immediately become
#      uniform width — no reload needed.
#
# Pass C — Column delete leaves no white-line artifact:
#   1. Insert a 4-column table. Right-click a column → Delete column.
#   2. The remaining 3 columns redistribute / stay at their widths,
#      and the table's right edge sits flush against the last column.
#      No white space where the deleted column used to be.
#
# Pass D — Click into a formula cell reveals the raw formula:
#   1. In a cell, type =SUM(A1:A5). Tab out — the cell shows "150"
#      italic.
#   2. Click back into the cell. The italic result disappears; the
#      raw `=SUM(A1:A5)` text becomes visible. Cursor is positioned
#      inside the formula.
#   3. Edit the formula (e.g. add another row reference). Tab out →
#      re-evaluates with the new formula.
#   4. Click into a non-formula cell. Verify nothing visible changes
#      (the decoration still applies, but with no data-formula-result
#      attr on this cell, the CSS swap doesn't engage).
#
# Pass E — Decoration moves with the cursor across cells:
#   1. Click into one formula cell, then arrow-key into an adjacent
#      formula cell. Each cell shows raw formula only while the
#      cursor is in it; the others show their results.
#   2. Tab out of the table entirely → all formula cells show results.
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
    git commit -m "Cluster 18 v1.0.1 - three bug fixes after v1.0 dogfooding. (1) Drag-resize and equalize column widths now apply LIVE (no reload needed): disabling prosemirror-tables's columnResizing plugin in v1.0 also took out its TableView nodeView, leaving cell colwidth attr changes invisible until next render. New CortexTableView (src/editor/CortexTableView.ts, ~160 lines) is a minimal stand-in: maintains a <colgroup> with <col style=width> elements read from each cell's colwidth, runs on every transaction-driven update(), and trims stale <col>s when column count shrinks. Wired via HtmlTable.extend({ addNodeView }) — registered per-table-node. (2) White-line artifact on column delete: same root cause; CortexTableView.updateColgroup() now removes extra <col>s when nextCol overshoots the new column count. (3) Click-to-edit on formula cells didn't reveal raw formula: the v1.0 CSS used :focus-within on <td>, which never fires because ProseMirror's document.activeElement is the .ProseMirror editor root — an ancestor of the cell, not a descendant. Added buildFocusedCellPlugin in FormulaCells.ts that maintains a Decoration.node with a `cortex-cell-editing` class on whichever cell currently contains the cursor, dispatched via the standard ProseMirror props.decorations hook (re-runs on every selection change). FormulaEvaluator extension now installs both buildFormulaEvaluatorPlugin and buildFocusedCellPlugin. CSS in index.css swaps four selectors from :not(:focus-within) to :not(.cortex-cell-editing) — text becomes visible only when the cursor is in the cell, the ::after result overlay disappears in lockstep. v1.1.4 cell-height-growth-on-hover fix is intact (CortexColumnResize plugin still owns drag input, never subscribes to view updates)."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-18-v1.0.1-complete" -ForegroundColor Cyan
git tag -f cluster-18-v1.0.1-complete

Write-Host ""
Write-Host "Done. Cluster 18 v1.0.1 (three bug fixes) shipped:" -ForegroundColor Green
Write-Host "  🟢 Drag-resize / equalize apply LIVE (CortexTableView nodeView)" -ForegroundColor Green
Write-Host "  🟢 No white-line artifact on column delete (colgroup trim in updateColgroup)" -ForegroundColor Green
Write-Host "  🟢 Click into formula cell reveals raw formula (Decoration replacing :focus-within)" -ForegroundColor Green
