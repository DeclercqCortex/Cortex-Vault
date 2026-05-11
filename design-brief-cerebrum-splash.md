# Cortex — Cerebrum splash + theme refresh

**Brief for Claude Design.** A two-part design pass for an existing Tauri/React/TypeScript desktop app called **Cortex** — a local-first research notebook for lab work. Part 1 is a startup splash featuring a rotating 3D brain with electron-like light rays; Part 2 is a theme pass that carries that identity into the rest of the app.

The app already shipped a "Cluster 25 — Aurora Glass" CSS refresh (translucent chrome, soft accent gradients, refined motion). This brief builds on that base — it does **not** start from scratch.

---

## 1. What Cortex is

A local-first research notebook. Every note, experiment, protocol, and PDF is a markdown file in a vault folder the user picks. Surfaces today:

- **Top toolbar** — universal, mounts above all panes; B/I/U, headings, structural blocks, particle effects, font picker. Cluster 21.
- **Sidebar** — vault file tree + 25-ish action buttons (+ Note, + Idea, + Method, + Protocol, + Proj, + Exp, + Iter, + Block, ReviewsMenu, Cal, Time, GH, Templates, Reviews, Refresh, Change, ?, ThemeToggle).
- **Multi-pane editor area** — single / dual / tri-bottom / tri-top / quad layouts, draggable dividers (Cluster 6 v1.5).
- **Modals everywhere** — CommandPalette, ShortcutsHelp, NewHierarchy, ExperimentBlock, Templates, Reviews, IntegrationsSettings, EventEdit, OrphanAttachments, etc.
- **Structured views** inside panes — Calendar, TimeTracking, IdeaLog, MarkQueue, MethodsArsenal, ProtocolsLog, BacklinksPanel, FrontmatterPanel.
- **PDF reader** with annotations + sidecar JSON.
- **Shape Editor** overlay (Microsoft-Paint-on-the-doc, Ctrl+Shift+D).

Built on Tauri 2 + Vite + React + TipTap (ProseMirror). Renders in WebView2 on Windows — full Chromium, so WebGL2, `backdrop-filter`, CSS `transform-style: preserve-3d`, and modern CSS color functions (`color-mix`, `oklab`) all work.

Repo layout (from `COWORK_HANDOFF.md`):

```
C:\Declercq Cortex\          ← git root
├── COWORK_HANDOFF.md
├── declercq-cortex\         ← Tauri app
│   ├── src\                 ← React frontend (App.tsx, components/, editor/)
│   ├── src-tauri\           ← Rust backend — DO NOT TOUCH
│   ├── public\              ← static assets (put models / textures here)
│   ├── index.html
│   └── package.json
```

---

## 2. Hard constraints — DO NOT TOUCH

These are non-negotiable. The backend logic, data model, and editor schema have been hand-tuned across 24+ shipped clusters:

1. **No Rust / Tauri changes.** `src-tauri/` is off-limits. No new Tauri commands, no Cargo deps, no `tauri.conf.json` edits, no `capabilities/*.json` edits. Splash is a frontend-only feature.
2. **No ProseMirror or TipTap edits.** Don't touch `src/editor/*`, don't restyle `.prose`, `.ProseMirror`, or anything inside contenteditable. A previous attempt to put `transform: scale()` on `.prose` broke selection + dispatched MutationObserver loops; font-size scaling via `--cortex-editor-zoom` is the only acceptable zoom mechanism.
3. **No data-attribute overlays disturbed.** `.cortex-typed-block-name::before` (reads `data-title`), formula cells (`color: transparent` + `::after` reads `data-formula-result`), and table frozen rows/cols (`position: sticky` cell-level z-index logic) are visual-but-load-bearing. Restyle their colors freely; don't change their structural CSS.
4. **No layout-grid changes.** `LayoutGrid.tsx` divider widths (`HANDLE_PX = 6`) and CSS Grid template strings are tuned. New skin only.
5. **No on-disk format changes.** No new file types, no new sidecar JSON schemas. Markdown stays markdown.
6. **Theme toggle stays 3-way Auto / Light / Dark.** `useTheme` writes `documentElement.classList` to `"dark"` / `"light"` from `localStorage`. The new design must work in both modes.
7. **Respect `prefers-reduced-motion`.** Cortex already has a `@media (prefers-reduced-motion: reduce)` global gate. The brain animation (and any other motion you introduce) MUST honour this — fade to a still 3/4 view, no rotation, no orbiting electrons. Reduced-motion users should see a beautiful static composition.

Soft constraints:

- **Bundle weight is fine.** Cortex is a desktop app. Three.js (~600 KB), a brain model, Lottie, etc. are all acceptable.
- **Single-window app.** No deep-link / multi-route considerations.
- **Local-first.** No external CDN dependencies for the splash assets — bundle everything in `public/`. (Google Fonts via CDN is already in place at `index.html`; that's fine to extend.)

---

## 3. The Aurora theme already in place

Read `src/index.css` lines 33–155 first. Every interactive surface in Cortex reads CSS variables, so retuning the palette is the highest-leverage move. The current dark palette:

- `--bg: #0d1018` (deep cool slate)
- `--bg-elev: rgba(30, 36, 54, 0.72)` (translucent, glassed)
- `--accent: #7aa2ff` (blue-violet)
- `--accent-2: #a98bff` (violet)
- `--accent-gradient: linear-gradient(135deg, #7aa2ff, #a98bff)`
- Three aurora corner gradients painted onto `body`: `--aurora-1` (cool blue), `--aurora-2` (violet), `--aurora-3` (soft teal)

New tokens already wired: `--radius-1/2/3/pill`, `--motion-fast/medium/slow`, `--ease`, `--blur-chrome/modal/strong`, `--shadow-1/2/3`, `--ring`, `--ring-strong`. Use them — don't invent parallel tokens.

Light mode is the same gradient family at `#4661ff → #8d54f5` over an airy off-white.

**The brain splash should feel like the natural origin of the existing aurora aesthetic — i.e. the aurora gradients are what bleed off the brain's electron rays.** Tie them together visually.

---

## 4. Part 1 — The Cerebrum splash

### Concept

A slow, hypnotic startup composition: a luminous white anatomical (or stylized-anatomical) brain rotating in 3D, with three to five "electron" light rays orbiting it on inclined elliptical paths. The rays are emissive — they bloom slightly. The whole stage is set against a dark cosmos with the existing Aurora corner gradients as the backdrop. Reads as: "this is where ideas form."

This is a startup splash, not an idle page. It plays during the loading state and fades out when the vault is ready (or when the user clicks past the welcome card on first launch).

### Composition

- **Brain.** Centered, ~55% of the smaller viewport dimension. Color: pure white to bone-white with a faint cool tint in the shadows (so it picks up the cosmos behind it). Material: matte with a subtle subsurface-scatter feel — not glossy, not metallic. Real anatomical detail (sulci / gyri visible) is good but not photoreal — go cinematic, not medical-illustration.
- **Rotation.** Continuous about the vertical axis. **24–32 seconds per full revolution.** Slow enough to feel meditative, fast enough that you see motion within 3 seconds of arrival. Slight wobble (≤2° on the X axis, sinusoidal, ~7s period) for a "this is alive, not a CAD model" feel.
- **Camera.** Slight perspective tilt — looking *very slightly* down on the brain (eye angle 8–12° above horizontal). 35–50mm equivalent FOV. Camera itself is static; only the brain rotates.
- **Lighting.** Three-point:
  - Key: cool white from upper-left, ~45°
  - Fill: dim violet (`#a98bff` at ~12% intensity) from lower-right
  - Rim: bright cyan-white from directly behind for a halo silhouette when the rays pass behind the brain
  - No hard shadow on the ground — it floats in cosmos.
- **Electron rays.** 3–5 orbital paths, each at a different inclination (e.g. 0°, 23°, 47°, 71°, 105° from horizontal). Each path carries 1–2 luminous particles traveling at different angular velocities (no two complete an orbit in the same time — irrational ratios so the pattern never repeats). Particle color: starts at `--accent` blue-violet, shifts subtly toward `--accent-2` along its arc. Each particle has a tail that fades over ~30° of arc. The orbits themselves should be faintly visible too — a 1-pixel emissive line at ~25% the brightness of the particle, so you can see the path even when the particle is on the far side. When a ray passes behind the brain, it's occluded (true 3D, not a 2.5D fake).
- **Backdrop.** A vignette of `--bg` deepening to `#070912` at the corners, with the existing `--aurora-1/2/3` gradients painted on top at slightly higher opacity than in the rest of the app (since the splash is a "hero" moment). A handful of distant stars (10–25 small dim points, each ≤1.5px) at random positions, low-amplitude twinkle (only some of them, randomly chosen, with an opacity sine over 4–8s).
- **Foreground caption.** Below the brain, after a 600 ms delay, fade in: "Cortex" in the Inter font (already loaded), 28–36px, weight 500, letter-spacing 0.04em. Below it, in `--text-muted`, "Local-first research notebook" at 13px. Both centered.

### Implementation guidance

Recommended: **Three.js (r150+) via npm**. The deps already include several heavy frontend libs; one more is fine.

- Add `three` to `package.json`. Don't pull in `three/examples/jsm/loaders/GLTFLoader` from a CDN — bundle via Vite.
- Brain model: source a CC0 / CC-BY anatomical brain mesh. **Recommended:** the BodyParts3D / NIH Visual Human-derived brain meshes (CC-BY 2.1 JP) or a Sketchfab CC0 stylized brain. Decimate to ≤30k triangles using Blender or `simplify-modifier`. Export as `.glb` (binary glTF) for compactness. Place at `declercq-cortex/public/brain.glb`. Target file size under 1.5 MB.
- Alternative: **procedural brain** via marching-cubes on a perturbed sphere (no model file needed). Looks abstract but still recognizable. Works if you want to ship without a 3D-asset license trail.
- Particles: small `THREE.Points` with an additive blending material + a soft circular sprite texture (32×32 PNG, white radial gradient with alpha falloff). Bloom via `UnrealBloomPass` from `three/examples/jsm/postprocessing/`.
- Pixel ratio: clamp `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` — 4K Retina users still get crisp output, 1× users save GPU.
- Resize handling: standard `ResizeObserver` on the canvas wrapper.
- **Reduced-motion fallback:** if `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, render a single still frame at the most flattering brain angle (~25° rotated from front, slight tilt) with the orbital paths drawn as faint static curves and the electrons positioned at aesthetic phase angles. No `requestAnimationFrame` loop in this mode.
- **Performance budget:** 60 fps on a 2018-era integrated GPU at 1920×1080. If you can't hit it with bloom on, ship without bloom and paint the rays as additive lines with `THREE.Line2` at higher opacity.

Acceptable simpler alternative if Three.js feels heavy: **CSS 3D + SVG**. A brain rendered as an SVG silhouette wrapped in a `transform-style: preserve-3d` container, layered with CSS-keyframed orbital divs. Looks 2.5D, not true 3D — only fall back to this if Claude Design specifically prefers it.

**Not recommended:** Lottie. The brain rotation needs continuous 3D, not a fixed-loop rendered animation.

### Splash component contract

Create `declercq-cortex/src/components/CerebrumSplash.tsx`. Props:

```ts
export interface CerebrumSplashProps {
  /** Show / hide. Parent controls visibility; on `false`, the
   *  component fades out over 480ms then unmounts WebGL. */
  visible: boolean;
  /** Optional callback fired when fade-out completes. Used by App.tsx
   *  to free the canvas memory once the welcome card has taken over. */
  onFadedOut?: () => void;
  /** Optional caption override; defaults to "Cortex" / "Local-first
   *  research notebook". Pass `null` to suppress the caption (used
   *  if the splash is reused as a brand badge elsewhere). */
  caption?: { title: string; subtitle: string } | null;
}
```

The component owns its own Three.js renderer / scene / camera lifecycle. Mounts on `useEffect`, disposes on unmount (`renderer.dispose()`, `geometry.dispose()`, texture disposal — full clean-up so Vite HMR doesn't leak GPU memory).

### Where it slots into App.tsx

`src/App.tsx` already has two pre-vault states:

```tsx
if (loading) {
  return <main style={baseStyles.shell}><div style={baseStyles.muted}>Loading…</div></main>;
}

if (!vaultPath) {
  return (
    <main style={baseStyles.shell}>
      <div style={baseStyles.welcomeCard} data-aurora-welcome>
        <h1>Welcome to Cortex</h1>
        ...
        <button data-aurora-cta>Choose vault folder</button>
      </div>
    </main>
  );
}
```

The splash should:

- Replace the "Loading…" state entirely.
- Layer **behind** the welcome card on the `!vaultPath` state — i.e. when the user reaches the welcome screen, the brain is already rotating in the background, and the welcome card sits on a translucent glass panel in front of it. This gives the splash → welcome transition zero visual jump; it feels like the welcome panel just fades in over the existing scene.
- Fade out the canvas only after `vaultPath` is set and the first vault tree has finished loading. ~480ms cubic-bezier cross-fade into the main app.

### Acceptance for Part 1

- [ ] Brain visibly rotates within 3s of mount, smooth continuous motion, no stutter.
- [ ] At least one electron ray passes behind the brain and is occluded by it (proves true 3D).
- [ ] Reduced-motion users see a still frame, no rAF loop, same color identity.
- [ ] Memory: full GPU disposal on unmount (no leaked WebGL contexts after navigating away and back ten times).
- [ ] Looks beautiful at 1280×720, 1920×1080, and 3840×2160.
- [ ] Caption typography matches the existing Cortex font stack (Inter primary).
- [ ] Welcome card sits over the splash with a glass panel that lets the rotation read through faintly.
- [ ] Light mode variant: same composition, brain is unchanged white, backdrop becomes a very pale aurora wash, caption text inverts.

---

## 5. Part 2 — Theme refresh aligned to the splash

The Aurora pass already wired the bones. Part 2 takes the same identity deeper into specific surfaces. **Don't rewrite tokens** — extend them. **Don't restructure layout** — restyle in place.

### 5.1 Brand language to carry through

- **Color identity is set.** Don't introduce new accents. Use `--accent`, `--accent-2`, `--accent-gradient`, `--aurora-1/2/3`. If you want a third accent for a specific affordance (e.g. "danger" stays `--danger`), reuse the existing one.
- **Motion identity:** slow, easeInOut, cosmos-like. The brain rotates at 24–32s per turn; ambient transitions in the chrome should match that pace family — i.e. transitions are brisk (`--motion-fast: 120ms`), but ambient effects (idle glows, hover halos that build) breathe slowly (1.5–4s).
- **Geometry identity:** soft rounded corners (`--radius-2: 10px` cards, `--radius-3: 14px` modals, `--radius-pill` for segmented controls / theme toggle). Don't sharpen any corners.

### 5.2 Per-surface direction

Refresh each of these. Prefer adding `data-aurora-*` attribute hooks (already a pattern; see `data-aurora-welcome`, `data-aurora-cta`, `data-aurora-topbar`, `data-aurora-card`) over class changes or React-component restructuring.

**Sidebar (`<aside>`)**

- Currently glass-tinted, 300px wide, with action buttons grouped at the top.
- Direction: tighten the action-button cluster. Today there are ~25 buttons in the sidebar header — they wrap and crowd. Group them into 3–4 logical clusters with subtle dividers (Notes / Hierarchy / Calendar+Time / Settings), each cluster gets a 1-line muted label. This is a CSS-only treatment — the buttons exist, just rearrange via flex / grid grouping.
- Add a faint vertical accent gradient on the right edge — the existing `aside::after` rule does this; consider intensifying it to ~1.5px and animating it slowly between accent and accent-2 over 8s.

**Top toolbar**

- Already glassed. Direction: introduce a subtle inner highlight on the top edge (1px `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`) so it reads as an embossed surface on dark backgrounds.
- Active toolbar buttons (e.g. Bold when caret is in bold text): currently get `--accent-gradient` + a soft halo. Direction: extend the halo to a 4px outer ring at very low alpha so it reads at glance distance.

**Modals**

- Most still use per-component inline `styles` objects with `borderRadius: 6` / `8`. Direction: tag every modal panel with `data-aurora-card`, set `borderRadius: var(--radius-3)` and `boxShadow: var(--shadow-3)` + `backdropFilter: var(--blur-modal)`. The opt-in CSS rule already exists.
- Scrim: tag with `data-aurora-scrim` to pick up the existing `backdrop-filter: var(--blur-modal)` rule + the `cortex-scrim-in` keyframe for a 220ms fade-in.
- Modal headers: very subtle `linear-gradient(to bottom, color-mix(in oklab, var(--accent) 6%, transparent), transparent)` overlay so the top edge gets a halo without competing with the content.

**File tree**

- Inline-styled in `FileTree.tsx`. Direction: add a class hook (`.cortex-filetree-row`) and CSS for: hover background `--accent-bg`, smooth `--motion-fast` transition, selected state with `--accent-bg-2` + a 2px left-edge accent bar in `--accent-gradient`. The class addition is a one-line change in `FileTree.tsx`; rest is CSS.
- Folder chevrons: rotate 90° smoothly on expand (transition `transform 200ms var(--ease)`).

**Welcome card (already partially refreshed)**

- Add a faint conic-gradient halo behind the card (radial bloom of `--accent` at 4% opacity) so the card sits inside a soft glow when over the splash.

**Status bar / NotificationBell area**

- The bell needs a more confident pulse when notifications are unread. Direction: when count > 0, halo it with `box-shadow: 0 0 0 2px var(--accent), 0 0 16px color-mix(in oklab, var(--accent) 50%, transparent)`, pulsing at 1.6s ease-in-out (paused on hover; respect reduced-motion).

**Structural blocks (Frame / Callout / Collapsible / Tabs)**

- Already lightly refreshed. Direction: give each its own faint accent-tinted top edge (1–2px `linear-gradient` left-to-right in the accent family) so the four block types read as "all from the same family" without each being identical.

**Tables**

- Already get rounded outer corners + a soft shadow. Direction: header row gets a `linear-gradient(to bottom, var(--accent-bg), transparent)` so it reads more like a header.

**Code blocks**

- Direction: add a tiny language label tab in the upper-right corner (only when `data-language` is present), `--radius-1`, accent-tinted background, subtle. The data attr is already round-tripped by the cluster-21 v1.1 code-block extension — just style it.

**Theme toggle**

- Currently a 3-way segmented control. Direction: when "Dark" is active, add a small particle (single point) drifting across the segment as ambient cosmos identity. When "Light" is active, replace it with a soft sun-glow ring on the active segment. When "Auto" is active, both faintly visible at half intensity. (Cute but tasteful — suppress entirely on reduced-motion.)

### 5.3 Typography pairing

The existing `EditorToolbar.tsx` already loads (via `index.html` Google Fonts CDN): Inter, Lora, Crimson Text, Playfair Display, EB Garamond, Source Serif, JetBrains Mono, Fira Code, Bebas Neue, Cinzel, Caveat, Pacifico.

Brand pairing for chrome (not editor content):

- **UI sans:** Inter (already in use). Weights: 400 (body), 500 (buttons / labels), 600 (headings).
- **Brand display:** Inter is fine for the splash caption; if Claude Design wants more identity, pick **Cinzel** (already loaded, evokes a serif gravitas) for the splash caption only — never for body or buttons.
- **Mono:** JetBrains Mono (already in use) for code blocks, file paths, monospace UI.

### 5.4 Acceptance for Part 2

- [ ] Sidebar action buttons grouped into ≤4 visually-distinct clusters; total visual density reduced.
- [ ] Every modal panel has `--radius-3` corners and `--shadow-3` elevation.
- [ ] File tree rows have smooth hover + a clear selected-state left bar.
- [ ] Notification bell pulses on unread count (and only on unread count, and only off reduced-motion).
- [ ] Light mode is a complete first-class citizen, not an afterthought — every Aurora effect has a light variant tested by toggling theme to Light.
- [ ] Side-by-side: opening the app feels like stepping out of the splash into the same universe, not into a different product.

---

## 6. Deliverables I expect from Claude Design

1. **`src/components/CerebrumSplash.tsx`** — full Three.js component, props as above, GPU clean-up, reduced-motion fallback. Plus any helper files (loaders, scene setup) it wants.
2. **`public/brain.glb`** — chosen / decimated brain mesh, ≤1.5 MB, attribution line in the file's userData / a `LICENSES.md` entry.
3. **`public/electron-particle.png`** — soft white radial sprite, 32×32 or 64×64.
4. **Patches to `src/App.tsx`** — wire the splash above the loading state and behind the welcome card; fade-out on vault load; nothing else.
5. **Patches to `src/index.css`** — additive only. Group all new rules in a clearly-marked `Cluster 26 — Cerebrum theme pass` section at the bottom of the file.
6. **Patches to per-component inline `styles` objects** — only for the surfaces called out in Part 2 (modals, file tree row class hook, notification bell, structural block tops). Keep the diff small.
7. **`package.json` patch** — add `three` (and post-processing if used). Don't add anything else.
8. **A short visual changelog (`design-notes.md`)** — what changed where, with token references and screenshots if possible.

**What I do not want from Claude Design:**

- Don't propose new file formats, new Tauri commands, new on-disk artefacts.
- Don't refactor any TipTap extension.
- Don't rename any CSS variable. Extend them, don't re-name.
- Don't add tracking, telemetry, or external network calls.
- Don't pin Tailwind versions or rewrite `index.html` beyond the Google Fonts `<link>` already present.

---

## 7. How to ship this in the existing convention

Cortex ships in tagged "clusters." This work is **Cluster 26 — Cerebrum + theme pass** (Cluster 25 was the Aurora groundwork already on disk). Convention from `COWORK_HANDOFF.md`:

- Add a `cluster_26_cerebrum.md` next to `phase_2_overview.md` in the git root.
- Write a `verify-cluster-26-v1.0.ps1` inside `declercq-cortex/` that runs prettier, cargo fmt + check (Rust unchanged, but the verify still runs for safety), commits, and tags `cluster-26-v1.0-complete`.
- Tag pattern: `cluster-26-v1.0-complete`. Push from the **outer** `C:\Declercq Cortex` folder.

The verify script doesn't need to validate the splash's visual quality — that's eyeball-tested. It just needs to confirm the build succeeds, prettier passes, and `pnpm tauri dev` starts cleanly.

---

## 8. Quick reference — files to read first

In this order:

1. `COWORK_HANDOFF.md` — architecture, ship workflow, watchouts.
2. `cluster_24_qol_pack_2.md` — most recent shipped cluster (file-ops in sidebar + reviews).
3. `declercq-cortex/src/index.css` lines 33–155 — Aurora token palette + new tokens.
4. `declercq-cortex/src/index.css` lines 3284–3663 — Cluster 25 chrome rules to extend.
5. `declercq-cortex/src/App.tsx` — top-level layout, baseStyles, loading + welcome states.
6. `declercq-cortex/src/components/EditorToolbar.tsx` — existing motion / particle patterns to mirror.
7. `declercq-cortex/src/components/ThemeToggle.tsx` — confirms 3-way Auto/Light/Dark contract.

That's enough context to design without breaking anything.

---

*Document maintained at `C:\Declercq Cortex\design-brief-cerebrum-splash.md`. Update freely as the design conversation evolves.*
