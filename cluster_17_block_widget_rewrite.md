# Cluster 17 — Block widget rewrite (custom TipTap node for `::TYPE NAME` blocks)

*Build order: Phase 3, on demand. Depends on Cluster 16 v1.1+ (the `::TYPE NAME` markers and routing pipeline). Cluster 18 (Excel layer for tables) is independent.*

---

## What this is

Convert `::experiment NAME / iter-N`, `::protocol NAME`, `::idea NAME`, and `::method NAME` blocks from their current "decoration over plain paragraphs" implementation to a real TipTap custom node. The user-visible behaviour, by sub-feature:

1. **The block is a non-editable widget.** Its title bar (the `::TYPE NAME` line) is rendered as styled text but the user cannot put a caret in it or modify the marker. To rename, the user clicks an "Edit name" button that opens a small inline input.
2. **Right-click on the block → "Delete block".** Removes the entire block in one operation, including its `::end` closer. v1.0/v1.1 has no delete affordance — the user has to manually select the lines and delete, which is awkward.
3. **The block can hold bullets, numbered lists, code blocks, AND tables.** Currently each block body is a flat sequence of paragraphs (because the v1.0 paragraph-decoration approach can't nest other blocks). With a custom node, the block becomes a proper container.
4. **No more `<!-- CORTEX-BLOCK -->` markers in the auto-section.** The custom node carries `(daily_note_path, block_index)` as native attrs, and the propagator parses node attrs instead of HTML comments.

## Why we want it

Each item is a daily-friction signal that surfaced after Cluster 16 shipped:

- **Right-click delete** was specifically requested in the original Cluster 16 ask but deferred to 17 because plain-paragraph blocks have no clean atomic-delete.
- **Holding bullets and tables** was also in the original ask. Same reason for deferring.
- **Non-editable widget** prevents the user from accidentally typing into the `::experiment` title and breaking the parse on save.
- **Dropping the visible HTML comments** addresses the v1.1.4 known issue "CORTEX-BLOCK markers visible in raw markdown" — once the node-based propagator is the source of truth, the on-disk format can drop the markers.

## Why it's deferred to its own cluster

A custom TipTap node + markdown serializer + parser is a 1-2 day effort on its own:

- Schema definition (node attrs, content rules, ParseDOM rules).
- `addStorage().markdown.serialize` — converts the node to `::TYPE NAME / content / ::end` text.
- A new parse extension that recognises `::TYPE NAME / content / ::end` in markdown and converts it back to the custom node on load.
- UI: title bar, edit-name affordance, right-click delete option, body-content rules (allow bullet lists, ordered lists, code blocks, tables).
- Migration of existing blocks (the v1.0/v1.1.x format on disk continues to work; the parser detects both forms).

## Decisions to lock in (proposed)

- **The on-disk format stays exactly the same as v1.1.x.** No format change. Existing daily notes with `::experiment NAME / iter-N` … `::end` blocks continue to parse correctly. The custom node is a UI/editor concern; the on-disk lines are unchanged so external markdown viewers, the Rust-side `route_experiment_blocks` parser, and `route_typed_blocks` keep working. This is the principle that lets Cluster 17 ship as an editor-only refactor.
- **Body content allows: paragraphs, bulletList, orderedList, taskList, codeBlock, table.** Not headings (headings inside a block break the document outline). Not images (out of scope until image handling is itself a cluster). Not nested blocks (no block-in-block).
- **Title bar is rendered via the custom node's `toDOM`**, not via decorations. Renders as a `contenteditable=false` element with the styled title overlay we currently paint via CSS `::before`.
- **Inline rename via a small input.** When the user clicks "Edit name" in the title bar, the block's `name` attr becomes editable in a transient input field. On blur (or Enter), the new name is committed via `updateAttributes`. On Escape, the change is reverted.
- **Right-click "Delete block" uses `editor.commands.deleteRange`** with the block's start and end positions. The block's `nodeSize` makes this a single operation. The Cluster 4 / Cluster 16 routing tables (`experiment_routings`, `typed_block_routings`) get a row removed via the next save's `route_*_blocks` call.
- **The block's `name` and `iterNumber` (for experiment blocks) are node attrs.** parseDOM reads them from `data-name` and `data-iter`, renderHTML writes them back. parseMarkdown extracts them from the `::TYPE NAME / iter-N` header line.
- **Per-block markers (`<!-- CORTEX-BLOCK src="…" idx="…" -->`) go away** for blocks that are inside a custom node. The propagator (`propagate_typed_block_edits`) is updated to parse node attrs instead. Backward-compat: the propagator still recognises legacy CORTEX-BLOCK markers for documents that haven't been migrated.

## Decisions still open

### Migration strategy for existing blocks

When the editor loads a markdown file with `::experiment NAME / iter-N` … `::end`, the parser needs to recognise the block-text and produce a custom-node ProseMirror tree. Two approaches:

A. **Transform-on-load.** A parser extension that walks the parsed markdown tree, finds runs of paragraphs starting with `::TYPE NAME` and ending with `::end`, and replaces them with custom-node instances. Runs once per load.

B. **Parse-as-text-then-decorate.** Keep the v1.0/v1.1 decoration extension. The decoration paints the styled title and the box. New right-click "Convert to widget" command does the actual node conversion, opt-in.

A is more work but produces a uniform editor experience. B is simpler but means the v1.1.x decoration has to coexist with the new node, and the user sees inconsistent behaviour.

Going with A, tentatively. Risk: the parser has to handle edge cases (mismatched ::end, nested blocks, etc.) that the decoration tolerated.

### Edit-name affordance UX

A few options for renaming:

- **Inline input.** Click "Edit name" → the title bar swaps to an `<input>`, user types, Enter commits, Esc cancels.
- **Modal.** Click "Edit name" → a small modal opens with a single text field. More disruptive.
- **Direct text edit.** Make the title bar `contenteditable` only when the user clicks an explicit edit button.

Inline input is least disruptive. Going with that.

### Block routing table integration

Currently the routings tables (`experiment_routings`, `typed_block_routings`) are keyed by `(daily_note_path, block_index)` where `block_index` is the position of the block in document order. With custom nodes, `block_index` is still meaningful (count of blocks before this one). But if the user reorders blocks via the custom-node UI (drag-to-reorder, future feature), the indices shift.

For v1.0 of Cluster 17, **no reordering UI** — block_index stays stable as long as the user doesn't manually cut/paste blocks. If they do, the routing rows get rewritten by the next save's route_*_blocks call.

### Rust-side parser stays unchanged

`extract_experiment_blocks` and `extract_typed_blocks` parse the on-disk text format. They don't know about TipTap custom nodes. Since the on-disk format is unchanged, they continue to work. Routing logic is unaffected.

The propagator (`propagate_typed_block_edits`) currently parses HTML comments. It needs an upgrade path: prefer node-attr-based markers when present (post-Cluster-17 documents) and fall back to CORTEX-BLOCK comments for legacy documents.

## Architecture sketch

### Pass 1 — Custom Node schema

```ts
import { Node } from "@tiptap/core";

export const TypedBlockNode = Node.create({
  name: "typedBlock",
  group: "block",
  content: "(paragraph|bulletList|orderedList|taskList|codeBlock|table)+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      blockType: { default: "experiment" }, // experiment | protocol | idea | method
      name: { default: "" },
      iterNumber: { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: "div[data-typed-block]",
      getAttrs: (el) => ({
        blockType: el.getAttribute("data-block-type"),
        name: el.getAttribute("data-name"),
        iterNumber: el.getAttribute("data-iter")
          ? parseInt(el.getAttribute("data-iter")!, 10)
          : null,
      }),
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-typed-block": "",
        "data-block-type": node.attrs.blockType,
        "data-name": node.attrs.name,
        ...(node.attrs.iterNumber != null && {
          "data-iter": String(node.attrs.iterNumber),
        }),
        class: "cortex-typed-block",
      }),
      0, // content placeholder
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TypedBlockNodeView);
  },
});
```

### Pass 2 — NodeView component

A small React component that renders the title bar above the editable content. Uses TipTap's `NodeViewWrapper` and `NodeViewContent` so the editor handles the body content normally.

```tsx
function TypedBlockNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const titleText = node.attrs.iterNumber != null
    ? `${capitalize(node.attrs.blockType)} · ${node.attrs.name} · iter ${node.attrs.iterNumber}`
    : `${capitalize(node.attrs.blockType)} · ${node.attrs.name}`;

  return (
    <NodeViewWrapper className="cortex-typed-block">
      <div className="cortex-typed-block-title" contentEditable={false}>
        {editing ? (
          <input
            defaultValue={node.attrs.name}
            onBlur={(e) => { updateAttributes({ name: e.target.value }); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <>
            <span>{titleText}</span>
            <button onClick={() => setEditing(true)}>Edit name</button>
            <button onClick={deleteNode}>Delete block</button>
          </>
        )}
      </div>
      <NodeViewContent className="cortex-typed-block-body" />
    </NodeViewWrapper>
  );
}
```

### Pass 3 — Markdown serializer

```ts
markdown: {
  serialize(state, node) {
    const header = node.attrs.iterNumber != null
      ? `::${node.attrs.blockType} ${node.attrs.name} / iter-${node.attrs.iterNumber}`
      : `::${node.attrs.blockType} ${node.attrs.name}`;
    state.write(header);
    state.closeBlock();
    state.renderContent(node);
    state.write("::end");
    state.closeBlock(node);
  },
},
```

### Pass 4 — Markdown parser (transform-on-load)

A custom token-stream transform that runs after `tiptap-markdown` produces the initial doc, but before TipTap's setContent. Walks the doc, finds paragraph runs starting with `::TYPE NAME` and ending with `::end`, and replaces them with `typedBlock` nodes containing the inner paragraphs.

This is the trickiest part. May need to be implemented as a ProseMirror transform that runs once after each `setContent` call. Or as a markdown-it plugin that runs during the parse phase.

Consider going with the ProseMirror transform — easier to debug, doesn't fight tiptap-markdown's pipeline.

### Pass 5 — Update propagator

`propagate_typed_block_edits` currently parses `<!-- CORTEX-BLOCK src="…" idx="…" -->` markers. Add a node-attr path: when the saved file's auto-section uses the node-based format, serialize the node tree to extract `(src, idx, content)` tuples directly. Fall back to the CORTEX-BLOCK comment parser for legacy documents.

The serializer for the new format emits the same `::TYPE NAME / content / ::end` text as v1.1.x. So the routings stay the same; only the editor representation changes.

### Pass 6 — Right-click delete in TableContextMenu (or a dedicated block menu)

The current `TableContextMenu` is table-specific. Add a separate context menu for typed blocks. Or, extend the existing one to also handle blocks.

A separate `BlockContextMenu` component is cleaner. It opens when the user right-clicks inside a `typedBlock` node. Includes "Delete block", "Edit name", and the existing block-specific actions.

### Pass 7 — Migration helper

When loading a document, if the editor detects v1.0/v1.1 plain-paragraph blocks, offer to convert them. Could be:

- **Automatic.** Convert all on load; user gets a status message "Cortex upgraded N blocks to the new widget format."
- **Lazy.** Detect on first edit of the block; convert at that point.

Going with automatic for simplicity.

### Pass 8 — Verify, NOTES, overview, tag

Standard cluster-completion routine.

## What this cluster doesn't include

- **Block reordering UI.** Drag-to-reorder, "move up / move down" buttons. Could be added later if the user wants it.
- **Nested blocks.** Block-in-block is intentionally disallowed by the schema.
- **Block templates.** "Start a new block from a template" UX. Cluster 17 v1.1 candidate.
- **Inline images, embeds.** The body content rules permit text and structural content only. Out of scope.
- **The cell-height growth bug.** That's a Cluster 16 v1.1.4 known issue, fixed properly in Cluster 18 via the custom drag-resize plugin.

## Prerequisites

Cluster 16 v1.1+ — the `::TYPE NAME` markers, the routing pipeline, and the `typed_block_routings` table.

## Triggers to build

- "Right-click delete on a block doesn't exist; I want it." (Already explicit user request, deferred from 16.)
- "I can't put a bullet list inside an experiment block." (Same.)
- "I keep accidentally typing into the `::experiment` title and breaking my saves."
- "The CORTEX-BLOCK comments in my protocol files are ugly when I view them externally."

If none of these have come up after a week of dogfooding 16, defer this cluster.

## Effort estimate

~2 days, eight passes:

- Pass 1 (~1 hr): custom node schema + parseHTML / renderHTML.
- Pass 2 (~2 hr): NodeView with title bar + edit-name + delete.
- Pass 3 (~1 hr): markdown serializer.
- Pass 4 (~3 hr): markdown parser transform — the trickiest part.
- Pass 5 (~1.5 hr): propagator upgrade to dual-format.
- Pass 6 (~1 hr): block context menu.
- Pass 7 (~1.5 hr): migration helper for v1.0/v1.1 documents.
- Pass 8 (~30 min): verify, NOTES, overview, tag.

## What this enables

- A clean UX for blocks: title is non-editable, body is rich, delete is one click.
- Cluster 18's table-formula work doesn't have to worry about typed blocks because they're isolated nodes; formulas stay table-scoped.
- Cluster 14's planned-vs-actual analytics gets a clean place to attach metadata (a `typedBlock` node could carry an `actual_minutes_spent` attr in the future).

## Open questions to revisit during build

1. The markdown parser transform — does ProseMirror's transform API cleanly handle the "find paragraph runs and replace with custom node" operation? May need to fall back to a markdown-it plugin if the PM-side transform is fragile.
2. The migration helper's UX — automatic conversion on load, or opt-in via a one-time prompt? Test with the user's actual vault to see how many blocks need migrating.
3. How does this interact with the experiment-block routing in Cluster 4? Should be transparent (the on-disk format is unchanged), but worth a smoke test of a fresh `::experiment` + iteration creation.
4. Do we need a separate cluster for "rich block content" (allowing tables and lists inside blocks) vs the widget-ization itself? Probably not — they share the same custom-node infrastructure and shouldn't be split.
5. After Cluster 17, does Cluster 16 v1.1.x's `<!-- CORTEX-BLOCK -->` marker code in the propagator stay forever as a legacy compatibility path, or do we eventually deprecate it? Recommend: keep as fallback for ~6 months of dogfooding, then evaluate.

