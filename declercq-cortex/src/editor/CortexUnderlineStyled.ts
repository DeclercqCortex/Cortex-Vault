// Cluster 21 v1.0 — Styled underline mark.
//
// Replaces the basic Underline extension with a feature-richer one:
// per-mark underline color, thickness, style (solid/dashed/dotted/
// double/wavy), and offset. Round-trips through HTML via data-* attrs
// + CSS text-decoration-* properties.
//
// Composes with the existing HtmlUnderline (which round-trips bare
// `<u>` to markdown) — when this mark is applied, it OVERRIDES the
// plain underline's rendering by setting text-decoration-line on the
// span itself.

import { Mark, mergeAttributes } from "@tiptap/core";

export type UnderlineThickness =
  | "thin"
  | "medium"
  | "thick"
  | "extra-thick";
export type UnderlineStyle =
  | "solid"
  | "dashed"
  | "dotted"
  | "double"
  | "wavy";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cortexUnderlineStyled: {
      setUnderlineStyled: (attrs: {
        color?: string | null;
        thickness?: UnderlineThickness | null;
        style?: UnderlineStyle | null;
        offset?: number | null;
        marching?: boolean;
      }) => ReturnType;
      clearUnderlineStyled: () => ReturnType;
    };
  }
}

const THICKNESS_PX: Record<UnderlineThickness, string> = {
  thin: "1px",
  medium: "2px",
  thick: "3px",
  "extra-thick": "5px",
};

export const CortexUnderlineStyled = Mark.create({
  name: "cortexUnderlineStyled",

  addAttributes() {
    return {
      color: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-uline-color"),
        renderHTML: (a: Record<string, unknown>) =>
          a.color ? { "data-uline-color": String(a.color) } : {},
      },
      thickness: {
        default: null as UnderlineThickness | null,
        parseHTML: (el) =>
          (el.getAttribute("data-uline-thickness") as UnderlineThickness | null) ??
          null,
        renderHTML: (a: Record<string, unknown>) =>
          a.thickness ? { "data-uline-thickness": String(a.thickness) } : {},
      },
      style: {
        default: null as UnderlineStyle | null,
        parseHTML: (el) =>
          (el.getAttribute("data-uline-style") as UnderlineStyle | null) ?? null,
        renderHTML: (a: Record<string, unknown>) =>
          a.style ? { "data-uline-style": String(a.style) } : {},
      },
      offset: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-uline-offset");
          return v == null ? null : Number(v);
        },
        renderHTML: (a: Record<string, unknown>) =>
          a.offset != null ? { "data-uline-offset": String(a.offset) } : {},
      },
      marching: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-uline-marching") === "1",
        renderHTML: (a: Record<string, unknown>) =>
          a.marching ? { "data-uline-marching": "1" } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-uline-style], span[data-uline-color], span[data-uline-thickness], span[data-uline-marching]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const a = mark.attrs as {
      color: string | null;
      thickness: UnderlineThickness | null;
      style: UnderlineStyle | null;
      offset: number | null;
      marching: boolean;
    };
    const styles: string[] = ["text-decoration-line: underline"];
    if (a.color) styles.push(`text-decoration-color: ${a.color}`);
    if (a.thickness) styles.push(`text-decoration-thickness: ${THICKNESS_PX[a.thickness]}`);
    if (a.style) styles.push(`text-decoration-style: ${a.style}`);
    if (a.offset != null) styles.push(`text-underline-offset: ${a.offset}px`);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "cortex-underline-styled" + (a.marching ? " cortex-underline-marching" : ""),
        style: styles.join("; "),
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setUnderlineStyled:
        (attrs) =>
        ({ chain }) =>
          chain().setMark(this.name, attrs).run(),
      clearUnderlineStyled:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
