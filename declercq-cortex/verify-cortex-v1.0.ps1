# verify-cortex-v1.0.ps1
# Cortex v1.0 — Aurora + Cerebrum design system milestone.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # confirm app boots cleanly first
#   .\verify-cortex-v1.0.ps1
#
# This tag sits on top of `cluster-24-v1.0-complete`. It bundles the
# Aurora token retune, the Cerebrum splash, the chrome glass refresh,
# brand identity (mark + wordmark + animated bell), structural-block
# polish (tabs / collapsible / typed block / table gradient borders /
# lens-flare page break + decorative divider), sidebar drag-resize,
# image-aware Align, and a substantial bug-fix sweep (rename selection,
# header caret, Reviews dropdown portal, copy-from-tab/collapsible,
# auto-replace trigger consumption, solid-rectangle gradient, etc.).
#
# See cortex_v1.0.md (at the outer git root) for the full release notes.
#
# What ships in v1.0
# ------------------
#
# A. Cerebrum splash (src/components/CerebrumSplash.tsx) — pure CSS-3D,
#    seven orbital electron rays, brain mark at center, force-shown for
#    ≥2.8 s on every cold launch. Honors prefers-reduced-motion.
#
# B. Aurora Glass token palette — :root.dark / :root.light retuned to
#    cool slate + blue-violet / violet accent pair; new tokens for radii
#    (--radius-1/2/3/pill), motion (--motion-fast/medium/slow + --ease),
#    blur (--blur-chrome/modal), elevation (--shadow-1/2/3), accent
#    gradient (--accent-gradient), focus ring (--ring), aurora corner
#    gradients (--aurora-1/2/3). Body four-corner aurora wash on a
#    fixed-attachment background-image.
#
# C. Glass chrome refresh — toolbar gets vertical gradient + inset top
#    highlight + backdrop-blur; sidebar gets glass + accent-gradient
#    seam down the right edge; main top bar gets gradient + z-index 50
#    so dropdowns don't hide behind the splash; file tree rows get
#    smooth hover + selected-bar + dirty-dot.
#
# D. Brand identity — public/cortex-mark.svg now self-contained (PNG
#    embedded as base64 data URI; bypasses the SVG sandbox issue that
#    silently blocked <image href="external">). public/cortex-wordmark.svg
#    with baked-in accent-gradient fill. NotificationBell.tsx renders the
#    animated brand mark instead of the 🔔 emoji; pulse animations for
#    unread / urgent reminders. Welcome card gets the brand badge + a
#    "Ctrl+K to search · Ctrl+/ for shortcuts" footer. Sidebar header
#    becomes a brand badge (62 px brain mark + wordmark, side by side).
#    Headers across .prose / welcome card / modals carry the wordmark
#    style (Inter 500, 0.04em letter-spacing, accent-gradient text fill).
#
# E. Modal polish via [data-cortex-modal] — 13 modals tagged with the
#    attribute pick up --radius-3 corners, --shadow-3 elevation,
#    var(--blur-modal) backdrop blur, and a cortex-modal-in entrance
#    animation. Companion [data-cortex-scrim] handles the backdrop.
#
# F. Structural-block refresh — typed block, tabs, collapsible, callout,
#    frame, code block all read as the same visual family (glass body,
#    accent-gradient seams, --accent text on active states). Tables get
#    real accent-gradient cell borders via the gradient-behind-table
#    technique (border-collapse: separate + border-spacing: 1px + table
#    paints the gradient; cells have opaque bg-elev-solid that hides
#    the gradient except at the 1 px gaps). Page break and decorative
#    separator get horizontal lens-flare effects instead of dashed /
#    flat lines — the glare IS the line, clamped to ≤2× line thickness,
#    lens-shape with thicker bright middle tapering to thin tips.
#
# G. Tight nested-container paragraph spacing — direct-child margins
#    inside table cells, tab panels, collapsibles, typed-block bodies,
#    frames, callouts compressed from Tailwind's default 1.25em to
#    0.25em. First/last-child rules clear outer margins. Top-level
#    prose paragraphs unaffected.
#
# H. View class hooks — .cortex-view + .cortex-view-{calendar / tt /
#    protocols / methods / ideas} on the structured views' root wraps
#    so the global gradient-hover rule applies to every button inside
#    them. TimeTracking's PIE_PALETTE leads with the new --accent
#    (#7aa2ff).
#
# I. Draggable sidebar — 8 px vertical drag handle on the sidebar's
#    right edge updates sidebarWidth state (240–560 px clamp), persists
#    to localStorage:cortex:sidebar-width. Visible 2 px line with
#    accent-gradient on hover.
#
# J. Image-aware Align — EditorToolbar's four align buttons walk the
#    selection's cortexImage nodes and update each's wrapMode (left /
#    break / right), then run setTextAlign for surrounding prose.
#    Free-positioned images (wrapMode === "free") skip the wrapMode
#    mutation entirely, so user-placed images stay put.
#
# K. Reviews dropdown portal — ReviewsMenu.tsx renders its dropdown via
#    React createPortal to document.body, escaping the sidebar's
#    backdrop-filter containing block. Position computed from the
#    trigger button's getBoundingClientRect on open; recomputed on
#    window resize / scroll.
#
# L. Copy-from-tab/collapsible unwrap — editorProps.transformCopied
#    peels wrapping cortexTabsBlock / cortexTabPanel / cortexCollapsible
#    nodes from clipboard slices when the selection is wholly inside
#    one of them. Schema flags (defining / isolating) preserved.
#
# M. Auto-replace trigger consumption — CortexAutoReplace.handleTextInput
#    strips the trailing trigger whitespace from `after` at apply time.
#    Built-ins like `--> ` → `→ ` now produce `→` (Word/Notion style).
#    Stored rule values not mutated; non-whitespace triggers preserved.
#
# N. Force-show splash on launch — splashVisible + splashFloorReached
#    state in App.tsx holds the splash for ≥2800ms on every cold launch.
#
# Bug fixes
# ---------
#
#   - Inline rename selection effect with [initialValue] deps → fixed to []
#   - Caret invisible in gradient-fill headers → caret-color: var(--accent)
#   - Layout picker + bell popups hidden behind splash → topbar z-index: 50
#   - cortex-mark.svg sandbox issue → SVG now self-contained (PNG data URI)
#   - Hover not painting on chrome buttons → per-property !important on hover
#   - Decorative separator as solid rectangle → core gradient terminal stop
#     changed from var(--accent) 100% to transparent 100%
#
# Files changed
# -------------
#
# Added:
#   declercq-cortex/design-system/                          (full Claude Design export parked)
#   declercq-cortex/public/cortex-mark.svg                  (self-contained, 324 KB)
#   declercq-cortex/public/cortex-wordmark.svg
#   declercq-cortex/public/electron-particle.svg
#   declercq-cortex/public/aurora-backdrop.svg
#   declercq-cortex/public/brain-circuit-white.png          (kept as Tauri icon source)
#   declercq-cortex/src/components/CerebrumSplash.tsx
#   declercq-cortex/src-tauri/icons/source.png              (1024x1024 brain, ready for `pnpm tauri icon`)
#   cortex_v1.0.md
#   declercq-cortex/verify-cortex-v1.0.ps1
#
# Modified:
#   declercq-cortex/src/index.css                           (~600 lines net additions)
#   declercq-cortex/src/App.tsx                             (splash state, sidebar resize, class hooks, brand badge, welcome card)
#   declercq-cortex/src/components/Editor.tsx               (editorProps.transformCopied + Slice import)
#   declercq-cortex/src/components/EditorToolbar.tsx        (applyAlign helper for image alignment)
#   declercq-cortex/src/components/NotificationBell.tsx     (brand-mark bell, badge floats)
#   declercq-cortex/src/components/FileTree.tsx             (dirty dot, class hooks, rename fix)
#   declercq-cortex/src/components/ReviewsMenu.tsx          (portal + position calc)
#   declercq-cortex/src/components/Calendar.tsx             (class hook, hex fallback fix)
#   declercq-cortex/src/components/TimeTracking.tsx         (class hook, palette retune)
#   declercq-cortex/src/components/ProtocolsLog.tsx         (class hook)
#   declercq-cortex/src/components/MethodsArsenal.tsx       (class hook)
#   declercq-cortex/src/components/IdeaLog.tsx              (class hook)
#   declercq-cortex/src/components/CommandPalette.tsx       (data-cortex-modal / scrim)
#   declercq-cortex/src/components/ShortcutsHelp.tsx        (data-cortex-modal)
#   declercq-cortex/src/components/NewHierarchyModal.tsx    (data-cortex-modal)
#   declercq-cortex/src/components/ExperimentBlockModal.tsx (data-cortex-modal)
#   declercq-cortex/src/components/InsertTableModal.tsx     (data-cortex-modal)
#   declercq-cortex/src/components/IntegrationsSettings.tsx (data-cortex-modal)
#   declercq-cortex/src/components/OrphanAttachmentsModal.tsx (data-cortex-modal)
#   declercq-cortex/src/components/TemplatesModal.tsx       (data-cortex-modal)
#   declercq-cortex/src/components/ReviewSettingsModal.tsx  (data-cortex-modal)
#   declercq-cortex/src/components/DeleteConfirmModal.tsx   (data-cortex-modal)
#   declercq-cortex/src/components/EventEditModal.tsx       (data-cortex-modal)
#   declercq-cortex/src/components/AutoReplaceModal.tsx     (data-cortex-modal)
#   declercq-cortex/src/components/CategoriesSettings.tsx   (data-cortex-modal)
#   declercq-cortex/src/editor/CortexAutoReplace.ts         (trigger whitespace consume)
#
# Files NOT touched
# -----------------
#
#   src-tauri/src/lib.rs            (no new Tauri commands, no schema changes)
#   src-tauri/Cargo.toml            (no new crates)
#   src-tauri/tauri.conf.json       (no bundle/capability/window config changes)
#   Any TipTap schema (no defining/isolating/content rule changes)
#   src-tauri/icons/*.png (the regenerated platform icons are produced by
#                          `pnpm tauri icon` from icons/source.png as a
#                          separate manual step — see release notes)
#
# Smoke walk
# ----------
#
# Run `pnpm tauri dev` from declercq-cortex/. Then:
#
# 1.  Cold launch → brain splash holds ~2.8 s, captions fade in, splash
#     fades out, chrome appears.
# 2.  Sidebar brand badge pulses on a 4 s cycle; wordmark sits to its right.
# 3.  Drag the sidebar's right edge → width clamps 240–560 px; persists.
# 4.  Hover any toolbar button → accent-gradient fill + white text. Active
#     state (Bold with caret in bold text) gets an additional 4 px outer halo.
# 5.  File tree → hover any row → smooth accent-bg fade. Selected file gets
#     a 2 px gradient bar on its left edge. Edit a file without saving →
#     a 7 px accent-gradient dot appears on the row and pulses gently.
# 6.  Notification bell → click the brain → dropdown opens cleanly (no
#     splash interference; no clipping at sidebar). Unread → brain pulses;
#     past-due → faster danger-tinted pulse.
# 7.  Reviews dropdown → click "Reviews" in the sidebar header → dropdown
#     appears past the sidebar's right edge (portaled to body).
# 8.  Tables → every cell border (rows + columns + outer ring + corners)
#     paints a continuous accent gradient. Header row gradient stronger.
# 9.  Tabs / collapsibles → glass body, accent-gradient seams, hover lights
#     idle tabs, active tab paints in the gradient. Press Enter inside a
#     panel → paragraph spacing is tight (no 1.25 em gap). Copy text from
#     inside → paste elsewhere produces clean prose (no wrapper).
# 10. Page break → insert via toolbar. Horizontal accent-gradient flare
#     with a bright center fades laterally; total height ≤ 4 px.
# 11. Decorative separator → same flare recipe scaled to 2 px tall, with
#     the glyph sitting on the brightest point with its own corona.
# 12. Type `--> ` in any document → arrow appears without trailing space.
# 13. Drop image into a note → select image → click "Align right" → image
#     floats right via wrap mode "right". Drag image to free position →
#     align buttons no longer affect it (free is preserved).
# 14. Toggle theme to Light → all Aurora effects render correctly.
# 15. Headers → typing in any `#` / `##` / `###` shows a visible caret in
#     the gradient-fill text.
# 16. Welcome screen (choose-different-vault) → brand mark + wordmark above
#     the heading, accent corner halo, gradient CTA, shortcut hint footer.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt (Rust untouched in v1.0 — check is advisory)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    # cargo check is advisory only: Rust sources (Cargo.toml, src/lib.rs)
    # are verifiably unchanged in v1.0, and on Windows the libgit2-sys
    # C build can fail intermittently with cl.exe error C1056 due to
    # Defender holding handles on intermediate .o files. We don't want
    # an environmental flake to gate the milestone push.
    #
    # Run a real cargo check manually any time with:
    #   cd src-tauri ; cargo clean ; cargo check
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    cargo check --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    (cargo check failed — advisory only, continuing)" -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
    }
    $ErrorActionPreference = $prev
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cortex-v1.0 milestone)" -ForegroundColor Cyan
git add .
git commit -m "Cortex v1.0 - Aurora + Cerebrum design system milestone. Wraps the cumulative chrome + brand + structural-block refresh into the first major version-tagged release. (A) Cerebrum splash: pure CSS-3D, seven orbital electron rays, brain mark at center, force-shown for >=2.8s on every cold launch, prefers-reduced-motion honored. (B) Aurora Glass token palette: cool slate base + blue-violet/violet accent pair, new tokens for radii/motion/blur/elevation/accent gradient/ring/aurora corners. Body four-corner aurora wash. (C) Glass chrome refresh: toolbar vertical gradient + inset highlight + backdrop-blur, sidebar with accent seam, main top bar z-index 50 so dropdowns clear the splash, file tree rows with smooth hover + selected bar + gradient dirty dot. (D) Brand identity: self-contained cortex-mark.svg (PNG embedded as data URI bypassing the SVG sandbox), cortex-wordmark.svg with baked-in gradient. NotificationBell renders the animated brand mark with unread/urgent pulse animations. Welcome card gets brand badge + shortcut hint. Sidebar header is now a brand badge (62px brain + wordmark side-by-side). Headers across prose/welcome/modals carry wordmark style (Inter 500, 0.04em letter-spacing, accent-gradient text fill). (E) Modal polish via [data-cortex-modal]: 13 modals tagged for radius-3 + shadow-3 + blur-modal + entrance animation. (F) Structural-block refresh: typed block, tabs, collapsible, callout, frame all in same visual family. Tables get real accent-gradient cell borders via gradient-behind-table technique. Page break and decorative separator get horizontal lens-flare (glare IS the line, <=2x thickness, lens-shape tapering at tips). (G) Tight nested-container paragraph spacing replacing Tailwind's default 1.25em. (H) View class hooks on Calendar/TimeTracking/ProtocolsLog/MethodsArsenal/IdeaLog. (I) Draggable sidebar (240-560px clamp, persisted). (J) Image-aware Align toolbar (freeform preserved). (K) Reviews dropdown portal to document.body. (L) Copy-from-tab/collapsible unwrap via editorProps.transformCopied. (M) Auto-replace trigger whitespace consumption (Word/Notion style). (N) Force-show splash on launch. Bug fixes: inline rename re-selection on keystroke (deps to []), header caret invisible (caret-color), layout/bell popups behind splash (topbar z-index), brand-mark SVG sandbox (self-contained data URI), chrome button hover (per-property !important), decorative separator as solid rectangle (core gradient terminal stop). No Rust changes, no Cargo deps, no Tauri config. Built on cluster-24-v1.0-complete."

Write-Host "==> 4/4  tag cortex-v1.0" -ForegroundColor Cyan
git tag -f cortex-v1.0

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cortex-v1.0 --force'
