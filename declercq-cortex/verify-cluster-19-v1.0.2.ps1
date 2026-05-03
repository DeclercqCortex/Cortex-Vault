# verify-cluster-19-v1.0.2.ps1
# Phase 3 Cluster 19 v1.0.2 — Image polish pass.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend hot-reload
#   .\verify-cluster-19-v1.0.2.ps1
#
# Five issues from v1.0.1 testing:
#
#   1. Resize handle drifted away from the bottom-right corner of the
#      image (and the rotation handle drifted similarly on rotation).
#      → Handles are now anchored at exact corners via
#        `transform: translate(±50%, ±50%)`. The handle is always
#        centred on the image's corner regardless of rendered width,
#        float context, or any inline-block descender quirks.
#      → `.cortex-image-anchor` got `font-size: 0` + `vertical-align:
#        top` so the box matches the image pixel-for-pixel.
#
#   2. Hover selection outline grew beyond the image into the next
#      paragraph row.
#      → Replaced `outline + outline-offset` with a tight inset
#        `box-shadow: 0 0 0 2px var(--accent)`. box-shadow doesn't
#        affect layout (the row below stays put) and the inset stops
#        the ring from drifting into neighbouring content.
#
#   3. The 📝 emoji badge looked inconsistent across OSes.
#      → Replaced with an inline SVG comment-bubble icon. Crisp at
#        any size, themable via `currentColor`, and uniform across
#        Windows / macOS / Linux. Badge is now a 22×22 circular
#        chip; matches the corner-handle visual language.
#
#   4. Annotation interaction split:
#      → Plain click on the badge → opens a read-only "view bubble"
#        showing the annotation text. Auto-closes on outside click
#        / Esc. Includes a hint footer "Ctrl+click image to edit".
#      → Ctrl+click on the badge OR the image → opens the editable
#        popover (existing v1.0 behaviour).
#      → Cursor feedback when Ctrl/Cmd is held: badge cursor flips
#        to text-edit, image cursor flips to pointer (rides on the
#        pre-existing `body.cortex-mod-pressed` class managed by
#        App.tsx — same pattern as the PDF wikilink hover).
#      → New CustomEvent `cortex:view-image-annotation` for the
#        view-only path; Editor.tsx listens for both events.
#
#   5. Imported images defaulted to `wrapMode: "break"`.
#      → Default switched to `wrapMode: "free"` with seeded
#        (freeX, freeY) computed from the drop coords (when given)
#        else from the cursor position via `view.coordsAtPos`.
#        Coordinates are translated into .ProseMirror-relative
#        pixels so absolute positioning resolves correctly. Images
#        land where you put them and are draggable from frame one;
#        Wrap left / right / break are still available via the
#        right-click menu.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Handles flush to corners:
#   1. Insert a small image (e.g. 200×200). Hover. The three handles
#      sit centred ON the corners (half-on, half-off the image),
#      not floating away from it.
#   2. Resize wider. Handles stay flush throughout the drag.
#   3. Rotate 30°. Handles stay flush to the rotated image's
#      corners (drag-shadow follows shape; handles follow layout).
#
# Pass B — Selection outline contained:
#   1. Click an image to select. The ring sits exactly on the
#      image's edge — does not bleed into the row of text below.
#   2. Click another paragraph; the ring clears.
#
# Pass C — Annotation badge:
#   1. Add an annotation to an image. The badge appears at the
#      bottom-left as a small circular chip with an SVG comment-
#      bubble icon (not 📝).
#   2. Hover the badge — accent-coloured.
#
# Pass D — Click vs Ctrl+click on the badge:
#   1. Click the badge (no modifier). A read-only bubble pops up
#      below the image showing the annotation text + a footer hint
#      "Ctrl+click image to edit". Click outside or press Esc to
#      close.
#   2. Ctrl+click the badge. The editable popover opens instead
#      (same as Ctrl+click the image directly).
#
# Pass E — Cursor feedback under Ctrl:
#   1. Hold Ctrl. Hover an image with an annotation: cursor becomes
#      pointer over the image, text-edit over the badge. Release
#      Ctrl: cursor returns to normal.
#
# Pass F — Default free mode on insert:
#   1. With a markdown note open, press Ctrl+Shift+I. Pick an
#      image. The image lands AT the cursor position with wrapMode
#      = "free" — drag it anywhere immediately; the move handle
#      (top-left ⋮⋮) is visible because the image is in free mode.
#   2. Drag an image from the file tree onto a paragraph. It lands
#      AT the drop point in free mode.
#   3. Right-click → Wrap left / right / break still available;
#      switching out of free mode hides the move handle and the
#      image flows in source order.
#
# Pass G — Round-trip on save + reload:
#   1. Insert an image (free mode, default). Move it, rotate it,
#      add an annotation. Save (Ctrl+S). Reload (Ctrl+R).
#   2. Position, rotation, width, badge all preserved. The on-disk
#      <img> has data-wrap="free" + data-free-x + data-free-y.
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
    git commit -m "Cluster 19 v1.0.2 - image polish pass. (1) Corner handles re-anchored via transform: translate(+/-50%, +/-50%) so they sit exactly on the image's corners regardless of float / margin / inline-block descender quirks; .cortex-image-anchor got font-size: 0 + vertical-align: top so the box matches the image pixel-for-pixel. (2) Selection outline switched from outline+outline-offset to box-shadow 0 0 0 2px var(--accent) so it stays self-contained and doesn't bleed into the next paragraph row. (3) Annotation badge replaced 📝 emoji with an inline SVG comment-bubble icon (uniform across OSes, themed via currentColor); badge is now a 22x22 circular chip matching the corner-handle visual language. (4) Annotation interaction split into click-to-view (read-only bubble with 'Ctrl+click image to edit' hint footer) and Ctrl+click-to-edit (popover, same as Ctrl+click on image). New cortex:view-image-annotation CustomEvent + ViewImageAnnotationDetail; Editor.tsx state imageBubble + listener + outside-click/Esc close. Cursor feedback under Ctrl rides on the existing body.cortex-mod-pressed class (set by App.tsx, same pattern as PDF wikilink hover). (5) New images default to wrapMode: 'free' with seeded (freeX, freeY) computed from drop coords when given, else from view.coordsAtPos(selection.from); images land where you put them and are draggable from frame one. Wrap left/right/break still in the right-click menu."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-19-v1.0.2-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.0.2-complete

Write-Host ""
Write-Host "Done. Cluster 19 v1.0.2 (image polish) shipped:" -ForegroundColor Green
Write-Host "  - Handles flush to image corners via transform translate" -ForegroundColor Green
Write-Host "  - Selection ring contained (box-shadow, no bleed)" -ForegroundColor Green
Write-Host "  - SVG annotation icon (cross-OS consistent)" -ForegroundColor Green
Write-Host "  - Click badge = read-only bubble; Ctrl+click = edit" -ForegroundColor Green
Write-Host "  - Ctrl-pressed cursor feedback on badge + image" -ForegroundColor Green
Write-Host "  - New images default to free wrap with seeded coords" -ForegroundColor Green
