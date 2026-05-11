# Cortex Design System

Cortex is a **local-first research notebook desktop app** for lab work — every note, experiment, protocol, and PDF is a markdown file in a vault folder the user picks. It's built on Tauri 2 + Vite + React + TipTap and ships a deeply customized markdown editor on top of ProseMirror, plus a network of structured surfaces (Calendar, Time Tracking, Idea Log, Methods Arsenal, Protocols Log, Reviews, PDF Reader with annotations, a Shape Editor overlay) that all read and write the same vault on disk.

The current visual identity is **Aurora Glass** (Cluster 25): translucent chrome surfaces, three soft corner gradients painted onto the body, blue-violet → violet accents, and a calm cosmos-like motion vocabulary. Cluster 26 — the **Cerebrum splash + theme refresh** — extends that identity with a rotating 3D brain on app launch and tightens the rest of the chrome to feel like the natural origin of the same aurora.

This is a single-product design system. The product is the **Cortex desktop app** — there is no marketing site, mobile app, or docs site.

---

## Sources

- **Codebase** (read-only, mounted): `declercq-cortex/`
  - `src/index.css` — all design tokens (lines 33–155 dark + light, 156+ chrome rules, 3284–3663 Cluster 25 Aurora rules)
  - `src/App.tsx` — top-level layout, `baseStyles` inline-style ledger, loading + welcome states
  - `src/components/EditorToolbar.tsx` — particle effects, font picker, mark palette
  - `src/components/ThemeToggle.tsx` — 3-way Auto / Light / Dark contract
  - `src/components/FileTree.tsx`, `Calendar.tsx`, `NotificationBell.tsx`, `CommandPalette.tsx`, etc.
  - `index.html` — Google Fonts CDN preload
- **Brief**: Cluster 26 — Cerebrum splash + theme refresh (in conversation)
- **Prior art**: Aurora Glass refresh (Cluster 25, already on disk)

The codebase root is `C:\Declercq Cortex\` (outer git root); the Tauri app sits at `declercq-cortex/`. This design system mirrors only what is needed to design _against_ Cortex; we do not reproduce backend logic, the Rust crate, or the TipTap node schema.

---

## Index

Foundations
- `colors_and_type.css` — every CSS variable from `src/index.css`, plus semantic shortcuts (`.h1` … `.code`, etc.) for use in mocks
- `fonts/` — webfont fallbacks (loaded via Google Fonts CDN — no local files needed)
- `assets/` — logos, brand marks, electron sprite, brand backdrops

Reference
- `CONTENT_FUNDAMENTALS` (in this file) — voice, tone, casing, copy patterns
- `VISUAL_FOUNDATIONS` (in this file) — colors, type, spacing, motion, shadow, glass treatment
- `ICONOGRAPHY` (in this file) — Cortex's text-glyph + Unicode-symbol icon system

Preview cards (Design System tab)
- `preview/` — atomic specimens registered to the Design System pane

Preview cards (Design System tab) — registered to the asset review pane
- `preview/colors-surfaces-dark.html`, `colors-surfaces-light.html` — surface tier on aurora wash
- `preview/colors-accents-dark.html` — accent / accent-2 / gradient / accent-bg tiers
- `preview/colors-status-text.html` — primary / danger / warning + text tiers
- `preview/colors-marks.html` — semantic mark palette (Ctrl+1..7)
- `preview/aurora-backdrop.html` — three-stop body wash (alphas exaggerated for legibility)
- `preview/type-scale.html`, `preview/type-stacks.html` — chrome scale + font stacks
- `preview/radii.html`, `preview/elevation.html`, `preview/motion.html`, `preview/glass-blur.html` — geometry + motion + blur tokens
- `preview/buttons.html`, `preview/segmented-bell.html` — chrome buttons, theme toggle, notification bell
- `preview/file-tree-row.html`, `preview/typed-block.html`, `preview/code-block.html`, `preview/welcome-card.html`, `preview/table.html`, `preview/toolbar.html`, `preview/modal.html` — surface-level component specimens

UI kit
- `ui_kits/cortex-app/index.html` — interactive click-through of the desktop window. Bottom segmented control switches between Main window, Welcome, Command palette, Modal, and Splash views.
- `ui_kits/cortex-app/cortex-app.css` — chrome rules layered on top of `colors_and_type.css`
- `ui_kits/cortex-app/chrome.jsx` — `EditorToolbar`, `Sidebar`, `FileTreeRow`, `StatusBar`, `ThemeToggle`, `NotificationBell`
- `ui_kits/cortex-app/editor.jsx` — `Editor` body (prose, code blocks, typed experiment block, table, marks, wikilinks)
- `ui_kits/cortex-app/overlays.jsx` — `Welcome`, `Modal`, `CommandPalette`, `Splash` (Cluster 26 placeholder)
- `ui_kits/cortex-app/app.jsx` — root + view switcher

Skill
- `SKILL.md` — Claude Code-compatible front-matter so this folder works as a portable skill

---

## CONTENT FUNDAMENTALS

Cortex's voice is **engineer's-notebook terse**. The app is a research tool for a single technical user (the developer of the app, a scientist running their own lab notebook); the copy reads like a co-worker labeling toolbar buttons, not a marketing surface.

### Voice

- **Direct, second-person implied.** Buttons and tooltips don't speak _at_ you — they label what they do. `Choose vault folder`, `Refresh file tree`, `Open today's daily log (Ctrl+D)`. No "Click here to…", no "Welcome back!", no friendly preamble.
- **Function-first naming.** Sidebar buttons are abbreviated like CLI commands the user has muscle-memory for: `+ Note`, `+ Idea`, `+ Method`, `+ Proj`, `+ Exp`, `+ Iter`, `+ Block`, `Cal`, `Time`, `GH`, `↻`. Compactness is a feature; the user reads them dozens of times an hour.
- **Hint at the keyboard.** Every interactive control with a shortcut surfaces it in the tooltip: `New note (Ctrl+N)`, `Search notes (Ctrl+K)`, `Insert experiment block (Ctrl+Shift+B)`. The keyboard is the primary surface; the buttons are scaffolding.
- **No emoji as part of brand voice.** A handful of chrome buttons use a single Unicode symbol as a glyph (`⏱ Time`, `↻`, `▸`, `▶ / ◀` for collapse) — these are functional iconography, not flourish. The body, headings, modals, and tooltips contain zero emoji.

### Tone

- **Calm, never urgent.** No exclamation marks. No "🎉 Awesome!" success states. Confirmation modals use plain titles like `Delete file?` and a single-sentence body.
- **Honest about state.** Errors surface raw: `Google Calendar connection expired. Open Integrations (GH button) to reconnect.` — they tell you what to do, not "Oops something went wrong." Dirty indicators are a single dot, not a banner.
- **Cluster-numbered changelogs internally.** Comments in the codebase reference work as "Cluster N v1.X" — a versioning shorthand the user invented for their own notebook. Not user-facing copy, but it bleeds into commit conventions and verify scripts (`verify-cluster-24-v1.0.ps1`).

### Casing

- **Sentence case for headings and modal titles.** `Welcome to Cortex`, `Insert table`, `Choose vault folder`, `Keyboard shortcuts`. Never Title Case.
- **Sentence case for buttons and labels** with one exception: the cluster of single-word sidebar buttons and tabs is **PascalCase / TitleCase** because they're treated as labels for noun-like entities (`Templates`, `Reviews`, `Calendar`, `Methods`, `Protocols`, `Search`, `Today`).
- **`+ Noun` for creation buttons.** `+ Note`, `+ Idea`, `+ Method`, `+ Block` — the literal `+` is part of the visual hierarchy, separated by a single space.
- **All-lowercase only for keyboard glyphs in tooltips** (`Ctrl+K`, `Ctrl+Shift+E`).

### Vibe / first-person stance

The app uses **no first-person at all** ("we", "our", "I"). It uses **no second-person address** in body copy either ("you'll see…"). The few sentences of body copy that exist read as third-person observation: `Indexed 27 notes`, `Vault is empty.`, `Select a folder containing your markdown notes.`

Everything else is a label, a tooltip, or a status. The product is a tool, not a companion.

### Specific examples (ripped from source)

- **Welcome card body**: `Cortex is a local-first research notebook. Pick a folder full of markdown files to begin.`
- **Sidebar empty state**: `Vault is empty.`
- **Loading state**: `Loading…` (single word, single ellipsis — never "Just a moment", never spinner copy)
- **Error banner**: `Google Calendar connection expired. Open Integrations (GH button) to reconnect.`
- **Tooltips**: `New note (Ctrl+N)` · `Open Methods Arsenal (active slot)` · `Time tracking — planned vs actual` · `Insert experiment block (Ctrl+Shift+B)`
- **Section markers in cluster-26**: `Cluster 26 — Cerebrum + theme pass` (em-dash separator, sentence case)

### What we don't do

- No "Get started" CTAs.
- No "Pro tip:" callouts.
- No exclamation marks anywhere.
- No emoji in body, headings, tooltips, or marketing surfaces (there is no marketing surface).
- No greeting like "Hi" or "Welcome back".
- No "smart-quotes corporate" copy. If something is broken, the error sentence says exactly what's broken.

---

## VISUAL FOUNDATIONS

The Aurora Glass identity is the dominant note. Cortex looks like a calm, slightly cool research instrument — a window into a deep slate cosmos with three soft auroras lit at the corners, blue-violet ink, glass surfaces that pick up the light behind them, and slow ambient motion that reads like instrumentation, not animation.

### Colors

The token system never gets renamed; it gets retuned. Every interactive surface reads from the same names in dark and light mode.

**Surface (dark, default)**
- `--bg: #0d1018` — deep cool slate base canvas
- `--bg-deep: #0a0d14` — recessed surfaces (sidebar, code blocks, paths)
- `--bg-elev: rgba(30, 36, 54, 0.72)` — translucent raised surfaces (toolbar, modals)
- `--bg-elev-solid: #1a1f2e` — opaque variant when blur isn't supported
- `--bg-card: rgba(26, 31, 46, 0.86)` — welcome card / palette background

**Text (dark)**
- `--text: #ebeefb` — primary
- `--text-2: #c2cae0` — secondary
- `--text-muted: rgba(235, 238, 251, 0.5)` — tertiary / placeholder

**Borders (dark)**
- `--border: rgba(168, 192, 240, 0.08)` — hairlines (cool light, picks up aurora glow)
- `--border-2: rgba(168, 192, 240, 0.16)` — buttons, panel edges

**Accent (dark)**
- `--accent: #7aa2ff` — blue-violet, the link / wikilink / palette color
- `--accent-2: #a98bff` — violet, the gradient end
- `--accent-bg: rgba(122, 162, 255, 0.12)` — accent on translucent
- `--accent-bg-2: rgba(122, 162, 255, 0.22)` — accent on hover
- `--accent-gradient: linear-gradient(135deg, #7aa2ff 0%, #a98bff 100%)` — CTA, halo, brand bar

**Status**
- `--primary: #5b8bff` (dark) / `#3b58e8` (light) — CTA blue (vault folder)
- `--danger: #ff8a8a` (dark) / `#d93838` (light)
- `--warning: #f5c365` (dark) / `#c47e0e` (light)

**Aurora (dark)** — three corner gradients painted onto `body`, fixed-attachment, behind everything:
- `--aurora-1: rgba(122, 162, 255, 0.13)` — cool blue, top-left
- `--aurora-2: rgba(169, 139, 255, 0.12)` — violet, bottom-right
- `--aurora-3: rgba(74, 222, 188, 0.07)` — soft teal, center

**Light mode** is the same gradient family: `--accent: #4661ff → --accent-2: #8d54f5` over `--bg: #fbfbfd`.

**Mark palette** (seven semantic colors used by the highlight system, mapped to keyboard 1–7): yellow (weekly review), green (monthly review), pink (tomorrow's daily), blue (concept inbox), orange (anti-hype), red (bottlenecks), purple (citations). See `Mark System` in `index.css`.

### Type

- **UI sans:** **Inter** at 300/400/500/600/700. Body 400, buttons + labels 500, headings 600. Used everywhere in the chrome.
- **System fallback** for the editor body (because `font-family` is user-pickable per-document via the toolbar): `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Mono:** **JetBrains Mono** (fallback **Fira Code**, then `ui-monospace, "Cascadia Code", Consolas, monospace`). Used in code blocks, file paths, the `--sidebarPath` line.
- **Brand display:** **Inter 500 with `letter-spacing: 0.04em`** for the splash caption (e.g. `Cortex` under the brain). **Cinzel** is an opt-in alternative loaded for the splash if the user wants more identity.
- **Editor body fonts (user-pickable, all loaded via Google Fonts):** Inter, Lora, Crimson Text, Playfair Display, EB Garamond, Source Serif Pro, JetBrains Mono, Fira Code, Bebas Neue, Cinzel, Caveat, Pacifico.
- **Sizes are in rem-fractions** (`0.7rem` chrome buttons, `0.95rem` headings, `1.6rem` `h1`). Editor body is `calc(15px * var(--cortex-editor-zoom, 1))` — zoom is multiplicative on `font-size`, never `transform`.

### Spacing & geometry

- **Radii:** `--radius-1: 6px` (small chips, icon buttons), `--radius-2: 10px` (cards, code blocks, structural blocks), `--radius-3: 14px` (modals, welcome card), `--radius-pill: 999px` (segmented controls, theme toggle, scrollbars). **Never sharpen any corners** to 0.
- **Padding** in chrome buttons: `2–3px 8–9px`. In the welcome card: `2.25rem 2.5rem`. In modals: ~`16–20px` outer.
- **Gap** in sidebar action cluster: `4px`. In modals: `0.5–1rem`.
- **Sidebar width:** `300px` expanded, `260px` minimum, `32px` collapsed. Transition `width 120ms ease`.
- **LayoutGrid divider width:** `6px` (`HANDLE_PX = 6`) — load-bearing, do not change.

### Backgrounds

The body has a **fixed-attachment three-stop aurora wash** painted on top of `--aurora-base`:

```css
background-image:
  radial-gradient(ellipse 1100px 800px at 12% 0%,  var(--aurora-1) 0%, transparent 65%),
  radial-gradient(ellipse  900px 700px at 95% 100%, var(--aurora-2) 0%, transparent 60%),
  radial-gradient(ellipse  700px 500px at 50%  50%, var(--aurora-3) 0%, transparent 70%);
```

It barely registers as a wash (alpha 0.07–0.13) — translucent surfaces above it are what pick up the glow through their `backdrop-filter`. The body is **never a flat color** in either theme.

For full-bleed imagery: not used in the app today. The Cerebrum splash adds the only "image-like" surface — a WebGL canvas. Imagery, when added, should be **cool-toned** (cyan-violet axis), with **no warm accents**, and should fade to the deep slate at the edges (no hard photo edges; vignette into `--bg`).

### Motion

Cortex has two motion families. Both run through CSS variables so every surface inherits the same easing.

- **Brisk transitions** on user-driven changes: `--motion-fast: 120ms`, `--motion-medium: 220ms`, `--motion-slow: 380ms`. All on `cubic-bezier(0.25, 0.8, 0.4, 1)` (`--ease`) — gentle ease-out, no bounce.
- **Slow, ambient motion** for branded effects: 1.5–4s breathing for idle glows, 24–32s per revolution for the Cerebrum splash brain, 7s sinusoidal wobble. These read as "the room is alive", not as animation.

The system **honors `prefers-reduced-motion`** with a global override that collapses every transition and animation to `0.01ms`. Any new motion must pass through this gate. The Cerebrum splash detects reduced motion explicitly and renders a single still frame.

Keyframes used: `cortex-popover-in` (translate + scale + opacity, 220ms), `cortex-modal-in` (8px lift), `cortex-scrim-in` (opacity), and a future notification-bell pulse on unread count.

### Hover, press, focus

- **Hover** on chrome buttons: `background: var(--accent-bg)`, `border-color: var(--accent-bg-2)`, `color: var(--text)`. Transition 120ms.
- **Hover** on the CTA: `filter: brightness(1.08)`, `transform: translateY(-1px)`, deeper accent halo (28px shadow at 40% alpha).
- **Hover** on image handles: `transform: scale(1.08)`.
- **Hover** on wikilinks (only when `Ctrl` is held — `body.cortex-mod-pressed`): underline + deeper accent background.
- **Press**: `transform: translateY(1px)` for chrome buttons, `translateY(0) + filter: brightness(0.96)` for the CTA. Buttons never shrink with `scale()`; they nudge.
- **Focus-visible**: `--ring` (a 2px outer halo at 45% accent), or `--ring-strong` for primary CTAs (a layered 2+4px ring across accent and accent-2). No outline.

### Borders, shadows, elevation

Three tiers, every one a layered double shadow that gets deeper at the bottom (suggesting weight, not glow):

- `--shadow-1: 0 1px 2px rgba(0,0,0,0.18), 0 1px 1px rgba(0,0,0,0.10)` — chips, code blocks, structural blocks
- `--shadow-2: 0 6px 22px rgba(0,0,0,0.40), 0 2px 6px rgba(0,0,0,0.18)` — cards, image bubbles
- `--shadow-3: 0 32px 60px -12px rgba(0,0,0,0.55), 0 16px 28px -8px rgba(0,0,0,0.35)` — modals, welcome card

Inner highlight on glass surfaces: `inset 0 1px 0 rgba(255,255,255,0.04)` — a one-pixel embossed edge that reads against deep backdrops.

The CTA button gets a **colored halo**, not a colorless drop shadow: `0 6px 18px color-mix(in oklab, var(--accent) 30%, transparent)`. The accent bleeds out of the shape.

### Transparency & blur

Glass is the chrome surface vocabulary. Blur is reserved for surfaces that **sit over content**:

- `--blur-chrome: saturate(160%) blur(12px)` — toolbar, sidebar, status bar
- `--blur-modal: saturate(150%) blur(20px)` — modals, welcome card, command palette
- `--blur-strong: saturate(180%) blur(28px)` — splash welcome panel (sits over the WebGL brain)

Translucent surfaces always pair `background: rgba(...)` with `backdrop-filter: var(--blur-...)` and a `1px` border at low alpha to define the edge. Never use blur without a backdrop, and never use it on the editor surface (`.prose` / `.ProseMirror`).

### Cards, modals, panels

- **Cards** (welcome, palette, modal panels): `background: var(--bg-card)`, `border: 1px solid var(--border-2)`, `border-radius: var(--radius-3)`, `box-shadow: var(--shadow-3)`, `backdrop-filter: var(--blur-modal)`.
- **Modal scrim**: `background: var(--scrim)` over a `backdrop-filter: var(--blur-modal)`. Opt-in via `data-aurora-scrim` for the cross-fade animation.
- **Modal headers** get a subtle accent halo at the top edge: `linear-gradient(to bottom, color-mix(in oklab, var(--accent) 6%, transparent), transparent)`.
- **Code blocks** (`.prose pre`): `border-radius: var(--radius-2)`, `box-shadow: var(--shadow-1)`, `border: 1px solid var(--border)`. On focus-within, an inner accent ring is added.
- **Tables**: `border-radius: var(--radius-2)`, `overflow: hidden`, `box-shadow: var(--shadow-1)`. Header row gets a top-down `--accent-bg → transparent` gradient.

### Layout rules

- The app shell is `flex column`: universal `EditorToolbar` flush at top, `appShell` (sidebar + main col) below, fills remaining height.
- The sidebar is **300px fixed** when expanded (collapsible to 32px). It does not respond to viewport size.
- The main col is `flex: 1, minWidth: 0` with a `mainTopBar` (status / notification / layout picker) and a `gridArea` (LayoutGrid with 1–4 panes).
- LayoutGrid panes are **draggable via 6px handles**; the column / row fractions persist to `localStorage`.
- Panes beyond the current layout's slot count remain **mounted in a hidden stash** so their state survives layout shrinks.

### Iconography vibe

Cortex does not use a graphical icon system in its current chrome. See the dedicated `ICONOGRAPHY` section below.

### Light mode parity

Light mode is a **first-class citizen**: every Aurora effect has a light variant. The aurora gradients become `~0.06–0.10 alpha` over `#fbfbfd`; shadows soften from `rgba(0,0,0)` to `rgba(15,23,42)`; the accent shifts cooler to `#4661ff → #8d54f5`. The 3-way Auto / Light / Dark toggle is a hard contract — always test both.

---

## ICONOGRAPHY

Cortex's icon system is **deliberately minimal and text-glyph-first**. There is no graphical icon font, no SVG sprite, no Lucide / Heroicons import, no PNG icons, and no Font Awesome. Today's chrome relies on three things, in order of frequency:

1. **Plain text labels.** The vast majority of buttons in the sidebar and toolbar are pure text: `+ Note`, `+ Idea`, `Today`, `Search`, `Templates`, `Reviews`, `Cal`, `Methods`, `Protocols`, `Change…`, `GH`. The label _is_ the icon.
2. **Single Unicode characters as glyphs.** A small set of carefully chosen symbols stand in for graphic icons:
   - `↻` — refresh file tree
   - `▶ / ◀` — collapse / expand sidebar
   - `▸` — experiment block bullet (also used as the ::after on typed-block headers)
   - `?` — keyboard shortcuts help
   - `⏱` — time tracking (the only "icon-emoji" used; lives in `⏱ Time`)
   - `▾ / ▸` — collapsible chevrons (rotated via CSS transition)
3. **CSS-drawn affordances** for things that need shape but not character: the LayoutPicker draws its mini-pane previews as CSS grids of div blocks (no SVG); the dirty-state indicator is a single tinted dot.

There is **no emoji** in any user-facing copy, label, tooltip, or modal. The lone `⏱` is a Unicode symbol (U+23F1), not an emoji presentation — it's used in monochrome and inherits `--text-2`.

### Source files copied into `assets/`

- `assets/cortex-mark.svg` — synthesized Cortex brain mark (composed for this design system, since the codebase ships no logo today). Used as the favicon equivalent and in splash treatments.
- `assets/electron-particle.svg` — the soft circular glow used for orbital electrons in the Cerebrum splash. SVG version of the brief's `public/electron-particle.png`.
- `assets/aurora-backdrop.svg` — a static SVG snapshot of the body's three-aurora gradient, useful as a fallback / poster for screenshots and slides.
- `assets/cortex-wordmark.svg` — the typeset wordmark (Inter 500, 0.04em letter-spacing) for use as a brand bug.

### When adding new icons

If a future surface needs graphical icons (e.g. a settings preferences panel with toggles), the recommended fallback is **Lucide via CDN** (`https://unpkg.com/lucide-static@latest`) at the same stroke weight (1.5px) as the existing CSS-drawn affordances, monochrome, sized at the same px height as the surrounding label (typically 13–14px). This is a substitution and is flagged here — Cortex has not chosen a graphical icon system yet.

### What we do not use

- No emoji (🎉, ✅, 🚀) anywhere — neither as iconography nor as decoration.
- No multi-color icons.
- No skeuomorphic glyphs (no folder-with-shadow, no document-with-fold).
- No Font Awesome / Material Icons / Heroicons.
- No SVG illustrations beyond the four brand-mark files above.

The brain in the splash is the single exception: a 3D rendered model, not an icon. It's the brand mark in motion, not part of the icon system.
