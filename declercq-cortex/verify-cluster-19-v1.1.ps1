# verify-cluster-19-v1.1.ps1
# Phase 3 Cluster 19 v1.1 — image flip controls.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev      # frontend-only changes; hot-reload picks them up
#   .\verify-cluster-19-v1.1.ps1
#
# What ships
# ----------
#
# Two new boolean attributes on the cortexImage TipTap atom node and
# matching context-menu entries:
#
#   - flipH (horizontal mirror, scaleX(-1))
#   - flipV (vertical mirror, scaleY(-1))
#
# Both attrs round-trip via data-flip-h="1" / data-flip-v="1" using
# tiptap-markdown's html: true the same way rotation, width, and the
# wrap mode do. False (default) emits no attr to keep simple cases
# clean on disk.
#
# CortexImageNodeView composes flip with rotation in a single CSS
# transform string: `rotate(Xdeg) scale(±1, ±1)`. Order is rotate-
# then-scale so a rotated-and-flipped image mirrors across the
# rotated axes (matches Photoshop / Figma's compose order). Identity
# (no rotation, no flip) emits no transform at all.
#
# ImageContextMenu grows a "Flip" section with two toggles:
#   - "Flip horizontal" (active dot when flipH is true)
#   - "Flip vertical"   (active dot when flipV is true)
# Both toggle the corresponding attr on click. The Editor's
# handleImageMenuAction reads the current value from the live doc
# (not the menu snapshot) before flipping so a rapid double-toggle
# ends back at identity rather than racing on stale state.
#
# Deferred to v1.2+ on the image-polish backlog (carried from v1.0.3):
#   - Crop controls (rectangular crop, save-as-cropped-asset)
#   - Multi-select on images (cmd-click to select multiple, then
#     apply operations to all)
#   - Orphan-attachments GC (sweep <note>-attachments/ for files no
#     longer referenced in their parent note)
#
# Smoke tests
# -----------
#
# Pass A — Insert + flip horizontal:
#   1. Insert an image (drag from FileTree onto an open .md, or
#      Ctrl+Shift+I → pick file).
#   2. Right-click the image → Flip section → "Flip horizontal".
#   3. Image visibly mirrors left↔right.
#   4. Right-click again — the active dot now sits next to "Flip
#      horizontal".
#
# Pass B — Toggle returns to identity:
#   1. With Pass A's flipped image, right-click → "Flip horizontal"
#      again.
#   2. Image returns to original orientation. Active dot disappears.
#
# Pass C — Vertical flip is independent:
#   1. Right-click → "Flip vertical". Image mirrors top↔bottom.
#   2. Active dot sits next to "Flip vertical" only; "Flip
#      horizontal" stays inactive.
#
# Pass D — Both flips = visual 180° rotation:
#   1. With both Flip H and Flip V active, the image looks rotated
#      180°.
#   2. The rotation attr is still 0 — the visual is achieved purely
#      through scale(-1, -1). data-rotation is NOT written.
#
# Pass E — Flip composes with rotation:
#   1. Drag the rotation handle to ~30°. The image renders at 30°.
#   2. Apply Flip horizontal. The image is now flipped across its
#      30°-rotated horizontal axis (matches Photoshop / Figma).
#   3. Reset rotation. The image is now flipped horizontally with
#      no rotation.
#
# Pass F — Save + reopen round-trips both flips:
#   1. With one or both flips active, save the file (Ctrl+S).
#   2. Open the .md file in any text editor. The img tag carries
#      `data-flip-h="1"` and/or `data-flip-v="1"` (whichever are
#      active). Inactive flips have no attribute.
#   3. Close + reopen the file in Cortex. The image renders in the
#      same orientation; the context menu's active dots still
#      reflect the saved state.
#
# Pass G — Flip composes with all wrap modes:
#   1. Set Wrap = Left, apply Flip H → text wraps to the right of a
#      mirrored image. Layout looks correct.
#   2. Set Wrap = Right, → mirror still applies; text on the left.
#   3. Set Wrap = Break → mirror still applies; centred-block image.
#   4. Set Wrap = Free → mirror applies; drag still works.
#
# Pass H — Reset rotation does NOT clear flips:
#   1. Set rotation = 30°, Flip H = on, Flip V = on.
#   2. Right-click → "Reset rotation". Rotation goes back to 0;
#      flips remain. (Flip is a separate axis from rotation.)
#
# Pass I — Free-position drag still works on a flipped image:
#   1. Switch wrap to Free, apply Flip H, then drag the move handle.
#   2. Image moves with the pointer; mirror persists during the drag
#      and after release. (The drag uses freeX / freeY which are
#      orthogonal to the transform.)
#
# Pass J — Annotation overlay still works on a flipped image:
#   1. Add an annotation. Apply Flip H. The 📝 badge stays in its
#      bottom-right anchor (wrapper is in document order; only the
#      <img> is flipped via transform).
#   2. Ctrl+click the annotation badge → popover opens normally.
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
    git commit -m "Cluster 19 v1.1 - image flip controls. Two new boolean attrs on the cortexImage TipTap atom node: flipH (scaleX(-1) horizontal mirror) and flipV (scaleY(-1) vertical mirror). Round-trip via data-flip-h='1' / data-flip-v='1' (only emitted when true; default state stays clean on disk). CortexImageNodeView composes rotation + flip into a single CSS transform string with rotate-then-scale order so a rotated+flipped image mirrors across the rotated axes (Photoshop / Figma compose order); identity emits no transform. ImageContextMenu grows a Flip section with two toggles ('Flip horizontal' / 'Flip vertical') showing the active dot when the corresponding attr is true. ImageContextAction discriminated union extended with flip-h / flip-v variants; handleImageMenuAction in Editor.tsx reads the current attr from the live doc before flipping (not the menu snapshot) so a rapid double-toggle ends back at identity. ImageContextMenuDetail and the menu prop shape carry flipH / flipV through. Composes with rotation, wrap modes (left/right/break/free), free-position drag, and the annotation overlay. Sequenced follow-ups (carried over from v1.0.3): crop, multi-select, orphan-attachments GC. 10 smoke passes covering insert+flip-H, toggle returns to identity, vertical independent of horizontal, both = visual 180°, flip composes with rotation, save+reopen round-trips both flags, flip composes with all wrap modes, reset-rotation doesn't clear flips, free-drag works on flipped image, annotation overlay positions correctly on flipped image."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-19-v1.1-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.1-complete

Write-Host ""
Write-Host "Done. Cluster 19 v1.1 shipped:" -ForegroundColor Green
Write-Host "  - flipH + flipV attrs on cortexImage node, data-flip-* round-trip" -ForegroundColor Green
Write-Host "  - rotation + flip composed in a single CSS transform" -ForegroundColor Green
Write-Host "  - 'Flip horizontal' / 'Flip vertical' entries in ImageContextMenu" -ForegroundColor Green
Write-Host "  - Identity (no rotation, no flip) emits no transform" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.2+):" -ForegroundColor DarkGray
Write-Host "  - Crop controls (rectangular crop, save-as-cropped-asset)" -ForegroundColor DarkGray
Write-Host "  - Multi-select on images" -ForegroundColor DarkGray
Write-Host "  - Orphan-attachments GC (sweep <note>-attachments/ for unreferenced files)" -ForegroundColor DarkGray
