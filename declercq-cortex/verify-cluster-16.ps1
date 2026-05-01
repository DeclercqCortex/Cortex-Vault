# verify-cluster-16.ps1
# Phase 3 Cluster 16 — QoL pack v1.0
#   table polish + wikilink shortcut + Ctrl+S scroll preservation +
#   multi-type blocks
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend-only cluster, but tauri dev still
#                           #   the canonical way to smoke-test
#   .\verify-cluster-16.ps1 # commit + tag
#
# v1.0 scope (per cluster_16_qol_pack.md):
#   1. Ctrl+S no longer scrolls to the bottom of the document.
#   2. Ctrl+Shift+W wraps selected text in [[…]]; with no selection
#      it opens the palette in pick-mode and a click on a result
#      inserts [[Title]] at the cursor instead of opening the file.
#   3. Tables have draggable column dividers
#      (`Table.configure({ resizable: true })`).
#   4. Right-click on a cell → "Equalize column widths" sets each
#      column to floor(table_width / column_count).
#   5. Right-click on a cell → "Cell alignment ▸ Top / Middle /
#      Bottom" — sets the per-cell verticalAlign attr; round-trips
#      through tiptap-markdown's html:true serialiser.
#   6. Ctrl+Shift+B opens BlockModal with a Type dropdown
#      (Experiment / Protocol / Idea / Method). The chosen type
#      generates the corresponding `::TYPE NAME` opener and `::end`
#      closer; the ExperimentBlockDecoration recognises all four.
#
# v1.0 deliberately defers (per cluster doc):
#   - Custom TipTap node for blocks (right-click delete, holding
#     bullets / tables, non-editable widget): Cluster 17.
#   - Excel formulas (MEAN, SUM…), cell-type formatting (money /
#     date / percent), freeze rows/columns: Cluster 18.
#   - Per-row / per-column vertical alignment shortcut. v1.0 is
#     per-cell only.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass 1 — Ctrl+S scroll preservation:
#   1. Open a long-ish daily note that scrolls. Place the cursor in the
#      middle of the document (e.g. via search or by clicking).
#   2. Type a few characters somewhere visible. Press Ctrl+S.
#   3. The viewport stays where it was. Cursor does NOT jump to bottom.
#      Pre-fix behaviour: `setContent` would re-fire because
#      `getMarkdown()` (escaped wikilinks) didn't equal `editedBody`
#      (unescaped wikilinks); the round-trip caused a re-render that
#      reset scrollTop to 0. Fix is in `Editor.tsx`'s content effect:
#      apply unescapeWikilinkBrackets to getMarkdown() before
#      comparing to content.
#   4. Bonus: open a doc with a `[[wikilink]]` near the bottom, scroll
#      so the wikilink is on screen, edit somewhere unrelated, Ctrl+S.
#      Wikilink stays visually intact (not re-escaped) and viewport
#      doesn't jump. Confirms the unescape is the right side of the
#      comparison.
#
# Pass 2 — Wikilink wrap:
#   1. In the editor, select a word (e.g. "Cortex"). Press
#      Ctrl+Shift+W. The selection becomes `[[Cortex]]`.
#   2. Multi-word selection works the same: select "daily review",
#      Ctrl+Shift+W, becomes `[[daily review]]`.
#   3. Selection that spans multiple paragraphs: only the trimmed
#      text-content gets wrapped; line breaks become spaces.
#      Acceptable for v1; flagged as a rough edge.
#
# Pass 3 — Wikilink palette pick-mode:
#   1. With NO selection (just a cursor blinking in a paragraph),
#      press Ctrl+Shift+W. The command palette opens in pick-mode —
#      banner across the top reads something like "Pick a note to
#      insert as a wikilink".
#   2. Type a few letters of an existing note title. Press Enter or
#      click a result. Palette closes; `[[Title]]` is inserted at
#      the cursor position.
#   3. Press Ctrl+Shift+W again with no selection, but Esc out of
#      the palette. Pick-mode clears; reopening the palette via
#      Ctrl+P lands you in normal open-file mode.
#
# Pass 4 — Table column resize:
#   1. Insert a table (Ctrl+Shift+I or sidebar). Hover the boundary
#      between two columns. The cursor changes to col-resize.
#   2. Drag the boundary. The two adjacent column widths update
#      smoothly. No flicker, no pointer-events bug.
#   3. Save, close, reopen the doc. Column widths are persisted
#      (they survived the markdown round-trip).
#
# Pass 5 — Equalize columns:
#   1. After Pass 4, the columns are uneven. Right-click on any cell.
#   2. Click "Equalize column widths". Every column snaps to the
#      same width. Save, reopen — equal widths persist.
#   3. Equalize on a 2-row × 3-col table where one cell has
#      colspan=2 (insert via "Merge cells"): the merged cell's
#      width remains 2 × per-column target; the unmerged column
#      stays at 1 × target.
#
# Pass 6 — Vertical alignment:
#   1. Make a row tall (insert a long paragraph in one cell so the
#      whole row stretches). Right-click on a short cell.
#   2. "Cell alignment ▸ Top". Cell content snaps to the top.
#   3. "Cell alignment ▸ Middle" — cell content centres vertically.
#   4. "Cell alignment ▸ Bottom" — sticks to bottom.
#   5. Save the note. Open it raw (file tree → preview as text or
#      open in an external editor). The cell renders as
#      `<td style="vertical-align: top">…</td>` (or middle/bottom)
#      inside the markdown HTML block. Reopen in Cortex — the
#      alignment is preserved.
#
# Pass 7 — Multi-type blocks:
#   1. Place cursor in the body of a daily note. Press Ctrl+Shift+B.
#      Modal opens with a "Block type" dropdown defaulting to
#      Experiment.
#   2. Pick "Protocol". The Experiment / iteration fields disappear
#      and a single "Protocol name" text input appears. Type
#      "Centrifuge wash". Click Insert.
#   3. The doc now contains:
#         ::protocol Centrifuge wash
#
#         (cursor lands here)
#
#         ::end
#      Decorated with the green strip; `::protocol Centrifuge wash`
#      header overlays as "Protocol · Centrifuge wash".
#   4. Repeat for Idea (`::idea …`) and Method (`::method …`). Same
#      green-strip styling; titles overlay as "Idea · …" /
#      "Method · …".
#   5. The Experiment branch still works: pick Experiment → existing
#      experiment dropdown + iteration input → Insert →
#      `::experiment NAME / iter-N` is decorated as before. Cluster
#      4's Rust-side `route_experiment_blocks` still routes only the
#      `::experiment` flavour into iteration daily-log auto-sections;
#      protocol / idea / method are visual only in v1.
#
# Pass 8 — ShortcutsHelp:
#   1. Press Ctrl+/ to open the shortcuts panel. Under "Editor mode"
#      a new row reads:
#         Ctrl+Shift+W   Wikilink: wrap selected text in [[…]],
#                        or open palette pick-mode if nothing selected
#
# ---------------------------------------------------------------------------
# Edge cases worth touching
# ---------------------------------------------------------------------------
#   a. Ctrl+Shift+W inside a table cell wraps the selection just
#      like in a regular paragraph — table-cell text is part of
#      the same ProseMirror selection model.
#   b. Ctrl+Shift+W inside a code block is a no-op (no selection or
#      a code-block selection); v1 doesn't enforce a hard guard but
#      the wrap-with-[[…]] is harmless inside code if it does fire.
#   c. Equalize columns on a single-column table: no-op (target ==
#      total). Equalize on an empty table: no-op (no rows).
#   d. Vertical-align on a cell that's also colspan-merged: the
#      verticalAlign attr lives on the cell node, so the merged
#      cell aligns its own content. Only the right-clicked cell
#      gets updated; sibling cells keep their previous alignment.
#   e. Multi-type block in an empty doc: header + closer get
#      inserted at depth 0; cursor lands on the empty body line.
#   f. Ctrl+S twice in rapid succession: each save round-trip is
#      idempotent (no setContent fires because content matches),
#      so no scroll perturbation.
#
# ---------------------------------------------------------------------------
# Sequenced follow-ups (not in this cluster)
# ---------------------------------------------------------------------------
#   - Cluster 17 — Block widget rewrite. Convert ::TYPE NAME blocks
#     to a real custom TipTap node so they hold bullets + tables,
#     are non-editable as a widget, and right-click can delete them
#     atomically. Migration path: same on-disk markers, schema
#     change is on the editor side only.
#   - Cluster 18 — Excel layer for tables. Formula parser
#     (=MEAN(C1:C3), =SUM(…), …), cell-type formatting (money /
#     date / percent / number), freeze rows / columns. Builds on
#     the column-resize foundation here.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check (no Rust changes; sanity only)" -ForegroundColor Cyan
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
    git commit -m "Cluster 16 v1.0 - QoL pack: table polish + wikilink shortcut + Ctrl+S scroll fix + multi-type blocks. Ctrl+S no longer jumps to bottom: Editor.tsx content effect now compares unescapeWikilinkBrackets(getMarkdown()) against editedBody, so the wikilink-escape round-trip no longer triggers a setContent that resets scrollTop. Ctrl+Shift+W: with selection, wraps in [[…]] via TabPaneHandle.wrapSelectionInWikilink (insertContentAt with the trimmed text); with no selection, App opens CommandPalette in pick-mode (new wikilinkPickMode state, optional onPickResult prop on CommandPalette, banner UI), and clicking a result calls TabPaneHandle.insertWikilinkAt(title) to insert [[Title]] at cursor. Tables: Table.configure({ resizable: true, handleWidth: 5 }) re-enabled; column dividers are draggable. TableContextMenu gains 'Equalize column widths' + 'Cell alignment' sub-menu (Top / Middle / Bottom). Editor.runTableAction routes equalizeColumns + valignTop/Middle/Bottom; equalizeColumnWidths(editor) walks descendants and sets each cell's colwidth via tr.setNodeMarkup. New ValignTableCell + ValignTableHeader extensions extend TableCell/TableHeader with a verticalAlign custom attr (parseHTML reads el.style.verticalAlign, renderHTML writes style='vertical-align: …') so per-cell alignment round-trips through tiptap-markdown's html:true serialiser. Block modal widened from experiment-only to four types: ExperimentBlockModal exports BlockType union and onConfirm signature is (type, name, iter?); modal renders a Type dropdown and conditionally shows the experiment dropdown + iter input vs. a single name input for protocol / idea / method. TabPaneHandle.insertExperimentBlock(type, name, iter?) builds the per-type header (`::experiment NAME / iter-N` vs. `::TYPE NAME`). ExperimentBlockDecoration regex split: EXPERIMENT_HEADER_RE for the iter-bearing flavour, SIMPLE_HEADER_RE for protocol|idea|method; decoration loop tries both and builds the data-title overlay accordingly. Cluster 4's Rust-side route_experiment_blocks unchanged — only ::experiment routes into iteration auto-sections; the other three are visual decorations only in v1. ShortcutsHelp gains a Ctrl+Shift+W row under Editor mode."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-16-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-16-v1.0-complete

Write-Host ""
Write-Host "Done. Cluster 16 v1.0 (QoL pack) shipped:" -ForegroundColor Green
Write-Host "  - Ctrl+S preserves scroll (unescape on the comparison side)" -ForegroundColor Green
Write-Host "  - Ctrl+Shift+W wikilink wrap + palette pick-mode" -ForegroundColor Green
Write-Host "  - Table column resize re-enabled" -ForegroundColor Green
Write-Host "  - Right-click 'Equalize column widths'" -ForegroundColor Green
Write-Host "  - Right-click 'Cell alignment > Top / Middle / Bottom'" -ForegroundColor Green
Write-Host "  - Ctrl+Shift+B opens BlockModal w/ Experiment / Protocol / Idea / Method" -ForegroundColor Green
Write-Host "  - ExperimentBlockDecoration recognises all four ::TYPE prefixes" -ForegroundColor Green
Write-Host "  - ShortcutsHelp documents the new Ctrl+Shift+W binding" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (separate clusters):" -ForegroundColor DarkGray
Write-Host "  - Cluster 17: block widget rewrite (custom node, holds bullets/tables, non-editable)" -ForegroundColor DarkGray
Write-Host "  - Cluster 18: Excel layer (formulas, cell types, freeze rows/columns)" -ForegroundColor DarkGray
