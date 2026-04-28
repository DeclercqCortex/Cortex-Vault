# verify-cluster-6.ps1
# Phase 3 Cluster 6 — PDF Reader + multi-tab layout (full cluster,
# shipped iteratively)
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install            # picks up pdfjs-dist
#   pnpm tauri dev          # smoke-test (see checklists below)
#   .\verify-cluster-6.ps1  # commit + tag
#
# A short walkthrough of what to test, in the order each Pass shipped:
#
# ---------------------------------------------------------------------------
# Pass 1 — open a PDF
# ---------------------------------------------------------------------------
#   1. Drop a small text-based PDF anywhere in the vault (a paper, a manual).
#   2. Click it in the file tree -> the editor pane is replaced by a PDF
#      reader that renders the pages vertically. Title bar shows the
#      filename and the back button works.
#
# ---------------------------------------------------------------------------
# Pass 2 — toolbar
# ---------------------------------------------------------------------------
#   1. Page indicator updates as you scroll. Type a page number and press
#      Enter -> jumps to it. Prev/Next arrows work.
#   2. Zoom +/- and Reset (the percentage button) work; Fit-Width sizes the
#      page to the available width.
#
# ---------------------------------------------------------------------------
# Passes 3 + 4 + 5 — annotations
# ---------------------------------------------------------------------------
#   1. Drag-select some text on a page. A floating bubble appears with seven
#      colour swatches.
#   2. Click yellow -> the selected text gets a yellow rectangle overlay.
#   3. Open the file at "<vault>/path/to/<pdf>.pdf.annotations.json" in any
#      text editor. Confirm: the annotation is in the JSON with kind:
#      "yellow", page: <whatever>, rects, text, created_at, resolved: false.
#   4. Click the yellow rectangle -> a side panel slides in with: jump-to-
#      page link, the highlighted text, colour swatches (current is
#      outlined), a note textarea, a resolved checkbox, a delete button.
#   5. Change colour to green -> overlay updates immediately. Add a note,
#      blur -> sidecar reflects it.
#   6. Mark resolved -> overlay opacity drops.
#   7. Delete -> overlay removed, sidecar reflects it.
#   8. Reload Cortex / reopen the PDF -> annotations persist.
#
# ---------------------------------------------------------------------------
# Pass 6 — marks integration
# ---------------------------------------------------------------------------
#   1. Make a yellow PDF annotation today.
#   2. Sidebar -> Reviews -> Weekly review -> the PDF's filename appears as
#      a row group; the highlighted text shows under it. The yellow PDF
#      highlight flows through Cluster 3's destination view alongside
#      yellow marks from notes.
#
# ---------------------------------------------------------------------------
# Pass 7 — search
# ---------------------------------------------------------------------------
#   1. Ctrl+K -> type a phrase you know is in the PDF body.
#   2. The PDF should appear as a result with the snippet showing the
#      match. Click it -> opens the PDF reader.
#   3. (Note: scanned/image-only PDFs won't be searchable — extraction
#      returns nothing for those. That's expected per the cluster spec.)
#
# ---------------------------------------------------------------------------
# Pass 8 — reading log
# ---------------------------------------------------------------------------
#   1. Open today's daily log (Ctrl+D).
#   2. Type a line:  ::reading <today's YYYY-MM-DD>
#                    ::end
#   3. Save (Ctrl+S), close, and reopen the file.
#   4. Between the markers, the file now has a Markdown list of every PDF
#      annotation made today, grouped by PDF and page.
#
# ---------------------------------------------------------------------------
# Pass 9 (v1.5) — multi-tab layout
# ---------------------------------------------------------------------------
#   1. Top-right corner has a "Layout" toggle. Open it -> 5 options
#      (Single, Two side-by-side, Two top one bottom, One top two
#      bottom, Quad). Each option shows a tiny preview icon. Slot
#      numbering runs top-to-bottom, left-to-right.
#
#   2. Pick "Two side-by-side". The main pane splits into two equal
#      halves with a draggable divider. Click a file in the sidebar ->
#      it opens in slot 1 (left). Ctrl+Click a different file -> it
#      opens in slot 2 (right). Click yet another file (no Ctrl) ->
#      it switches the file in slot 1.
#
#   3. Drag the vertical divider between the two slots -> the panes
#      resize live. Stop dragging -> sizes persist when you reload.
#
#   4. With slot 1 active, press Ctrl+S -> only slot 1's file saves
#      (slot 2 stays alone). Click into slot 2; the active-slot label
#      in the top bar updates to "Active: slot 2". Press Ctrl+R -> only
#      slot 2's file reloads from disk.
#
#   5. Pick "Quad (2x2)". Slots numbered 1 (top-left), 2 (top-right),
#      3 (bottom-left), 4 (bottom-right). Drag any file from the
#      sidebar onto slot 3 -> it opens there (other slots untouched).
#
#   6. Press Ctrl+K -> palette appears. Click a result. A modal asks
#      "Open in which slot?" — pick slot 4. The file opens there and
#      the palette closes.
#
#   7. Pick "Two top, one bottom". Slot 1 top-left, slot 2 top-right,
#      slot 3 spans the full bottom. There are TWO draggable dividers:
#      vertical between 1 and 2, horizontal between top row and slot 3.
#
#   8. Pick "One top, two bottom". Slot 1 spans the top, slot 2 is
#      bottom-left, slot 3 is bottom-right.
#
#   9. Switch back to Single layout. Slots 2-4 disappear from view but
#      their state is preserved — switch back to quad, the previously
#      open files are still in slots 2-4. (The hidden panes also
#      participate in save-on-close: edit a file in slot 3, switch to
#      single, close the window -> the slot 3 edits are saved before
#      the window closes.)
#
#  10. Inside any pane, the existing functionality still works:
#      backlinks, related-hierarchy, queue views, idea log,
#      methods, protocols, PDF reader. Each pane is fully
#      independent — you can have a PDF in slot 1, a markdown
#      note in slot 2, the methods arsenal in slot 3, and an
#      idea-log view in slot 4 simultaneously.
#
# ---------------------------------------------------------------------------
# Pass 9 fixups (still v1.5)
# ---------------------------------------------------------------------------
#   a. Sidebar click routing: plain click opens the file in the
#      currently ACTIVE slot (the one the user last clicked into).
#      Ctrl+Click opens in the next slot in slot order, wrapping.
#      In dual that gives "left, then right, then left again." In
#      tri/quad it cycles 1->2->3(->4)->1. Drag-and-drop remains
#      the explicit "open in this slot" affordance.
#
#   b. Quad layout actually works. (CSS Grid requires every named
#      area to be rectangular; the original quad template had the V
#      and H dividers each split across two non-contiguous cells,
#      which silently broke the layout.) The fix uses four distinct
#      shards (v1/v2/h1/h2) all driven by the same colFrac/rowFrac
#      so they move in sync visually.
#
#   c. Double-click any divider to equalize the two panes it
#      straddles (resets the fraction to 0.5). Tooltip on hover
#      reads "Drag to resize · double-click to equalize."
#
#   d. Drag-and-drop into a slot now actually drops into that slot
#      even when the slot already has a TipTap editor open — the
#      drop handlers run in CAPTURE phase and stopPropagation()
#      before TipTap's bubble-phase listener can consume the drop.
#      The file-tree drag also stopped advertising `text/plain`
#      (only `text/cortex-path`) so even a slipped event has
#      nothing for the editor to insert as text.
#
#   e. PDF horizontal scroll: a zoomed-in PDF used to bleed off
#      the left edge with no way to reach it. The page container
#      gained `min-width: max-content` (so it expands to fit the
#      widest page), and the PDF view drops the pane padding so
#      the page can use the full slot width.

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
    git commit -m "Cluster 6 v1.5 - PDF Reader + multi-tab layout: render + annotate + sidecar + marks + FTS5 + reading log + annotations panel + linked-notes backlinks + real-time in-PDF search (normalized, starred-overlap, two-tab palette filter) + two-page view + collapsible sidebar (in every view) + Ctrl-only hover affordance + N-tab layout (single, dual, tri-bottom, tri-top, quad) with draggable dividers, Ctrl+Click routing, drag-to-slot, search-result slot picker, per-active-slot Ctrl+R/Ctrl+S, save-on-close fan-out across all panes"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-6-v1.5-complete" -ForegroundColor Cyan
git tag -f cluster-6-v1.5-complete

Write-Host ""
Write-Host "Done. Cluster 6 shipped:" -ForegroundColor Green
Write-Host "  - PDF rendering inside Cortex (read_binary_file + PDF.js)" -ForegroundColor Green
Write-Host "  - Toolbar: page nav, zoom, fit-width" -ForegroundColor Green
Write-Host "  - Text-selection annotation creation in seven colours" -ForegroundColor Green
Write-Host "  - Annotation overlay + side-panel editing" -ForegroundColor Green
Write-Host "  - Sidecar JSON persistence (<pdf>.annotations.json)" -ForegroundColor Green
Write-Host "  - Marks-table integration (PDF highlights flow into Cluster 3)" -ForegroundColor Green
Write-Host "  - PDF text extraction in Rust -> FTS5 (palette-searchable)" -ForegroundColor Green
Write-Host "  - ::reading DATE ::end block populator on daily-log open" -ForegroundColor Green
Write-Host "  - Multi-tab layout: single / dual / tri-bottom / tri-top / quad" -ForegroundColor Green
Write-Host "    with draggable dividers, slot-aware shortcuts, drag-to-slot" -ForegroundColor Green
Write-Host "    routing, and search-palette slot picker" -ForegroundColor Green
