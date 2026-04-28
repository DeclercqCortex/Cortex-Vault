# verify-cluster-6.ps1
# Phase 3 Cluster 6 — PDF Reader (full cluster, shipped iteratively)
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
    git commit -m "Cluster 6 v1.4 - PDF Reader: render + annotate + sidecar + marks + FTS5 + reading log + annotations panel + linked-notes backlinks + real-time in-PDF search (normalized, starred-overlap, two-tab palette filter) + two-page view + collapsible sidebar (in every view) + Ctrl-only hover affordance"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-6-v1.4-complete" -ForegroundColor Cyan
git tag -f cluster-6-v1.4-complete

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
