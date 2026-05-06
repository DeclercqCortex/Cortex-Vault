// Cluster 21 v1.0 — Cortex Particle Host mark.
//
// Marks a span as a particle host. The actual particle rendering is
// handled by ParticleOverlay.tsx, which uses an IntersectionObserver
// to find spans with `[data-particle]` and mounts a per-span canvas
// sibling that runs the appropriate particle render function via a
// shared requestAnimationFrame loop.
//
// Particle types:
//   sparkle / star / confetti / snow / heart / ember / smoke /
//   bubble / lightning / pixie / petal / comet / bokeh / coderain
//
// `data-particle-color` is an optional tint (used by sparkle / star /
// heart / ember / pixie / coderain).

import { Mark, mergeAttributes } from "@tiptap/core";

export const PARTICLE_TYPES = [
  "sparkle",
  "star",
  "confetti",
  "snow",
  "heart",
  "ember",
  "smoke",
  "bubble",
  "lightning",
  "pixie",
  "petal",
  "comet",
  "bokeh",
  "coderain",
] as const;
export type ParticleType = (typeof PARTICLE_TYPES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cortexParticleHost: {
      setParticle: (
        particle: ParticleType | null,
        color?: string | null,
      ) => ReturnType;
      clearParticle: () => ReturnType;
    };
  }
}

export const CortexParticleHost = Mark.create({
  name: "cortexParticleHost",

  addAttributes() {
    return {
      particle: {
        default: null as ParticleType | null,
        parseHTML: (el) =>
          (el.getAttribute("data-particle") as ParticleType | null) ?? null,
        renderHTML: (a: Record<string, unknown>) =>
          a.particle ? { "data-particle": String(a.particle) } : {},
      },
      color: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-particle-color"),
        renderHTML: (a: Record<string, unknown>) =>
          a.color ? { "data-particle-color": String(a.color) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-particle]" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const a = mark.attrs as {
      particle: ParticleType | null;
      color: string | null;
    };
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "cortex-particle-host",
      }),
      0,
    ];
    // Note: `particle` and `color` data attrs are added by the
    // attribute-level renderHTML methods; including them here would
    // double-up.
    void a;
  },

  addCommands() {
    return {
      setParticle:
        (particle, color) =>
        ({ commands }) => {
          if (!particle) return commands.unsetMark(this.name);
          return commands.setMark(this.name, {
            particle,
            color: color ?? null,
          });
        },
      clearParticle:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
