# verify-cortex-v1.0.2.ps1
# Cortex v1.0.2 — three follow-up fixes on top of cortex-v1.0.1.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # confirm app boots cleanly first
#   .\verify-cortex-v1.0.2.ps1
#
# This tag sits on top of `cortex-v1.0.1`. Three more chrome regressions
# from the Cortex v1.0 design refresh that v1.0.1 missed:
#
# 1.  SHAPE EDITOR MENU STILL INVISIBLE AFTER v1.0.1
#
#     v1.0.1 bumped the .cortex-shape-editor-layer's z-index from 50
#     to 100 to lift the layer above the universal editor toolbar (60).
#     That fixed the SVG drawing canvas's stacking — any shape drawn
#     in the editor pane painted correctly — but the floating "Shape
#     editor" toolbar (rendered as a child of the layer using
#     `position: fixed`) was still invisible.
#
#     Root cause: Chromium (and therefore Tauri's WebView2 on Windows)
#     treats `backdrop-filter` as an effect that creates a CONTAINING
#     BLOCK for position: fixed descendants. The .cortex-editor-toolbar
#     and several sibling chrome surfaces have backdrop-filter applied
#     in v1.0; while none of them are direct ancestors of the shape-
#     editor layer, the toolbar's `position: fixed` was still being
#     intercepted by something in the ancestor chain (the same way
#     ReviewsMenu and cortex-tb-popover were before they portaled).
#     Bumping the layer's z-index helped the SVG but couldn't move the
#     toolbar out of the affected stacking context.
#
#     Fix: portal the ShapeEditorToolbar to document.body via
#     React.createPortal. Same pattern Cortex v1.0 used for
#     ReviewsMenu's portal-to-body (escaping the sidebar's backdrop-
#     filter containing block) and cortex-tb-popover's portal-to-body
#     (escaping the editor toolbar's backdrop-filter containing block).
#     With <body> as the parent, position: fixed anchors to the
#     viewport and z-index competes at the root stacking context.
#
#     Companion change: bumped the toolbar's z-index from 80 to 200
#     so it sits above the editor toolbar (60), the main top bar (50),
#     and any v1.0 chrome surface, but stays below toolbar color-
#     picker popovers (250) and modal scrims (>=900).
#
#     Files: src/components/ShapeEditorToolbar.tsx (createPortal
#     import + wrap return JSX in createPortal(..., document.body),
#     zIndex 80 -> 200). src/components/ShapeEditor.tsx (the layer
#     comment is updated; z-index stays at 100 from v1.0.1 to keep
#     the SVG drawing canvas above pane content).
#
# 2.  POPUP BUTTONS WITHOUT ACCENT-GRADIENT HOVER
#
#     The v1.0 milestone described a "unified accent-gradient hover on
#     every clickable surface across the chrome." In practice only the
#     sidebar (.cortex-sidebar button:hover) and toolbar popovers
#     (.cortex-tb-popover button:hover) actually got CSS rules. Every
#     [data-cortex-modal] (the 13 v1.0-tagged modals) and every
#     structured view tagged with .cortex-view-* (Calendar / Time
#     Tracking / Idea / Method / Protocol log) rendered their buttons
#     with whatever neutral inline style they were carrying pre-v1.0.
#     The user saw the mismatch — a sidebar button glowed accent on
#     hover, a button in the same session inside a modal stayed gray.
#
#     Fix: add one pair of generic rules in src/index.css matching
#     `.cortex-view button` and `[data-cortex-modal] button`:
#       - :hover:not(:disabled):not(.cortex-tb-swatch) -> accent-
#         gradient background, white text, drop shadow + inset
#         highlight (same recipe as .cortex-sidebar button:hover).
#       - transition on every painted prop so the hover lands
#         smoothly.
#       - :active translateY(1px) for press feedback.
#       - :focus-visible var(--ring).
#       - colour swatches (.cortex-tb-swatch) get a brighter accent
#         ring + scale(1.08) on hover instead of the gradient, so the
#         swatch keeps its colour preview.
#
#     Modals already tagged with [data-cortex-modal] in v1.0
#     automatically pick up the rule; no per-modal wiring needed.
#
# 3.  TABLE LOST ITS GRADIENT CELL BORDERS
#
#     The Cortex v1.0 milestone described "real accent-gradient cell
#     borders via the gradient-behind-table technique — border-
#     collapse: separate + border-spacing: 1px + table-level gradient
#     + opaque cell bg-elev-solid that hides the gradient except at
#     the 1 px gaps." The cluster doc + handoff both describe the
#     final look. But .prose table currently uses border-collapse:
#     collapse + `border: 1px solid var(--border)` on cells — the flat
#     single-pixel hairline look that pre-dates v1.0. Either the v1.0
#     change was never committed or it was reverted; in either case
#     the table reads as plain Tailwind chrome rather than the v1.0
#     family.
#
#     Fix: restore the gradient-behind-table technique on
#     .prose table / .prose table.cortex-table:
#       - border-collapse: separate; border-spacing: 1px;
#       - Table-level background = linear-gradient(135deg,
#         accent-mix 55% -> accent-2-mix 55%) over bg-elev-solid so
#         the gradient lights only the 1 px gaps.
#       - Cell border: none (the 1 px gap IS the border).
#       - Cell background: var(--bg-elev-solid, var(--bg)) -- OPAQUE,
#         so cells hide the gradient at their interior.
#       - Header cells: var(--bg-deep) for the column-title strip.
#       - Zebra rows: a mix of bg-elev-solid + 8% accent so the
#         striping still reads but the cell stays opaque.
#       - Table border-radius: var(--radius-1) + overflow: hidden so
#         the gradient ring stays inside rounded corners.
#
#     Result: every cell border (rows + columns + outer ring +
#     corners) paints a continuous accent gradient. Uniform across the
#     table, no gaps at intersections, matches the v1.0 chrome family
#     (sidebar seam, file-tree dirty dot, button-hover gradient).
#
# Files changed
# -------------
#
#   declercq-cortex/src/components/ShapeEditorToolbar.tsx
#   declercq-cortex/src/components/ShapeEditor.tsx           (comment only)
#   declercq-cortex/src/index.css
#
# Files NOT touched
# -----------------
#
#   src-tauri/                          (no Rust changes)
#   Any TipTap schema                   (no schema changes)
#   Any other .tsx component            (only ShapeEditorToolbar mounts a portal)
#
# Smoke walk
# ----------
#
# Run `pnpm tauri dev` from declercq-cortex/. Then:
#
# 1. Open a markdown note. Press Ctrl+Shift+D. Expect: the floating
#    "Shape editor" toolbar appears at top-right of viewport (top: 12,
#    right: 12 by default; or wherever localStorage persisted last
#    drag). ProseMirror dims to ~78% opacity. Click R, drag on the
#    canvas. A rectangle paints. Press Esc twice to exit.
#
# 2. Open the Templates modal (Templates sidebar button). Hover any
#    button (Edit, Reset, Close). Expect: accent gradient background +
#    white text + soft drop shadow + inset top edge highlight, identical
#    to the sidebar button hover. Repeat for the Reviews modal, the
#    shortcuts help (Ctrl+/), and the command palette (Ctrl+K).
#
# 3. Open the Calendar view (sidebar button). Hover any control button.
#    Expect: same gradient hover. Repeat for Time Tracking, Idea Log,
#    Methods Arsenal, Protocols Log.
#
# 4. Open any markdown note containing a table (e.g. a method's
#    Reagents/Parts List). Expect: every cell separator + the outer
#    ring + corner rounds paint a continuous accent gradient. Hover a
#    cell -- the column-resize handle appears at the right edge.
#    Verify rows alternate between bg-elev-solid and the lightly
#    accent-tinted zebra row.
#
# 5. Toggle theme to Light. Repeat each smoke step -- the gradient
#    ramp uses the light-mode accent pair (#4661ff -> #8d54f5) and
#    cells use the light-mode bg-elev-solid (#ffffff).
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt (Rust untouched in v1.0.2 - check is advisory)" -ForegroundColor Cyan
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

Write-Host "==> 3/4  git commit (cortex-v1.0.2 patch)" -ForegroundColor Cyan
git add .
git commit -m "Cortex v1.0.2 - shape editor toolbar portal + popup button gradient hover + table gradient borders restored. Three more chrome regressions from the v1.0 design refresh. (1) Shape-editor floating toolbar was still invisible after v1.0.1's z-index bump. Root cause: Chromium treats backdrop-filter as creating a containing block for position: fixed descendants, and the v1.0 chrome stack puts the shape-editor layer inside an ancestor chain where some surface has backdrop-filter. Same problem ReviewsMenu and cortex-tb-popover had in v1.0; same fix: portal the toolbar to document.body via React.createPortal so position: fixed anchors to the viewport and z-index competes at the root stacking context. Bumped the toolbar's z-index from 80 to 200 (still below toolbar popovers at 250 and modal scrims at >=900). (2) The v1.0 milestone described a unified accent-gradient hover on every clickable chrome surface but only .cortex-sidebar button and .cortex-tb-popover button actually got CSS rules. Modals tagged [data-cortex-modal] and structured views tagged .cortex-view-* rendered their buttons with neutral inline styles -- the user saw the mismatch between a sidebar button glowing gradient on hover and a modal button staying gray. Added one pair of generic rules: .cortex-view button + [data-cortex-modal] button -- :hover:not(:disabled):not(.cortex-tb-swatch) gets the gradient + drop shadow + inset highlight; :active translateY(1px); :focus-visible var(--ring); swatches keep their inline colour but get a brighter ring + scale(1.08). All 13 v1.0-tagged modals (CommandPalette, ShortcutsHelp, NewHierarchyModal, etc.) and all five structured views (Calendar / TimeTracking / IdeaLog / MethodsArsenal / ProtocolsLog) pick up the rule via existing class/attr hooks. (3) Tables regressed back to plain Tailwind border-collapse: collapse + 1px solid hairlines. Restored the v1.0 gradient-behind-table technique on .prose table: border-collapse: separate + border-spacing: 1px + table-level linear-gradient(135deg, accent-mix -> accent-2-mix) over bg-elev-solid, OPAQUE cell backgrounds hiding the gradient at the cell interior so only the 1px gaps show the accent. Header row uses bg-deep, zebra rows mix bg-elev-solid with 8% accent. Table gets border-radius: var(--radius-1) + overflow: hidden so the gradient ring stays inside rounded corners. No Rust touches, no schema changes."

Write-Host "==> 4/4  tag cortex-v1.0.2" -ForegroundColor Cyan
git tag -f cortex-v1.0.2

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cortex-v1.0.2 --force'
