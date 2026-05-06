# verify-cluster-21-v1.0.ps1
# Phase 3 Cluster 21 v1.0 — Text Editor Toolbar Overhaul.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend-only changes; hot-reload picks them up
#   .\verify-cluster-21-v1.0.ps1
#
# What ships
# ----------
#
# A persistent, scroll-following toolbar above the markdown editor with
# comprehensive formatting controls — basic marks, headings/paragraph
# styles, alignment/spacing, lists, font size / family / weight, text +
# highlight + underline color pickers (with a marker-pen mode), strike-
# resolve variants, visual text effects (glow, shadow, gradient, golden,
# neon, animation, particle effects), insertion menus (link, footnote,
# citation, special character, emoji, symbol, math, date), structural
# nodes (callout, columns, side-by-side, tabs, decorative divider,
# toggle/collapsible, margin note, frame), utility tools (find &
# replace, live counts, outline, zoom, focus mode, reading mode, show
# invisibles, print, DOCX export), Cortex-specific quick actions, and
# toolbar-level polish (density preset, group reorder, favorites,
# pause-animations).
#
# Architecture
# ------------
#
# - EditorToolbar.tsx is mounted INSIDE the editor wrapper in TabPane,
#   sticky-positioned at the top of the visible area so it scrolls with
#   the document until it reaches the viewport top, then pins.
# - TipTap extensions consolidate aggressively: one CortexFontStyle
#   mark covers size + family + weight via data-* attrs; one
#   CortexUnderlineStyled mark covers color + thickness + style +
#   offset; one CortexTextEffect mark covers all glow / shadow /
#   gradient / animation effects via a data-effect attr → CSS class;
#   one CortexParticleHost mark wires data-particle to the particle
#   canvas overlay.
# - Marker-pen mode: a TipTap plugin tracks an "active" flag + color
#   in plugin state; on every selection-end while active, applies
#   the highlight mark with that color and clears the selection.
# - ParticleOverlay.tsx — IntersectionObserver scans for [data-particle]
#   spans, mounts a per-span <canvas> sibling, runs particle render
#   functions via a single global requestAnimationFrame loop. Pauses
#   when offscreen / when global "pause animations" toggle is on.
#   Respects prefers-reduced-motion (defaults the toggle ON).
# - FindReplaceBar — Ctrl+F bar with match decorations; Ctrl+H adds
#   a replace input.
# - OutlinePanel — sidebar, toggleable, scans the doc on doc-change
#   (debounced) and lists clickable headings.
# - Focus / typewriter mode — Decoration plugin dims non-current
#   paragraphs.
# - Reading mode — CSS class hides toolbar / panels / sidebar.
# - Show invisibles — Decoration plugin emits widgets for paragraph
#   marks and replaces spaces with dot-glyphs.
# - DOCX export — frontend `docx` JS lib; HTML → docx converter
#   walks the editor's HTML output and produces a downloadable file.
# - PDF export — window.print() opens the OS dialog with "Save as PDF"
#   as a destination.
#
# Toolbar persistence in localStorage `cortex:editor-toolbar-prefs`:
# density, collapsedGroups, favorites, pauseAnimations, reduceMotion,
# readingMode, spellcheck, zoom.
#
# New keyboard shortcuts
# ----------------------
#
#   Ctrl+<                Toggle subscript        (Ctrl+Shift+,)
#   Ctrl+>                Toggle superscript      (Ctrl+Shift+.)
#   Ctrl+F                Find bar
#   Ctrl+H                Find & replace bar
#   Ctrl+\                Clear formatting
#   Ctrl+0                Reset to body text size
#   Ctrl++ / Ctrl+=       Increase font size
#   Ctrl+-                Decrease font size
#   Ctrl+Alt+F            Toggle focus / typewriter mode
#   Ctrl+Alt+R            Toggle reading mode
#   Ctrl+Alt+I            Toggle show-invisibles
#   F7                    Toggle spellcheck
#
# Smoke tests
# -----------
#
# Pass A — Toolbar shell:
#   1. Open a markdown note. The toolbar appears above the editor body
#      with groups (Format, Paragraph, Align, Lists, Size, Font, Color,
#      Highlight, Underline, Strike, Effects, Particles, Insert,
#      Layout, Utility, Cortex).
#   2. Scroll the document down. The toolbar follows the scroll for
#      the first 80-100 px, then pins to the top of the visible area.
#   3. Continue scrolling — toolbar stays pinned.
#   4. Scroll back to the top — toolbar returns to its original
#      position relative to the document.
#
# Pass B — Basic formatting:
#   1. Type "hello world". Select "hello".
#   2. Click the Bold button (B) → "hello" goes bold. Click again to
#      toggle off. Same for Italic, Underline, Inline code.
#   3. Press Ctrl+< over a selection → subscript. Press Ctrl+>
#      → superscript. Toolbar buttons mirror.
#   4. Click the Clear (✕) button → all marks stripped.
#   5. Press Ctrl+\ → also clears.
#
# Pass C — Strike-resolve replaces strikethrough:
#   1. The toolbar's strike button applies the strike-resolve mark
#      (existing Cluster 2 Ctrl+Shift+X behavior — strikes AND
#      resolves any colour mark).
#   2. The strike-resolve color picker subgroup overrides the line
#      color via the mark's data-color attr.
#   3. "Double" and "Dashed" toggles change the underline-style of
#      the strike line via data-style.
#
# Pass D — Headings + paragraph styles:
#   1. Click H1 → current paragraph becomes H1. Same for H2, H3.
#   2. The H4/H5/H6 popover offers all three.
#   3. Click "Body" → reverts to paragraph.
#   4. "Block quote" wraps the paragraph in a blockquote.
#   5. "Pull quote" applies an oversized quoted style with a left
#      border.
#   6. "Code block" creates a fenced code block with a language
#      picker.
#   7. "Drop cap" — select the first character of a paragraph,
#      click the drop-cap button → 3em, floated, 0.9 line-height.
#
# Pass E — Alignment + indent + spacing:
#   1. Align left / center / right / justify buttons toggle on the
#      current paragraph.
#   2. Indent + / - buttons add / remove paragraph indent (data-
#      indent attr; CSS padding-left).
#   3. Line-height selector cycles through 1.0 / 1.15 / 1.5 / 2.0
#      / custom.
#   4. Paragraph spacing popover sets above + below in px.
#
# Pass F — Lists:
#   1. Bullet list → toggles. Ordered list → toggles. Task list →
#      toggles, checkboxes appear and are clickable.
#   2. Custom bullet glyph picker offers ●, ◆, ★, →; selection is
#      rendered via list-style-type or pseudo-element.
#   3. Custom numbering picker offers 1/i/A/a; the list re-renders
#      with the chosen style.
#   4. Indent / outdent buttons nest / unnest the current item.
#   5. Collapse arrow on a parent list-item collapses its children
#      (visual; no data change).
#
# Pass G — Font size:
#   1. Size selector dropdown offers 8/10/12/14/16/18/20/24/28/32/
#      36/48/64/96 px.
#   2. Custom size input accepts free numeric entry (8-200).
#   3. + and - step buttons increment / decrement by one preset.
#   4. Reset button clears the size attr.
#   5. Ctrl++/=/-, Ctrl+0 keyboard equivalents work.
#
# Pass H — Font family + weight + style:
#   1. Family selector offers Sans-serif, Serif, Monospace,
#      Handwriting, plus a curated list (Inter, JetBrains Mono,
#      Lora, Crimson, Caveat, Playfair). Selection applies to
#      selection or current paragraph.
#   2. Per-document default font picker stores in frontmatter; new
#      paragraphs default to it.
#   3. Weight selector 300/400/500/600/700/800/900.
#   4. Italic / oblique toggle.
#
# Pass I — Text color picker:
#   1. The Color group's swatch button opens a popover with palette
#      + hex input + recent-colors row + eyedropper button.
#   2. Click a swatch → applies to selection.
#   3. Type a hex into the input → applies.
#   4. Eyedropper → opens browser's native EyeDropper API (Tauri
#      Chromium supports it). Pick any color on screen → applies.
#   5. Recent-colors row grows as you use new colors.
#   6. Reset button clears the color.
#   7. "Multi-color text" cycles through the palette per character
#      across the selection.
#   8. "Random color sprinkle" applies a different random hue to
#      each character in the selection.
#
# Pass J — Highlight (mark colors + marker-pen mode):
#   1. The Highlight group has 7 swatches mirroring the existing
#      Cluster 2 mark colors (Ctrl+1-7). Click a swatch to apply
#      the corresponding mark to the current selection.
#   2. The "Marker pen" toggle button activates marker-pen mode.
#      The cursor changes to a marker-pen icon while on. The color
#      picker beside the toggle sets the marker color.
#   3. While active, drag-select any text. ON CURSOR RELEASE, the
#      selection is highlighted with the marker color and the
#      selection is cleared (so the user can immediately drag-
#      select another span).
#   4. Esc or clicking the toggle again exits marker-pen mode.
#   5. The "Reset highlight" button clears highlight on selection.
#
# Pass K — Underline styled:
#   1. The Underline group's color picker sets the underline color
#      independently from text color (data-color attr; CSS
#      text-decoration-color).
#   2. Thickness selector: thin / medium / thick / extra-thick
#      (text-decoration-thickness).
#   3. Style selector: solid / dashed / dotted / double / wavy
#      (text-decoration-style).
#   4. Wave amplitude slider (only visible when style=wavy).
#   5. Offset slider (text-underline-offset).
#   6. Multi-color underline (a CSS gradient under the line via
#      a custom data-* class).
#   7. Animated marching-ants underline (CSS keyframes shifting
#      a dashed line's offset).
#
# Pass L — Glow + shadow effects:
#   1. The Effects popover has a Glow section with: Soft glow,
#      Neon glow, Halo. Click any → applies the matching CSS
#      class via the CortexTextEffect mark.
#   2. Shadow section: Drop shadow, Inset shadow, Embossed,
#      Engraved, 3D extrude, Outline / stroke.
#   3. Each effect button has a tiny preview glyph showing the
#      result.
#   4. Re-clicking an active effect removes it.
#
# Pass M — Gradient text:
#   1. The Gradient section offers presets: Golden, Silver,
#      Rainbow, Sunset, Ocean.
#   2. Each renders the selection with `background-clip: text` +
#      transparent fill so the gradient shows through.
#   3. "Custom gradient" opens a builder with 2 or 3 color stops
#      and an angle slider.
#
# Pass N — Animation effects:
#   1. The Animation popover lists: Pulse, Bounce, Shake, Wave,
#      Typewriter, Marquee, Fade-in, Color cycle, Animated
#      gradient, Glitch, Flicker, Heartbeat, Float.
#   2. Each is a CSS keyframe animation; click to apply, click
#      again to remove.
#   3. Hover preview shows the animation in the popover before
#      committing.
#   4. Shake, Pulse, Wave, Bounce visibly animate on the page once
#      applied. Color cycle hue-rotates the text. Animated gradient
#      drifts the gradient stops.
#
# Pass O — Particle effects:
#   1. The Particles popover lists: Sparkle, Star, Confetti, Snow,
#      Heart, Ember, Smoke, Bubble, Lightning, Pixie, Petal,
#      Comet, Bokeh, Code-rain.
#   2. Click any → applies CortexParticleHost mark with that name.
#   3. The ParticleOverlay component detects the new [data-
#      particle] span, mounts a canvas sibling, and starts
#      rendering particles around / over the text.
#   4. Particles are visible: sparkles twinkle, snow falls, embers
#      rise, lightning flashes occasionally.
#   5. Scroll the particle off-screen — animation pauses
#      (IntersectionObserver disconnect).
#   6. Toggle "Pause animations" in the toolbar — all particles
#      freeze.
#   7. Re-click the same particle button → removes the mark.
#
# Pass P — Insertion menus:
#   1. Insert link — opens a modal with URL + display text fields.
#      Submit wraps the selection in a Link mark.
#   2. Insert footnote — places a `<sup>[N]</sup>` at the cursor
#      and opens a footnote-editor modal. The footnote-defs block
#      at the end of the doc accumulates definitions.
#   3. Insert citation — places `[N]` and opens a citation modal
#      (title / authors / year / URL fields).
#   4. Insert HR — adds a horizontal rule.
#   5. Insert page break — adds a `<hr class="cortex-page-break">`.
#   6. Special character picker offers em-dash (—), en-dash (–),
#      ellipsis (…), copyright (©), trademark (™), etc.
#   7. Emoji picker — searchable grid; click inserts the emoji.
#   8. Symbol picker — Σ π ÷ ≠ ∴ ∞ etc.
#   9. Math input modal — LaTeX entry; renders inline `<span
#      class="cortex-math-inline">` with KaTeX. Block math via
#      the same modal with a "block" toggle.
#   10. Date stamp button inserts the current date in the user's
#       locale format.
#
# Pass Q — Layout / structure nodes:
#   1. 2-column / 3-column buttons wrap the current selection or
#      cursor in a `<div class="cortex-columns cortex-columns-2">`.
#      The two columns are independently editable.
#   2. Side-by-side splits content into two equal columns with a
#      vertical divider.
#   3. Tabs button creates a tab-set node — a horizontal row of
#      named tab buttons + a single content panel showing the
#      active tab. Adding tabs / renaming via right-click.
#   4. Decorative section divider — picker offers ❦ ✦ ◆ ※; the
#      chosen glyph renders centered between two horizontal lines.
#   5. Toggle / collapsible block — wraps content in a `<details>`
#      element. Summary line visible always; body collapses on
#      click.
#   6. Floating sidebar / margin note — places a small annotation
#      to the right of the main column, sticky to the line where
#      it was inserted (CSS float: right + clear: right).
#   7. Frame around section — wraps content in a bordered box
#      with optional corner decoration.
#
# Pass R — Utility tools:
#   1. Ctrl+F → find bar slides down from the top of the editor.
#      Type a query → all matches in the doc are highlighted via
#      ProseMirror decorations. Up / Down arrows step through
#      matches.
#   2. Ctrl+H → adds a "replace with" input below find. Replace
#      and Replace all buttons.
#   3. Live word / char / reading-time counts in the toolbar's
#      utility group, updating on every doc change.
#   4. Spellcheck toggle (F7) sets contenteditable's spellcheck
#      attr to true / false.
#   5. Outline panel button toggles a sidebar showing every
#      heading. Click a heading → editor scrolls to it.
#   6. Zoom selector (50/75/100/125/150%) applies CSS
#      transform: scale to the editor wrapper.
#   7. Focus / typewriter mode (Ctrl+Alt+F) — non-current
#      paragraphs dim to 30% opacity. Current paragraph is fully
#      visible. Updates on cursor move.
#   8. Reading mode (Ctrl+Alt+R) — hides the toolbar, panels,
#      sidebar; shows just the document body at full width.
#   9. Show invisibles (Ctrl+Alt+I) — pilcrow ¶ at end of each
#      paragraph, dot · for each space.
#   10. Print → window.print() opens the OS dialog (Save as PDF
#       available as a destination).
#   11. Export DOCX → generates a .docx via the `docx` JS library
#       and triggers a download (or prompts for a save location).
#
# Pass S — Cortex shortcuts in the toolbar:
#   1. Insert experiment block button → equivalent to Ctrl+Shift+B
#      → opens the existing modal.
#   2. Insert protocol / idea / method → same.
#   3. Insert wikilink → equivalent to Ctrl+Shift+W → wraps
#      selection or opens palette.
#   4. Today's daily-log link button inserts `[[YYYY-MM-DD]]` at
#      the cursor.
#   5. GitHub commits-today block → equivalent to Ctrl+Shift+G.
#
# Pass T — Polish / preferences:
#   1. "Pause all animations / particles" toggle in the polish
#      group freezes every animation + particle on the page.
#      Persisted in localStorage.
#   2. "Reduce motion" toggle defaults to ON when
#      prefers-reduced-motion is set.
#   3. Density preset (compact / comfortable / spacious) changes
#      button height + padding throughout the toolbar.
#   4. Group reorder — the user can drag a group's title to a new
#      position; persisted.
#   5. Collapse — chevron on each group title hides its body;
#      persisted.
#   6. Favorites — right-click any button → "Add to favorites".
#      Favorites pinned at the leftmost end of the toolbar.
#
# Pass U — Markdown round-trip:
#   1. Apply 4-5 different effects across a paragraph: bold,
#      gradient golden, glow, particle sparkle, heading H2.
#   2. Save (Ctrl+S). Open the .md file in a text editor.
#   3. Verify the saved markdown contains `<span class="...">`
#      with appropriate `data-*` attrs for the new effects, and
#      the heading is `## …`.
#   4. Reopen the .md file in Cortex. All effects render
#      identically; particle sparkles re-attach.
#
# Pass V — Pause-animations preferences regression:
#   1. Apply several animations + particle effects.
#   2. Toggle "Pause animations" → all freeze.
#   3. Reload the app — animations stay paused (pref persisted).
#   4. Toggle off → animations resume.
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
    cargo check --quiet
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cluster 21 v1.0)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 21 v1.0 — Text Editor Toolbar Overhaul (sticky scrolling toolbar; basic formatting + headings + paragraph styles + alignment/spacing + lists; font size/family/weight; text/highlight/underline color pickers + marker-pen mode; strike-resolve variants; text effects — glow/shadow/gradient/animation; particle effects via canvas overlay; insertion menus — link/footnote/citation/special char/emoji/symbol/math/date; layout nodes — callout/columns/tabs/divider/toggle/margin note/frame; utility — find&replace/counts/outline/zoom/focus/reading/invisibles/print/DOCX export; Cortex shortcuts; toolbar polish — density/reorder/favorites/pause-animations)"

Write-Host "==> 4/4  tag cluster-21-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-21-v1.0-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-21-v1.0-complete --force'
