# verify-cluster-17.ps1
# Phase 3 Cluster 17 v1.0 — Block widget rewrite (custom TipTap node).
#
# Converts `::experiment NAME / iter-N`, `::protocol NAME`,
# `::idea NAME`, and `::method NAME` blocks from "decoration over plain
# paragraphs" (Cluster 4 + Cluster 16 v1.1) to a real TipTap custom
# node. The on-disk markdown format is unchanged — header line +
# body content + `::end` closer — so the Rust-side parsers
# (route_experiment_blocks, route_typed_blocks, propagate_typed_block_edits)
# continue to work without modification.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # Cargo unchanged, but a full restart is
#                           # cleanest after pulling these frontend changes
#   .\verify-cluster-17.ps1 # commit + tag
#
# v1.0 ships:
#
#   1. Custom typedBlock node (src/editor/TypedBlockNode.tsx).
#      Schema: name="typedBlock", group="block", content=
#      "(paragraph|bulletList|orderedList|codeBlock|table)+",
#      defining + isolating. Attrs: blockType (experiment | protocol |
#      idea | method), name, iterNumber.
#
#   2. React NodeView (src/components/TypedBlockNodeView.tsx).
#      Title bar is contentEditable={false} — the user can't put a
#      caret in the `::TYPE NAME` text and accidentally break the
#      parse. Inline rename via a small input (pencil button or
#      right-click → Edit name); Enter commits, Esc cancels, blur
#      commits when focus leaves the title bar. Trash button →
#      atomic deleteNode.
#
#   3. Markdown serializer (src/editor/TypedBlockSerializer.ts).
#      Emits the same `::TYPE NAME [/ iter-N]\n\n<body>\n\n::end`
#      text the v1.0/v1.1 inserter wrote. state.renderContent walks
#      every body child through its own serializer (paragraphs,
#      lists, code blocks, tables — all round-trip).
#
#   4. Markdown parser transform (src/editor/TypedBlockTransform.ts).
#      tiptap-markdown has no token for our custom node; on load,
#      paragraph runs from the file appear as plain paragraphs. The
#      `liftTypedBlocks` ProseMirror transform runs after every
#      setContent (called from Editor.tsx's content effect) and
#      replaces each `::TYPE NAME … ::end` paragraph run at top
#      level with a typedBlock node containing the inner content.
#      Idempotent. Migration is invisible: legacy v1.0/v1.1
#      documents lift on first open, save back to the same on-disk
#      format.
#
#   5. BlockContextMenu (src/components/BlockContextMenu.tsx).
#      Right-click inside a typedBlock node (and not inside a
#      nested table) opens this menu instead of the table menu:
#      Edit name / Delete block. Edit-name dispatches a CustomEvent
#      on view.dom which the matching NodeView picks up to flip
#      its title bar input on. Delete-block uses
#      editor.chain().command tr.delete over the block's range.
#
#   6. Inserter rewrite (src/components/TabPane.tsx
#      insertExperimentBlock). Fresh blocks are born as a
#      typedBlock node directly — no plain-paragraph stage, no
#      reliance on the lift transform for new content. The cursor
#      lands inside the empty body paragraph.
#
#   7. CSS treatment (src/index.css). New rules under
#      `.cortex-typed-block` give the node the same accent-tinted
#      card look as the legacy decoration. Edit-name input gets
#      its own focused-border styling. Body content (paragraphs,
#      lists, code blocks, tables) sits in a contiguous editable
#      region with tightened first/last-child margins.
#
#   8. Legacy ExperimentBlockDecoration removed from the editor's
#      extension list. The file remains as a deprecation stub so
#      stale build artefacts don't fail to resolve the symbol.
#
# ---------------------------------------------------------------------------
# What this cluster doesn't include
# ---------------------------------------------------------------------------
#
#   - Block reordering UI (drag-to-reorder, move up/down). Not asked
#     for in v1.0; could be added later.
#   - Nested blocks (block-in-block). Schema disallows by design.
#   - Block templates ("Start a new block from a template"). Cluster
#     17 v1.1 candidate.
#   - Inline images / embeds inside the body. Out of scope.
#   - Cell-height-growth-on-hover bug (Cluster 16 v1.1.4 known
#     unresolved). Cluster 18 is the right home for the custom
#     drag-resize plugin that fully fixes that.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass 1 — Insert a fresh block and verify the widget renders:
#   1. Open a daily note in Cortex.
#   2. Ctrl+Shift+B → ExperimentBlockModal. Pick "Method", choose any
#      existing method (or type "Test Method" if you want a missing-
#      target warning).
#   3. The block renders as a single rounded card with:
#        - Title bar reading "Method · <name>" with a pencil + trash
#          button at the right.
#        - One empty body paragraph beneath, with a caret already
#          inside it.
#   4. Type a few sentences. Save (Ctrl+S). Open the file in a plain
#      markdown viewer outside Cortex. Confirm the on-disk text is:
#        ::method <name>
#
#        <your sentences>
#
#        ::end
#      with no `<div data-typed-block>` HTML or other widget chrome.
#
# Pass 2 — Right-click → Delete block:
#   1. Right-click anywhere inside the block (NOT inside a nested
#      table). The BlockContextMenu opens with header "Method ·
#      <name>" and entries "Edit name" + "Delete block".
#   2. Click "Delete block". The entire block (header + body +
#      `::end`) is removed in one operation. Ctrl+Z restores it as
#      a single history step.
#
# Pass 3 — Right-click → Edit name + pencil button:
#   1. Right-click → Edit name. The title bar swaps to two inputs
#      for an experiment block (name + iter-N), one for protocol/
#      idea/method blocks (name only). The name input auto-focuses
#      and the existing name is selected.
#   2. Type a new name, press Enter. Title bar reverts to the
#      static span with the new name. Save and reload — the on-disk
#      `::TYPE NEW_NAME` line reflects the change.
#   3. Click the pencil button to enter edit mode without using the
#      menu. Press Escape; the name reverts to its prior value.
#
# Pass 4 — Bullet list / table / code block inside a block:
#   1. Inside a fresh block, type "- item 1[Enter]item 2[Enter]
#      item 3[Enter][Enter]" — the body now has a bullet list.
#   2. Add a code fence: ```js\nconsole.log("hi")\n```\n
#   3. Insert a table via Ctrl+Shift+T. Equalize columns. The card
#      grows around the table.
#   4. Save, close, reopen. All three (bullets, code, table) are
#      still inside the block, the title bar is intact, the body
#      content round-tripped.
#
# Pass 5 — Migration of a v1.0/v1.1 document:
#   1. Open a daily note that has `::experiment Foo / iter-1` …
#      `::end` written in the v1.0/v1.1 plain-paragraph format
#      (open the file in a plain text editor first to confirm it's
#      pre-Cluster-17).
#   2. Open the same file in Cortex. The block renders as a
#      typedBlock widget (title bar + body + buttons), not as the
#      old paragraph-decoration card. No status banner; the
#      migration is invisible.
#   3. Save (Ctrl+S). Re-inspect the on-disk file. The text is
#      unchanged — same `::experiment Foo / iter-1`, same body,
#      same `::end`. No new chrome.
#
# Pass 6 — Routing still works (Cluster 4 + Cluster 16):
#   1. In a daily note, write `::experiment SomeExperiment / iter-1`
#      + `::end`. Save. The Iterations file's "From daily notes"
#      section regenerates with the body content (Cluster 4
#      route_experiment_blocks, unchanged).
#   2. In a daily note, write `::method SomeMethod` + body +
#      `::end`. Save. The Methods file's auto-section regenerates
#      with `<!-- CORTEX-BLOCK src="…" idx="…" -->` markers
#      (Cluster 16 v1.1 route_typed_blocks, unchanged).
#   3. Open the method file. Edit the routed content directly. Save.
#      The source daily note's `::method SomeMethod / ::end` block
#      body is updated in place (Cluster 16 v1.1.1
#      propagate_typed_block_edits, unchanged).
#
# Pass 7 — Right-click inside a nested table goes to the table menu:
#   1. Insert a table into a typedBlock body (Pass 4).
#   2. Right-click inside a cell. The TableContextMenu opens with
#      "Insert row above" / "Delete column" / "Equalize column
#      widths" / etc. — NOT the BlockContextMenu. The block menu
#      remains reachable by right-clicking inside the body but
#      outside the table.
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
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 3/4  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Cluster 17 v1.0 - Block widget rewrite. Convert ::experiment / ::protocol / ::idea / ::method blocks from decoration-over-plain-paragraphs (Cluster 4 + Cluster 16 v1.1) to a real TipTap custom node. New files: src/editor/TypedBlockNode.tsx (schema, content rule (paragraph|bulletList|orderedList|codeBlock|table)+, defining + isolating, attrs blockType/name/iterNumber, ReactNodeViewRenderer wiring); src/editor/TypedBlockSerializer.ts (tiptap-markdown serialize hook emitting `::TYPE NAME [/ iter-N]\n\n<body>\n\n::end` text via state.renderContent — same on-disk format the v1.0/v1.1 inserter wrote, so route_*_blocks on the Rust side is unaffected); src/editor/TypedBlockTransform.ts (liftTypedBlocks: post-setContent ProseMirror transform that walks top-level paragraphs, finds `::TYPE NAME … ::end` runs, and replaces each with a typedBlock node containing the inner content; idempotent, gated out of undo history; this is also the migration path — legacy v1.0/v1.1 docs lift on first open, save back to the same on-disk format invisibly); src/components/TypedBlockNodeView.tsx (React NodeView with contentEditable={false} title bar, inline edit-name input that supports Enter-commit / Esc-cancel / blur-commit / Tab between name and iter, pencil + trash buttons, custom DOM event listener for BlockContextMenu's Edit-name action via `cortex:edit-typed-block` CustomEvent on view.dom keyed by getPos()); src/components/BlockContextMenu.tsx (positioned right-click menu with viewport clamping, Edit name + Delete block actions; opens when right-click lands inside a typedBlock and NOT inside a nested table). Modified: src/components/Editor.tsx (drop ExperimentBlockDecoration extension, add SerializingTypedBlockNode, add liftTypedBlocks call in the post-setContent useEffect, add typedBlock-detection branch in handleContextMenu that walks $pos ancestors and routes to BlockContextMenu when a typedBlock is found without an intervening table, add runBlockAction for editName/deleteBlock, render BlockContextMenu in JSX); src/components/TabPane.tsx (insertExperimentBlock now inserts a typedBlock node directly via insertContentAt instead of plain paragraphs — fresh blocks are born as the new node); src/index.css (new .cortex-typed-block rules — accent-tinted card, title-bar layout, edit-name input focus styling, body-content first/last-child margin tightening, danger-coloured trash button); src/editor/ExperimentBlockDecoration.ts (deprecated to a no-op stub; the deprecation header points to the typedBlock files); src-tauri/src/lib.rs (added a Cluster 17 design note in the propagator comment block — the on-disk format is unchanged, so the Rust parsers (extract_typed_blocks, parse_auto_section_blocks, replace_daily_note_typed_block) need no modifications; CORTEX-BLOCK comment markers continue to be emitted by regenerate_typed_target_auto_section and parsed by propagate_typed_block_edits, surviving the markdown round-trip via tiptap-markdown's html:true preserved Type 2 HTML blocks). Schema content rule excludes headings (would break document outline), images (own cluster), nested typedBlocks (no block-in-block), blockquotes (intentional). Migration is automatic and invisible: docs that contain plain-paragraph block runs lift to typedBlock nodes on first load; first save re-emits the same on-disk text. Right-click inside a typedBlock opens the BlockContextMenu (Edit name + Delete block); right-click inside a nested table inside a typedBlock still opens the TableContextMenu — the more-specific surface wins. Closes the cluster doc's stated triggers: ::TYPE title is no longer accidentally typeable, atomic right-click delete exists, body holds bullets/lists/tables/code (not just flat paragraphs). 🟡 The CORTEX-BLOCK markers in protocol/idea/method auto-sections are still HTML comments visible in raw markdown — addressed in a future iteration that introduces a per-routed-entry custom node for the auto-section. Not in v1.0 scope; the Cluster 16 v1.1.4 known issue stands."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-17-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-17-v1.0-complete

Write-Host ""
Write-Host "Done. Cluster 17 v1.0 (Block widget rewrite) shipped:" -ForegroundColor Green
Write-Host "  - Custom typedBlock node replacing the v1.0/v1.1 decoration approach" -ForegroundColor Green
Write-Host "  - Non-editable title bar (no more accidental typing into ::TYPE)" -ForegroundColor Green
Write-Host "  - Atomic right-click Delete block" -ForegroundColor Green
Write-Host "  - Inline rename via title-bar input or right-click Edit name" -ForegroundColor Green
Write-Host "  - Body holds bullets / ordered lists / code blocks / tables (not just paragraphs)" -ForegroundColor Green
Write-Host "  - On-disk format unchanged; migration invisible" -ForegroundColor Green
Write-Host "  - Routing pipelines (route_experiment_blocks, route_typed_blocks," -ForegroundColor Green
Write-Host "    propagate_typed_block_edits) untouched" -ForegroundColor Green
Write-Host ""
Write-Host "🟡 Carried forward from Cluster 16 v1.1.4 (still open):" -ForegroundColor Yellow
Write-Host "  - Cell-height growth on hover for tables without explicit colwidths." -ForegroundColor Yellow
Write-Host "    Workaround: Equalize once. Proper fix → Cluster 18 custom drag-resize." -ForegroundColor Yellow
Write-Host "  - CORTEX-BLOCK comment markers visible in raw markdown viewers." -ForegroundColor Yellow
Write-Host ""
Write-Host "Sequenced follow-ups:" -ForegroundColor DarkGray
Write-Host "  - Cluster 18: Excel layer (formulas, cell types, freeze) + custom drag-resize" -ForegroundColor DarkGray
