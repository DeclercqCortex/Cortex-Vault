// Cluster 21 v1.0 — Cortex Text Effect mark.
//
// Single mark that covers all visual text effects via a `data-effect`
// attribute. The attr value is a class suffix; the actual visual is
// produced by a CSS class `.tx-<effect>` defined in src/index.css.
//
// Effects:
//   Glow / shadow:
//     glow-soft, glow-neon, halo, shadow-drop, shadow-inset,
//     embossed, engraved, extrude-3d, outline
//   Gradient:
//     gradient-golden, gradient-silver, gradient-rainbow,
//     gradient-sunset, gradient-ocean, gradient-custom
//   Animation:
//     anim-pulse, anim-bounce, anim-shake, anim-wave,
//     anim-typewriter, anim-marquee, anim-fade, anim-colorcycle,
//     anim-animgradient, anim-glitch, anim-flicker, anim-heartbeat,
//     anim-float
//
// Multiple effects on the same span: store as space-separated string
// in `data-effect` (e.g. "gradient-golden anim-pulse"). The mark also
// supports a custom-color override via `data-effect-color` (used by
// glow / outline / halo / gradient-custom for tinting).

import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cortexTextEffect: {
      /** Toggle a single effect on/off in the current selection. */
      toggleTextEffect: (effect: string, color?: string | null) => ReturnType;
      /** Set the active effects (replaces any existing). */
      setTextEffect: (effects: string[], color?: string | null) => ReturnType;
      /** Remove all text effects from the current selection. */
      clearTextEffect: () => ReturnType;
    };
  }
}

export const CortexTextEffect = Mark.create({
  name: "cortexTextEffect",

  // Excludes nothing — composes with bold, italic, color, etc.
  addAttributes() {
    return {
      effect: {
        // Space-separated effect names, e.g. "gradient-golden anim-pulse"
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-effect") || "",
        renderHTML: (a: Record<string, unknown>) =>
          a.effect ? { "data-effect": String(a.effect) } : {},
      },
      color: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-effect-color"),
        renderHTML: (a: Record<string, unknown>) =>
          a.color ? { "data-effect-color": String(a.color) } : {},
      },
      gradient: {
        // For gradient-custom: a CSS gradient string (e.g.
        // "linear-gradient(120deg, #f00, #00f)").
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-effect-gradient"),
        renderHTML: (a: Record<string, unknown>) =>
          a.gradient ? { "data-effect-gradient": String(a.gradient) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-effect]" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const a = mark.attrs as {
      effect: string;
      color: string | null;
      gradient: string | null;
    };
    const classes = (a.effect || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((e) => `tx-${e}`)
      .join(" ");
    const styles: string[] = [];
    if (a.color) styles.push(`--tx-effect-color: ${a.color}`);
    if (a.gradient && a.effect.includes("gradient-custom")) {
      styles.push(`background: ${a.gradient}`);
    }
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: `cortex-text-effect ${classes}`.trim(),
        style: styles.join("; ") || undefined,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleTextEffect:
        (effect, color) =>
        ({ commands, state }) => {
          // Read current attrs at the cursor / selection start.
          const cur = state.doc
            .resolve(state.selection.from)
            .marks()
            .find((m) => m.type.name === this.name);
          const existing = ((cur?.attrs?.effect as string) || "")
            .split(/\s+/)
            .filter(Boolean);
          const has = existing.includes(effect);
          const next = has
            ? existing.filter((e) => e !== effect)
            : [...existing, effect];
          if (next.length === 0) {
            return commands.unsetMark(this.name);
          }
          return commands.setMark(this.name, {
            effect: next.join(" "),
            color: color ?? cur?.attrs?.color ?? null,
            gradient: cur?.attrs?.gradient ?? null,
          });
        },
      setTextEffect:
        (effects, color) =>
        ({ commands }) => {
          if (!effects.length) return commands.unsetMark(this.name);
          return commands.setMark(this.name, {
            effect: effects.join(" "),
            color: color ?? null,
          });
        },
      clearTextEffect:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
