import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * The seven Mark System colors locked in scaffold v4.1.
 *
 * Cluster 2 (this file) handles the editor side. Cluster 3 will read these
 * from disk via the Rust extractor and render destination views.
 */
export const COLOR_MARK_NAMES = [
  "yellow",
  "green",
  "pink",
  "blue",
  "orange",
  "red",
  "purple",
] as const;

export type ColorMarkName = (typeof COLOR_MARK_NAMES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    colorMark: {
      setColorMark: (color: ColorMarkName) => ReturnType;
      toggleColorMark: (color: ColorMarkName) => ReturnType;
      unsetColorMark: () => ReturnType;
    };
  }
}

/**
 * ColorMark — single TipTap Mark with a `color` attribute that takes one
 * of the seven values. On disk it serializes as
 *
 *   <mark class="mark-yellow">text</mark>
 *
 * round-tripping cleanly through tiptap-markdown when configured with
 * `html: true`. The CSS in `src/index.css` styles each `.mark-<color>`
 * class for both light and dark themes.
 *
 * Why a single mark with an attribute instead of seven separate marks:
 *   - Re-marking text with a different color is a single command (replace
 *     the attribute) instead of an unset/set pair.
 *   - The keyboard shortcuts in this extension can route through one
 *     toggle command.
 *   - The Rust extractor only needs to recognise one HTML pattern.
 */
export const ColorMark = Mark.create({
  name: "colorMark",

  addAttributes() {
    return {
      color: {
        default: null as ColorMarkName | null,
        parseHTML: (el) => {
          const cls = el.getAttribute("class") || "";
          for (const c of COLOR_MARK_NAMES) {
            if (cls.split(/\s+/).includes(`mark-${c}`)) {
              return c;
            }
          }
          return null;
        },
        renderHTML: (attrs) => {
          if (!attrs.color) return {};
          return { class: `mark-${attrs.color}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        // Match any <mark> element whose class includes "mark-" — we
        // verify the specific colour in the attribute parser above.
        tag: 'mark[class*="mark-"]',
        // Reject if the class doesn't include any of our seven colors
        // (e.g., a future "mark-advisor" class would not match).
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const cls = el.getAttribute("class") || "";
          return COLOR_MARK_NAMES.some((c) =>
            cls.split(/\s+/).includes(`mark-${c}`),
          )
            ? null
            : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // The 0 is TipTap's "render the children here" placeholder.
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setColorMark:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      toggleColorMark:
        (color) =>
        ({ commands, editor }) => {
          const isActiveSame = editor.isActive(this.name, { color });
          if (isActiveSame) {
            return commands.unsetMark(this.name);
          }
          // If marked with a different colour, swap by re-applying.
          if (editor.isActive(this.name)) {
            return commands.setMark(this.name, { color });
          }
          return commands.setMark(this.name, { color });
        },
      unsetColorMark:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-1": () => this.editor.commands.toggleColorMark("yellow"),
      "Mod-2": () => this.editor.commands.toggleColorMark("green"),
      "Mod-3": () => this.editor.commands.toggleColorMark("pink"),
      "Mod-4": () => this.editor.commands.toggleColorMark("blue"),
      "Mod-5": () => this.editor.commands.toggleColorMark("orange"),
      "Mod-6": () => this.editor.commands.toggleColorMark("red"),
      "Mod-7": () => this.editor.commands.toggleColorMark("purple"),
      // Strikethrough lives in StarterKit but its default shortcut is
      // Mod-Shift-s, which collides with Ctrl+S (save). Re-bind to
      // Mod-Shift-x as the cluster doc specifies. Cluster 3 will
      // interpret strikethrough wrapping a coloured mark as "resolved".
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
    };
  },
});
