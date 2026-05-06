# verify-cluster-21-v1.1.ps1
# Phase 3 Cluster 21 v1.1 — Code-block syntax highlighting + interactive
# Tabs / Collapsible NodeViews. Closes the v1.0 deferred backlog.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install                    # picks up the 3 new deps below
#   pnpm tauri dev
#   .\verify-cluster-21-v1.1.ps1
#
# What ships
# ----------
#
# 1. CODE-BLOCK SYNTAX HIGHLIGHTING via lowlight + highlight.js. New
#    src/editor/CortexCodeBlock.ts registers
#    @tiptap/extension-code-block-lowlight with a curated set of
#    languages (Python / JavaScript / TypeScript / Rust / Go / JSON /
#    Bash / Shell, plus aliases py/js/ts/rs/golang/sh/console). The
#    StarterKit's built-in codeBlock is disabled so CortexCodeBlock
#    is the only registered node. Token tree is themed via
#    .hljs-* CSS rules in src/index.css (light + dark palettes).
#
# 2. TOOLBAR LANGUAGE PICKER. A <select> dropdown next to the {} button
#    in the Layout group, visible only when the cursor is inside a
#    code block. Switching language updates the codeBlock's language
#    attr and lowlight re-tokenizes immediately.
#
# 3. INTERACTIVE TABS NODEVIEW. CortexTabsBlock now mounts via
#    ReactNodeViewRenderer (CortexTabsNodeView in
#    src/editor/CortexBlockNodeViews.tsx). Click a tab title → the
#    active panel switches. Active index persists in node attrs
#    (data-active-tab=<n>) so saving + reopening restores the
#    user's selection.
#
# 4. INTERACTIVE COLLAPSIBLE NODEVIEW. CortexCollapsible now mounts
#    via ReactNodeViewRenderer (CortexCollapsibleNodeView). Click
#    the chevron or summary text → toggle open/closed. Double-click
#    the summary text → inline-rename input (Enter commits, Esc
#    cancels, blur commits). Open state persists via data-open
#    so saving + reopening preserves the user's view.
#
# Architecture
# ------------
#
# - Languages opt-in (smaller bundle than registering all of
#   highlight.js). Default language is plaintext.
# - Active panel display via CSS custom property
#   `--cortex-tab-active` + nth-child rule. ProseMirror still owns
#   the full child list — non-active panels are display: none.
# - Open/active-tab state lives on the node, not in component state,
#   so it round-trips through markdown via tiptap-markdown's
#   html: true path.
# - parseHTML accepts BOTH the v1.0 emission (details.cortex-toggle,
#   div.cortex-tabs without data-active-tab) and the v1.1 emission
#   (div.cortex-toggle with data-open, div.cortex-tabs with
#   data-active-tab) so old saved files keep loading.
#
# New keyboard shortcuts
# ----------------------
#
# (None new in v1.1 — all interaction is via mouse / Enter / Esc on
#  the NodeView chrome, plus the existing toolbar buttons.)
#
# Smoke tests
# -----------
#
# Pass A — Code block default rendering:
#   1. In a markdown note, click the {} button. A code block appears.
#   2. The toolbar's language picker (a small <select>) appears next to
#      the {} button with "Plain text" selected.
#   3. Type:
#         def hello(name):
#             print(f"Hello, {name}!")
#             return name.upper()
#      With "Plain text" selected, the text renders mono-spaced but
#      with no token coloring.
#
# Pass B — Python syntax highlighting:
#   1. With the cursor still in the code block, change the language
#      picker to "Python".
#   2. The keywords (def, return) turn one color; the string literal
#      ("Hello, {name}!") turns another; the comment-style content
#      stays muted. Expected: keyword purple-ish, string red-ish in
#      light mode (or pink-ish / orange-ish in dark mode).
#   3. Add a comment line `# this is a comment` — it renders italic
#      muted green.
#
# Pass C — JavaScript / TypeScript:
#   1. Switch language to "JavaScript".
#      Type:
#         function add(a, b) {
#           return a + b;
#         }
#      Expected: function/return colored as keywords, parameters
#      different from regular text.
#   2. Switch to "TypeScript".
#      Type:
#         interface Point { x: number; y: number; }
#      Expected: interface colored as keyword, number as type.
#
# Pass D — Rust / Go / JSON / Bash:
#   1. Each language picker option produces distinct token coloring
#      for at least keywords + strings + numbers.
#   2. JSON: keys vs values colored differently.
#   3. Bash: $VAR-style references styled as variables.
#
# Pass E — Code-block round-trip:
#   1. Save the file (Ctrl+S). Reopen by switching to another note
#      and back, or by closing and reopening the tab.
#   2. The code block reopens with the same language selected and
#      the same token coloring.
#   3. Open the .md file in a plain editor and confirm the source
#      shows ```python (or whatever language) on the fence.
#
# Pass F — Tabs interaction:
#   1. Insert a Tabs block via the toolbar's tabs button (Layout
#      group). It renders with two default tab titles
#      ("Tab 1 | Tab 2") and one paragraph in the body.
#   2. Click "Tab 1" — title is highlighted, panel shows the first
#      child block.
#   3. Add a second paragraph below the first. Type some text into
#      it. Click "Tab 2" — the second paragraph becomes visible,
#      the first hides.
#   4. Click "Tab 1" again — first paragraph reappears, second
#      hides. Verify your typed content in tab 2 is still in the
#      doc (not destroyed by the switch).
#
# Pass G — Tabs persistence:
#   1. Switch to Tab 2, save (Ctrl+S).
#   2. Reopen the note. The Tabs block opens with Tab 2 already
#      highlighted and its panel visible.
#   3. Open the raw .md and confirm the wrapper carries
#      `data-active-tab="1"`.
#
# Pass H — Empty-tabs placeholder:
#   1. Open the .md and edit the data-tabs attr to "" (empty string).
#      Reopen the note.
#   2. The tab strip shows a muted italic "no tabs — set data-tabs"
#      placeholder. The body still renders normally.
#
# Pass I — Collapsible toggle:
#   1. Insert a Collapsible block via the toolbar (Layout group).
#      It renders closed with chevron pointing right, summary
#      "Toggle", and body hidden.
#   2. Click the chevron — it rotates 90° down, body becomes visible.
#   3. Click the chevron again — body hides.
#   4. Click the summary text (single click) — same toggle behavior.
#
# Pass J — Collapsible summary rename:
#   1. Double-click the summary text. An input appears with the
#      current summary preselected.
#   2. Type a new summary and press Enter. The input commits the
#      new text.
#   3. Double-click again, change the text, click outside the input.
#      Blur commits.
#   4. Double-click, change text, press Esc. The input reverts to
#      the original summary.
#
# Pass K — Collapsible persistence:
#   1. Open a collapsible, save (Ctrl+S).
#   2. Reopen the note. The collapsible reopens already open with
#      chevron rotated down.
#   3. Inspect the .md and confirm the wrapper carries `open`
#      (HTML attr) AND `data-open="true"`.
#
# Pass L — Collapsible content:
#   1. Inside an open collapsible, type a paragraph + a bullet list.
#   2. Verify both render normally (full Cluster 21 toolbar applies
#      to the content inside).
#   3. Close the collapsible. Open it again — content survives.
#
# Pass M — Read-mode HTML still works:
#   1. Toggle reading mode (Ctrl+Alt+R).
#   2. Tabs still display the active panel (the renderHTML emits
#      a style="--cortex-tab-active: N" that the CSS picks up
#      without JS).
#   3. Collapsibles still toggle in reading mode (it's a
#      <details>/<summary> in the rendered HTML, so browser default
#      behavior takes over). Note that the inline-rename gesture
#      is editor-only.
#
# Pass N — Old v1.0 saved files still parse:
#   1. Take a v1.0 note (saved before the v1.1 NodeViews) — its
#      details.cortex-toggle and div.cortex-tabs without
#      data-active-tab attrs.
#   2. Open it. Tabs default to active=0 (first tab); collapsibles
#      default to closed (unless they had `open` set in the
#      original).
#   3. Toggle / switch — v1.1 NodeView takes over and writes the
#      new attrs on the next save.
#
# Pass O — Toolbar code-language picker visibility:
#   1. Cursor outside any code block — picker is hidden.
#   2. Cursor inside a code block — picker is visible with the
#      block's current language selected.
#   3. Cursor jumps between two code blocks with different
#      languages — picker updates to reflect the active block.
#
# Pass P — Compose with v1.0 features:
#   1. Inside a tab panel, apply a gradient text effect.
#   2. Switch tabs — the gradient stays on the underlying paragraph
#      (it's a mark, not view state).
#   3. Inside a collapsible, add a particle host span.
#   4. Toggle the collapsible closed and back open. Particles
#      restart on intersection (per ParticleOverlay's IO rule).
#
# Pass Q — Build cleanly:
#   1. `pnpm install` runs without errors (3 new deps:
#      @tiptap/extension-code-block-lowlight, lowlight,
#      highlight.js).
#   2. `pnpm build` produces no TypeScript errors.
#   3. `pnpm tauri dev` starts cleanly.
#
# Files added
# -----------
#
# - src/editor/CortexCodeBlock.ts
# - src/editor/CortexBlockNodeViews.tsx
# - verify-cluster-21-v1.1.ps1
#
# Files modified
# --------------
#
# - src/components/Editor.tsx
# - src/editor/CortexBlocks.ts
# - src/components/EditorToolbar.tsx
# - src/index.css
# - package.json

Write-Host ""
Write-Host "Phase 3 Cluster 21 v1.1 verification" -ForegroundColor Cyan
Write-Host "===================================="
Write-Host ""
Write-Host "Code-block syntax highlighting + interactive Tabs / Collapsible." -ForegroundColor Yellow
Write-Host ""
Write-Host "Run the smoke walks A-Q above against a freshly-built dev build."
Write-Host "Required deps:"
Write-Host "  pnpm add @tiptap/extension-code-block-lowlight lowlight highlight.js"
Write-Host ""
Write-Host "Tag with: git tag cluster-21-v1.1-complete"
Write-Host ""
