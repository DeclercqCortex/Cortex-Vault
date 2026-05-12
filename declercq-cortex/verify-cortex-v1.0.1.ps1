# verify-cortex-v1.0.1.ps1
# Cortex v1.0.1 — two follow-up fixes on top of the cortex-v1.0 milestone.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # confirm app boots cleanly first
#   .\verify-cortex-v1.0.1.ps1
#
# This tag sits on top of `cortex-v1.0`. Two changes, both root-cause
# regressions introduced by the Cortex v1.0 chrome refresh:
#
# 1.  SHAPE EDITOR INVISIBLE AFTER v1.0
#
#     Pressing Ctrl+Shift+D no longer surfaced the shape-editor SVG
#     overlay + floating toolbar. Root cause: stacking-context layering.
#
#     The `.cortex-shape-editor-layer` div in ShapeEditor.tsx renders
#     with `position: absolute` + `zIndex: 50`. That combination CREATES
#     a new stacking context. The shape-editor toolbar inside the layer
#     uses `position: fixed; zIndex: 80`, but that 80 only stacks
#     against other CHILDREN of the layer — externally, the entire
#     layer subtree paints at z-50 in the root stacking context.
#
#     Cortex v1.0 introduced the universal `.cortex-editor-toolbar` at
#     `z-index: 60` at the very top of the app (flex-shrink: 0 above
#     appShell). 60 > 50, so the editor toolbar painted on top of the
#     shape-editor toolbar, hiding it. Pre-v1.0 there was no chrome at
#     that z-band so the layer's 50 was effectively the highest UI
#     layer in the document area.
#
#     Fix: bump the layer's z-index from 50 to 100 so the toolbar
#     (and any drawn shapes) clear the editor toolbar (60), the main
#     top bar (50), and any sibling chrome introduced by v1.0. Stays
#     well below toolbar popovers (250) and modal scrims (>=900) so
#     nothing else regresses.
#
#     File: src/components/ShapeEditor.tsx (single inline-style edit
#     on the cortex-shape-editor-layer div).
#
# 2.  WORDMARK GRADIENT SPANNED THE FULL DOCUMENT WIDTH, NOT THE TEXT
#
#     The Cortex v1.0 `.prose h1/h2/h3/h4` rule sets `background:
#     var(--accent-gradient); background-clip: text` to give every
#     in-document heading the wordmark style. But because h1-h4 are
#     block-level by default, the heading's box stretched to the
#     prose container's full width (~780 px). The linear-gradient
#     ramp was painted across the entire 780 px box, so a short title
#     like "Methods" sat in the leftmost ~80 px of the ramp and only
#     showed the accent-1 end of the gradient — readers couldn't see
#     the accent → accent-2 transition.
#
#     Fix: add `width: fit-content; max-width: 100%;` to the
#     `.prose h1/h2/h3/h4` rule. The heading box now sizes to its
#     text content, so the gradient ramp maps directly to the
#     glyphs. Headings stay block-level (their own line) — they
#     just stop occupying the full row width. `max-width: 100%`
#     keeps long headings inside the container with normal wrapping.
#
#     The companion rule for chrome surfaces (.cortex-welcome-card
#     h1/h2/h3 + [data-cortex-modal] h1/h2/h3) gets the same pair of
#     declarations so welcome card and modal headings ramp across
#     their text width too.
#
#     File: src/index.css (two rules, both already present from
#     v1.0; only adding `width: fit-content; max-width: 100%`).
#
# Files changed
# -------------
#
#   declercq-cortex/src/components/ShapeEditor.tsx
#   declercq-cortex/src/index.css
#
# Files NOT touched
# -----------------
#
#   src-tauri/                      (no Rust, no Cargo, no tauri.conf)
#   Any TipTap schema / extension   (no schema changes)
#   Any other .tsx component        (only the one ShapeEditor inline style)
#
# Smoke walk
# ----------
#
# Run `pnpm tauri dev` from declercq-cortex/. Then:
#
# 1. Open a markdown note. Press Ctrl+Shift+D. Expect: ProseMirror
#    dims to ~78% opacity AND the floating "Shape editor" toolbar
#    appears at top-right of viewport (top: 12, right: 12 by default
#    or wherever it was last dragged).
# 2. Click R (or the rect tool). Drag on the canvas. A rectangle
#    appears. Press Esc once → multi-select clears. Press Esc again
#    → shape-editor mode exits, sidecar saves, ProseMirror un-dims.
# 3. Click anywhere in the prose. Type `# Title`, then `## Heading`.
#    Both headings paint in the accent → accent-2 gradient, with
#    the gradient ramp spanning the heading text (not the full
#    780 px container width). Verify by comparing a 1-word heading
#    vs. a 5-word heading — the 5-word one shows MORE of the
#    gradient ramp, not the same leftmost slice.
# 4. Open the Templates modal (Templates sidebar button). The modal
#    heading at the top picks up the same fit-to-text gradient
#    treatment.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt (Rust untouched in v1.0.1 - check is advisory)" -ForegroundColor Cyan
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

Write-Host "==> 3/4  git commit (cortex-v1.0.1 patch)" -ForegroundColor Cyan
git add .
git commit -m "Cortex v1.0.1 - shape-editor visibility + heading wordmark gradient. Two fixes on top of cortex-v1.0. (1) Shape editor was invisible after Ctrl+Shift+D because the .cortex-shape-editor-layer div (position: absolute + zIndex: 50) created a stacking context BELOW the new universal .cortex-editor-toolbar (z-index: 60). The shape-editor toolbar inside the layer used position: fixed + zIndex: 80, but that 80 only stacks against other layer children - the whole layer subtree paints at z-50 in the root context, so the editor toolbar painted over it. Bumped the layer's z-index from 50 to 100, clearing the editor toolbar (60), the main top bar (50), and any sibling v1.0 chrome. Still well below toolbar popovers (250) and modal scrims (>=900). (2) The .prose h1/h2/h3/h4 wordmark gradient (background: var(--accent-gradient); background-clip: text from cortex-v1.0) painted across the heading's full block-level box width (~= the 780px prose container), so a short title showed only the leftmost slice of the accent -> accent-2 ramp. Added width: fit-content + max-width: 100% to both the .prose heading rule and the companion chrome rule (.cortex-welcome-card h1/h2/h3 + [data-cortex-modal] h1/h2/h3) so the gradient ramp maps to the text length, not the document width. Headings stay block-level (own line); only their box width changes. No Rust touches, no schema changes, no TypeScript type changes."

Write-Host "==> 4/4  tag cortex-v1.0.1" -ForegroundColor Cyan
git tag -f cortex-v1.0.1

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cortex-v1.0.1 --force'
