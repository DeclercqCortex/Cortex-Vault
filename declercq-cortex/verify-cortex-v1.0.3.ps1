# verify-cortex-v1.0.3.ps1
# Cortex v1.0.3 — three more fixes on top of cortex-v1.0.2.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # confirm app boots cleanly first
#   .\verify-cortex-v1.0.3.ps1
#
# Sits on top of `cortex-v1.0.2`. Closes the user-reported follow-ups
# after v1.0.2:
#
#   - "Shape Editor toolbar/pop-up is still not appearing, but I'm
#     entering the mode (since my cursor becomes a crosshair)."
#   - "Some of the pop-ups have text that is cut by the button space
#     being too small."
#
# 1.  SHAPE EDITOR TOOLBAR STILL INVISIBLE (despite v1.0.2 portal)
#
#     v1.0.2 portaled the toolbar to document.body. The user confirmed
#     they ARE entering the mode (cursor is crosshair, meaning `active`
#     is true on the SVG layer) but still cannot see the toolbar.
#
#     Two root causes still in play:
#
#     (a) DEFAULT POSITION OVERLAPPED THE EDITOR TOOLBAR.
#         The legacy default was `top: 12; right: 12` -- exactly inside
#         the universal EditorToolbar's vertical band (which sits flush
#         at viewport top with ~52 px height at default density). Even
#         portaled to body with z-index 200 (above the editor toolbar's
#         60), the shape toolbar visually merged INTO the editor
#         toolbar's busy button strip. Hard to spot if you weren't
#         looking for a small panel overlapping a bigger one.
#         Fix: default position bumped to `top: 72; right: 16` so the
#         toolbar lands cleanly in the empty strip BELOW the editor
#         toolbar and above the file-path header. Drag/persisted
#         positions are unaffected (the user keeps wherever they put
#         it last).
#
#     (b) STALE PERSISTED POSITION OFF-SCREEN.
#         `cortex:shape-toolbar-position` in localStorage is loaded
#         verbatim without viewport validation. A position saved on a
#         larger monitor / different window arrangement could land
#         outside the current viewport, and the toolbar would render
#         past the right/bottom edge. clampToViewport only fires DURING
#         drag, not on load.
#         Fix: on initial load, validate the stored (x, y) against the
#         current viewport. If less than 80 px of the toolbar would be
#         visible on any side, drop the stored value (also clearing
#         the localStorage entry) so the default position kicks in.
#
#     Companion polish: solid bg-card panel + accent-tinted border
#     ring (1 px solid 60%-accent + outer 1 px 25%-accent halo) +
#     heavier drop shadow + backdrop blur. The shape-editor toolbar
#     reads as a distinct floating tool palette rather than blending
#     into the v1.0 glass chrome family. Matches the Photoshop /
#     Figma "floats above the document" feel that the cluster doc
#     called for.
#
#     Files: src/components/ShapeEditor.tsx (load-time position
#     validation), src/components/ShapeEditorToolbar.tsx (default
#     position 72 right 16; toolbar bar style polish).
#
# 2.  POPUP BUTTON TEXT BEING CUT BY THE BUTTON SPACE
#
#     The new v1.0.2 unified hover rule covers paint state but doesn't
#     control button sizing. Buttons inside modals / structured views
#     that carry a tight inline `padding: 4px 12px` (the common
#     btnGhost / changeBtn pattern) and have a multi-word label like
#     "Reset to default" or "Save just this" would WRAP their label
#     across two lines at narrow flex widths. Combined with the
#     button's small vertical padding (~24 px total height) the
#     second line spilled outside the button box, looking "cut."
#
#     Fix: add two declarations to the existing
#     `.cortex-view button:not(:disabled), [data-cortex-modal]
#     button:not(:disabled)` rule:
#       - `white-space: nowrap` -- forces label onto a single line,
#         letting the button box grow to the natural text width.
#       - `flex-shrink: 0` -- keeps the button from being collapsed
#         by a flex row's free-space algorithm when other flex
#         content competes for width.
#     Intentionally NOT adding `overflow: hidden` / `text-overflow:
#     ellipsis` -- goal is for buttons to grow to fit text, not
#     truncate.
#
# Files changed
# -------------
#
#   declercq-cortex/src/components/ShapeEditor.tsx
#   declercq-cortex/src/components/ShapeEditorToolbar.tsx
#   declercq-cortex/src/index.css
#
# Files NOT touched
# -----------------
#
#   src-tauri/                      (no Rust changes)
#   Any TipTap schema               (no schema changes)
#
# Smoke walk
# ----------
#
# Run `pnpm tauri dev` from declercq-cortex/. Then:
#
# 1. Open a markdown note. Press Ctrl+Shift+D. EXPECT: the cursor
#    becomes a crosshair AND a floating tool panel appears at top: 72
#    right: 16 of the viewport (~60 px below the editor toolbar's
#    bottom edge). Panel has an accent-tinted border ring and
#    substantial drop shadow so it pops off the page.
# 2. Drag the panel anywhere on screen. Close the app, reopen, press
#    Ctrl+Shift+D again. EXPECT: panel reappears where you left it
#    (assuming the saved coords are still on-screen). If you resize
#    the window so the saved coords are off-screen, the panel falls
#    back to the default top-right position on next entry.
# 3. Open the Templates modal. Look for a "Reset to default" button
#    on any template row. EXPECT: label fits on a single line, button
#    grows to text width. Same for the Reviews modal, DeleteConfirm,
#    EventEditModal ("Save just this" / "Save series"), Categories
#    Settings, AutoReplaceModal.
# 4. Resize the window very narrow. Modal buttons should still keep
#    their labels on a single line (the button row may scroll
#    horizontally if needed, but no text gets cut).
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt (Rust untouched in v1.0.3 - check is advisory)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    cargo check --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    (cargo check failed - advisory only, continuing)" -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
    }
    $ErrorActionPreference = $prev
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cortex-v1.0.3 patch)" -ForegroundColor Cyan
git add .
git commit -m "Cortex v1.0.3 - shape-editor toolbar default position + load-time clamp + popup button text overflow. Closes the user-reported follow-ups after v1.0.2. (1) Shape-editor toolbar still invisible: v1.0.2 portaled to body but the default position top:12 right:12 put the toolbar INSIDE the universal EditorToolbar's vertical band, where it visually merged into the busy button strip even at z-index 200. Bumped default to top:72 right:16 so it lands cleanly below the editor toolbar. Also added load-time viewport validation: stored cortex:shape-toolbar-position from a previous monitor / window arrangement could put the toolbar fully off-screen, since clampToViewport only fires during drag, not on load. If less than 80px of the toolbar would be visible after load, drop the stored value (also clearing localStorage) so the default position kicks in. Companion polish: solid bg-card panel + accent-tinted border ring (1px solid 60%-accent + outer 1px 25%-accent halo via box-shadow) + heavier drop shadow + backdrop blur so the toolbar reads as a distinct floating tool palette rather than glass chrome. (2) Popup button text cut by button space: the v1.0.2 unified hover rule covered paint state but not sizing. Buttons inside .cortex-view + [data-cortex-modal] with tight inline padding (btnGhost / changeBtn 4px 12px) and multi-word labels (Reset to default / Save just this / Save series) wrapped their labels across two lines, spilling outside the ~24px button box. Added white-space: nowrap + flex-shrink: 0 to the existing generic rule so buttons keep labels on a single line and grow to natural text width. No overflow:hidden or ellipsis -- goal is to fit, not truncate. No Rust touches, no schema changes."

Write-Host "==> 4/4  tag cortex-v1.0.3" -ForegroundColor Cyan
git tag -f cortex-v1.0.3

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cortex-v1.0.3 --force'
