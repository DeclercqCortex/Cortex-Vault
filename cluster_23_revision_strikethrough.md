# Cluster 23 — Revision strikethrough

**One-liner:** A Ctrl+click on any strikethrough surfaces a single-line, contenteditable bubble that floats **directly above the struck text and spans exactly the strike's width** — the lab-notebook gesture of crossing out, signing, and writing the revised idea above the cross-out. The bubble's left and right edges align with the strike's, so it visually reads as a header glued to the cross-out. The bubble holds the user's *replacement* — what they would have written instead. The replacement persists on the strike's `data-revision` attr and survives save/reload; reopening the bubble shows the saved value pre-populated. Plain strike (no revision) still works exactly as before; the revision is purely additive.

---

## Status

✅ v1.0 shipped — `cluster-23-v1.0-complete`.

## Triggers

- You want to mark a phrase wrong AND record what should go there instead, without losing the original (so revisiting later you can see both the strike and the replacement).
- Existing strikes (Reviews-pipeline "resolved" markers) keep working unchanged — adding a revision to a strike doesn't disrupt the resolve semantic.

## Dependencies

- Cluster 2 (Mark System foundation) — strike is a Cluster 2 mark.
- Cluster 21 v1.0 (Editor toolbar) — the existing Strike toolbar button is unchanged; users learn the Ctrl+click gesture from `ShortcutsHelp.tsx`.

## Effort

~0.5–1 day. Confident — small surface, no Rust changes, no schema changes, no migrations. The on-disk format change is pure addition (`data-revision="…"` on the existing `<s>` tag), backwards-compatible by construction.

---

## Decisions already made (locked before implementation)

1. **Mark scope: every strikethrough can carry a revision.** No new "revision" mark type — the existing strike mark gains a `revision: string | null` attr. Means: any user-typed strike is already a candidate for getting a bubble; no learning curve about which kind of strike to use. The Reviews pipeline (Cluster 3) reads strike-presence and ignores the new attr.
2. **Bubble open/closed state is ephemeral.** Only the revision text persists to disk. On reload, every bubble starts closed — Ctrl+click reopens. Avoids saving redundant UI state in the markdown.
3. **Empty Ctrl+click opens an empty editable bubble.** If the user Ctrl+clicks a strike that has no `revision` attr yet, the bubble opens empty and ready for input. If they leave it empty and close, the strike stays plain (`<s>…</s>` on disk, no `data-revision` attr).
4. **No new toolbar button.** Existing Strike button / Ctrl+Shift+X creates a plain strike; Ctrl+click on it adds a revision. One gesture chain, zero toolbar churn.
5. **Single-line bubble.** "One line height-wise" per the design spec — bubble height is exactly 1.5em, no wrap, horizontal scroll for long replacements.
6. **Ephemeral bubble id, not text-derived key.** Each bubble open emits a fresh `rb-<base36ts>-<counter>` id stored in plugin state. The bubble's React key is the id — replacing the revision text doesn't remount the bubble. Mounting only happens on `toggle` / `close` / `closeAll` plugin meta, not on every keystroke.

## Open questions (deferred)

- **Visible indicator on strikes that carry a revision.** v1.0 ships no visual cue beyond the strikethrough itself. A subtle marker (small ✏ icon at the end, dotted underline, etc.) would help discoverability. Deferred to v1.1 because the user explicitly asked for "purely an editable text box" — minimum chrome.
- **Multi-line revisions.** v1.0 is single-line by spec. If users want paragraph-length replacements, the bubble would need to grow vertically and accept Enter as a line break (currently Enter commits + closes).
- **Rich text inside the revision.** Bold / italic / link inside the bubble. Bubble is already a contenteditable div for this reason, but v1.0 ignores marks on input.
- **Reviews-pipeline integration.** A revised strike could surface in a future "review my edits" destination (the way coloured marks surface in weekly review). Deferred — needs trial-data evidence the user wants this view.
- **External-source revisions.** AI-suggested replacements, dictionary suggestions, etc. The bubble's external-update sync is scaffolded (`useEffect` that re-mounts content from the mark when the bubble isn't focused) but no producer exists yet.

---

## Architecture sketch

### Mark side — `src/editor/CortexStrikeRevision.ts`

`CortexStrikeRevision` extends `@tiptap/extension-strike` and adds a `revision: string | null` attr.

- **parseHTML:** reads `data-revision` off any `<s>` / `<strike>` / `<del>` element; null when missing.
- **renderHTML:** emits `data-revision="…"` only when non-empty (keeps the on-disk shape clean for plain strikes).
- **markdown serializer:** function-based open tag — `<s data-revision="…escaped…">` when present, `<s>` otherwise. Close is always `</s>`. Round-trips through tiptap-markdown's `html: true` parser.
- The HTML attribute escape covers the four characters with attribute-value meaning: `&`, `<`, `>`, `"`.

### Plugin side — same file

`buildStrikeRevisionPlugin()` returns a ProseMirror plugin keyed by `strikeRevisionKey`.

State shape:

```ts
type OpenBubble = { id: string; from: number; to: number };
// state: OpenBubble[]
```

Meta kinds:

- `{ kind: "toggle"; from: number; to: number }` — toggle a bubble for the given range. If a bubble for that exact range exists, close it. Otherwise drop any bubbles that overlap and add a new one.
- `{ kind: "close"; id: string }` — close one bubble.
- `{ kind: "closeAll" }` — close every bubble (Esc handler).
- `{ kind: "ignore" }` — used by the bubble's own `setStrikeRevision` transaction so the apply-time prune-pass doesn't fire while we're modifying the strike's own attrs.

Position handling:

- On `tr.docChanged` with no toggle meta, every stored range is mapped through `tr.mapping`. Ranges that collapse (`from >= to`) or no longer carry a strike mark on their first character are dropped.
- The "still has strike" check uses `state.doc.resolve(from).marks()` rather than `rangeHasMark`, because zero-length-mapped positions still resolve to a valid `$pos.marks()` lookup.

Click handling:

- `props.handleClick(view, pos, event)` — if Ctrl/Cmd held AND `findStrikeRangeAtPos(state, pos)` returns a range, dispatch a `toggle` meta and consume the click. Otherwise fall through (lets the wikilink-follow handler downstream still work for non-strike Ctrl+clicks).
- `findStrikeRangeAtPos` walks both directions from the click position while `$pos.marks()` contains the strike mark. Returns the contiguous strike run.

Esc handling:

- `props.handleKeyDown` — Esc dispatches `closeAll` if any bubble is open. Returns true (consumes); false otherwise (lets shape editor / modals consume Esc when no bubble is open).

### Overlay side — `src/components/RevisionBubbleOverlay.tsx`

`RevisionBubbleOverlay` mounts inside the prose wrapper (sibling of `<EditorContent>`, inside the same `position: relative` div in `Editor.tsx`).

- Subscribes to `editor.on("transaction")` to re-render in lockstep with PM state changes.
- Subscribes to wrapper's `scroll` event and `window.scroll` / `window.resize` to recompute positions when the editor scrolls.
- Each render: reads `getOpenBubbles(view.state)`, walks the list, computes the strike's bounding box from `view.coordsAtPos(b.from)` and `view.coordsAtPos(b.to)`, anchors the bubble's top-left at the strike's top-left and sets its WIDTH to the strike's bbox width: `top = startCoords.top - rootRect.top`, `left = startCoords.left - rootRect.left`, `width = endCoords.right - startCoords.left` (single-line) or `rootRect.right - startCoords.left` (multi-line wrapped, fallback to wrapper-right-edge). Width is floored at 16 px so a 1- or 2-character strike still produces a clickable bubble. The bubble's own inline `transform: translateY(calc(-100% - 4px))` then pulls it UP by its own height plus a 4-px gap. No horizontal transform — `left` + `width` already place the bubble flush with the strike's left and right edges. Net effect: bubble visually spans the cross-out, sitting one line above it. **CSS `box-sizing: border-box`** so the inline width includes padding and border (without it, the bubble would be wider than the strike by 1 px border + 1 em padding on each side).
- Renders one `<RevisionBubble key={b.id}>` per open bubble.
- Each `<RevisionBubble>` is a contenteditable div positioned absolutely inside the wrapper.

`<RevisionBubble>` lifecycle:

- **Mount:** write `bubble.revision` to `el.textContent` first (so reopening on a strike that already has a saved revision shows the saved text — the v1.0.1 fix; without this seed step, the post-focus "external sync" effect early-returns because `document.activeElement === el`, leaving the bubble visibly empty even though `data-revision` is on disk). Then focus the div via `ref.current.focus({ preventScroll: true })` and place the caret at end of existing revision text so the user appends rather than overwrites by default.
- **Input:** `onInput` reads `el.textContent`, calls `setStrikeRevision(state, from, to, text || null)` which dispatches a `removeMark + addMark` transaction tagged with `{ kind: "ignore" }`.
- **Esc / Enter:** dispatch `{ kind: "close", id }` and return focus to the editor.
- **Outside writes:** if the underlying revision changes while the bubble is NOT focused, `useEffect` writes the new value to `el.textContent`. Currently no producer of outside writes; reserved for v1.1+.
- **Event isolation:** `onKeyDown` calls `e.stopPropagation()` on every keystroke so editor shortcuts (`Ctrl+S` save, `Ctrl+1-7` color marks, `Ctrl+Shift+X` strike) don't fire while the bubble has focus.

### Editor.tsx wiring

- Old inline `HtmlStrike` extension definition removed. Replaced by import of `CortexStrikeRevision` from `src/editor/CortexStrikeRevision.ts`.
- The strike extension is registered via `CortexStrikeRevision.extend({ addProseMirrorPlugins() { return [buildStrikeRevisionPlugin()] } })` — same shape as Cluster 19 v1.2's `CortexImage.extend({ addProseMirrorPlugins() { return [buildImageMultiSelectPlugin()] } })`.
- New `proseWrapperRef = useRef<HTMLDivElement>(null)` attached to the `.prose` wrapper div. Wrapper gets `position: relative` so absolute-positioned bubbles anchor correctly.
- `<RevisionBubbleOverlay editor={editor} rootRef={proseWrapperRef} />` mounts inside the prose div, after `<EditorContent>`.

### CSS — `src/index.css`

New section after the Cluster 19 image-bubble block:

```css
.cortex-revision-bubble {
  z-index: 50;
  height: 1.5em;
  line-height: 1.5em;
  padding: 0 0.5em;
  background: var(--bg-card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  font-size: 0.85rem;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
  caret-color: var(--accent);
}
.cortex-revision-bubble:focus {
  outline: 2px solid var(--accent);
  border-color: var(--accent);
  /* On focus, drop the ellipsis and let the bubble scroll
     horizontally so the caret stays visible while the user types
     past the visible width. */
  overflow-x: auto;
  overflow-y: hidden;
  text-overflow: clip;
}
```

`z-index: 50` sits above prose content but below modals (≥900) and the Cluster-19 image-bubble (`z-index: 800`).

The bubble's `position: absolute`, `top`, `left`, `width`, and `transform: translateY(calc(-100% - 4px))` are all set inline (not in this stylesheet) so the same class can be reused if a future variant needs different positioning. `box-sizing: border-box` is critical — without it the inline `width` would be content-only, the padding+border would push the bubble wider than the strike, and the visual "spans the cross-out exactly" intent breaks.

`min-width` / `max-width` are intentionally absent — width is driven entirely by the inline `width` attribute, which equals the strike's bbox width.

### ShortcutsHelp

New row under EDITOR_MODE:

```
Ctrl+Click (on strikethrough) — Open / close a single-line revision
                                bubble for the struck text — type the
                                replacement; saved on the strike's
                                data-revision attr (Cluster 23)
```

---

## On-disk format

Plain strike, no revision (unchanged from pre-Cluster-23):

```html
<s>old text</s>
```

Strike with revision (new):

```html
<s data-revision="new text">old text</s>
```

Both round-trip cleanly through `tiptap-markdown`'s `html: true` parser. The `data-revision` value is HTML-escaped on save (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`).

The Rust extractor (`extract_marks` / Cluster 3 destinations) reads the strike's *presence* to mark items resolved. It doesn't read `data-revision`. Adding revisions to existing struck items is invisible to Reviews until v1.1+ adds a "review edits" destination.

---

## Files added

- `src/editor/CortexStrikeRevision.ts` — mark + plugin + helpers.
- `src/components/RevisionBubbleOverlay.tsx` — React overlay.
- `verify-cluster-23-v1.0.ps1` — verify script.

## Files modified

- `src/components/Editor.tsx` — strike extension swapped, plugin registered, prose wrapper ref + overlay mount, comment cleanup.
- `src/components/ShortcutsHelp.tsx` — new EDITOR_MODE row for Ctrl+click on strike.
- `src/index.css` — `.cortex-revision-bubble` rule block.
- Outer-repo docs: `phase_2_overview.md`, `COWORK_HANDOFF.md`, `NOTES.md`.

---

## Smoke walk (verify-cluster-23-v1.0.ps1)

1. Apply strike (`Ctrl+Shift+X`) to a phrase. Save. Reload. Strike survives. ✓
2. Ctrl+click the strike. Bubble opens **directly above the struck text, spanning exactly the strike's width** (left edges align, right edges align), empty, focused. ✓
3. Type "replacement". Bubble shows it. Save. Reload. ✓
4. Ctrl+click the strike again. Bubble reopens with "replacement" pre-filled, caret at end. (v1.0.1 fix — pre-fix the bubble showed empty and the next keystroke wiped the saved value.) ✓
5. Esc closes the bubble. Editor regains focus. ✓
6. Apply strike to plain text (no revision yet). Open file in raw markdown editor. Confirm `<s>...</s>` (no `data-revision` attr). ✓
7. Add a revision. Save. Open in raw editor. Confirm `<s data-revision="...">...</s>`. ✓
8. Apply strike to a phrase that contains a `<` or `&` in the revision text — confirm `data-revision="…&amp;…&lt;…"` on disk. ✓
9. Compose with color mark: highlight yellow, then strike, then add revision. Reload. All three (yellow + strike + revision) round-trip. The Reviews pipeline still reads the item as resolved. ✓
10. Type inside the struck range while the bubble is open. Bubble's position AND width re-anchor as the strike shifts/grows (stays directly above the strike, same width). ✓
11. Delete the entire struck text. Bubble auto-closes (range collapsed). ✓
12. Un-strike the text (`Ctrl+Shift+X` while in range). Bubble auto-closes. Revision attr is gone. ✓
13. **Short strike.** Apply strike to a 1- or 2-character word. Open bubble — width is floored at 16 px so the bubble is still clickable even if the strike's natural width is smaller. ✓
14. **Long replacement.** Type a revision longer than the strike's width. Unfocused bubble ellipsis-truncates; focused bubble scrolls horizontally so the caret stays visible. The bubble's WIDTH stays equal to the strike's width — the long text doesn't widen the bubble. ✓
15. **Strike near the top of the doc.** Apply strike to text on the very first line. Open the bubble. The bubble is positioned above the strike — if the document is scrolled to the top, this lands above the editor's top edge and may be partially clipped. Acceptable for v1.0; "flip-below-when-no-room-above" is deferred to v1.1+. ✓
16. **Multi-line wrapped strike.** Apply strike to a phrase that wraps across two lines. The bubble appears above the FIRST line of the strike, extending from the strike's start to the wrapper's right edge (fallback width for multi-line). Acceptable for v1.0; precise "first-line end-of-line" detection is deferred. ✓

---

## v1.1+ deferred

- **Visible indicator** on strikes that carry a revision (small icon, dotted underline, etc.).
- **Multi-line revisions** — bubble grows vertically, Enter inserts line break instead of closing.
- **Rich text inside the bubble** — bold / italic / link, written through to a richer attr shape.
- **Reviews-pipeline integration** — surface revised strikes in a "review my edits" destination.
- **External-source revisions** — AI-suggested replacements, dictionary suggestions, etc. The bubble's external-update sync is already scaffolded.
- **Per-revision metadata** — author, timestamp. Useful if Cortex ever supports collaboration.
- **Hover-to-preview** — show the revision as a tooltip on hover without opening the bubble (read-only mode for non-edit reviewing).
- **Flip-below-when-no-room-above** — strikes at the very top of the document have their bubble clipped above the editor's top edge. v1.1 should detect this (`startCoords.top - bubbleHeight - 4 < 0`) and flip the bubble to render below the strike instead.
- **Multi-line strike anchoring** — wrapped strikes use the bounding-box midpoint of (start.left, end.right) which can land the bubble somewhere other than directly over actual struck text. Worth a smarter "above the first line at its center" calculation if multi-line strikes become common.
