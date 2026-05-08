# verify-cluster-21-v1.1.ps1
# Phase 3 Cluster 21 v1.1 — Tab panel rework (panel-per-tab schema).
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend-only changes; hot reload picks them up
#   .\verify-cluster-21-v1.1.ps1
#
# What ships
# ----------
#
# A working tabs block. v1.0's "1 child block per tab title" model is
# replaced with a real two-level schema:
#
#     cortexTabsBlock   content: cortexTabPanel+, attr: activeTab
#     cortexTabPanel    content: block+,           attr: title
#
# Each tab is its own real node holding any block+ content; titles
# live on each panel's `title` attr (no more pipe-delimited string on
# the parent). Add / remove a tab inserts or deletes a cortexTabPanel
# directly. Rename uses setNodeMarkup on the specific panel position.
# Switching tabs only updates the parent's activeTab; the existing CSS
# rule
#     .cortex-tabs[data-active-tab="N"]
#         > .cortex-tab-body > *:nth-child(N+1) { display: block; }
# shows only the active panel.
#
# Why the rework
# --------------
#
# v1.0's model required exactly N child blocks for N titles, with a
# children-count-sync useEffect that PADDED or TRIMMED the body on
# every render. Pressing Enter inside tab 1 made ProseMirror split
# into two paragraphs in the body, and the next render's sync would
# DELETE the second paragraph (mistaking it for an extra tab without
# a title). Tabs could never hold more than one paragraph; typing a
# blank line destroyed the next tab's content.
#
# The panel-per-tab model lets each tab be a real isolating node with
# its own block+ content. Enter inside tab 1 creates a second
# paragraph INSIDE the same panel. Tab 2's content is unaffected.
#
# Files touched
# -------------
#
#   src/editor/CortexBlocks.ts:
#     - new exported CortexTabPanel node (content: block+, attr: title,
#       defining + isolating, parses div.cortex-tab-panel, renders
#       div.cortex-tab-panel with data-title)
#     - rewritten CortexTabsBlock: content cortexTabPanel+, drop the
#       pipe-delimited tabs attr (titles now live on panels), keep
#       activeTab. parseHTML matches div.cortex-tabs; renderHTML emits
#       the parent div + the content hole — no inline title strip
#       (the NodeView renders the title strip at runtime).
#
#   src/editor/CortexBlockNodeViews.tsx:
#     - rewrite CortexTabsNodeView. Reads titles from each
#       cortexTabPanel child's title attr. Drops the children-count-
#       sync effect entirely. New helpers getPanelPos /
#       getPanelInnerStart for the position math; setActive,
#       commitRename, addTab, removeTab updated. addTab seeds a new
#       cortexTabPanel with one empty paragraph. removeTab clamps
#       the new active index based on whether the removed tab was
#       active / left of active / right of active, and updates the
#       parent's activeTab in the SAME transaction as the delete so
#       there's no transient state where active points at the deleted
#       panel.
#
#   src/components/Editor.tsx:
#     - import CortexTabPanel; register it next to CortexTabsBlock
#       (no NodeView; pure content).
#
#   src/components/EditorToolbar.tsx:
#     - tabs-button insertion now seeds two cortexTabPanel children
#       (each with an empty paragraph) rather than two paragraphs as
#       direct children.
#
# Backward compatibility
# ----------------------
#
# v1.0 docs that have `<div class="cortex-tabs" data-tabs="A|B">` with
# bare `<p>` children will fail schema validation when re-opened
# (cortexTabsBlock now requires cortexTabPanel children). v1.0 just
# shipped earlier today so only test tabs exist; the user re-inserts.
# The ParseHTML for the new format is strict — if children aren't
# cortex-tab-panel divs, the tabs block ends up empty (or PM's filling
# rule kicks in to seed a default panel structure).
#
# Smoke tests
# -----------
#
# Two follow-up fixes after dogfooding the rework
# -----------------------------------------------
#
#   (1) `getPanelInnerStart` returned `panelPos + 1`. That position
#       resolves to a $pos whose parent is `cortexTabPanel` itself
#       (content rule `block+`, NOT inline content);
#       TextSelection.create rejects it, the chain catches silently
#       and no-ops the cursor move, the user's cursor stays put in
#       the previous panel, and subsequent keystrokes go there —
#       presenting as "tabs share the same typed text". FIXED via
#       Selection.near($pos, 1).from to walk to the nearest valid
#       text-cursor position regardless of the panel's first child
#       kind.
#
#   (2) PM's view update for a React NodeView schedules an async
#       React state update; PM's setSelection on the DOM runs
#       synchronously inside dispatchTransaction. So in the natural
#       chain.updateAttributes(activeTab=N).setTextSelection(...)
#       ordering, PM tries to focus inside panel N while the
#       wrapper's data-active-tab is still the OLD value, the new
#       panel is still resolving to display:none, and the browser
#       refuses contenteditable focus on a display:none element.
#       The selection snaps to the nearest visible editable
#       position (the line above the tabs block) and the user's
#       keystroke lands there. FIXED via a wrapperRef on
#       <NodeViewWrapper> + a revealPanelInDom(idx) helper that
#       writes data-active-tab on the wrapper DOM imperatively
#       BEFORE PM dispatches the transaction — CSS recomputes
#       synchronously and PM's selection set lands in a visible
#       panel. Called from setActive / addTab / removeTab.
#
# Pass A — Insert a tabs block:
#   1. Open a markdown note. Click the toolbar's tabs button.
#   2. A tabs block appears with two tab titles ("Tab 1", "Tab 2"),
#      a + button at the right, and the first panel showing
#      "Tab 1 content".
#   3. An empty paragraph is also inserted directly below the tabs
#      block — the cursor lands there so the user can keep typing
#      prose underneath without needing to navigate out of the
#      isolated panels first.
#   4. Click the "Tab 2" title - panel switches; cursor lands inside
#      "Tab 2 content".
#   5. Click "Tab 1" - switches back. Cursor lands inside "Tab 1
#      content".
#
# Pass B — Typing inside a tab (the v1.0 bug fix):
#   1. With cursor in tab 1, press End. Type " more text" - text is
#      appended to the same paragraph. Tab 2's content is unaffected
#      (switch to tab 2 to verify).
#   2. With cursor in tab 1, press Enter - a SECOND paragraph appears
#      inside tab 1. Type "second line" - it lands in the new paragraph.
#      Tab 2's content is STILL unaffected (this is the bug fix; v1.0
#      would have deleted Tab 2's content here).
#   3. Press Enter again - third paragraph in tab 1. Tab 2 untouched.
#
# Pass C — Add a tab:
#   1. Click the + button at the right of the title strip.
#   2. A new tab "Tab 3" appears with an empty panel; the cursor lands
#      inside the new empty panel.
#   3. Type some content. Switch back to tab 1 / tab 2 - their content
#      is preserved.
#
# Pass D — Rename a tab:
#   1. Double-click "Tab 1" title - an inline input appears with the
#      current title selected.
#   2. Type "Hypothesis" - press Enter. Title updates to "Hypothesis".
#   3. Double-click - input appears, press Esc - cancels (title stays
#      "Hypothesis").
#   4. Double-click - clear the input - press Enter - title falls back
#      to "Tab 1" (one-indexed default).
#
# Pass E — Remove a tab:
#   1. Click x next to "Tab 2".
#   2. Tab 2 disappears. Active stays on whichever tab remains
#      "to the left" of where the user was.
#   3. The x button is ALWAYS visible (even on the last remaining
#      tab); clicking x on the last tab deletes the entire tabs
#      block from the document so the user never gets stuck with
#      an empty tabs shell. The button's tooltip says
#      "Remove and delete the tabs block" when it's the last one.
#   4. Add a third tab back, switch to it, click x on the active tab
#      - active falls back to the previous tab (no orphan active
#      pointing at a deleted panel).
#   5. With ONE tab remaining, click x. The whole tabs block goes
#      away; the cursor lands wherever the block was (typically the
#      trailing paragraph that the toolbar inserted alongside the
#      block on creation).
#
# Pass F — Block content inside a tab:
#   1. With cursor in tab 1, type "## Heading" - press Space - it
#      becomes an H2.
#   2. Press Enter - new paragraph below the H2 in the same panel.
#   3. Type "- list item" - bullet list inside the panel.
#   4. Switch to tab 2 - tab 2 still shows its single paragraph. Tab
#      1's H2 + list survive on switch-back.
#   5. Insert an image inside tab 1 (Ctrl+Shift+I or drag from tree).
#      The image embeds inside the active panel.
#
# Pass G — Markdown round-trip:
#   1. Save the file (Ctrl+S).
#   2. Open the .md file in a text editor outside Cortex. The body
#      contains:
#        <div class="cortex-tabs" data-active-tab="0">
#          <div class="cortex-tab-panel" data-title="Tab 1">
#            <p>...</p>
#            ...
#          </div>
#          <div class="cortex-tab-panel" data-title="Tab 2">
#            <p>...</p>
#          </div>
#        </div>
#   3. Close the file in Cortex, re-open it. Tabs come back exactly
#      as saved - same titles, same active tab, same per-panel content.
#
# Pass H — Cursor isolation between panels:
#   1. With cursor at the END of tab 1's last paragraph, press
#      ArrowDown. The cursor does NOT slide into tab 2's hidden
#      content - it either stays put or moves out of the tabs block
#      entirely (panels are isolating: true, so PM treats their
#      boundary as a hard edge). Verifies that typing in tab 1 can
#      never accidentally end up writing to a hidden panel.
#
# Pass I — Cluster 21 effects inside tabs:
#   1. Inside tab 1, select a word and apply gradient-golden via the
#      Effects popover.
#   2. Switch to tab 2 - tab 2 unaffected.
#   3. Switch back to tab 1 - gradient renders.
#   4. Save and reopen - effect round-trips.
#
# Pass J — Cluster 22 templates regression:
#   1. Templates modal - Project - Edit. Inside the project template,
#      insert a tabs block with two tabs containing different scaffold
#      sections.
#   2. Save the template.
#   3. Create a new project. The new project file's body includes the
#      tabs block with both panels populated. Switch tabs to verify.
#
# Polish pass (v1.1 final ship)
# -----------------------------
#
# Pass K — Zoom actually works:
#   1. Open a markdown note. The toolbar's zoom <select> shows "100%".
#   2. Change to "150%". The editor body visibly grows — text is
#      ~1.5× larger via font-size scaling on .prose; layout reflows
#      naturally because every `em`/`rem`-based sub-element scales
#      with the root font-size. Cursor still works (font-size
#      scaling keeps PM's contenteditable surface intact, unlike a
#      `transform: scale` which broke selection math and made the
#      page render blank in an earlier polish attempt).
#   3. Change to "75%". Editor scales down. Toolbar / sidebar
#      UNAFFECTED (only the document content scales — the toolbar's
#      .cortex-editor-toolbar uses absolute pixel sizes).
#   4. Reload the app. Zoom level persists (in localStorage prefs).
#
# Pass L — Particles render and survive edits:
#   1. Select a word, open the Particles popover, click "sparkle".
#   2. The selected word now has tiny sparkles animating around / over
#      it.
#   3. Type more text adjacent to the marked span — the particles
#      KEEP rendering (the canvas-attached check re-mounts the canvas
#      if PM's mutation observer wipes it on doc edits).
#   4. Save and reopen the file. Sparkles re-render.
#   5. Try other particle types (snow, confetti, hearts, etc.).
#
# Pass M — Stack glow + gradient:
#   1. Select a word, apply gradient-golden via the Effects popover.
#      The text turns into a gold gradient.
#   2. With the same word selected, apply glow-soft. The glow now
#      paints in --text colour around the gradient text — both
#      effects visible together. Previously the glow was invisible
#      because text-shadow inherited `currentColor` which the gradient
#      had set to `transparent`.
#   3. Apply halo, outline — also visible alongside gradient.
#
# Pass N — Font dropdown previews + new fonts:
#   1. Open the Font popover's family <select>. Each <option> renders
#      its label IN ITS OWN FONT — "Lora" appears in Lora serif,
#      "JetBrains Mono" in monospace, "Pacifico" in script, etc.
#   2. The list now includes Inter, Lora, Crimson Text, Playfair
#      Display, EB Garamond, Source Serif, JetBrains Mono, Fira Code,
#      Bebas Neue, Cinzel, Caveat, Pacifico (plus Sans-serif / Serif
#      / Monospace system stacks).
#   3. Pick "Pacifico" — selected text renders in Pacifico script.
#
# Pass O — Auto-replace pipeline:
#   1. Type `--> ` (dash dash greater-than space). It auto-replaces to
#      `→ `.
#   2. Type `<= ` → `≤ `. `>= ` → `≥ `. `!= ` → `≠ `. `+- ` → `± `.
#   3. Type `... ` → `… `. `--- ` → `— `. `-- ` → `– `.
#   4. LaTeX shorthand: `\alpha ` → `α `, `\sigma ` → `σ `, `\Sigma `
#      → `Σ `, `\inf ` → `∞ `, etc.
#   5. Press Ctrl+Z right after a substitution — reverts to the
#      literal characters (the inputRule is in PM's history).
#
# Pass P — Insert URL works with no selection:
#   1. With no text selected, click the Link button (🔗). A prompt
#      asks for a URL. Type `cortex.dev` and confirm.
#   2. The URL is INSERTED at the cursor as `cortex.dev` (link text)
#      with the link mark applied. No more silent no-op.
#   3. Bare domains get auto-prefixed `https://` — the rendered link
#      points to `https://cortex.dev`. URLs that already have a
#      scheme (`https://`, `mailto:`, `tel:`, `file:`) are kept as-is.
#   4. With text selected, the existing flow still works: the
#      selection wraps in a link mark with the prompted URL.
#
# Pass Q — Rich text in find&replace:
#   1. Ctrl+H opens the find&replace bar.
#   2. Type "hello" in Find. Type "WORLD" in Replace.
#   3. The Replace field is now a small editor — click into it,
#      select "WORLD", click the B button in the mini formatting
#      strip. Click I. The text in the field shows as bold + italic.
#   4. Click Replace all. Every "hello" in the document is replaced
#      with **WORLD** (bold italic).
#   5. The mini strip's buttons cover bold / italic / underline /
#      strike / inline-code / text-color. All apply to the
#      replacement text only.
#   6. The find input remains plain text (searching is on textual
#      content, not formatting).
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

Write-Host "==> 3/4  git commit (cluster 21 v1.1)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 21 v1.1 - Tab panel rework (panel-per-tab schema). New CortexTabPanel node holds each tab's block+ content with its own title attr; CortexTabsBlock content becomes cortexTabPanel+ and only carries the activeTab attr. Replaces v1.0's broken '1 child block per tab title' model where pressing Enter inside any tab made the children-count-sync effect delete the next tab's content. NodeView rewritten: titles read from child panels' attrs, addTab inserts a new cortexTabPanel with one empty paragraph, removeTab deletes the panel slice with active-tab clamp in the same transaction, rename uses setNodeMarkup on the specific panel position. Children-count-sync effect dropped (no longer needed - panels can hold any block+). Markdown round-trip via tiptap-markdown's html: true; on-disk format: <div class=cortex-tabs data-active-tab=N><div class=cortex-tab-panel data-title=...>...</div>...</div>. v1.0 docs with bare <p> children fail schema validation on reopen; v1.0 just shipped today so only test tabs exist."

Write-Host "==> 4/4  tag cluster-21-v1.1-complete" -ForegroundColor Cyan
git tag -f cluster-21-v1.1-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-21-v1.1-complete --force'
