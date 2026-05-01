# verify-cluster-16-v1.1.4.ps1
# Phase 3 Cluster 16 v1.1.4 — drag-to-resize re-enable + calendar all-day +
# two-way typed-block sync + col-resize cursor.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart needed (new Rust commands)
#   .\verify-cluster-16-v1.1.4.ps1  # commit + tag
#
# This is the final tag in the v1.1.x patch series. It supersedes
# v1.1.1 / v1.1.2 / v1.1.3 (which were intermediates around an
# ongoing layout bug — see "Known issues" below). The chronology of
# what was tried lives in NOTES.md under "Phase 3 — Cluster 16
# v1.1.1 → v1.1.4 — Bug-fix iterations".
#
# v1.1.4 ships:
#
#   1. Drag-to-resize columns (re-enabled). New tables auto-equalize
#      on insert so every cell has an explicit `colwidth`, which
#      keeps prosemirror-tables's `updateColumnsOnResize` in its
#      no-op path on hover and prevents the layout shift.
#
#   2. col-resize cursor at column boundaries. prosemirror-tables's
#      columnResizing plugin sets `.resize-cursor` on view.dom when
#      the mouse is near a boundary; CSS rule
#      `.ProseMirror.resize-cursor { cursor: col-resize }` flips the
#      cursor to the double-arrow.
#
#   3. Two-way sync for ::protocol / ::idea / ::method blocks.
#      Document edits propagate back to the source daily-note block
#      surgically (no new block is created). Per-block CORTEX-BLOCK
#      markers in the auto-section carry `(daily_note_path, block_
#      index)` — the routing's primary key — so propagate_typed_
#      block_edits can match and replace.
#
#   4. Calendar WeekView all-day row. All-day events created in
#      MonthView (or via Google Calendar sync) now appear in the
#      week view too, in a sticky row between the day-header and
#      the hour grid.
#
# ---------------------------------------------------------------------------
# 🔴 KNOWN UNRESOLVED — cell-height growth on hover (pre-existing tables only)
# ---------------------------------------------------------------------------
#
# Tables that were created BEFORE v1.1.4 and never had column widths
# set still hit prosemirror-tables's `defaultCellMinWidth = 100px`
# fallback in `updateColumnsOnResize`, which causes empty cells to
# visibly grow when the user hovers near a column boundary. This
# bug is documented but not fully fixed in v1.1.4.
#
# Workaround: right-click → Equalize Column Widths once on each
# affected table. After that, every cell has an explicit `colwidth`
# and the hover-growth stops.
#
# Tables created AFTER v1.1.4 (via the Insert Table modal) auto-
# equalize on insert and don't have this issue.
#
# Proper fix candidates and the long-term path forward live in
# `cluster_18_table_excel_layer.md` (the natural home for a custom
# drag-resize plugin that doesn't go through prosemirror-tables's
# `columnResizing`).
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass 1 — Drag-to-resize on a fresh table:
#   1. Insert a table (Ctrl+Shift+T → Insert Table modal).
#   2. Cells immediately have explicit widths (auto-equalized on
#      insert). The table is page-width.
#   3. Hover near a column boundary. Cursor changes to col-resize
#      (the double-arrow). The hairline accent strip on the right
#      edge of the cell fades in to ~45% opacity.
#   4. Cells do NOT grow vertically. Empty cells stay at their
#      compact baseline height.
#   5. Click and drag the boundary. The column resizes smoothly.
#      Save the file, close, reopen — column widths persist (HTML
#      table serializer from v1.1.0 preserves data-colwidth).
#
# Pass 2 — Drag-to-resize on a pre-existing (pre-v1.1.4) table:
#   1. Open an old protocol/method file that has a markdown table.
#   2. Hover near a column boundary. ❌ Cells grow vertically (the
#      known bug — see top of this script).
#   3. Right-click any cell → "Equalize column widths".
#   4. Hover near a column boundary again. Cells now stable.
#   5. Drag-to-resize works smoothly from this point on.
#
# Pass 3 — Two-way sync, daily-note → document direction (existing):
#   1. Have a Protocol document (e.g. 06-Protocols/Centrifuge wash.md).
#   2. In today's daily note, write ::protocol Centrifuge wash /
#      "Run at 4°C with 5x buffer" / ::end. Save (Ctrl+S).
#   3. Open the protocol document. The auto-section between
#      <!-- TYPED-DAILY-NOTES-AUTO-START --> and <!-- ...END -->
#      contains:
#         ## From daily notes
#
#         ### From [[2026-04-29]]
#
#         <!-- CORTEX-BLOCK src="C:\…\2026-04-29.md" idx="0" -->
#         Run at 4°C with 5x buffer
#         <!-- /CORTEX-BLOCK -->
#
# Pass 4 — Two-way sync, document → daily-note direction (NEW):
#   1. With the protocol document still open, edit the content
#      INSIDE the CORTEX-BLOCK markers (between the start and the
#      `/CORTEX-BLOCK` end). Change "5x buffer" to "10x buffer".
#   2. Save the protocol document (Ctrl+S).
#   3. Console log shows:
#         [cortex pane N] typed propagate: 1 block(s) propagated
#         to source daily notes
#   4. Open today's daily note (or refresh its pane). The block
#      content is now "Run at 4°C with 10x buffer". The ::protocol
#      Centrifuge wash header and ::end markers are unchanged. NO
#      new block was created.
#   5. Round-trip: edit the daily note's block again → save → open
#      protocol → updated content. Bidirectional sync works
#      indefinitely.
#
# Pass 5 — col-resize cursor:
#   1. Hover slowly over a table column boundary. As the mouse
#      crosses into the ~5px hit zone, the cursor flips from text
#      (I-beam) to col-resize (double-arrow). When the mouse leaves
#      the hit zone, the cursor flips back to text.
#   2. The cursor change works on every table (fresh or pre-existing).
#
# Pass 6 — Calendar all-day events appear in both views:
#   1. Open the Calendar (sidebar Cal button or Ctrl+Shift+C).
#   2. Switch to Month view. Click an empty day. The EventEditModal
#      opens. Toggle "All day", set title "Test Holiday", save.
#   3. The event appears as a chip in the day's cell in MonthView.
#   4. Switch to Week view (containing the same day). The event
#      appears in the new "all-day" row at the top of the week
#      view, between the day-header and the hour grid. Same
#      accent-tinted chip styling as month view.
#   5. Click the chip → opens the modal for editing.
#   6. Click an empty cell in the all-day row → opens a new-event
#      modal with start = day's midnight, end = next midnight. (You
#      have to manually toggle "All day" — known minor rough edge.)
#
# Pass 7 — Two-way sync edge cases:
#   a. Edit document → save → daily note still open in another
#      pane: the daily-note pane shows STALE content until manually
#      reloaded (Ctrl+R or pane re-open). Files-on-disk are correct.
#   b. Save daily note while document is open with unsaved edits:
#      the daily note's `route_typed_blocks` regenerates the
#      document's auto-section, overwriting the unsaved typed
#      changes. Mitigation: save the document first.
#   c. Delete the source block in the daily note → save: the
#      document's auto-section is regenerated without that block
#      (and its row is removed from typed_block_routings).
#   d. Existing v1.1.0 documents (no CORTEX-BLOCK markers): the
#      propagator finds zero markers and returns 0 (no-op). The
#      next daily-note save regenerates the auto-section in the new
#      per-block-marker format, and bi-directional sync starts
#      working from that point on.
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
    git commit -m "Cluster 16 v1.1.4 - drag-to-resize via auto-equalize-on-insert + two-way typed-block sync + col-resize cursor + calendar all-day row in WeekView. Final tag of the v1.1.x patch series. Drag-to-resize columns: prosemirror-tables's columnResizing plugin re-enabled (Table.configure resizable: true). The cell-height-growth-on-hover bug is sidestepped (not fully fixed) by ensuring every cell of newly-inserted tables has an explicit `colwidth`: TabPane.insertTable calls equalizeTableColumnWidths on requestAnimationFrame post-insert, so updateColumnsOnResize takes the fixedWidth=true path and per-hover re-runs are no-ops. equalizeTableColumnWidths is now exported from Editor.tsx for this purpose. Pre-existing tables without colwidths still hit the 100px-fallback path; workaround is right-click→Equalize once. Documented in NOTES.md as 🔴 unresolved. col-resize cursor: .ProseMirror.resize-cursor { cursor: col-resize } CSS rule reflects prosemirror-tables's near-boundary state class on view.dom. Two-way sync (Cluster 16 v1.1.1): per-block CORTEX-BLOCK markers in the typed auto-section (`<!-- CORTEX-BLOCK src=\"…\" idx=\"…\" -->\\ncontent\\n<!-- /CORTEX-BLOCK -->`) carry the routing's composite primary key. New propagate_typed_block_edits Tauri command runs on every save: extracts the auto-section, parses per-block markers, compares each block's content against typed_block_routings, and for any changed block (a) updates the routing row and (b) calls replace_daily_note_typed_block to surgically replace the body lines of the matching `::TYPE NAME / ::end` block in the source daily note. No re-serialization, no chance of clobbering unrelated edits. TabPane.tsx invokes propagate after every save (Rust short-circuits when no typed-auto section). Migration: existing v1.1.0 auto-sections (no markers) are no-op for the propagator; first re-save of the daily note regenerates the auto-section in the new format and bi-directional sync starts working. Calendar WeekView all-day row: between the day-header and hour grid, sticky below the header at top: 56px. Filters events by all_day=true within the day's window; renders as month-view-style chips with accent-tinted background + border-left. Click a chip to edit; click an empty cell to create. Resolves the v1.0 bug where all-day events were filtered out of the WeekView body and never rendered anywhere else. CSS handle styling iterated through display:none and back to a visible 3px bar with pointer-events:none always (so cross-cell drag-select still works). Calendar.tsx, TabPane.tsx, Editor.tsx, lib.rs, index.css, NOTES.md updated."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-16-v1.1.4-complete" -ForegroundColor Cyan
git tag -f cluster-16-v1.1.4-complete

Write-Host ""
Write-Host "Done. Cluster 16 v1.1.4 (final v1.1.x patch) shipped:" -ForegroundColor Green
Write-Host "  - Drag-to-resize columns (auto-equalize-on-insert avoids 100px-fallback growth)" -ForegroundColor Green
Write-Host "  - col-resize cursor at column boundaries" -ForegroundColor Green
Write-Host "  - Two-way sync: edits in protocol/idea/method document propagate to source daily-note block" -ForegroundColor Green
Write-Host "  - Calendar WeekView all-day row" -ForegroundColor Green
Write-Host ""
Write-Host "🔴 Known unresolved:" -ForegroundColor Yellow
Write-Host "  - Cell-height growth on hover persists for tables without explicit colwidths." -ForegroundColor Yellow
Write-Host "    Workaround: right-click → Equalize column widths once per pre-existing table." -ForegroundColor Yellow
Write-Host "    Proper fix: custom drag-resize plugin (Cluster 18 candidate)." -ForegroundColor Yellow
Write-Host ""
Write-Host "Sequenced follow-ups (separate clusters, unchanged):" -ForegroundColor DarkGray
Write-Host "  - Cluster 17: block widget rewrite (custom node, holds bullets/tables, non-editable)" -ForegroundColor DarkGray
Write-Host "  - Cluster 18: Excel layer (formulas, cell types, freeze) + custom drag-resize" -ForegroundColor DarkGray
