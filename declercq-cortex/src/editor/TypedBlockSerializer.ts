// TypedBlockSerializer — Cluster 17 Pass 3.
//
// `tiptap-markdown` walks each node type when serializing and looks up
// `node.type.spec.toMarkdown` (set indirectly via the `addStorage().markdown
// .serialize` hook on TipTap extensions). Our custom typedBlock node needs
// to emit:
//
//   ::TYPE NAME [/ iter-N]
//
//   <body content rendered through tiptap-markdown's normal pipeline>
//
//   ::end
//
// matching the v1.0/v1.1 on-disk format. The Rust-side parsers
// (`extract_experiment_blocks`, `extract_typed_blocks`) and the routing
// pipeline are completely unaffected — they parse plain text lines.
//
// Body rendering: `state.renderContent(node)` recurses through every
// child node (paragraph, bulletList, orderedList, codeBlock, table) and
// runs each one's own markdown serializer. For tables we get the HTML
// emitter we configured on HtmlTable; for paragraphs, the alignment-aware
// serializer; for lists, tiptap-markdown's defaults. So a typedBlock can
// hold rich nested content and round-trip cleanly.
//
// Why a separate wrapper file (instead of inlining in TypedBlockNode.tsx
// or Editor.tsx): the markdown serializer is a clean, isolated concern
// with non-trivial logic around blank-line spacing. Keeping it next to
// the node definition (in src/editor/) but in its own file makes it
// easy to find when debugging round-trip issues.

import {
  TypedBlockNode,
  formatTypedBlockHeader,
  type TypedBlockAttrs,
} from "./TypedBlockNode";

/**
 * Coerce attrs to the typed shape. ProseMirror serializes attrs as a
 * plain Record so the runtime types are not guaranteed.
 */
function asAttrs(raw: Record<string, unknown>): TypedBlockAttrs {
  return {
    blockType: (raw.blockType as TypedBlockAttrs["blockType"]) ?? "experiment",
    name: typeof raw.name === "string" ? raw.name : "",
    iterNumber:
      typeof raw.iterNumber === "number"
        ? raw.iterNumber
        : raw.iterNumber == null
          ? null
          : Number(raw.iterNumber),
  };
}

/**
 * The TypedBlockNode extended with a tiptap-markdown serializer hook.
 *
 * Editor.tsx registers this extension instead of the bare TypedBlockNode
 * so the markdown round-trip is wired up.
 */
export const SerializingTypedBlockNode = TypedBlockNode.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const attrs = asAttrs(node.attrs);
          const header = formatTypedBlockHeader(attrs);

          // Header line on its own paragraph, followed by a blank
          // line before the body. closeBlock() inserts the trailing
          // blank line.
          state.write(header);
          state.closeBlock(node);

          // Body content. renderContent walks each child through its
          // own serializer (paragraph / lists / codeBlock / table).
          state.renderContent(node);

          // Closer. closeBlock here also adds a trailing newline so
          // the next top-level node starts cleanly.
          state.write("::end");
          state.closeBlock(node);
        },
        // No parser hook on the markdown side — tiptap-markdown only
        // knows about markdown-it tokens and our node has no token
        // representation. Loading a markdown file produces plain
        // paragraphs; the post-setContent ProseMirror transform
        // (TypedBlockTransform.ts) lifts paragraph runs into typedBlock
        // nodes.
        parse: { setup: () => {} },
      },
    };
  },
});
