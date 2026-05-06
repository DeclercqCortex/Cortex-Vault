// Cluster 21 v1.0 — Cortex Font Style mark.
//
// Single mark covering size + family + weight, configured via three
// data-* attrs that round-trip through tiptap-markdown's html: true.
// Applied as `<span class="cortex-font-style" data-size data-family
// data-weight style="...">…</span>`.
//
// The renderer also writes inline CSS so a vault scanned by another
// tool sees the formatting visibly even without our parseHTML logic.

import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cortexFontStyle: {
      setFontSize: (px: number | null) => ReturnType;
      setFontFamily: (family: string | null) => ReturnType;
      setFontWeight: (weight: number | string | null) => ReturnType;
      clearFontStyle: () => ReturnType;
    };
  }
}

export const CortexFontStyle = Mark.create({
  name: "cortexFontStyle",

  // Marks of the same name auto-merge — when the user applies bold +
  // italic + a font size, all three exist on the same span.
  addAttributes() {
    return {
      size: {
        default: null as number | null,
        parseHTML: (el) => {
          const ds = el.getAttribute("data-size");
          if (ds) return Number(ds);
          // Fallback: parse from inline style.
          const m = el.style.fontSize?.match(/(\d+(\.\d+)?)px/);
          return m ? Number(m[1]) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.size ? { "data-size": String(attrs.size) } : {},
      },
      family: {
        default: null as string | null,
        parseHTML: (el) =>
          el.getAttribute("data-family") || el.style.fontFamily || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.family ? { "data-family": String(attrs.family) } : {},
      },
      weight: {
        default: null as string | number | null,
        parseHTML: (el) =>
          el.getAttribute("data-weight") || el.style.fontWeight || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.weight ? { "data-weight": String(attrs.weight) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          // Only adopt spans that have at least one of our attrs OR
          // an inline style for one of them. This avoids hijacking
          // every <span> in the doc.
          const has =
            el.hasAttribute("data-size") ||
            el.hasAttribute("data-family") ||
            el.hasAttribute("data-weight") ||
            !!el.style.fontSize ||
            !!el.style.fontFamily ||
            !!el.style.fontWeight;
          return has ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const a = mark.attrs as {
      size: number | null;
      family: string | null;
      weight: string | number | null;
    };
    const inline: string[] = [];
    if (a.size) inline.push(`font-size: ${a.size}px`);
    if (a.family) inline.push(`font-family: ${a.family}`);
    if (a.weight) inline.push(`font-weight: ${a.weight}`);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "cortex-font-style",
        style: inline.join("; "),
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (px) =>
        ({ chain }) =>
          chain().setMark(this.name, { size: px }).run(),
      setFontFamily:
        (family) =>
        ({ chain }) =>
          chain().setMark(this.name, { family }).run(),
      setFontWeight:
        (weight) =>
        ({ chain }) =>
          chain().setMark(this.name, { weight }).run(),
      clearFontStyle:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
