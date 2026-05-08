# verify-cluster-23-v1.0.ps1
# Phase 3 Cluster 23 v1.0 — Revision strikethrough.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend-only changes; hot reload picks up
#   .\verify-cluster-23-v1.0.ps1
#
# What ships
# ----------
#
# Strikethrough now carries an editable "revision" — the replacement
# text the user would have written instead of the struck phrase. The
# revision is exposed via a single-line, rectangular, contenteditable
# bubble that floats DIRECTLY ABOVE the struck text and SPANS THE
# STRIKE'S WIDTH EXACTLY (left and right edges aligned to the strike's
# bbox) — the lab-notebook gesture of crossing out and writing the
# revised idea right above the cross-out, occupying the same
# horizontal extent.
#
# Gestures
#   - Strike a phrase with Ctrl+Shift+X (existing).
#   - Ctrl+click on the strike → bubble opens, focused, ready for input.
#   - Type the replacement → saved on the strike's data-revision attr.
#   - Esc / Enter → bubble closes; editor regains focus.
#   - Ctrl+click again → bubble reopens with the saved revision.
#
# On disk
#   <s>old text</s>                                    (no revision; v0)
#   <s data-revision="new text">old text</s>           (with revision)
#
# Plain strikes (no revision) round-trip exactly as before — pre-
# Cluster-23 files are unchanged on disk.
#
# Architecture
# ------------
#
# Mark side — src/editor/CortexStrikeRevision.ts:
#   CortexStrikeRevision extends @tiptap/extension-strike. Adds a
#   `revision: string | null` attr that round-trips via data-revision
#   on the <s> tag. Markdown serializer is a function-based open tag
#   that emits the attr only when non-empty (HTML-escaped: & < > ").
#
# Plugin side — same file:
#   buildStrikeRevisionPlugin() returns a PM plugin keyed by
#   strikeRevisionKey. State is Array<{id, from, to}> tracking which
#   strike ranges currently have an OPEN bubble. Ephemeral — bubbles
#   close on reload; only the revision text persists.
#
#   Click handling: handleClick fires when Ctrl/Cmd is held; calls
#   findStrikeRangeAtPos (walks both directions while $pos.marks()
#   contains the strike mark) and dispatches a {kind:"toggle"} meta.
#
#   Position handling: on tr.docChanged with no toggle meta, every
#   stored range is mapped through tr.mapping. Ranges that collapse
#   or no longer carry a strike on their first character get pruned.
#
#   setStrikeRevision(state, from, to, text) is the helper that
#   updates a strike's revision attr — removeMark + addMark with a
#   {kind:"ignore"} meta so the apply-time prune-pass doesn't fire
#   while we're modifying the strike's own attrs.
#
# Overlay side — src/components/RevisionBubbleOverlay.tsx:
#   Mounts inside the prose wrapper (sibling of <EditorContent>).
#   Subscribes to editor.on("transaction") and the wrapper's scroll +
#   window resize. Each render reads getOpenBubbles(state), computes
#   the strike's bounding box from view.coordsAtPos(b.from) and
#   view.coordsAtPos(b.to), and anchors at:
#
#     top  = startCoords.top - rootRect.top
#     left = (startCoords.left + endCoords.right) / 2 - rootRect.left
#
#   The bubble's own inline transform: translateY(calc(-100% - 4px))
#   pulls it UP by its own height plus a 4-px gap. No horizontal
#   transform — the inline `left` and `width` already place the
#   bubble flush with the strike's left and right edges. Net effect:
#   bubble visually spans the cross-out, sitting one line above it.
#
#   Anchor + size:
#     top   = startCoords.top - rootRect.top
#     left  = startCoords.left - rootRect.left
#     width = endCoords.right - startCoords.left   (single-line)
#           = rootRect.right  - startCoords.left   (multi-line wrapped)
#     width = max(width, 16)                        (16 px floor)
#
#   CSS `box-sizing: border-box` is critical so the inline width
#   includes padding and border — without it, the bubble would render
#   ~17 px wider than the strike.
#
#   Each <RevisionBubble> is a contenteditable div that on mount
#   writes bubble.revision to el.textContent BEFORE focusing (the
#   v1.0.1 fix; without this seed step, reopening on a strike that
#   already had a saved revision rendered the bubble empty because
#   the post-focus "external sync" effect early-returns when
#   document.activeElement === el — and the user's first keystroke
#   wiped the saved data-revision via setStrikeRevision). Then
#   focuses with caret at end so the user appends rather than
#   overwrites. Input dispatches setStrikeRevision; Enter / Esc
#   closes; e.stopPropagation on every keystroke so editor shortcuts
#   don't fire while the bubble has focus. External-update sync
#   (resync from PM when not focused) is scaffolded for v1.1+
#   producers.
#
# Editor.tsx wiring:
#   - Old inline HtmlStrike definition removed.
#   - CortexStrikeRevision registered with the plugin via
#     CortexStrikeRevision.extend({addProseMirrorPlugins(){...}}).
#   - New proseWrapperRef on the .prose div, which gets
#     `position: relative` so absolute-positioned bubbles anchor
#     correctly. <RevisionBubbleOverlay editor={editor}
#     rootRef={proseWrapperRef} /> mounts inside.
#
# CSS — src/index.css:
#   .cortex-revision-bubble — 1.5em tall, var(--bg-card) background,
#   var(--border) border, focus ring on var(--accent). NO min-width
#   or max-width — width is fully driven by the inline `width` attr
#   from the bubble component (which equals the strike's bbox width).
#   `box-sizing: border-box` so the inline width includes padding
#   (0.5em on each side) and border (1 px). Unfocused: white-space:
#   pre + overflow: hidden + text-overflow: ellipsis so long
#   replacements ellipsis-truncate within the strike's width.
#   Focused: the rule swaps to overflow-x: auto + text-overflow:
#   clip so the caret stays visible while typing past the visible
#   width. z-index: 50 sits above prose but below modals (>=900) and
#   image bubbles (800). The position: absolute, top, left, width,
#   and transform: translateY(calc(-100% - 4px)) are all applied
#   INLINE by the bubble component so the same class can be reused
#   for future variants.
#
# ShortcutsHelp.tsx — new EDITOR_MODE row:
#   Ctrl+Click (on strikethrough) — Open / close a revision bubble
#
# v1.1+ deferred
# --------------
#
#   - Visible indicator on strikes that carry a revision (icon, dotted
#     underline). Spec said "purely an editable text box" — minimum
#     chrome for v1.0; discoverability hint waits.
#   - Multi-line revisions. v1.0 is single-line; Enter commits + closes.
#   - Rich text inside the bubble. Bubble is contenteditable for this
#     reason; v1.0 ignores marks on input.
#   - Reviews-pipeline integration — surface revised strikes in a
#     "review my edits" destination.
#   - External-source revisions (AI suggestions). External-update sync
#     is scaffolded.
#   - Per-revision metadata (author, timestamp).
#   - Hover-to-preview tooltip without opening the bubble.
#
# Smoke tests
# -----------
#
# Pass A — Apply, save, reload (plain strike unchanged):
#   1. Open any note. Type "this is wrong text". Select "wrong text".
#   2. Press Ctrl+Shift+X → struck.
#   3. Save (Ctrl+S). Open the file in Notepad / VSCode side-by-side.
#      The on-disk markdown contains <s>wrong text</s> — no
#      data-revision attr. (Identical to pre-Cluster-23 format.)
#   4. Close + reopen the file in Cortex. Strike survives.
#
# Pass B — Open empty bubble, type, save, reload:
#   1. With the same struck phrase: Ctrl+click on it.
#   2. A rectangular bubble appears DIRECTLY ABOVE the struck text
#      and SPANS THE STRIKE'S WIDTH EXACTLY — left edge of the
#      bubble aligns with the left edge of the strike, right edge
#      aligns with the right edge of the strike (lab-notebook
#      gesture). It's focused; the caret blinks inside.
#   3. Type "right text". The bubble shows "right text" in real time.
#   4. Press Esc. Bubble closes, editor regains focus.
#   5. Save. Open on disk. The markdown contains
#      <s data-revision="right text">wrong text</s>.
#   6. Reload. Strike still shows "wrong text"; no bubble open by
#      default (ephemeral state).
#   7. Ctrl+click the strike again. Bubble reopens PRE-FILLED with
#      "right text", caret at end (so further input appends).
#      ★ This is the v1.0.1 fix: pre-fix the bubble showed empty
#        on reopen and the next keystroke wiped the saved value.
#        Verify by typing more characters — they should APPEND
#        ("right text" + new chars) rather than replace.
#
# Pass C — Toggle behaviour:
#   1. Bubble open, Ctrl+click the strike again → bubble closes.
#   2. Ctrl+click again → reopens. The id changes each open (verify
#      by adding a console.log in the plugin's "toggle" branch if you
#      want to confirm) but the persisted revision text is unchanged.
#
# Pass D — Esc on bubble vs Esc when no bubble:
#   1. Bubble open. Press Esc → bubble closes.
#   2. No bubble open. Press Esc → existing modal-close / shape-editor-
#      exit behaviour fires (whatever's downstream of our handleKeyDown
#      that returns false). Confirm shape editor still exits on Esc.
#
# Pass E — Enter on bubble:
#   1. Bubble open with content. Press Enter → bubble closes; Enter
#      did NOT insert a newline in the editor body (we stopPropagation).
#
# Pass F — HTML escape:
#   1. Type into a bubble: "this & that <stuff>".
#   2. Save. Open on disk. The data-revision attr reads
#      data-revision="this &amp; that &lt;stuff&gt;".
#   3. Reload. Bubble re-opens via Ctrl+click → unescaped string
#      "this & that <stuff>" appears.
#
# Pass G — Compose with color mark:
#   1. Highlight "yellow phrase" with Ctrl+1 (yellow color mark).
#   2. Strike it (Ctrl+Shift+X) → struck-through highlight.
#   3. Ctrl+click → bubble opens. Type "replacement". Save.
#   4. On disk: <s data-revision="replacement"><mark class="mark-
#      yellow">yellow phrase</mark></s> (or the reverse nesting,
#      depending on application order — both round-trip).
#   5. Reload. The Reviews pipeline (Cluster 3 destinations) still
#      reads the item as RESOLVED — the strike's presence is what
#      matters; Cluster 3 doesn't read data-revision.
#
# Pass H — Position re-anchors during edits:
#   1. Open a bubble on a struck phrase mid-paragraph.
#   2. Type new text on the line ABOVE the strike. The bubble's
#      position visibly stays glued to the struck phrase (PM's
#      mapping handles the position shift).
#   3. Type INSIDE the strike's line, before the strike. Bubble
#      stays at the strike's right edge.
#
# Pass I — Auto-close on un-strike / delete:
#   1. Open a bubble on a phrase. With bubble open, click into the
#      editor and apply Ctrl+Shift+X again to the same range
#      (un-strike). The bubble closes — the prune-pass detects the
#      strike mark is gone.
#   2. Open a bubble on a phrase. Select the entire phrase + delete.
#      The bubble closes — the range collapsed.
#
# Pass J — Multiple bubbles open simultaneously:
#   1. Strike phrase A on line 1, phrase B on line 5.
#   2. Ctrl+click A → bubble A opens.
#   3. Ctrl+click B → bubble B opens (A stays open).
#   4. Type into B → only B's revision updates.
#   5. Press Esc → both close (closeAll handler).
#
# Pass K — Editor shortcuts swallowed by bubble:
#   1. Bubble open, focused. Press Ctrl+S → editor's save handler
#      should NOT fire (bubble onKeyDown stopPropagation).
#   2. Same with Ctrl+1, Ctrl+2, etc. — no color marks applied
#      while the bubble has focus.
#   3. Click into the editor body → editor regains focus → Ctrl+S
#      saves normally again.
#
# Pass L — File-tree click pivot regression smoke:
#   1. Open a file with a revision-bubbled strike. Ctrl+click the
#      strike → bubble opens.
#   2. Click another file in the FileTree. The active pane switches
#      files. The bubble disappears (the editor instance changed
#      and the new file's open-set starts empty).
#   3. Switch back. Strike still has the revision saved on disk.
#      Bubble doesn't auto-reopen (ephemeral state).
#
# Pass M — TabPane multi-pane regression:
#   1. Quad layout. Open the same note in two slots.
#   2. Strike a phrase in slot 1. Ctrl+click → bubble in slot 1
#      opens. Slot 2 doesn't show the bubble (each slot has its
#      own editor + plugin state).
#   3. Type "rev1" in slot 1's bubble → slot 1 dirty.
#   4. Save. Slot 2's view of the file refreshes. Ctrl+click the
#      same strike in slot 2 → bubble opens with "rev1" populated.
#
# Pass N — Wikilink Ctrl+click still works:
#   1. With a [[some link]] in the doc, Ctrl+click on it → still
#      navigates to that file. The strike-revision handler
#      returns false for non-strike Ctrl+clicks so wikilink-follow
#      gets its turn.
#
# Pass O — Image Ctrl+click still works:
#   1. Image with annotation. Ctrl+click the image → annotation
#      popover opens (Cluster 19). Our strike handler doesn't
#      interfere because findStrikeRangeAtPos returns null when
#      the click isn't inside a strike mark.
#
# Pass P — Long replacement renders cleanly (v1.0.2):
#   1. Ctrl+click a strike that's, say, 80 px wide. Type 50+
#      characters: "this is a very long replacement that exceeds
#      the bubble width here".
#   2. The bubble's WIDTH does NOT change — it stays 80 px (matching
#      the strike). While focused, the bubble scrolls horizontally
#      so the caret stays visible. No ellipsis when focused.
#   3. Press Esc. Bubble closes. Reopen via Ctrl+click.
#   4. Initial state: bubble is 80 px wide, content ellipsis-
#      truncated (the FULL text is still in the data-revision attr
#      on disk; the bubble just shows what fits).
#   5. Click into the bubble (focus). Ellipsis disappears, caret
#      visible at end, full content readable via horizontal scroll.
#
# Pass Q — Width matches strike exactly (v1.0.2):
#   1. Apply strike to a SHORT phrase (e.g., "no").
#   2. Ctrl+click. Bubble's width matches the struck "no" — much
#      narrower than v1.0.1's 96-px min-width.
#   3. Apply strike to a LONG phrase (a full sentence).
#   4. Ctrl+click. Bubble spans the entire sentence, left edge to
#      right edge, no overshoot.
#   5. Bubble's left edge aligns precisely with the strike's left
#      edge; right edge aligns precisely with the strike's right
#      edge. Visual feel: a label glued ABOVE the cross-out, not a
#      floating tooltip somewhere nearby.
#
# Pass R — 16-px width floor for tiny strikes:
#   1. Strike a single character "i" (which is ~4 px wide).
#   2. Ctrl+click. The bubble is 16 px wide (floor) — wider than
#      the struck "i" but still small. Aligned to the strike's
#      left edge.
#   3. Click into the bubble — focusable / clickable despite small
#      width.
#
# Pass S — Multi-line wrapped strike fallback:
#   1. Apply strike to a long phrase that wraps across two lines.
#   2. Ctrl+click. The bubble appears above the FIRST line of the
#      strike, extending from the strike's start to the wrapper's
#      RIGHT edge (multi-line fallback width). Acceptable for v1.0;
#      precise "first-line end-of-line" detection is deferred.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check (defensive — no Rust changes)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check --quiet
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cluster 23 v1.0)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 23 v1.0 - Revision strikethrough (Ctrl+click on a struck range opens a single-line, rectangular, contenteditable bubble that floats DIRECTLY ABOVE the struck text and SPANS THE STRIKE'S WIDTH EXACTLY - left and right edges aligned to the strike's bbox - the lab-notebook gesture of crossing out and writing the revised idea right above the cross-out, occupying the same horizontal extent. Bubble anchor + size: top = startCoords.top - rootRect.top, left = startCoords.left - rootRect.left, width = endCoords.right - startCoords.left (single-line) or rootRect.right - startCoords.left (multi-line wrapped fallback), floored at 16 px. Bubble's inline transform translateY(calc(-100% - 4px)) pulls it up by its own height plus a 4-px gap. CSS box-sizing: border-box so the inline width includes padding+border (without it the bubble would render ~17 px wider than the strike). No min-width / max-width on the class - width is fully inline-driven. Type the replacement, saved on the strike's data-revision attr; Esc/Enter closes; bubble open/closed state is ephemeral, only the revision text persists. Reopening on a saved revision pre-populates the bubble (v1.0.1 fix: useLayoutEffect now writes el.textContent = bubble.revision BEFORE focusing, so the post-focus external-sync useEffect's early-return when document.activeElement === el doesn't strand the saved value). New CortexStrikeRevision mark extends @tiptap/extension-strike with a revision attr round-tripping via data-revision on the <s> tag, HTML-escaping & < > and double-quote in the markdown serializer. New strikeRevisionPlugin tracks open ranges; handleClick detects Ctrl/Cmd+click on a strike, walks outward via findStrikeRangeAtPos to get the contiguous strike run, dispatches a toggle meta. Positions remap through tr.mapping on doc changes; ranges that collapse or no longer carry a strike mark on their first character are pruned. New RevisionBubbleOverlay React component subscribes to editor transactions + wrapper scroll/resize, computes wrapper-local coords via view.coordsAtPos for both b.from and b.to, mounts one contenteditable div per open bubble. Plain strikes round-trip identically to pre-Cluster-23 format - <s>...</s> with no data-revision attr - so existing files are unchanged. Files added: src/editor/CortexStrikeRevision.ts, src/components/RevisionBubbleOverlay.tsx. Files modified: src/components/Editor.tsx (HtmlStrike removed in favor of CortexStrikeRevision import + plugin registration; new proseWrapperRef; overlay mount with position:relative on prose div), src/components/ShortcutsHelp.tsx (new Ctrl+Click row), src/index.css (.cortex-revision-bubble at z-index 50; unfocused white-space:pre + overflow:hidden + text-overflow:ellipsis truncates long replacements at max-width 28rem; :focus swaps to overflow-x:auto + text-overflow:clip so the caret stays visible while typing past the visible width)"

Write-Host "==> 4/4  tag cluster-23-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-23-v1.0-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-23-v1.0-complete --force'
