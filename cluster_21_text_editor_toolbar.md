# Cluster 21 — Text Editor Toolbar Overhaul

_Build order: Phase 3, on demand. No upstream dependencies beyond the existing TipTap stack._

---

## What this is

A persistent, scroll-following toolbar above the markdown editor with comprehensive formatting controls — basic marks, headings/paragraph styles, alignment/spacing, lists, font size / family / weight, text + highlight + underline color pickers (with a marker-pen mode), strike-resolve variants, **visual text effects** (glow, shadow, gradient, golden, neon, animation, particle effects), insertion menus (link, footnote, citation, special character, emoji, symbol, math, date), structural nodes (callout, columns, side-by-side, tabs, decorative divider, toggle/collapsible, margin note, frame), utility tools (find & replace, live counts, outline, zoom, focus mode, reading mode, show invisibles, print, DOCX export), Cortex-specific quick actions, and toolbar-level polish (density preset, group reorder, favorites, pause-animations).

## Why we want it

The vault is a research notebook; documents that look like one — with structure, callouts, intentional typography — are easier to come back to than an unbroken wall of monospace text. The current editor exposes most TipTap features only through keyboard shortcuts; the toolbar makes them discoverable and stacks new effects on top (gradients, glows, particles) that simply have no keyboard equivalent.

## Decisions already made

- **Sticky scrolling banner.** `EditorToolbar.tsx` mounted inside the `editorWrapperRef` div in `TabPane`, `position: sticky; top: 0; z-index: 60`. It scrolls with the rest of the editor content but pins to the top of the visible area while the user is mid-document, like Word or Google Docs.
- **Extension consolidation.** Rather than 40+ TipTap extensions, a handful of multi-purpose marks cover the bulk:
  - `CortexFontStyle` mark — `data-size`, `data-family`, `data-weight` attrs.
  - `CortexUnderlineStyled` mark — `data-color`, `data-thickness`, `data-style` (solid/dashed/dotted/double/wavy), `data-offset`.
  - `CortexTextEffect` mark — `data-effect` attr maps to a CSS class (`glow-soft`, `glow-neon`, `shadow-drop`, `embossed`, `engraved`, `extrude-3d`, `outline-stroke`, `halo`, `gradient-golden`, `gradient-silver`, `gradient-rainbow`, `gradient-sunset`, `gradient-ocean`, `gradient-custom`, `anim-pulse`, `anim-bounce`, `anim-shake`, `anim-wave`, `anim-typewriter`, `anim-marquee`, `anim-fade`, `anim-colorcycle`, `anim-animgradient`, `anim-glitch`, `anim-flicker`, `anim-heartbeat`, `anim-float`).
  - `CortexParticleHost` mark — `data-particle` attr triggers the canvas overlay system; values: `sparkle`, `star`, `confetti`, `snow`, `heart`, `ember`, `smoke`, `bubble`, `lightning`, `pixie`, `petal`, `comet`, `bokeh`, `coderain`.
  - `CortexLineHeight` and `CortexParagraphSpacing` — paragraph-node attrs.
  - `CortexIndent` — paragraph-node attr.
  - `CortexDropCap` mark — applied to a single character at the start of a paragraph.
- **Marker-pen mode.** A new TipTap plugin tracks a `markerActive: boolean` plus `markerColor: string` in plugin state. While active, every selection-end event applies the highlight mark with the active color and clears the selection. Toggleable from the toolbar; visible cursor / banner indicator while on so the user can see the mode is hot.
- **Particle overlay.** A separate `ParticleOverlay.tsx` component scans the editor DOM for `[data-particle]` spans via `IntersectionObserver`, mounts a sibling `<canvas>` absolutely positioned over each visible span, animates per-type particle render functions via `requestAnimationFrame`. Pauses when the span scrolls offscreen or when the global "pause animations" toggle is on. Respects `prefers-reduced-motion`.
- **Markdown round-trip via `html: true`.** All new marks/nodes emit `<span>`/`<div>` HTML with `data-*` attrs. tiptap-markdown's `html: true` preserves inline HTML. CommonMark "type-6 HTML block" leaves block-level HTML untouched on parse. Marks that have a clear markdown equivalent (bold, italic, etc.) still serialize to that.
- **Strike-resolve replaces strikethrough.** Per user request, the toolbar's "strikethrough" button instead applies the existing Cluster 2 strike-resolve (Ctrl+Shift+X) — strikes the selection AND clears any mark on it. The strikethrough variants (color picker, double, dashed) extend the strike-resolve mark via attrs so the existing routing pipeline doesn't notice a difference.
- **One TipTap mark per effect family**, configured via attrs — keeps the schema small and lets effects compose (a span can be glowing AND golden AND animated). The CSS classes are designed to compose (gradient via `background-clip: text`, animation via independent transforms / opacities, glow via `text-shadow` stacks).
- **DOCX export is frontend-only**, via the `docx` JS library (≈100KB minified, well-maintained). Saves us a Rust crate compile.
- **PDF export uses Tauri's WebView print** — `window.print()` opens the OS print dialog with "Save as PDF" as a destination on every supported OS.
- **Find & replace** is decoration-based — a ProseMirror plugin walks the doc on every transaction or on the search bar's input, emits `Decoration.inline` matches, replace-all walks the matches and applies a single transaction.
- **Outline panel** is a sidebar that scans the doc for headings on every doc change (debounced) and renders a clickable list. Uses ProseMirror's `editor.view.coordsAtPos` to scroll the editor on click.
- **Focus mode** dims non-current paragraphs via a Decoration plugin keyed on the cursor's parent paragraph.
- **Reading mode** is a CSS class that hides the toolbar, sidebar, panels.
- **Show invisibles** is a Decoration plugin emitting widget decorations for hard-breaks (`¶`) and replacing spaces with `·`.

## Decisions still open

### Drop cap implementation

Two approaches: (a) a `cortexDropCap` mark applied to the first character, with CSS `font-size: 3em; float: left; margin-right: 0.1em; line-height: 0.9` — simple, but the user has to manually mark the first character. (b) A node-level paragraph attr `dropCap: true` that the renderer auto-applies to the first character via a NodeView. v1.0 ships (a) for simplicity; v1.1 may add (b).

### Footnote / citation

Footnotes are an inline reference + a back-of-document footnote block. v1.0 ships a `cortexFootnote` mark that wraps the inline reference (clickable to scroll to definition) plus a `cortexFootnoteDef` node at the end. Citations are a similar pair but render with bracketed numbering. Round-trip via HTML + data-attrs.

### Math equations

Inline math `$x^2$` and block math `$$x^2$$` via KaTeX. New `katex` dep (~280KB), rendered by a NodeView. Markdown round-trips via raw `$...$` for inline and `$$...$$` for block — markdown-it's `texmath` plugin handles parsing if we add it; otherwise we serialize as raw text and keep the source visible (acceptable for v1.0).

## Architecture sketch

### File layout

```
src/components/EditorToolbar.tsx              ← main shell
src/components/EditorToolbar/
  TextStyleGroup.tsx                          ← B/I/U + sub/super + code + clear
  ParagraphGroup.tsx                          ← H1-H6, body, blockquote, pull quote, code block, drop cap
  AlignmentGroup.tsx                          ← left/center/right/justify, indent/outdent, line-height, spacing
  ListsGroup.tsx                              ← bullet/numbered/task, custom glyph/numbering, indent/outdent, collapse
  SizeGroup.tsx                               ← preset selector, custom input, +/-, reset
  FontGroup.tsx                               ← family selector, weight, italic
  ColorPickerPopover.tsx                      ← shared by text/highlight/underline/strike-resolve
  HighlightGroup.tsx                          ← 7 mark color buttons + marker-pen toggle + reset
  UnderlineGroup.tsx                          ← color, thickness, style, offset, wavy
  StrikeResolveGroup.tsx                      ← strike-resolve button + color + double + dashed
  EffectsGroup.tsx                            ← glow/shadow/gradient/animation popovers
  ParticlesGroup.tsx                          ← particle picker
  InsertGroup.tsx                             ← link, footnote, citation, special char, emoji, symbol, math, date
  LayoutGroup.tsx                             ← columns, side-by-side, tabs, divider, toggle, margin note, frame
  UtilityGroup.tsx                            ← find/replace, counts, spellcheck, outline, zoom, focus, reading, invisibles, print, docx
  CortexGroup.tsx                             ← experiment/protocol/idea/method blocks, wikilink, daily log, github
  TextStylePicker.tsx                         ← font dropdown
  EmojiPicker.tsx                             ← emoji grid
  SymbolPicker.tsx                            ← math/symbol grid
  SpecialCharPicker.tsx                       ← em-dash etc.
  EffectPickerPopover.tsx                     ← grid of effect previews
  GradientPickerPopover.tsx                   ← preset list + custom 2/3-stop builder
  AnimationPickerPopover.tsx                  ← list of animations with hover preview
  ParticlePickerPopover.tsx                   ← list of particle types with preview
src/components/ParticleOverlay.tsx            ← canvas overlay manager
src/components/FindReplaceBar.tsx             ← Ctrl+F / Ctrl+H bar
src/components/OutlinePanel.tsx               ← TOC sidebar
src/components/MathInputModal.tsx             ← LaTeX input
src/components/InsertLinkModal.tsx            ← URL + text
src/components/InsertFootnoteModal.tsx
src/components/InsertCitationModal.tsx
src/editor/CortexFontStyle.ts                 ← size + family + weight mark
src/editor/CortexUnderlineStyled.ts           ← color + thickness + style + offset
src/editor/CortexTextEffect.ts                ← glow/shadow/gradient/animation mark
src/editor/CortexParticleHost.ts              ← particle mark
src/editor/CortexLineHeight.ts                ← paragraph attr
src/editor/CortexParagraphSpacing.ts          ← paragraph attrs (top/bottom)
src/editor/CortexIndent.ts                    ← paragraph indent attr
src/editor/CortexDropCap.ts                   ← drop-cap mark
src/editor/CortexBulletGlyph.ts               ← list-style attrs
src/editor/CortexOrderedListStyle.ts
src/editor/CortexMarkerMode.ts                ← marker-pen plugin
src/editor/CortexCallout.ts                   ← callout node (info/tip/warning/danger/note)
src/editor/CortexColumns.ts                   ← 2 / 3 column container node
src/editor/CortexSideBySide.ts
src/editor/CortexTabs.ts
src/editor/CortexCollapsibleBlock.ts
src/editor/CortexMarginNote.ts
src/editor/CortexFrame.ts
src/editor/CortexPullQuote.ts
src/editor/CortexFootnote.ts                  ← inline ref + def node pair
src/editor/CortexCitation.ts
src/editor/CortexMathInline.ts
src/editor/CortexMathBlock.ts
src/editor/CortexDecoSeparator.ts             ← decorative divider with glyph
src/editor/CortexPageBreak.ts
src/editor/CortexFindReplace.ts               ← decoration plugin
src/editor/CortexFocusMode.ts                 ← decoration plugin
src/editor/CortexInvisibles.ts                ← decoration plugin
src/index.css                                  ← all the visual effects + animation keyframes + toolbar styles
```

### Toolbar layout

Single horizontal bar, grouped sections separated by 1-px borders. Each section is collapsible (chevron). Density preset (compact / comfortable / spacious) controls button height + padding. Favorites group at the start can pin user-chosen buttons. Multi-row when window is narrow (CSS flex-wrap).

### Keyboard shortcuts (new in this cluster)

| Key                          | Action                          |
| ---------------------------- | ------------------------------- |
| `Ctrl+<` (`Ctrl+Shift+,`)    | Toggle subscript                |
| `Ctrl+>` (`Ctrl+Shift+.`)    | Toggle superscript              |
| `Ctrl+F`                     | Find bar                        |
| `Ctrl+H`                     | Find & replace bar              |
| `Ctrl+\`                     | Clear formatting                |
| `Ctrl+0`                     | Reset to body text size         |
| `Ctrl++` / `Ctrl+=`          | Increase font size              |
| `Ctrl+-`                     | Decrease font size              |
| `Ctrl+Alt+F`                 | Toggle focus / typewriter mode  |
| `Ctrl+Alt+R`                 | Toggle reading mode             |
| `Ctrl+Alt+I`                 | Toggle show-invisibles          |
| `F7`                         | Toggle spellcheck               |

(All gated to "editor has focus" so they don't collide with palette / nav.)

### Effect composition

A span can carry multiple effect marks simultaneously: `<span data-effect="gradient-golden anim-pulse" data-particle="sparkle">important word</span>`. Each effect class is independent; the gradient applies via `background-clip: text`, the animation via `transform`/`opacity`, the particle via the canvas overlay sibling. They compose without conflict.

### Particle render strategy

`ParticleOverlay` runs at most one global rAF loop. For each visible particle-marked span:

- A per-span canvas sized to the span's bounding box (refreshed via ResizeObserver).
- A per-span particle pool (~10-20 particles depending on type).
- Each tick: clear, advance positions, render. CPU cost ~0.1ms per visible span.
- Offscreen spans pause via IntersectionObserver disconnect.
- Global "pause animations" toggle freezes the rAF loop entirely.
- `prefers-reduced-motion` defaults the toggle to ON on first run.

### Toolbar persistence

Single localStorage key `cortex:editor-toolbar-prefs`:

```json
{
  "density": "comfortable",
  "collapsedGroups": ["effects", "particles"],
  "favorites": ["bold", "h1", "color"],
  "pauseAnimations": false,
  "reduceMotion": false,
  "readingMode": false,
  "spellcheck": true,
  "zoom": 1.0
}
```

### CSS class registry

Inside `index.css` under a new section `Cluster 21 — Text Editor effects`:

```css
.tx-glow-soft        { text-shadow: 0 0 6px var(--tx-glow-color, currentColor); }
.tx-glow-neon        { text-shadow: 0 0 4px #fff, 0 0 8px var(--tx-glow-color, #ff0080), ...; }
.tx-shadow-drop      { text-shadow: 1px 1px 2px rgba(0,0,0,.45); }
.tx-shadow-inset     { text-shadow: inset 0 0 4px rgba(0,0,0,.5); }
.tx-embossed         { text-shadow: -1px -1px 0 #fff, 1px 1px 0 #555; }
.tx-engraved         { text-shadow: -1px -1px 0 #555, 1px 1px 0 #fff; }
.tx-extrude-3d       { text-shadow: 1px 1px 0 #ccc, 2px 2px 0 #bbb, ...; }
.tx-outline          { -webkit-text-stroke: 1px var(--tx-stroke-color, currentColor); color: transparent; }
.tx-halo             { text-shadow: 0 0 12px var(--tx-glow-color, currentColor); }
.tx-gradient-golden  { background: linear-gradient(120deg, #f7e07a, #d4a017, #6a4710);
                       -webkit-background-clip: text; background-clip: text; color: transparent; }
.tx-gradient-silver  { ... }
.tx-gradient-rainbow { ... }
.tx-gradient-sunset  { ... }
.tx-gradient-ocean   { ... }
.tx-anim-pulse       { animation: cortex-anim-pulse 1.6s ease-in-out infinite; }
.tx-anim-bounce      { animation: cortex-anim-bounce 1s ease-in-out infinite; }
.tx-anim-shake       { animation: cortex-anim-shake 0.5s linear infinite; }
.tx-anim-wave        { /* per-character delay handled via NodeView */ }
.tx-anim-typewriter  { /* triggered on viewport entry */ }
.tx-anim-marquee     { animation: cortex-anim-marquee 12s linear infinite; }
.tx-anim-fade        { /* triggered on viewport entry */ }
.tx-anim-colorcycle  { animation: cortex-anim-colorcycle 5s linear infinite; }
.tx-anim-animgradient { background-size: 200% 200%; animation: cortex-anim-gradient 4s ease infinite; }
.tx-anim-glitch      { /* layered ::before / ::after */ }
.tx-anim-flicker     { animation: cortex-anim-flicker 1.2s steps(2) infinite; }
.tx-anim-heartbeat   { animation: cortex-anim-heartbeat 1s ease-in-out infinite; }
.tx-anim-float       { animation: cortex-anim-float 4s ease-in-out infinite; }

/* Pause-all class on body */
body.cortex-anim-paused .tx-anim-pulse,
body.cortex-anim-paused .tx-anim-bounce,
body.cortex-anim-paused .tx-anim-shake,
... { animation-play-state: paused !important; }
```

### Markdown serialization

- Marks emit as `<span class="tx-..." style="...">…</span>`.
- Layout nodes emit as `<div class="cortex-callout cortex-callout-info">…</div>` etc.
- Footnotes emit `<sup class="cortex-fn" data-id="…">[1]</sup>` inline + `<div class="cortex-fn-defs">…</div>` block.
- Math: inline as `<span class="cortex-math-inline" data-tex="…">$x^2$</span>` (the $-source preserved as the visible content if KaTeX render fails).
- Page break: `<hr class="cortex-page-break" />`.
- Decorative separator: `<hr class="cortex-deco-separator" data-glyph="❦" />`.
- Drop cap: `<span class="cortex-drop-cap">A</span>`.

Round-trip relies on tiptap-markdown's `html: true` (already enabled). New parseHTML rules in each extension read the data-attrs / classes back.

## Verify pointer

`verify-cluster-21-v1.0.ps1` walks every group's smoke passes (one section per toolbar group). Sections A through V.

## Sequenced follow-ups (v1.1+)

- All particle effects fully tuned (some land in v1.0 with simpler render).
- Color cycling for animated gradients with custom palette.
- Font preview in the family dropdown.
- Recent-color row sync across all three pickers (text / highlight / underline) instead of independent.
- Drop-cap auto-mode (paragraph attr instead of mark on first char).
- Spellcheck integration with a Rust-side dictionary (currently uses the browser's native spellcheck).
- Citations linked to a vault-level `Citations.md` file.
- Outline panel shows H4/H5/H6 collapsibly (v1.0 only goes to H3).
- Find & replace with regex.
- Multi-document find & replace.
- Math LaTeX preview pane in MathInputModal.
- Tab-set node navigation via keyboard.
- Margin notes auto-positioning when notes overlap.
- Frame node with corner glyph picker.
- Toolbar "favorites" stored per-doc via frontmatter when set explicitly.
