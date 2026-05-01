# verify-cluster-16-v1.1.ps1
# Phase 3 Cluster 16 v1.1 — QoL pack patch + protocol/idea/method routing
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart needed (Rust schema add + new command)
#   .\verify-cluster-16-v1.1.ps1  # commit + tag
#
# v1.1 covers:
#   - Bug fixes from v1.0 (column widths not persisted, valign not
#     persisted, equalize too narrow, title-row hover growth, drag
#     cell-selection broken / merge-cells affordance missing,
#     right-click menu bleed-through-no-scroll).
#   - New feature: ::protocol / ::idea / ::method blocks now route to
#     the chosen log entry on save, mirroring Cluster 4's experiment
#     routing.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass 1 — HTML table serializer (column widths persist):
#   1. Insert a table. Drag a column divider so column 1 is wide and
#      column 2 is narrow. Save (Ctrl+S).
#   2. Open the file in a different pane (or close + reopen). The
#      column widths should be exactly as left.
#   3. Open the file as raw text (file tree, or external editor). The
#      table is now stored as <table>…</table> HTML with `<td
#      data-colwidth="...">` attributes — NOT GFM pipe markdown. This
#      is the format change that makes widths survive.
#   4. Old pipe-tables in older notes still load correctly (markdown-it
#      parses them on first open; on next save they become HTML).
#
# Pass 2 — Resize-handle CSS (no row growth on hover):
#   1. Hover over a column boundary in the title (header) row. The
#      header row's height should NOT change; only the faint accent
#      line on the boundary appears.
#   2. The handle stays a thin 2px hairline; it never sticks out into
#      the next column or pushes layout.
#
# Pass 3 — Equalize uses real rendered width:
#   1. Make a 4-column table with deliberately uneven widths
#      (e.g. 100px / 300px / 200px / 80px = 680px total).
#   2. Right-click → Equalize column widths.
#   3. The total table width is unchanged (still ~680px). Each
#      column is now ~170px (= 680/4).
#   4. Pre-fix v1.0 behaviour: the table snapped to 4 × 150 = 600px
#      regardless of original width, visibly narrower than the
#      surrounding text column.
#
# Pass 4 — Equalize scoped to selected columns:
#   1. In the same 4-col table, click in column 2 and drag to column 3
#      (across cells). The selected cells get an accent-tinted
#      background + thin accent border (the new selectedCell style).
#   2. Right-click → Equalize column widths. Columns 1 and 4 keep
#      their original widths; columns 2 and 3 share their combined
#      width evenly.
#   3. Whole-table equalize still works: click in any cell (no drag),
#      right-click → Equalize. Every column gets the same width.
#
# Pass 5 — Drag cell-selection + Merge cells:
#   1. Drag from a cell in row 1 to a cell in row 2 (or column to
#      column). The cells should highlight in the accent tint and
#      show the thin accent border. THIS is the visual confirmation
#      that prosemirror-tables created a CellSelection.
#   2. Right-click on the selection. The menu shows "Merge cells"
#      (which it didn't in v1.0 because the right-click handler used
#      to clobber the CellSelection back to a single caret).
#   3. Click Merge cells. The cells merge; right-click → Split cell
#      undoes it.
#   4. Drag-select while crossing the column boundary that has the
#      hairline resize handle. The drag continues past the handle
#      (handle is now permanently pointer-events: none).
#
# Pass 6 — TableContextMenu repositioning:
#   1. Right-click in a cell at the very BOTTOM of the editor (scroll
#      down so the cell is near the bottom edge of the viewport).
#   2. The context menu opens but is clamped UP from the click point
#      so it stays in the viewport. No part of the menu bleeds off.
#   3. Right-click in a cell near the right edge — menu clamps left.
#   4. If the table menu would be taller than 80% of the viewport
#      (rarely; only if many entries), scroll-overflow appears
#      inside the menu so you can scroll through items.
#   5. Open the notification bell while the table menu is up — the
#      table menu paints above the bell dropdown (z-index 5000 vs.
#      bell ~1500).
#
# Pass 7 — Vertical alignment persists:
#   1. Right-click on a cell → Cell alignment ▸ Bottom. Save. Reopen.
#      The cell content is still bottom-aligned. This works because
#      v1.1's HTML serializer emits `style="vertical-align: bottom"`
#      on the cell, and our ValignTableCell parseHTML reads it back.
#
# Pass 8 — Protocol/Idea/Method routing (the big new feature):
#   1. Have at least one Protocol document created via the Protocols
#      Log (e.g. "Centrifuge wash"). Confirm 06-Protocols/Centrifuge
#      wash.md exists with `type: protocol` frontmatter.
#   2. Open today's daily note. Press Ctrl+Shift+B → Block type:
#      Protocol → "Existing protocol" dropdown shows "Centrifuge
#      wash". Pick it. The "Name to insert" field auto-populates with
#      the same title.
#   3. Click Insert. The doc gains:
#         ::protocol Centrifuge wash
#         (cursor here)
#         ::end
#      Decorated with the green strip.
#   4. Type some content between the markers, e.g. "ran with 5x
#      buffer at 4°C — wash supernatant cloudy".
#   5. Save (Ctrl+S). In Rust logs (--release stderr or `pnpm tauri
#      dev` console) you should see:
#         [cortex] route_typed_blocks: file=<daily-note-path>,
#                  parsed=1 blocks
#         [cortex]   typed-block[0]: matched protocol → <…>/06-Protocols/Centrifuge wash.md
#         [cortex] route_typed_blocks summary: routed=1, regenerating 1 targets
#   6. Open 06-Protocols/Centrifuge wash.md. At the bottom, between
#      <!-- TYPED-DAILY-NOTES-AUTO-START --> and
#      <!-- TYPED-DAILY-NOTES-AUTO-END -->:
#         ## From daily notes
#
#         ### From [[2026-04-29]]
#
#         ran with 5x buffer at 4°C — wash supernatant cloudy
#   7. Repeat for Idea (04-Ideas/) and Method (05-Methods/). Each
#      type's block routes into its corresponding log document's
#      auto-section. The auto-block is bracketed by start/end markers
#      so any user-written content above is preserved.
#   8. Edit the block content in the daily note → Save. The protocol
#      file's auto-section refreshes to match (idempotent: re-saving
#      with no change is a no-op).
#   9. Delete the block from the daily note → Save. The protocol
#      file's auto-section regenerates without that entry; if no
#      other daily note routes to it, the auto-section reads "(no
#      daily-note blocks routed here yet…)".
#  10. Type a name that doesn't match any existing log entry, e.g.
#      "::idea Made-up name / ::end". Save. Warning surfaces:
#      "Idea \"Made-up name\" not found — block skipped." The block
#      stays in the daily note (visual decoration intact); routing
#      just doesn't fire until a matching idea exists. Create it via
#      Idea Log → save again → routing kicks in.
#
# ---------------------------------------------------------------------------
# Edge cases worth touching
# ---------------------------------------------------------------------------
#   a. Multi-block: a daily note with one ::experiment, one
#      ::protocol, and one ::idea block — all three routings fire
#      independently (experiment blocks hit route_experiment_blocks;
#      typed blocks hit route_typed_blocks).
#   b. Two daily notes routing to the same protocol. Both `### From
#      [[…]]` subheadings appear in that protocol's auto-section,
#      sorted alphabetically by daily-note title.
#   c. Existing pipe-table in an old vault file. Open it in Cortex —
#      it parses normally. Edit it (e.g. add a row) → save. On
#      reload, the table is now HTML format. No data loss.
#   d. Right-click in an empty paragraph (no table around) → menu
#      shows just "Insert table…" and clamps as before.
#   e. CellSelection that spans rows AND columns. Equalize scopes to
#      the affected columns (rows don't change widths in any case).
#   f. Connect/disconnect a protocol/idea/method routing across
#      sessions: routing rows persist in SQLite typed_block_routings;
#      reopening Cortex doesn't lose them.
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
    git commit -m "Cluster 16 v1.1 - QoL pack patch + protocol/idea/method routing. HTML table serializer always emits <table>...</table> via DOMSerializer.fromSchema (Editor.tsx HtmlTable extension); column widths (data-colwidth) and per-cell vertical-align attributes survive the markdown round-trip via tiptap-markdown's html:true parser. Old GFM pipe tables still load correctly; on first re-save they migrate to HTML format. CSS: column-resize-handle is permanently pointer-events: none (hover only changes opacity + cursor) so cross-cell drag-selection isn't broken by the handle absorbing mousemove; tableWrapper forced to overflow: visible. selectedCell gets an accent-tinted background + thin accent border so CellSelections are visually obvious. equalizeColumnWidths now reads the table's actual rendered width via view.nodeDOM(tablePos).getBoundingClientRect().width (with sum-of-colwidths and 150*colCount fallbacks) instead of hardcoded 150*N — equalize keeps total width close to the existing layout. equalizeColumnWidths also accepts a CellSelection: when one is present, the helper restricts equalisation to the columns spanned by selected cells (computed via TableMap.findCell). Fall-back to whole-table when no CellSelection. Editor's handleContextMenu preserves an active CellSelection (only setTextSelection when sel is NOT a CellSelection) so right-click on a multi-cell drag exposes 'Merge cells'. TableContextMenu uses useLayoutEffect to measure the actual rendered rect and clamp top/left into the viewport; max-height 80vh + overflow-y auto so right-clicking near the bottom of the app no longer bleeds off-screen; z-index 5000 (was 1100) so it paints above bell/palette. Backend: new typed_block_routings table (block_type 'protocol'/'idea'/'method', target_path, content keyed by daily_note_path + block_index) with idx_typed_routings_target index. extract_typed_blocks parses ::protocol/::idea/::method NAME … ::end. find_typed_target_path walks the notes table for matches in 04-Ideas/ / 05-Methods/ / 06-Protocols/ by title or filename-stem. regenerate_typed_target_auto_section splices a TYPED-DAILY-NOTES-AUTO-START/END bracketed '## From daily notes' section into the target file (preserves user content above and below). New route_typed_blocks Tauri command mirrors route_experiment_blocks shape. TabPane.tsx invokes route_typed_blocks alongside route_experiment_blocks after every save (independent failure paths). ExperimentBlockModal: protocol/idea/method branches now show an existing-entry dropdown driven by query_notes_by_type plus a free-text name fallback (typing a name not in any log still inserts the block; save surfaces a 'X not found' warning until the document is created). All four block types share the same green-strip decoration."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-16-v1.1-complete" -ForegroundColor Cyan
git tag -f cluster-16-v1.1-complete

Write-Host ""
Write-Host "Done. Cluster 16 v1.1 (QoL patch + typed-block routing) shipped:" -ForegroundColor Green
Write-Host "  - HtmlTable serializer: column widths + valign persist" -ForegroundColor Green
Write-Host "  - Resize-handle CSS: no row growth on hover, stays pointer-events:none" -ForegroundColor Green
Write-Host "  - Equalize uses real rendered width + scopes to selected columns" -ForegroundColor Green
Write-Host "  - Cross-cell drag selection works (visual + 'Merge cells' affordance)" -ForegroundColor Green
Write-Host "  - TableContextMenu clamps to viewport + scrolls + z-index 5000" -ForegroundColor Green
Write-Host "  - typed_block_routings table + route_typed_blocks Tauri command" -ForegroundColor Green
Write-Host "  - ::protocol / ::idea / ::method blocks splice into the target's '## From daily notes' section" -ForegroundColor Green
Write-Host "  - BlockModal picks existing log entries (mirrors experiment dropdown)" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (separate clusters, unchanged):" -ForegroundColor DarkGray
Write-Host "  - Cluster 17: block widget rewrite (custom node, holds bullets/tables, non-editable)" -ForegroundColor DarkGray
Write-Host "  - Cluster 18: Excel layer (formulas, cell types, freeze rows/columns)" -ForegroundColor DarkGray
