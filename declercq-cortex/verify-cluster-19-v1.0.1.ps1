# verify-cluster-19-v1.0.1.ps1
# Phase 3 Cluster 19 v1.0.1 — Image fix pack.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (frontend hot-reload only)
#   .\verify-cluster-19-v1.0.1.ps1
#
# Six issues from initial v1.0 testing, plus one console error:
#
#   1. Clicking an image file in the tree showed "Could not open file:
#      Failed to read file: stream did not contain valid UTF-8" because
#      TabPane's file-read effect tried to read the binary as markdown.
#      → TabPane.tsx: file-read effect short-circuits for image paths
#        (mirroring the existing PDF short-circuit).
#
#   2. Shadow only visible in light mode AND didn't follow rotation;
#      rotated images bled a rectangular bg over images underneath them.
#      → src/index.css: switched from `box-shadow` on a wrapper span
#        to `filter: drop-shadow` on the <img> itself. drop-shadow
#        follows the image's actual rendered shape (rotation included)
#        and respects transparent regions, so overlapping rotated
#        images no longer paint a rectangle over each other.
#      → Dark-mode: drop-shadow is brightened (a light halo + thin
#        contrast ring) via @media (prefers-color-scheme: dark) AND a
#        `[data-theme="dark"]` / `.dark` parent selector for any app-
#        level dark mode toggle.
#      → Removed the .cortex-image-shadow wrapper span (no longer
#        needed) and its `background: var(--bg)` / 1px outline (the
#        actual cause of the rectangular bleed behind transparent
#        regions).
#
#   3. Resize handles didn't track the image's new bounds during
#      drag — they snapped only after the drag ended.
#      → New `.cortex-image-anchor` inner wrapper sits tight against
#        the <img>'s rendered bounds (line-height: 0 to eat the
#        descender gap; display: inline-block to shrink-wrap). The
#        three corner handles are children of the anchor, so they
#        re-anchor at every paint (which fires on every width change)
#        instead of riding on the outer wrapper's float / margin box.
#
#   4. Wrap modes (Wrap left / Wrap right) did not actually reflow
#      surrounding text — text just sat below the image.
#      → CortexImageNode: changed `group: "block"` to
#        `group: "inline", inline: true`. The image now lives inside
#        a paragraph alongside text, so CSS `float: left/right` on
#        the wrapper makes adjacent text reflow around it. (Block-
#        level images break the line and have no inline siblings to
#        wrap.) On-disk format is unchanged — same <img> with the
#        same data-* attrs.
#      → ProseMirror "TextSelection endpoint not pointing into a
#        node with inline content (doc)" warning in the console came
#        from the same root cause (block atom at a doc-level
#        position). Resolved by the inline spec change.
#
#   5. Image was supposed to be freely movable during wrap and break
#      modes with text adapting in real time.
#      → In wrap and break modes, the image is now ProseMirror-
#        draggable (the wrapper sets `data-drag-handle=""` so PM
#        picks up native HTML5 drag). Drag the image to a different
#        paragraph and it relocates in the doc; surrounding text
#        reflows naturally because float anchors against the image's
#        new source position. Free mode keeps the dedicated 2D drag
#        handle (top-left ⋮⋮) for absolute positioning.
#      → Note: continuous "drag-anywhere with live shape-aware text
#        reflow" (CSS `shape-outside`) is deliberately deferred —
#        that combination of float + absolute is a known hard
#        problem and the doc-position-drag approach gets 90% of the
#        feel for 5% of the complexity.
#
#   6. insertImageFromPath used setTextSelection + insertContent
#      which threw the TextSelection error when the drop coordinates
#      landed at a block boundary.
#      → TabPane.tsx: switched to `insertContentAt(pos, node)` which
#        resolves the position internally and lands cleanly on
#        either inline or block boundaries.
#
# ---------------------------------------------------------------------------
# Smoke test checklist (re-run the v1.0 walk + the four below)
# ---------------------------------------------------------------------------
#
# Pass A — Image file opens in ImageViewer (not as md):
#   1. Click an image file in the tree. The active slot switches to
#      ImageViewer. NO error banner about "stream did not contain
#      valid UTF-8". Console is quiet.
#
# Pass B — Shadow follows rotation, no rectangular bleed:
#   1. Insert two images, both with transparent corners (e.g. PNGs).
#   2. Switch one to "Free position", drag it on top of the other.
#      Rotate the top one 30°. The shadow tilts with it; the lower
#      image's pixels remain visible through the top image's
#      transparent corners (no rectangular bg bleed).
#   3. Toggle the OS / app theme to dark. The shadow stays visible
#      (light halo + soft contrast).
#
# Pass C — Resize handles track in real time:
#   1. Hover an image. Drag the bottom-right ⤡ handle. The handle
#      stays glued to the image's new bottom-right corner the whole
#      time you drag, not just on release.
#   2. Same for rotate handle (top-right) — it tracks the image's
#      rotated top-right corner during the rotation gesture.
#
# Pass D — Wrap modes reflow text:
#   1. Open a note with multiple paragraphs of text. Click in a
#      paragraph and Ctrl+Shift+I to insert an image into it.
#   2. Right-click → Wrap left. The paragraph's text wraps to the
#      RIGHT of the image (image floats left, text on right side).
#   3. Right-click → Wrap right. Wrap flips.
#   4. Right-click → Break. Image becomes block-level; text breaks
#      cleanly above and below.
#   5. Right-click → Free position. Image detaches; the move handle
#      reappears at top-left.
#
# Pass E — Drag image in wrap mode → relocate in doc:
#   1. With an image set to Wrap left in paragraph A, click and drag
#      the image (anywhere on it, no special handle needed) to
#      paragraph C. The image relocates; paragraph A's text closes
#      up; paragraph C's text now wraps around it.
#   2. The free-mode move handle (⋮⋮) does NOT appear in wrap modes;
#      only rotate (↻) and resize (⤡) handles show on hover.
#
# Pass F — Console quiet:
#   1. Throughout the above, no "TextSelection endpoint" warnings,
#      no UTF-8 errors, no other ProseMirror complaints.
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
    git commit -m "Cluster 19 v1.0.1 - image fix pack. (1) TabPane file-read effect short-circuits for image paths so clicking an image file in the tree no longer triggers 'stream did not contain valid UTF-8' (mirrors the existing PDF short-circuit). (2) Shadow switched from box-shadow on a wrapper span to filter: drop-shadow on the <img> itself so it follows rotation and respects transparent regions; dark-mode override via @media (prefers-color-scheme: dark) AND parent [data-theme='dark'] / .dark selector for the app-level toggle; .cortex-image-shadow wrapper + its background + outline removed (those were the cause of overlapping rotated images bleeding rectangular bg over each other). (3) New .cortex-image-anchor inner wrapper hosts the three corner handles so they track the image's rendered bounds 1:1 during resize / rotate (line-height: 0 to eat the descender gap, display: inline-block to shrinkwrap). (4) CortexImage node changed from group: 'block' to group: 'inline' + inline: true so wrap-left / wrap-right floats actually have adjacent inline text to reflow around. On-disk format unchanged. (5) In wrap and break modes the wrapper exposes data-drag-handle so ProseMirror's native HTML5 drag picks up the image; users drag the image into a different paragraph and surrounding text reflows naturally via float anchored at the new source position. The dedicated 2D move handle (top-left dots) only renders in free mode now. (6) TabPane.insertImageFromPath switched from setTextSelection + insertContent to insertContentAt(pos, node) which resolves the position internally — fixes the 'TextSelection endpoint not pointing into a node with inline content (doc)' ProseMirror warning when the drop coords landed on a block boundary."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-19-v1.0.1-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.0.1-complete

Write-Host ""
Write-Host "Done. Cluster 19 v1.0.1 (image fix pack) shipped:" -ForegroundColor Green
Write-Host "  - File-read short-circuits on image paths" -ForegroundColor Green
Write-Host "  - drop-shadow on image (rotates, no rectangular bleed, dark-mode visible)" -ForegroundColor Green
Write-Host "  - Anchor wrapper so handles track resize/rotate in real time" -ForegroundColor Green
Write-Host "  - Inline node spec — wrap modes actually reflow text" -ForegroundColor Green
Write-Host "  - PM-native drag in wrap/break for repositioning across paragraphs" -ForegroundColor Green
Write-Host "  - insertContentAt fixes TextSelection console warning" -ForegroundColor Green
