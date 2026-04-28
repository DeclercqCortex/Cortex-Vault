import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * WikilinkDecoration
 *
 * A non-invasive visual treatment for `[[Note Title]]` and `[[Title|alias]]`
 * patterns in the editor. We do NOT modify the document — wikilinks remain
 * stored as plain text, which is how they need to live on disk for git
 * round-trip and for the Rust-side index to keep working.
 *
 * Instead we attach inline ProseMirror Decorations to the matching ranges
 * with a class (`cortex-wikilink`). CSS handles the styling. Decorations
 * are recomputed on every doc change but they're cheap because we only
 * walk text nodes and a single regex run per node.
 *
 * The decoration also stamps a `data-wikilink-target` attribute on the
 * span so other code can reach the resolved (alias-stripped) target
 * without re-parsing.
 */
export const WikilinkDecoration = Extension.create({
  name: "wikilinkDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("wikilinkDecoration"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              const text = node.text ?? "";
              if (!text.includes("[[")) return;

              const re = /\[\[([^\[\]\n]+)\]\]/g;
              let m: RegExpExecArray | null;
              while ((m = re.exec(text)) !== null) {
                const start = pos + m.index;
                const end = start + m[0].length;
                const target = m[1].split("|")[0].trim();
                decos.push(
                  Decoration.inline(start, end, {
                    class: "cortex-wikilink",
                    "data-wikilink-target": target,
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
