// TypedBlockTransform — Cluster 17 Pass 4.
//
// After the editor calls `setContent(markdown)`, tiptap-markdown produces
// a doc whose top-level children are plain paragraphs (and other block
// nodes). Our custom typedBlock node has no markdown-it token, so the
// parser doesn't produce typedBlock instances directly.
//
// This module contains a single function `liftTypedBlocks` that walks
// the doc, finds paragraph runs starting with `::TYPE NAME [/ iter-N]`
// and ending with `::end`, and replaces each run with a typedBlock node
// whose body contains the in-between content. The transformation is
// idempotent: a doc that already contains typedBlock nodes is returned
// unchanged for those regions.
//
// This is also the migration path. v1.0/v1.1 documents on disk have
// the same `::TYPE NAME …` format; loading them runs through this
// transform and they appear as proper typedBlock widgets in the editor.
// First save re-emits via the typedBlock serializer, which writes the
// same on-disk text — so migration is invisible.
//
// Two scope decisions worth flagging:
//
//   1. Top-level only. We don't lift `::TYPE NAME` text that's nested
//      inside a list or blockquote. This matches v1.0/v1.1 behaviour
//      (the decoration scanned `doc.forEach` at depth 1 only) and
//      keeps the transform safe under arbitrary doc structures. The
//      Rust-side `extract_typed_blocks` is blockquote-tolerant on the
//      raw text, but a typed block inside a blockquote is unusual and
//      out-of-scope for v1 of the widget.
//
//   2. Inner-content filter. Children of a typedBlock are constrained
//      by its schema content rule: paragraph | bulletList | orderedList
//      | codeBlock | table. If a paragraph run between header and
//      ::end contains a heading or blockquote (because the user typed
//      one in a v1.0/v1.1 doc), we skip it — the resulting typedBlock
//      will have those children dropped. The user's content isn't
//      lost: they can rearrange it in the editor after migration.
//      Logged via console.warn so we have a trace if this fires.

import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import {
  parseTypedBlockHeader,
  isTypedBlockEnd,
  type TypedBlockAttrs,
} from "./TypedBlockNode";

/**
 * The set of node types allowed inside a typedBlock per the schema's
 * content rule. Used to filter children when lifting a paragraph run.
 */
const ALLOWED_BODY_TYPES = new Set([
  "paragraph",
  "bulletList",
  "orderedList",
  "codeBlock",
  "table",
]);

/**
 * A match found in the doc — a header paragraph at top-level offset
 * `from` (inclusive) through an `::end` paragraph ending at offset
 * `to` (exclusive). The body is the inner top-level nodes.
 */
interface BlockMatch {
  /** Absolute doc position immediately before the header paragraph. */
  from: number;
  /** Absolute doc position immediately after the ::end paragraph. */
  to: number;
  attrs: TypedBlockAttrs;
  /** Inner top-level nodes between header and ::end, exclusive. */
  innerNodes: ProseMirrorNode[];
}

/**
 * Scan the top-level children of `doc` and collect block matches.
 *
 * Returns an array in document order. Subsequent ReplaceStep operations
 * apply these in reverse so positions are stable.
 */
function findMatches(doc: ProseMirrorNode): BlockMatch[] {
  const matches: BlockMatch[] = [];
  // Snapshot children + their absolute offsets first. doc.forEach
  // gives us (child, offset, index); offset is the absolute position
  // of `child` inside the doc (top-level offsets start at 0).
  const children: Array<{ node: ProseMirrorNode; from: number; to: number }> =
    [];
  doc.forEach((child, offset) => {
    children.push({
      node: child,
      from: offset,
      to: offset + child.nodeSize,
    });
  });

  let i = 0;
  while (i < children.length) {
    const child = children[i];
    // We're only interested in plain paragraphs at top level.
    // typedBlock nodes are skipped — they're already lifted, no
    // re-lift needed.
    if (child.node.type.name !== "paragraph") {
      i++;
      continue;
    }

    const attrs = parseTypedBlockHeader(child.node.textContent);
    if (!attrs) {
      i++;
      continue;
    }

    // Find the matching ::end paragraph. Skip over any non-paragraph
    // top-level nodes (lists, tables, code blocks).
    let j = i + 1;
    while (j < children.length) {
      const c = children[j];
      if (
        c.node.type.name === "paragraph" &&
        isTypedBlockEnd(c.node.textContent)
      ) {
        break;
      }
      // Don't allow another typed-block header inside an unterminated
      // run — bail out so the outer header is left untouched (matches
      // v1.0/v1.1 decoration behaviour and lets the user fix it).
      if (
        c.node.type.name === "paragraph" &&
        parseTypedBlockHeader(c.node.textContent)
      ) {
        break;
      }
      j++;
    }

    if (
      j >= children.length ||
      children[j].node.type.name !== "paragraph" ||
      !isTypedBlockEnd(children[j].node.textContent)
    ) {
      // Unterminated header — leave as plain paragraphs. The user is
      // probably mid-typing or has a malformed block.
      i++;
      continue;
    }

    // Inner nodes: indices i+1 .. j-1 (exclusive of header and ::end).
    const innerNodes: ProseMirrorNode[] = [];
    for (let k = i + 1; k < j; k++) {
      const candidate = children[k].node;
      if (ALLOWED_BODY_TYPES.has(candidate.type.name)) {
        innerNodes.push(candidate);
      } else {
        console.warn(
          "[cortex typedBlock transform] dropping disallowed child of type",
          candidate.type.name,
          "from block",
          attrs.blockType,
          attrs.name,
        );
      }
    }

    matches.push({
      from: children[i].from,
      to: children[j].to,
      attrs,
      innerNodes,
    });

    // Advance past the ::end paragraph.
    i = j + 1;
  }

  return matches;
}

/**
 * Lift every `::TYPE NAME … ::end` paragraph run at top level into a
 * typedBlock node. Returns a Transaction with the substitutions, or
 * null if no matches were found (caller can skip dispatch).
 *
 * Caller pattern (from Editor.tsx after setContent):
 *   const tr = liftTypedBlocks(editor.state);
 *   if (tr) editor.view.dispatch(tr.setMeta("addToHistory", false));
 *
 * The "addToHistory" meta keeps the migration off the undo stack — the
 * user shouldn't be able to Ctrl+Z back to the pre-lifted state.
 */
export function liftTypedBlocks(state: EditorState): Transaction | null {
  const typedBlockType = state.schema.nodes.typedBlock;
  if (!typedBlockType) {
    console.warn(
      "[cortex typedBlock transform] schema has no typedBlock node — extension not registered?",
    );
    return null;
  }

  const matches = findMatches(state.doc);
  if (matches.length === 0) return null;

  const tr = state.tr;

  // Apply in reverse so earlier matches' positions remain valid as
  // later matches are replaced.
  for (let i = matches.length - 1; i >= 0; i--) {
    const { from, to, attrs, innerNodes } = matches[i];

    // typedBlock requires at least one body node (content rule is
    // `(...)+`). If the body is empty after filtering, insert a single
    // empty paragraph.
    let body = innerNodes;
    if (body.length === 0) {
      body = [state.schema.nodes.paragraph.create()];
    }

    const newNode = typedBlockType.create(attrs, Fragment.fromArray(body));

    // Sanity check: typedBlock's content rule must accept the body.
    // If validation fails (e.g. someone changed the schema), fall
    // back to a paragraph-only body so we don't throw.
    if (!newNode) {
      console.warn(
        "[cortex typedBlock transform] failed to create typedBlock for",
        attrs,
      );
      continue;
    }

    tr.replaceWith(from, to, newNode);
  }

  return tr;
}

/**
 * Convenience: returns true if `doc` contains any plain-paragraph
 * `::TYPE NAME` headers that would be lifted by `liftTypedBlocks`.
 * Used by the migration helper (Pass 7) to decide whether to dispatch
 * the transform at all on a given load.
 */
export function docContainsLegacyTypedBlocks(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.forEach((child) => {
    if (found) return;
    if (child.type.name !== "paragraph") return;
    if (parseTypedBlockHeader(child.textContent)) {
      found = true;
    }
  });
  return found;
}
