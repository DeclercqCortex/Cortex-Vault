// CortexImage — Cluster 19 v1.0.
//
// Custom TipTap node for images embedded in markdown notes. Stores
// image state (rotation, wrap mode, free-positioning coordinates,
// resize width, annotation) as `data-*` attrs on a plain <img>
// element. Rides on tiptap-markdown's `html: true` plumbing so the
// HTML survives the markdown round-trip — same pattern used by
// HtmlTable, HtmlStrike, HtmlUnderline, and the typed-block widget.
//
// On-disk shape inside markdown:
//
//   <img data-cortex-image="1"
//        src="2026-04-30-attachments/cat.jpg"
//        data-wrap="left"
//        data-rotation="-3"
//        data-width="320"
//        data-free-x="120"
//        data-free-y="84"
//        data-annotation="My%20cat%20Merguez%20judging%20me." />
//
// Other markdown editors render the <img> normally and ignore the
// data-* attrs. Cortex re-parses everything on load via parseHTML.
//
// The actual rendering (shadow, transform, handles, drag-to-move,
// rotation handle, resize handle, annotation popover) lives in the
// companion NodeView (`src/components/CortexImageNodeView.tsx`).
// This module is just the schema + parse/serialize.

import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Wrap modes — how the image relates to surrounding text:
 *
 *   - "break"  — block-level. Text breaks above and below.
 *   - "left"   — float: left. Text wraps on the right side.
 *   - "right"  — float: right. Text wraps on the left side.
 *   - "free"   — absolutely positioned via (freeX, freeY). Detached
 *                from the text flow. Mirrors the "physical notebook
 *                with glued/pasted images" feel.
 *
 * "break" is the default for newly inserted images.
 */
export type CortexImageWrap = "break" | "left" | "right" | "free";

const WRAP_MODES: ReadonlyArray<CortexImageWrap> = [
  "break",
  "left",
  "right",
  "free",
];

function clampWrap(input: unknown): CortexImageWrap {
  if (typeof input === "string") {
    const s = input.trim().toLowerCase();
    if ((WRAP_MODES as ReadonlyArray<string>).includes(s)) {
      return s as CortexImageWrap;
    }
  }
  return "break";
}

function parseFloatAttr(
  input: unknown,
  fallback: number | null,
): number | null {
  if (input == null || input === "") return fallback;
  const n = typeof input === "number" ? input : parseFloat(String(input));
  return Number.isFinite(n) ? n : fallback;
}

function parseIntAttr(input: unknown, fallback: number | null): number | null {
  if (input == null || input === "") return fallback;
  const n = typeof input === "number" ? input : parseInt(String(input), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The CortexImage extension. Block-level atom with rich attrs that
 * round-trip through markdown via tiptap-markdown's html:true.
 *
 * The default extension defined here ships *without* a NodeView so
 * it can be unit-tested headless. Wire the React NodeView in via
 * `CortexImage.extend({ addNodeView() { … } })` from Editor.tsx.
 */
export const CortexImage = Node.create({
  name: "cortexImage",
  // Cluster 19 v1.0.1 — inline atom so it lives inside a paragraph
  // alongside text. CSS float (wrap-left/right) then makes the
  // surrounding text reflow around the image, which is what users
  // expect from "wrap" mode. Block-level images break the line and
  // can't be wrapped by adjacent text.
  group: "inline",
  inline: true,
  // atom: leaf node, no children. The image itself is the content.
  atom: true,
  // draggable: lets ProseMirror's drag-handle decoration target this
  // node directly (the user can grab and move it as a unit).
  draggable: true,
  // selectable: allows NodeSelection so right-click / Ctrl+Click /
  // delete operations target the image as a unit.
  selectable: true,

  addAttributes() {
    return {
      /** Image src — relative to the note's parent dir, with forward
       *  slashes. Resolved by the NodeView via Tauri's convertFileSrc
       *  + the note's absolute path. */
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("src") ?? "",
        renderHTML: (attrs) => {
          if (!attrs.src) return {};
          return { src: attrs.src };
        },
      },
      /** Wrap mode: break / left / right / free. */
      wrapMode: {
        default: "break" as CortexImageWrap,
        parseHTML: (el) => clampWrap(el.getAttribute("data-wrap")),
        renderHTML: (attrs) => {
          const w = clampWrap(attrs.wrapMode);
          // Always emit so the HTML round-trips deterministically.
          return { "data-wrap": w };
        },
      },
      /** Free-positioning x coordinate in pixels (relative to the editor
       *  content area's top-left). Only meaningful when wrapMode === "free".
       *  null = use natural position. */
      freeX: {
        default: null as number | null,
        parseHTML: (el) => parseFloatAttr(el.getAttribute("data-free-x"), null),
        renderHTML: (attrs) => {
          if (attrs.freeX == null) return {};
          return { "data-free-x": String(Math.round(attrs.freeX)) };
        },
      },
      /** Free-positioning y coordinate in pixels. */
      freeY: {
        default: null as number | null,
        parseHTML: (el) => parseFloatAttr(el.getAttribute("data-free-y"), null),
        renderHTML: (attrs) => {
          if (attrs.freeY == null) return {};
          return { "data-free-y": String(Math.round(attrs.freeY)) };
        },
      },
      /** Rotation in degrees. Positive = clockwise. 0 (or null) = no
       *  rotation (saved without a data-rotation attr to keep simple
       *  cases clean on disk). */
      rotation: {
        default: 0 as number,
        parseHTML: (el) =>
          parseFloatAttr(el.getAttribute("data-rotation"), 0) ?? 0,
        renderHTML: (attrs) => {
          const r = Number(attrs.rotation) || 0;
          if (Math.abs(r) < 0.01) return {};
          return { "data-rotation": r.toFixed(2) };
        },
      },
      /** Display width in pixels. null = natural width (max-width: 100%
       *  applied via CSS). */
      width: {
        default: null as number | null,
        parseHTML: (el) => parseIntAttr(el.getAttribute("data-width"), null),
        renderHTML: (attrs) => {
          if (attrs.width == null) return {};
          return { "data-width": String(Math.round(attrs.width)) };
        },
      },
      /** Annotation text. URL-encoded so it survives the data-attribute
       *  round-trip even with newlines / quotes / unicode. Empty string
       *  (or absent) = no annotation. */
      annotation: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-annotation") ?? "",
        renderHTML: (attrs) => {
          if (!attrs.annotation) return {};
          return { "data-annotation": String(attrs.annotation) };
        },
      },
      /** Cluster 19 v1.1 — horizontal flip. true = the image is
       *  mirrored across its vertical axis. Composes with rotation
       *  and vertical flip via the NodeView's CSS transform. Saved
       *  as `data-flip-h="1"` only when set, to keep simple cases
       *  clean on disk (matches the rotation / width attr style). */
      flipH: {
        default: false as boolean,
        parseHTML: (el) => el.getAttribute("data-flip-h") === "1",
        renderHTML: (attrs) => {
          if (!attrs.flipH) return {};
          return { "data-flip-h": "1" };
        },
      },
      /** Cluster 19 v1.1 — vertical flip. true = mirrored across the
       *  horizontal axis. */
      flipV: {
        default: false as boolean,
        parseHTML: (el) => el.getAttribute("data-flip-v") === "1",
        renderHTML: (attrs) => {
          if (!attrs.flipV) return {};
          return { "data-flip-v": "1" };
        },
      },
      /** Cluster 19 v1.2 — non-destructive crop. Stored in NATURAL
       *  image pixels. All four must be non-null for the crop to
       *  apply; a half-set state is treated as no-crop (defensive
       *  partial-set fallback, mirrors the v1.6 time-override
       *  semantic). The original src never changes — re-cropping
       *  opens the modal with the ORIGINAL image and the existing
       *  rect as the starting state, so the user can adjust or
       *  expand without ratchet-loss. */
      cropX: {
        default: null as number | null,
        parseHTML: (el) => parseFloatAttr(el.getAttribute("data-crop-x"), null),
        renderHTML: (attrs) => {
          if (attrs.cropX == null) return {};
          return { "data-crop-x": String(Math.round(attrs.cropX)) };
        },
      },
      cropY: {
        default: null as number | null,
        parseHTML: (el) => parseFloatAttr(el.getAttribute("data-crop-y"), null),
        renderHTML: (attrs) => {
          if (attrs.cropY == null) return {};
          return { "data-crop-y": String(Math.round(attrs.cropY)) };
        },
      },
      cropW: {
        default: null as number | null,
        parseHTML: (el) => parseFloatAttr(el.getAttribute("data-crop-w"), null),
        renderHTML: (attrs) => {
          if (attrs.cropW == null) return {};
          return { "data-crop-w": String(Math.round(attrs.cropW)) };
        },
      },
      cropH: {
        default: null as number | null,
        parseHTML: (el) => parseFloatAttr(el.getAttribute("data-crop-h"), null),
        renderHTML: (attrs) => {
          if (attrs.cropH == null) return {};
          return { "data-crop-h": String(Math.round(attrs.cropH)) };
        },
      },
    };
  },

  parseHTML() {
    // Match only <img> elements that opt in via data-cortex-image.
    // Plain ![](path) markdown images go through StarterKit's Image
    // extension and stay outside this node — that's intentional;
    // legacy / non-Cortex images keep their simpler behaviour.
    return [
      {
        tag: "img[data-cortex-image]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          // Always match if the marker is present; attribute parsers
          // above handle individual fields.
          return null;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Emit a self-closing <img> with the marker attribute and all
    // other data-* attrs merged in. tiptap-markdown's `html: true`
    // serializer keeps this as inline HTML inside the markdown body.
    return [
      "img",
      mergeAttributes({ "data-cortex-image": "1", alt: "" }, HTMLAttributes),
    ];
  },
});

/** Build a fresh CortexImage attrs object for inserting a new image. */
export function defaultCortexImageAttrs(src: string): {
  src: string;
  wrapMode: CortexImageWrap;
  freeX: number | null;
  freeY: number | null;
  rotation: number;
  width: number | null;
  annotation: string;
} {
  return {
    src,
    wrapMode: "break",
    freeX: null,
    freeY: null,
    rotation: 0,
    width: null,
    annotation: "",
  };
}
