# Cluster 16 — QoL pack (table polish + wikilink shortcut + Ctrl+S scroll + multi-type blocks)

*Build order: Phase 3, on demand. No upstream dependencies. Cluster 17 (block widget rewrite) and Cluster 18 (table formulas / cell types / freeze) are sequenced follow-ups.*

---

## What this is

Six small features bundled into one ship. Each one is daily-friction-grade: not big enough to deserve its own cluster, large enough to be worth doing properly with a doc.

The user-visible behavior, by feature:

1. **Ctrl+S no longer jumps the editor scroll** to the bottom of the document. The save action preserves the cursor and viewport position.
2. **Ctrl+Shift+W** is a new shortcut. With text selected, it wraps the selection in `[[...]]`. With no selection, it opens the existing command palette in a "pick a note" mode — clicking a result inserts `[[Title]]` at the cursor instead of opening the file.
3. **Tables can have draggable column dividers** (`Table.configure({ resizable: true })` is back).
4. **Right-click on a table → "Equalize columns"** sets every column to the same width.
5. **Right-click on a table → "Cell alignment" → top / middle / bottom** sets the vertical alignment of the right-clicked cell.
6. **`Ctrl+Shift+B` now opens a `BlockModal` with a Type dropdown** offering Experiment / Protocol / Idea / Method. The chosen type generates the corresponding `::TYPE NAME` opener and `::end` closer; the green-strip decoration recognises all four prefixes.

## Why we want it

Daily friction. The user reported each item as an annoyance encountered while actually using Cortex. None of these is architecturally pivotal; together they represent the difference between "a tool that works" and "a tool that works smoothly."

The user explicitly chose this slice over the bigger Cluster 17 (block widget rewrite) and Cluster 18 (table formulas + cell types + freeze) work because the QoL pack ships in 1.5 days vs. 2-3 days for the next slice.

## Why it's deferred

Not deferred — being built now. The trigger evidence is the user typing each pain point.

## Decisions already made

- **No custom TipTap node for blocks in this cluster.** The "blocks should be a non-editable widget that holds bullets and tables" piece of the original ask is moved entirely to Cluster 17. Cluster 16 keeps the v1 plain-paragraph format and just extends the type list. Reason: a custom node + markdown round-trip is a 1-2 day effort on its own and would push this cluster out of the "1.5 day" slot.
- **No Excel formulas, cell-type formatting, or freeze rows/columns.** Those go to Cluster 18 — the user explicitly opted out of them for this slot to avoid the multi-day spreadsheet engine.
- **Wikilink shortcut: `Ctrl+Shift+W`.** `Ctrl+L` is taken (legend), `Ctrl+K` is taken (palette / PDF search), and the editor markdown convention "wrap with `[[`" doesn't have a universal shortcut. `W` for wikilink is mnemonic and free. Editor-mode-only — the App-level shortcut handler gates it on `isEditorFocused()` so it doesn't fire inside other modal inputs.
- **Multi-type blocks share the v1 format.** All four types (`::experiment NAME / iter-N`, `::protocol NAME`, `::idea NAME`, `::method NAME`, then content paragraphs, then `::end`) parse and decorate uniformly. Cluster 4's experiment-block routing into iteration daily-log auto-sections continues to work for `::experiment` only; the other three types are visual conveniences without server-side routing in v1. Cluster 17's widget rewrite will revisit this.
- **Equalize columns sets each column's `colwidth` attribute** on every cell in every row to `floor(total_table_width / column_count)`. ProseMirror handles the actual layout. Doesn't touch merged cells (those keep their `colspan`-derived widths).
- **Vertical alignment is per-cell, not per-row or per-column.** Stored as a `verticalAlign` custom attr on the `tableCell` extension. Renders as `style="vertical-align: top|middle|bottom"`, round-trips through `tiptap-markdown`'s `html: true` parser. Default is `top`.
- **Right-click delete block is NOT in this cluster.** Plain-paragraph blocks can already be selected and deleted with normal editing; the special delete affordance only makes sense for the custom-node version (Cluster 17).

## Decisions still open

### Ctrl+S scroll-preservation strategy

Two candidate fixes:

A. **Snapshot the scroll position before save, restore after.** Capture `editor.view.dom.scrollTop` (or the nearest scrollable ancestor's `scrollTop`) before kicking off `saveCurrentFile`, restore it in the `.finally()` callback. Cheap, surgical.

B. **Eliminate the re-render that's resetting the scroll in the first place.** If `setContent` is being called with the same content after save, that's the root cause and the fix is to skip the call. Diagnosing this requires reading `Editor.tsx`'s content effect and the post-save state-update chain.

A is reliable; B is correct. Going with B if the diagnosis is fast, falling back to A if not.

### Wikilink shortcut deps array

When the wikilink wrap fires from inside the editor, we need the active `editorInstanceRef`. The TabPaneHandle already exposes `insertExperimentBlock` and `insertTable` — adding `wrapSelectionInWikilink()` and `insertWikilinkAt(title)` follows the same pattern. The handle's `useImperativeHandle` deps include `editedBody`, `selectedPath`, `activeView`, etc. — confirm the new methods don't read state outside the existing deps.

### Palette pick-mode

The current `<CommandPalette>` has `onOpenFile(path)`. Adding an optional `onPickResult(path, title)` prop that, when provided, is called instead of `onOpenFile` when a result is clicked. The App passes `onPickResult` only when in "wikilink pick" mode (a new `wikilinkPickMode` boolean state).

### Vertical-align default

Top is the most-common spreadsheet default. Existing rows without the attribute should NOT get retrofitted on load — they should keep whatever they had (which was the browser default, i.e. typically baseline). Only newly-aligned cells get the attribute. Avoid a migration that touches all existing tables.

### Multi-type block decoration

`ExperimentBlockDecoration.ts` currently regex-matches `::experiment`. Two options:

A. Extend the regex to `::(experiment|protocol|idea|method)` and keep one decoration extension.
B. Create three new decoration extensions — `ProtocolBlockDecoration`, `IdeaBlockDecoration`, `MethodBlockDecoration` — each matching its own prefix.

A is simpler and matches the project's "minimum components" ethos. Going with A and renaming the file to `BlockDecoration.ts`.

## Architecture sketch

### Pass 1 — Ctrl+S scroll preservation

Read `Editor.tsx`'s content effect:
```ts
useEffect(() => {
  if (!editor) return;
  const current = editor.storage.markdown.getMarkdown() as string;
  if (current !== content) {
    editor.commands.setContent(content, { emitUpdate: false });
  }
}, [content, editor]);
```

The guard already says "skip setContent if content matches." So the `setContent` shouldn't fire on save unless `content` actually changed. But `content` is `editedBody` from TabPane, and `saveCurrentFile` doesn't mutate `editedBody`. So why does the scroll reset?

Hypothesis: The `index_single_file` Tauri call after save bumps `indexVersion`, which triggers a side-effect somewhere that re-mounts or re-renders the editor. Worth tracing.

Fallback fix (Approach A): wrap `saveIfDirty` in a scroll-preservation block:
```ts
async saveIfDirty() {
  const scroll = editorInstanceRef.current?.view?.dom?.scrollTop ?? 0;
  const ok = await saveCurrentFile();
  // Restore on next tick after any re-renders settle.
  if (editorInstanceRef.current?.view?.dom) {
    requestAnimationFrame(() => {
      editorInstanceRef.current.view.dom.scrollTop = scroll;
    });
  }
  return ok;
}
```

### Pass 2 — Wikilink wrap (selection)

App keyboard handler:
```ts
} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "W" || e.key === "w")) {
  e.preventDefault();
  if (isEditorFocused()) {
    const handle = paneRefs.current[activeSlotIdx];
    if (handle?.wrapOrPickWikilink) {
      handle.wrapOrPickWikilink();
    }
  }
}
```

`TabPaneHandle.wrapOrPickWikilink()` checks if the editor selection has text. If yes, wraps with `[[...]]` via `editor.chain().focus().insertContentAt({...}).run()` — actually the cleanest way is to use `editor.commands.insertContent('[[' + selectedText + ']]')` after deleting the selection.

Or: read the selection text, replace it with `[[ + text + ]]`. ProseMirror gives `editor.state.doc.textBetween(from, to)`.

If no selection, the handle calls `setWikilinkPickModeOpen(true)` via a new prop callback. App opens the palette in pick mode.

### Pass 3 — Palette pick mode

```ts
<CommandPalette
  vaultPath={vaultPath}
  isOpen={paletteOpen || wikilinkPickMode}
  onClose={...}
  onOpenFile={!wikilinkPickMode ? onOpenFile : undefined}
  onPickResult={
    wikilinkPickMode
      ? (path, title) => {
          paneRefs.current[activeSlotIdx]?.insertWikilinkAt(title);
          setWikilinkPickMode(false);
        }
      : undefined
  }
/>
```

CommandPalette internally chooses which callback to fire on result click.

### Pass 4 — Column resize

```ts
Table.configure({ resizable: true })
```

In `Editor.tsx`. Done.

If pointer-event issues resurface, that's documented in NOTES.md as a Tauri WebView quirk. Defer to a follow-up if it bites.

### Pass 5 — Equalize columns

`TableContextMenu.tsx` gets a new "Equalize column widths" item, gated on `inTable`. Editor's `runTableAction` dispatches:

```ts
function equalizeColumnWidths() {
  const { tr } = editor.state;
  const tablePos = ... // walk up from current selection to the nearest table node
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return;
  const totalWidth = table.attrs.style?.match(/width:\s*(\d+)px/)?.[1] ?? estimateFromCells();
  const colCount = table.firstChild.childCount;  // first row's cell count
  const targetWidth = Math.floor(totalWidth / colCount);
  // Walk every cell, set colwidth attr to [targetWidth] (or [targetWidth, targetWidth] for spanned cells)
  ...
}
```

Implementation detail: ProseMirror table cells store `colwidth: number[] | null`. For non-merged cells it's a 1-element array; for cells with `colspan=N` it's an N-element array. The transaction iterates rows, computes per-cell `colwidth`, builds a transaction that updates each cell's attrs.

### Pass 6 — Vertical alignment

Extend the TipTap `TableCell` extension with a custom attr:

```ts
const VAlignTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      verticalAlign: {
        default: null,
        parseHTML: (el) => el.style.verticalAlign || null,
        renderHTML: (attrs) => {
          if (!attrs.verticalAlign) return {};
          return { style: `vertical-align: ${attrs.verticalAlign}` };
        },
      },
    };
  },
});
```

Context-menu submenu: "Cell alignment ▸ Top / Middle / Bottom" — each picks the value and dispatches `editor.chain().focus().updateAttributes('tableCell', { verticalAlign: 'top' }).run()`.

### Pass 7 — Multi-type block modal

Rename `ExperimentBlockModal.tsx` → `BlockModal.tsx`. Type dropdown:

```tsx
<select value={blockType} onChange={(e) => setBlockType(e.target.value as BlockType)}>
  <option value="experiment">Experiment</option>
  <option value="protocol">Protocol</option>
  <option value="idea">Idea</option>
  <option value="method">Method</option>
</select>
```

Per-type fields rendered conditionally:
- Experiment: name + iter (existing)
- Protocol / Idea / Method: just name

`onConfirm` callback signature widens to `(type, name, iter?) => void`. The `TabPaneHandle.insertExperimentBlock` is renamed to `insertBlock(type, name, iter?)`. The header line built per type:

```ts
const header = type === "experiment"
  ? `::experiment ${name} / iter-${iter}`
  : `::${type} ${name}`;
```

`ExperimentBlockDecoration.ts` → `BlockDecoration.ts`, regex updated to match `^::(experiment|protocol|idea|method)\s+`. Same green-strip styling for now.

Cluster 4's `route_experiment_blocks` Tauri command continues to recognise only `::experiment` so the iteration auto-section logic isn't disturbed.

## What this cluster doesn't include

- Custom TipTap node for blocks (Cluster 17).
- Right-click delete block (depends on custom node).
- Blocks holding bullets and tables (depends on custom node — currently a paragraph block can't nest other blocks).
- Excel formulas, cell-type formatting, freeze rows/columns (Cluster 18).
- Cell merging UX polish — already shipped in v2.1.2; this cluster doesn't touch it.

## Prerequisites

Phase 1 + Cluster 4 (block routing) + Cluster 8 (idea / method / protocol creators — though those create whole files, not blocks). The block types map onto existing creators: a `::idea Foo` block in a daily note is a "draft idea" before the user formally creates `04-Ideas/Foo.md`. Cluster 17's widget rewrite will explicitly link blocks to file creators if it makes sense.

## Triggers to build

User-driven. Each item was reported as a daily-use friction.

## Effort estimate

~1.5 days, eight passes:

- Pass 1 (~30 min): Ctrl+S scroll diagnosis + fix.
- Pass 2 (~30 min): wikilink wrap on selection.
- Pass 3 (~1.5 hr): palette pick-mode + wikilink-insert wiring.
- Pass 4 (~15 min): table column resize re-enable + smoke test.
- Pass 5 (~1 hr): equalize-columns context menu item + ProseMirror transaction.
- Pass 6 (~1 hr): vertical-align custom attr + context menu submenu.
- Pass 7 (~1 hr): multi-type BlockModal + decoration regex.
- Pass 8 (~30 min): verify script, NOTES, overview, tag.

## What this enables

- Cluster 17's block-widget rewrite gets a clean migration path: same `::TYPE NAME` markers can be matched, decorated, and eventually upgraded to a real custom node without changing the on-disk format.
- Cluster 18's formula engine can build on top of the column-resize foundation here.
- Wikilink-from-palette gives the user a faster path for inserting links to existing notes — a frequent operation in research notebooks.

## Open questions to revisit during build

1. The Ctrl+S scroll bug's root cause — does diagnosis reveal an upstream re-render that's worth removing for general performance, or is the snapshot/restore the right fix?
2. Should the wikilink shortcut also work inside table cells? Yes by default — TipTap's selection includes table-cell text. Confirm.
3. Equalize columns when the table has merged cells: probably should respect colspans (a cell with `colspan=2` keeps its merged width = 2 × target). Confirm in the implementation.
4. Vertical-align rendering through markdown: confirm that the `style="vertical-align: ..."` HTML survives `tiptap-markdown`'s `html: true` round-trip without escaping.
5. The `BlockDecoration` rename — should the file move from `src/editor/ExperimentBlockDecoration.ts` to `src/editor/BlockDecoration.ts`, or stay at the old path with a renamed export? The former is cleaner; the latter is git-rename-friendly. Going with the former + a one-line redirect comment in the old file's history.
