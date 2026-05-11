# Cortex v1.0 — Aurora + Cerebrum design system

The first major version-tagged release of Cortex. Wraps the cumulative chrome refresh, design-system integration, brand identity, structural-block polish, and bug-fix work shipped in this session into a single milestone.

This is a milestone tag (`cortex-v1.0`), not a per-cluster tag. It sits ON TOP of `cluster-24-v1.0-complete` (the last shipped cluster). Conceptually it spans two un-tagged clusters of work — Cluster 25 (Aurora Glass token + chrome refresh) and Cluster 26 (Cerebrum splash + complete structural-block + brand identity + flare effects). Both were shipped as a single unified visual pass; tagging them under one `cortex-v1.0` marker keeps the milestone history clean.

---

## Status

✅ Shipped — `cortex-v1.0`.

---

## What's in v1.0

### A. Cerebrum splash

A startup composition that holds for ~2.8 s on every cold launch — the rotating brain mark surrounded by seven electron-ray orbits, captioned "Cortex / local-first research notebook." Lives at `src/components/CerebrumSplash.tsx`.

- Pure CSS-3D. Seven `.splash-orbit` divs each tilted on three axes (`--rx`, `--ry`, `--rz`) and spinning continuously at irrational angular ratios so the pattern never visually repeats. Inline custom properties carry the per-orbit parameters from the React component.
- Brain mark loaded from `/cortex-mark.svg` (self-contained — see "Brand assets" below).
- Light caption fade-in for "Cortex" (Inter 500, accent-gradient text fill) followed by "local-first research notebook" (JetBrains Mono uppercase).
- Force-show on every launch via `splashVisible` state + `splashFloorReached` timer in `App.tsx`. Fades when both the 2.8 s floor has elapsed AND `loading` is false. Rendered at top level of every render branch (loading / welcome / main app) at `z-index: 1`.
- `prefers-reduced-motion: reduce` honored — orbits freeze in their initial tilt; captions skip the fade-in.

### B. Aurora Glass token palette

Every interactive surface reads from CSS variables. The retune at `src/index.css:48-155`:

- **Dark mode**: `--bg #0d1018`, `--bg-elev rgba(30,36,54,0.62)`, `--bg-card rgba(26,31,46,0.86)`, `--text #ebeefb`, `--text-2 #c2cae0`, `--accent #7aa2ff` (blue-violet), `--accent-2 #a98bff` (violet), `--accent-gradient: linear-gradient(135deg, accent → accent-2)`.
- **Light mode**: same gradient family at `#4661ff → #8d54f5` over `#fbfbfd`.
- **Shared tokens**: `--radius-1: 6px`, `--radius-2: 10px`, `--radius-3: 14px`, `--radius-pill: 999px`, `--motion-fast: 120ms`, `--motion-medium: 220ms`, `--motion-slow: 380ms`, `--ease: cubic-bezier(0.25,0.8,0.4,1)`, `--blur-chrome: saturate(160%) blur(12px)`, `--blur-modal: saturate(150%) blur(20px)`, `--shadow-1/2/3`, `--ring`, `--aurora-1/2/3`, `--aurora-base #141a2c`.
- **Body backdrop**: four-corner aurora wash (blue top-left + bottom-right, violet top-right + bottom-left) painted as fixed-attachment radial gradients. Subtle by design (alphas 0.06–0.10); chrome surfaces with `backdrop-filter` blur pick up the wash through their translucency.

### C. Glass chrome refresh

Every chrome surface either glasses up (translucent + backdrop-filter) or gets explicit class hooks for CSS-driven hover / focus / active states. The shipping convention from here on: **inline-style baseStyles set structure (width / flex / padding / position); CSS class hooks set visuals (background / blur / border / shadow / hover) via `!important` per-property only where the inline style competes.**

- **Toolbar** (`.cortex-editor-toolbar`): vertical gradient `linear-gradient(180deg, --bg-elev, --bg-deep)` + `backdrop-filter: var(--blur-chrome)` + 1 px inset top highlight + `--shadow-1`.
- **Toolbar buttons** (`.cortex-tb-btn`): `--radius-1` corners, smooth transitions on every state property, accent-gradient + white text on `:hover`, additional 4 px outer halo on `.active`, `var(--ring)` on `:focus-visible`.
- **Sidebar** (`.cortex-sidebar`): translucent `--bg-elev` + `--blur-chrome`. Faint vertical accent-gradient seam down the right edge via `::after`. Every button inside the sidebar gets gradient-fill hover via `.cortex-sidebar button:hover:not(:disabled)`.
- **Brand badge in sidebar** (`.cortex-sb-brand`): brain mark + wordmark side-by-side. 62 px brain pulses on a 4 s `cortex-sb-brand-pulse` keyframe (scale + slight rotate, no filter animation). Wordmark fills the remaining horizontal space at `max-width: 200px; max-height: 46px`. No frame, no aurora window, no drop-shadow halo on the mark — just the white brain.
- **Main top bar** (`.cortex-main-topbar`): glass vertical gradient + backdrop-blur + inset top highlight + `position: relative; z-index: 50` (lifts the topbar's stacking context above the splash so dropdowns within it — bell + layout picker — render visibly).
- **File tree rows** (`.cortex-filetree-row`): `--radius-1` corners, smooth hover background, selected rows get a 2 px accent-gradient bar on the left edge via `::before`. Dirty rows get a 7 px accent-gradient `.cortex-filetree-dirty-dot` on the right edge with a 2.4 s pulse animation.

### D. Brand identity

- **Canonical brand mark**: `public/cortex-mark.svg` — a self-contained SVG with `brain-circuit-white.png` embedded as a base64 data URI (PNG resized to 512 × 397 first). Total file size 324 KB. Every `<img>` in the app references this path: splash center, sidebar brand badge, welcome card, notification bell.
- **Wordmark**: `public/cortex-wordmark.svg` — "Cortex" text in Inter 500 with a baked-in accent-gradient `<linearGradient>` fill.
- **Headers carry the wordmark style**: `.prose h1/h2/h3/h4`, `.cortex-welcome-card h1/h2/h3`, `[data-cortex-modal] h1/h2/h3` all render with Inter 500 + 0.04 em letter-spacing + accent-gradient text fill via `background-clip: text`. `caret-color: var(--accent)` keeps the typing caret visible despite `color: transparent`.
- **Notification bell becomes the animated brand mark**: `NotificationBell.tsx` renders `<img src="/cortex-mark.svg" class="cortex-brand-bell-mark">` instead of the 🔔 emoji. Wrapped in a 36×36 px circle button (`.cortex-brand-bell`); the badge floats absolute in the top-right corner. `--unread` modifier triggers a 2.4 s accent-glow pulse; `--urgent` (past-due) triggers a faster 1.4 s danger-glow pulse. Reduced-motion users get static glow.
- **Welcome card** (`/no-vault` state): brand mark + wordmark above the heading, accent corner halo, `data-cortex-modal` shadow + radius. Shortcut hint footer in JetBrains Mono uppercase ("Ctrl+K to search · Ctrl+/ for shortcuts").

### E. Modal panel polish via `[data-cortex-modal]`

Generic CSS rule applies `--radius-3` corners + `--shadow-3` elevation + `var(--blur-modal)` backdrop blur + a `cortex-modal-in` entrance animation to any element that opts in via the attribute. Tagged 13 modals: `CommandPalette`, `ShortcutsHelp`, `NewHierarchyModal`, `ExperimentBlockModal`, `InsertTableModal`, `IntegrationsSettings`, `OrphanAttachmentsModal`, `TemplatesModal`, `ReviewSettingsModal`, `DeleteConfirmModal`, `EventEditModal`, `AutoReplaceModal`, `CategoriesSettings`. Companion `[data-cortex-scrim]` on each modal's backdrop adds the scrim blur + fade-in.

Optional `.cortex-modal-head` / `.cortex-modal-body` / `.cortex-modal-footer` sub-classes available for the design-system three-band layout where a modal opts in.

### F. Structural-block refresh

Every block in the visual family — typed block (experiment / iteration / etc.), tabs, collapsible, frame, callout, code block — now reads as the same family:

- **Typed block**: glass body (`--bg-elev-solid 50% mix` + `blur(8px)`), `--radius-2` corners, header in `--accent` with accent-tinted background, body in `--text-2`, 6 px accent-gradient `::after` end strip.
- **Tabs**: glass body, accent-gradient bottom seam under the title strip via `border-image`. Idle tab titles in `--text-2`; hover lights to `--accent-bg`; active tab paints in `--accent-gradient` + white text + soft upward halo. Add (`+`) and remove (`×`) buttons styled appropriately for active vs idle tabs.
- **Collapsible**: glass body, summary text in `--accent`, chevron in `--accent` with a 4 px drop-shadow halo when open, rotates over `--motion-medium`. Body gets a 1 px accent-gradient hairline divider via `border-image` from the open state.
- **Code blocks** (`.prose pre`): `--radius-2` corners + `--shadow-1` + accent inset ring on `:focus-within`.
- **Inline code**: `--radius-1` with a `--border` hairline.
- **Tables** (`.prose table`): real accent-gradient cell borders via the gradient-behind-table technique — `border-collapse: separate; border-spacing: 1px;` with `linear-gradient(135deg, accent-mix 55%, --bg-elev-solid)` painted as the table's background and opaque cell backgrounds hiding it except at the 1 px gaps between cells and around the outer ring. Uniform across every cell, no gaps at intersections or table edges.
- **Page break** (`hr.cortex-page-break`): pseudo-element `::before` renders a horizontal lens flare instead of a dashed line. Three layers — a wide thin beam (360 × 1 px), a medium bloom (80 × 4 px, near-center only, gives the "thicker middle" effect), a white-hot 2.5 px core. Total height clamped to 4 px (2× the original line thickness). The flare IS the line.
- **Decorative separator** (`.cortex-deco-separator`): same lens-flare recipe applied to the parent's `background-image`, scaled to fit a 2 px tall band (2× the previous 1 px line). Beam spans 75 % of the parent width; bloom + core sit at center behind the glyph. Empty `::before` / `::after` are flex spacers — no separate line segments. Glyph keeps its own layered text-shadow corona.

### G. Tighter prose in nested containers

Tailwind typography's default `margin: 1.25em` on `<p>` elements caused wide gaps when pressing Enter inside table cells, tab panels, collapsible bodies, typed-block bodies, frames, and callouts. Direct-child block elements (`> *`) inside any of these containers now get `margin-top: 0.25em; margin-bottom: 0.25em`, with first/last-child rules clearing the outer margins. Top-level prose paragraphs are unaffected.

### H. View class hooks

Structured views inside panes get a `.cortex-view` + `.cortex-view-<name>` class on their root wrap so the global button-hover rule (`.cortex-view button:hover:not(:disabled)`) applies accent-gradient hover to every button inside them:

- `Calendar.tsx` → `.cortex-view-calendar`
- `TimeTracking.tsx` → `.cortex-view-tt`
- `ProtocolsLog.tsx` → `.cortex-view-protocols`
- `MethodsArsenal.tsx` → `.cortex-view-methods`
- `IdeaLog.tsx` → `.cortex-view-ideas`

Calendar's active view-toggle segment also gets the gradient + halo via `[style*="white"]` (the only inline white-text buttons in those views are the active toggles). `TimeTracking`'s `PIE_PALETTE` updated so position 0 is the new `--accent` (`#7aa2ff`), positions 2/3/4/5 match `--warning` / `--danger` / `--accent-2` / `--aurora-3` so the most-frequent categories paint in the brand palette.

### I. Draggable sidebar

The sidebar's right edge now has an 8 px vertical drag handle (`.cortex-sidebar-resize`) that captures pointer-down and tracks the drag to update `sidebarWidth` in App.tsx state. Persisted in `localStorage:cortex:sidebar-width`. Clamped 240–560 px. Visible affordance is a 2 px line that brightens to the accent gradient + a soft halo on hover. Doesn't break sidebar collapse (the handle is only rendered when not collapsed).

### J. Image alignment + freeform preserved

The four Align toolbar buttons (`left` / `center` / `right` / `justify`) now drive `cortexImage` nodes in the selection in addition to the surrounding prose. New `applyAlign(editor, kind)` helper in `EditorToolbar.tsx` walks `state.doc.nodesBetween` and for every `cortexImage` whose `wrapMode !== "free"` updates its wrapMode (`left` → `"left"`, `center` / `justify` → `"break"`, `right` → `"right"`) in a single PM transaction, then runs `setTextAlign` for the surrounding prose. Free-positioned images skip the wrapMode mutation entirely, so user-placed images stay where you put them.

### K. Reviews dropdown portal

`ReviewsMenu.tsx`'s dropdown is now rendered via React `createPortal` to `document.body`, escaping the sidebar's `backdrop-filter` containing block. Position computed from the trigger button's `getBoundingClientRect()` on open, recomputed on `resize` and `scroll`. Click-outside dismissal checks both the trigger ref and the portaled menu ref. The dropdown no longer gets clipped at the sidebar's right edge.

### L. Copy-from-tab/collapsible unwrap

`editorProps.transformCopied` in `Editor.tsx`'s `useEditor` config peels wrapping structural containers (`cortexTabsBlock` / `cortexTabPanel` / `cortexCollapsible`) from clipboard slices when the selection is wholly inside one of them. Schema flags (`defining: true`, `isolating: true`) stay intact — they're what makes Enter inside a tab panel not escape — but the clipboard now produces plain prose instead of dragging the wrapping container along.

### M. Auto-replace trigger-space consumption

`CortexAutoReplace.handleTextInput` now strips the trailing trigger character from `after` at apply time WHEN the trigger (last char of `before`) is whitespace AND `after` ends with the same char. Built-ins like `--> ` → `→ ` now produce `→` (no trailing space), matching Word / Notion autocorrect expectations. Non-whitespace triggers (`(c)` → `©`) are unaffected. Stored rule values are not mutated; the strip is runtime-only.

### N. Force-show splash on launch

`App.tsx` now holds the splash visible for at least `SPLASH_MIN_MS = 2800ms` on every cold launch, regardless of how fast `loading` resolves. State: `splashVisible` (default true) + `splashFloorReached` (set true by a 2.8 s timeout). Fade conditions: floor reached AND `loading` is false. The splash is rendered at top level of every render branch (loading / no-vault / main app) so a warm start with a saved vault still shows the brain rotating before the chrome appears.

---

## Bug fixes shipped in v1.0

- **Inline rename re-selected the basename on every keystroke** — `InlineEditInput.tsx`'s focus + selection effect had `[initialValue]` deps; parent passed a new draft on each onChange; effect re-fired; cursor clobbered. Changed deps to `[]` so it runs once on mount.
- **Header caret invisible** — `.prose h1/h2/h3/h4` paint with `color: transparent` for the gradient text fill, which made the caret transparent too. Added `caret-color: var(--accent)`.
- **Layout picker + bell popups didn't render** — `.cortex-main-topbar` got `backdrop-filter` which creates a stacking context. Without an explicit `z-index`, the topbar's whole context defaulted to z-auto and competed with the splash's z-1 stacking context, so dropdowns within (z-1100 / z-100) painted under the splash. Added `position: relative; z-index: 50` to the topbar.
- **App icon not refreshing after `pnpm tauri icon`** — Cargo's dependency tracker doesn't watch `src-tauri/icons/` as a rebuild trigger, so the exe kept its old embedded ICO. Documented the `cargo clean` + `pnpm tauri dev` workflow (or `touch lib.rs` shortcut).
- **Decorative separator painted as a solid rectangle** — the bright-core radial-gradient terminated at `var(--accent) 100%` instead of `transparent 100%`. Beyond the 2.5 px circle, the rest of the element's background-image area filled with solid accent. On the page break the pseudo is only 4 px tall so it didn't visually manifest; on the decorative separator the parent is the full row (~22 px). Fixed both core gradients to terminate with `transparent 100%`.
- **Hover state didn't paint on chrome buttons** — inline `background: transparent` from `baseStyles.changeBtn` won over CSS class rules. Added per-property `!important` to the hover rules in `.cortex-sidebar button:hover` and `.cortex-main-topbar button:hover`.
- **Pre-existing `cortex-mark.svg` wrapped a PNG via `<image href="brain-circuit-white.png">`** — Chromium's SVG sandbox silently drops external resource loads from sandboxed `<img>`-loaded SVGs. The brain never rendered. Rebuilt the SVG to embed the PNG as a base64 data URI; now self-contained.

---

## Files added

- `declercq-cortex/design-system/` — full Claude Design system export parked for reference. README.md (22 KB voice/tone/visual foundations), SKILL.md, colors_and_type.css (token reference), preview/ (23 specimen HTMLs), ui_kits/cortex-app/ (pixel-fidelity static recreation), assets/ (source brand files).
- `declercq-cortex/public/cortex-mark.svg` — self-contained brand mark (324 KB, PNG embedded as data URI).
- `declercq-cortex/public/cortex-wordmark.svg` — wordmark with baked-in accent-gradient fill.
- `declercq-cortex/public/electron-particle.svg` — particle sprite (reserved for future splash polish).
- `declercq-cortex/public/aurora-backdrop.svg` — flat SVG of the aurora wash (reserved).
- `declercq-cortex/public/brain-circuit-white.png` — kept as the Tauri icon source.
- `declercq-cortex/src/components/CerebrumSplash.tsx` — the splash component.
- `declercq-cortex/src-tauri/icons/source.png` — 1024×1024 brain prepared for `pnpm tauri icon` regen. Run that command + `cargo clean` to push the new icon into the Windows resource section of the exe.
- `cortex_v1.0.md` — this doc.
- `declercq-cortex/verify-cortex-v1.0.ps1` — verify + tag script.

## Files modified

- `declercq-cortex/src/index.css` — ~600 lines net additions. Token retune, body aurora, scrollbars, reduced-motion gate, toolbar refinement, splash CSS section (3367+), Cluster 26 chrome theme pass section (3284+), structural-block + tabs + collapsible polish, table gradient borders, page-break + decorative-separator lens flares, brand-bell rules, sidebar resize handle.
- `declercq-cortex/src/App.tsx` — `baseStyles` token + radius + shadow refinements; new `splashVisible` / `sidebarWidth` state + `startSidebarResize` handler; class hooks (`cortex-sidebar`, `cortex-sb-brand`, `cortex-sb-head`, `cortex-sb-actions`, `cortex-sb-body`, `cortex-sb-foot`, `cortex-main-col`, `cortex-main-topbar`, `cortex-app-shell`); welcome card with brand mark + wordmark + shortcut hint; sidebar header restructured into a brand row + an actions row; `dirtyPaths` computed and threaded to FileTree.
- `declercq-cortex/src/components/Editor.tsx` — `editorProps.transformCopied` added to `useEditor` config; `Slice` imported from `@tiptap/pm/model`.
- `declercq-cortex/src/components/EditorToolbar.tsx` — `applyAlign(editor, kind)` helper for image-aware alignment; the four align button onClicks now route through it.
- `declercq-cortex/src/components/NotificationBell.tsx` — bell glyph swapped for `<img src="/cortex-mark.svg" class="cortex-brand-bell-mark">`; badge tagged `cortex-brand-bell-badge`; wrapper class adds `cortex-brand-bell` + `--unread` / `--urgent` modifiers.
- `declercq-cortex/src/components/FileTree.tsx` — `dirtyPaths: ReadonlySet<string>` prop; per-row dirty dot rendering; `cortex-filetree-row` + `cortex-filetree-row--file` / `--folder` / `--selected` / `--dirty` classes; `InlineEditInput` selection effect deps fixed.
- `declercq-cortex/src/components/ReviewsMenu.tsx` — dropdown portal via `createPortal` + position from `getBoundingClientRect`; click-outside dismissal checks both refs.
- `declercq-cortex/src/components/Calendar.tsx` — `.cortex-view .cortex-view-calendar` class on root; hard-coded `#888` fallbacks replaced with `var(--text-muted)`.
- `declercq-cortex/src/components/TimeTracking.tsx` — `.cortex-view .cortex-view-tt` class; `PIE_PALETTE` updated to lead with brand accent.
- `declercq-cortex/src/components/ProtocolsLog.tsx`, `MethodsArsenal.tsx`, `IdeaLog.tsx` — `.cortex-view .cortex-view-<name>` class on root.
- 13 modals tagged with `data-cortex-modal` + `data-cortex-scrim`.
- `declercq-cortex/src/editor/CortexAutoReplace.ts` — trigger-whitespace consumption in `handleTextInput`.

## Files NOT touched

- Anything in `src-tauri/src/` (Rust). The Tauri command surface and schema migrations are unchanged.
- `src-tauri/Cargo.toml`. No new crates.
- `src-tauri/tauri.conf.json`. No bundle / capability changes.
- Any TipTap extension's schema (`defining`, `isolating`, content rules). The clipboard fix is a `transformCopied` editorProp; node attributes round-trip unchanged.
- Frozen-row / frozen-col sticky logic in tables (Cluster 18). Gradient borders are painted via the table's `background`; cell `background-color` (which sticky positioning uses) is orthogonal.

---

## Smoke walk

Run `pnpm tauri dev`. Then:

1. **Splash on cold launch** — brain rotates with seven orbital rays for ~2.8 s, captions fade in, splash fades out, chrome appears.
2. **Sidebar brand badge** — white brain at the top of the sidebar pulses on a 4 s cycle; wordmark sits to its right.
3. **Sidebar resize** — drag the right edge of the sidebar; width clamps to 240–560 px; persists across reloads.
4. **Toolbar buttons** — hover any toolbar button → accent-gradient fill + white text + soft halo + smooth transition. Active state (e.g., Bold with caret in bold text) gets an additional 4 px outer ring.
5. **File tree** — hover any row → smooth fade to accent-bg. Selected file gets a 2 px gradient bar on its left edge. Open a file, edit it without saving → a 7 px accent-gradient dot appears on the right edge of that row and pulses gently.
6. **Notification bell** — click the brain in the top bar → dropdown appears (not clipped, not hidden behind the splash). If you have unread reminders the brain pulses; past-due reminders get a faster danger-tinted pulse.
7. **Reviews dropdown** — click "Reviews" in the sidebar header → dropdown appears to the right, fully visible past the sidebar boundary.
8. **Tables** — every cell intersection corner and every outer-ring edge shows a continuous accent-gradient line. Header row's gradient is brighter.
9. **Tabs / collapsibles** — open both. Glass body, accent-gradient seams, hover lights idle tabs, active tab paints in the gradient. Press Enter inside a tab panel — paragraph spacing is tight (no 1.25 em gap). Copy text from inside → paste elsewhere produces clean prose (no tab/collapsible wrapper).
10. **Page break** — insert via the toolbar. A horizontal accent-gradient flare with a bright center point fades laterally. Total height stays within 4 px.
11. **Decorative separator** — same flare recipe scaled to 2 px tall, with the glyph sitting on the brightest point with its own corona.
12. **Auto-replace** — type `--> ` in any document. The arrow appears without a trailing space; cursor is parked right after `→` ready for the next character.
13. **Image align** — drop an image into a note. Right-click → wrap mode "break". Select the image. Click "Align right" in the toolbar — image floats right. "Align center" — image centers via "break" mode. Drag the image to free position (wrap mode `free`). Click align buttons — image stays where you put it (free is preserved).
14. **Light mode** — toggle via the theme toggle. Every Aurora effect renders correctly in light: aurora wash, gradient borders, glassy chrome, lens flares.
15. **Headers** — typing in any `#`/`##`/`###` heading shows a visible blue caret inside the gradient-fill text.
16. **Welcome screen** — choose a different vault. Welcome card shows brain mark + wordmark + accent corner halo + "Choose vault folder" CTA with gradient bg.

---

## Desktop icon (separate manual step)

The brand mark needs to be embedded into the exe's Windows resource section for the title bar / taskbar icon. The 1024×1024 source PNG is prepared at `declercq-cortex/src-tauri/icons/source.png`. From PowerShell:

```powershell
cd "C:\Declercq Cortex\declercq-cortex"
pnpm tauri icon src-tauri/icons/source.png
cd src-tauri
cargo clean
cd ..
pnpm tauri dev
```

Cargo doesn't watch `icons/` as a rebuild trigger, so `cargo clean` is required to force the re-link with the new embedded ICO. Windows' icon cache may also need flushing — `ie4uinit.exe -show` usually does it; the heavy hammer is killing Explorer and deleting `%LOCALAPPDATA%\IconCache.db`.

---

## Ship protocol

```powershell
cd "C:\Declercq Cortex\declercq-cortex"
.\verify-cortex-v1.0.ps1
cd "C:\Declercq Cortex"
git push
git push origin cortex-v1.0 --force
```

The verify script runs prettier on the frontend, `cargo fmt + check` on the (unchanged) Rust side as a safety net, `git add . && git commit` with the milestone summary, and `git tag -f cortex-v1.0`. Push from the outer folder where `origin` lives.

---

## What comes after v1.0

Open questions deferred for future versions:

- Per-folder default template (Cluster 22 v1.1 backlog).
- Drag-and-drop file move within the FileTree (Cluster 24 v1.1 backlog).
- Per-Sunday monthly review choice (first / second / third / fourth / last) (Cluster 24 v1.1 backlog).
- Concept graph view (Cluster 7, never started).
- Outlook Calendar sync (Cluster 13, planned).
- Light-mode dirty-dot pulse intensity may need a separate tuning pass (currently uses the same alpha as dark mode).
- Sidebar action-button cluster could be reorganized into logical groups (Notes / Hierarchy / Calendar+Time / Settings) with cluster labels — deferred to a future UX pass.
