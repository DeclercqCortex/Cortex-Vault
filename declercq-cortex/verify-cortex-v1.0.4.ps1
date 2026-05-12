# verify-cortex-v1.0.4.ps1
# Cortex v1.0.4 — single fix on top of cortex-v1.0.3.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # confirm app boots cleanly first
#   .\verify-cortex-v1.0.4.ps1
#
# Sits on top of `cortex-v1.0.3`. Clarifies the v1.0.3 misinterpretation
# of "popup text being cut by button space" -- the user actually meant
# dropdown labels being vertically clipped at the top and bottom inside
# the NewHierarchyModal (Create new project / experiment / iteration /
# idea / method / protocol) and similar modals.
#
# 1.  DROPDOWN LABEL VERTICALLY CLIPPED INSIDE THE SELECT BOX
#
#     The Cortex v1.0 dropdown rule at index.css:3865 set every
#     `<select>` inside `[data-cortex-modal]` / `.cortex-select` /
#     `[data-cortex-popover]` to a fixed `height: 28px` with
#     `box-sizing: border-box` -- a HARD constraint that includes
#     borders and padding inside the 28 px.
#
#     The default `font-size: 0.85rem` + `line-height: 1.2` glyph fits
#     in 28 px with room to spare (~16 px line in 28 px box). But many
#     modals override the select's inline style with larger metrics:
#
#       NewHierarchyModal:        font-size: 0.9rem + padding: 0.45rem 0.6rem
#       EventEditModal:           similar
#       AutoReplaceModal sub-modal: similar
#
#     With `padding: 0.45rem 0.6rem` (= 7.2 px vertical) plus a
#     `line-height: 1.2 * 0.9rem` (= 17.28 px) line, the NATURAL
#     content height is ~31.7 px. Crammed into the 28 px border-box,
#     Chromium clipped 2 px off the top and 2 px off the bottom of
#     the glyph. The user saw "the description text for the dropdowns
#     is cut off a little at the top and bottom from its residing box."
#
#     Fix: change the global rule's `height: 28px` to `min-height:
#     28px`. The select still defaults to 28 px when no overrides are
#     present (no visual change for the cortex-tb-popover selects or
#     any default-styled select), but grows when inline padding /
#     font-size push the natural content taller. Also bumped the
#     default vertical padding from 0 to 4 px so the un-overridden
#     default has more breathing room between glyph and edge, and
#     `line-height: 1.2` -> 1.3 for slightly better legibility.
#
# Files changed
# -------------
#
#   declercq-cortex/src/index.css   (single CSS rule)
#
# Files NOT touched
# -----------------
#
#   src-tauri/                      (no Rust changes)
#   Any TipTap schema               (no schema changes)
#   Any .tsx component              (the fix is purely CSS)
#
# Smoke walk
# ----------
#
# Run `pnpm tauri dev` from declercq-cortex/. Then:
#
# 1. Sidebar -> + Proj. EXPECT: the "Project / Experiment / Iteration /
#    Idea / Method / Protocol" select shows its current label cleanly
#    without ANY top/bottom clipping inside the select box.
# 2. Sidebar -> + Exp. Open the "Project" dropdown. EXPECT: each
#    option's label sits inside the select with comfortable padding;
#    no clipping.
# 3. Sidebar -> + Iter. Open the "Experiment" dropdown. Same.
# 4. Sidebar -> + Method. Open the "Domain" and "Complexity"
#    dropdowns. Same -- "Complexity" labels like "3" or "5 (hairy)"
#    fit cleanly.
# 5. Sidebar -> + Protocol. Open the "Domain" dropdown. Same.
# 6. Open the EventEditModal (Calendar -> click an event). Verify
#    every <select> inside it (Category, Recurrence, etc.) renders
#    its label without clipping.
# 7. Open the AutoReplaceModal (Auto-replace sidebar button). Verify
#    its <select>s render without clipping. Also open the Rich
#    snippet sub-modal -- any <select> there inherits the same rule.
# 8. Confirm the cortex-tb-popover selects in the toolbar (font
#    picker, code language picker) are visually unchanged -- they
#    don't override font-size / padding so they stay at the compact
#    28 px height.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt (Rust untouched in v1.0.4 - check is advisory)" -ForegroundColor Cyan
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

Write-Host "==> 3/4  git commit (cortex-v1.0.4 patch)" -ForegroundColor Cyan
git add .
git commit -m "Cortex v1.0.4 - dropdown label vertical clipping in modals. Clarifies the v1.0.3 misinterpretation -- the user meant dropdown labels being vertically clipped inside the NewHierarchyModal / EventEditModal / AutoReplaceModal selects, not button text wrapping. Cortex v1.0's [data-cortex-modal] select rule pinned every modal <select> to height: 28px with box-sizing: border-box -- a hard constraint that included borders + padding inside 28px. The default metrics (font 0.85rem + line-height 1.2 + 0 vertical padding) fit in 28px with room to spare, but modals that override with larger inline padding/font (NewHierarchyModal sets padding 0.45rem 0.6rem + font 0.9rem) hit a natural content height of ~32px and Chromium clipped 2px off the top and 2px off the bottom of the glyph. Fix: change height to min-height so the box can grow when inline overrides push content taller, while still defaulting to a compact 28px for un-overridden selects. Also bumped default vertical padding from 0 to 4px and line-height 1.2 -> 1.3 for slightly more breathing room on the un-overridden default. No Rust touches, no schema changes."

Write-Host "==> 4/4  tag cortex-v1.0.4" -ForegroundColor Cyan
git tag -f cortex-v1.0.4

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cortex-v1.0.4 --force'
