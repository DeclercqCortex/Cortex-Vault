// TypedBlockNode — Cluster 17.
//
// Replaces the v1.0/v1.1 "decoration over plain paragraphs" approach
// (src/editor/ExperimentBlockDecoration.ts) with a real ProseMirror
// custom node. The on-disk markdown format is unchanged — header
// `::TYPE NAME [/ iter-N]`, body, closer `::end` — so:
//   - The Rust-side parsers (extract_experiment_blocks,
//     extract_typed_blocks, route_*_blocks) keep working without
//     modification.
//   - Existing daily notes load as v1.0/v1.1 paragraph runs, which
//     the markdown parser transform (TypedBlockTransform.ts) lifts
//     into typedBlock nodes after setContent. Migration is invisible.
//
// What the custom node buys us:
//   1. The block is a non-editable widget — the user can't put a
//      caret on the title bar and accidentally break the parse.
//   2. The block's body holds bullets, ordered lists, code blocks,
//      AND tables — not just flat paragraphs (the v1.0/v1.1
//      decoration approach couldn't, because content was constrained
//      to top-level paragraphs).
//   3. Right-click → Delete block is one operation (deleteNode);
//      v1.0/v1.1 had no atomic delete.
//   4. Inline rename via a small input on the title bar (no modal).
//   5. Per-block CORTEX-BLOCK markers can eventually be replaced by
//      node attrs, addressing v1.1.4's "markers visible in raw
//      markdown" known issue. v1.0 of Cluster 17 keeps the markers
//      for backward compatibility with the propagator (the upgrade
//      to a dual-format propagator is Pass 5).
//
// Why a single TypedBlockNode for all four types (experiment / protocol
// / idea / method) instead of four separate node types: the body
// schema, NodeView, serializer, and parser transform are identical
// across types. The only differences are (a) the header line shape
// (experiment carries `iter-N`; the others don't) and (b) which
// routing pipeline runs on save (route_experiment_blocks vs
// route_typed_blocks; that's a backend concern unaffected by the
// editor representation). A single node with a `blockType` attr is
// the clean encoding.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TypedBlockNodeView } from "../components/TypedBlockNodeView";

/** The four block types Cortex understands. */
export type TypedBlockType = "experiment" | "protocol" | "idea" | "method";

/**
 * Shape of the typedBlock node's attrs. Matches the parseHTML / renderHTML
 * round-trip plus the markdown serializer's needs.
 */
export interface TypedBlockAttrs {
  blockType: TypedBlockType;
  /** Document name — appears in the title bar and resolves to a routing target. */
  name: string;
  /**
   * Iteration number. Only meaningful for `blockType === "experiment"`.
   * Stored as `null` for the other three types.
   */
  iterNumber: number | null;
}

const VALID_TYPES: TypedBlockType[] = [
  "experiment",
  "protocol",
  "idea",
  "method",
];

function coerceBlockType(v: unknown): TypedBlockType {
  if (typeof v === "string" && (VALID_TYPES as string[]).includes(v)) {
    return v as TypedBlockType;
  }
  return "experiment";
}

function coerceIter(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * The node itself. Body content schema:
 *
 *   paragraph | bulletList | orderedList | codeBlock | table
 *
 * Excluded on purpose:
 *   - headings (would break the document outline)
 *   - images (out of scope until image handling is its own cluster)
 *   - nested typedBlock (no block-in-block; cluster doc decision)
 *   - blockquote (decision: blocks aren't quotes; if the user wants
 *     a quote inside a block, they can fall back to a paragraph)
 *
 * `defining: true` keeps the block from being merged with surrounding
 * content on backspace at boundaries. `isolating: true` prevents
 * paste/drop operations from breaking through the block boundary
 * (pasted content lands inside or outside, never half-and-half).
 */
export const TypedBlockNode = Node.create({
  name: "typedBlock",
  group: "block",
  content: "(paragraph|bulletList|orderedList|codeBlock|table)+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      blockType: {
        default: "experiment" as TypedBlockType,
        parseHTML: (el: HTMLElement) =>
          coerceBlockType(el.getAttribute("data-block-type")),
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-block-type": coerceBlockType(attrs.blockType),
        }),
      },
      name: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-name") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-name": String(attrs.name ?? ""),
        }),
      },
      iterNumber: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          coerceIter(el.getAttribute("data-iter")),
        renderHTML: (attrs: Record<string, unknown>) => {
          const n = coerceIter(attrs.iterNumber);
          return n == null ? {} : { "data-iter": String(n) };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-typed-block]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-typed-block": "",
        class: "cortex-typed-block",
      }),
      0,
    ];
  },

  addNodeView() {
    // Render via React so the title bar can host an inline input
    // (edit-name) and buttons (edit-name / delete) cleanly. The body
    // is delegated to <NodeViewContent /> so TipTap handles the rich
    // editing of paragraphs / lists / tables natively.
    return ReactNodeViewRenderer(TypedBlockNodeView);
  },
});

/**
 * Format the title-bar text the user sees. Experiment blocks carry an
 * iteration number; the other three types don't.
 */
export function formatTypedBlockTitle(attrs: TypedBlockAttrs): string {
  const cap =
    attrs.blockType.charAt(0).toUpperCase() + attrs.blockType.slice(1);
  if (attrs.blockType === "experiment" && attrs.iterNumber != null) {
    return `${cap} · ${attrs.name} · iter ${attrs.iterNumber}`;
  }
  return `${cap} · ${attrs.name}`;
}

/**
 * Format the on-disk header line the markdown serializer writes.
 */
export function formatTypedBlockHeader(attrs: TypedBlockAttrs): string {
  if (attrs.blockType === "experiment") {
    const iter = attrs.iterNumber ?? 1;
    return `::experiment ${attrs.name} / iter-${iter}`;
  }
  return `::${attrs.blockType} ${attrs.name}`;
}

/**
 * Match a header line into (blockType, name, iterNumber) attrs. Returns
 * null if the line doesn't look like a typed-block header.
 *
 * Used by the markdown parser transform (Pass 4) and by the migration
 * path that lifts v1.0/v1.1 paragraph runs into custom nodes.
 */
const EXPERIMENT_HEADER_RE = /^::experiment\s+(.+?)\s*\/\s*iter-(\d+)\s*$/;
const SIMPLE_HEADER_RE = /^::(protocol|idea|method)\s+(.+?)\s*$/;

export function parseTypedBlockHeader(line: string): TypedBlockAttrs | null {
  const trimmed = line.trim();
  const expMatch = EXPERIMENT_HEADER_RE.exec(trimmed);
  if (expMatch) {
    return {
      blockType: "experiment",
      name: expMatch[1].trim(),
      iterNumber: parseInt(expMatch[2], 10),
    };
  }
  const simpleMatch = SIMPLE_HEADER_RE.exec(trimmed);
  if (simpleMatch) {
    return {
      blockType: simpleMatch[1] as TypedBlockType,
      name: simpleMatch[2].trim(),
      iterNumber: null,
    };
  }
  return null;
}

/** Match the closer line. Allow trailing whitespace. */
export function isTypedBlockEnd(line: string): boolean {
  return line.trim() === "::end";
}
