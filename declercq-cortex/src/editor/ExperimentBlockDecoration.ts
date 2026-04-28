import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * ExperimentBlockDecoration
 *
 * Visual treatment for `::experiment NAME / iter-N` … `::end` blocks
 * inserted by the ExperimentBlockModal (Cluster 4). The block markers
 * are NOT rewritten — they have to live on disk as plain text because
 * the Rust-side `route_experiment_blocks` parser keys off those exact
 * lines and routes the content into the iteration's "From daily notes"
 * section.
 *
 * Strategy mirrors WikilinkDecoration: walk the doc, attach
 * `Decoration.node(...)` to each paragraph that participates in a
 * block, with class names that CSS in `index.css` styles into a card.
 *
 * The header paragraph also gets a `data-title` attribute carrying the
 * parsed name + iter; CSS uses `::before { content: attr(data-title) }`
 * to overlay a clean title on top of the now-`color:transparent` raw
 * `::experiment ...` text. Same trick for `::end` — the literal text is
 * collapsed via font-size:0 so the box closes cleanly.
 *
 * Why class-only and not a Node-replacing approach: keeping the doc
 * shape as plain paragraphs means saving still emits the literal
 * `::experiment …` lines (no schema migration, no tiptap-markdown
 * serializer hooks needed) and editing inside the body paragraphs is
 * just normal paragraph editing — no nested-node positioning quirks.
 */

// Header line, e.g. "::experiment Experiment 1 / iter-2".
//   group 1 = experiment name (lazy, so the slash is the boundary)
//   group 2 = iter number
const HEADER_RE = /^::experiment\s+(.+?)\s*\/\s*iter-(\d+)\s*$/;

interface ParaInfo {
  pos: number;
  size: number;
  text: string;
}

export const ExperimentBlockDecoration = Extension.create({
  name: "experimentBlockDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("experimentBlockDecoration"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const doc = state.doc;

            // Pass 1 — flatten top-level paragraphs. Blocks always live
            // at depth 1 (Cluster 4's insertContentAt uses $from.after(1)
            // to escape any wrapping blockquote/list before inserting).
            const paras: ParaInfo[] = [];
            doc.forEach((node, offset) => {
              if (node.type.name === "paragraph") {
                paras.push({
                  pos: offset,
                  size: node.nodeSize,
                  text: node.textContent.trim(),
                });
              }
            });

            // Pass 2 — sweep for `::experiment` … `::end` pairs.
            // Unterminated headers are left undecorated so the user can
            // see the literal text while they're mid-typing.
            let i = 0;
            while (i < paras.length) {
              const headerMatch = HEADER_RE.exec(paras[i].text);
              if (!headerMatch) {
                i++;
                continue;
              }

              let j = i + 1;
              while (j < paras.length && paras[j].text !== "::end") j++;
              if (j >= paras.length) {
                i++;
                continue;
              }

              const name = headerMatch[1].trim();
              const iter = headerMatch[2];
              const title = `${name} · iter ${iter}`;

              const header = paras[i];
              const end = paras[j];
              const body = paras.slice(i + 1, j);
              const isEmpty = body.length === 0;

              decos.push(
                Decoration.node(header.pos, header.pos + header.size, {
                  class:
                    "cortex-experiment-block-header" +
                    (isEmpty ? " is-empty" : ""),
                  "data-title": title,
                }),
              );

              body.forEach((b, idx) => {
                let cls = "cortex-experiment-block-body";
                if (idx === 0) cls += " is-first";
                if (idx === body.length - 1) cls += " is-last";
                decos.push(
                  Decoration.node(b.pos, b.pos + b.size, { class: cls }),
                );
              });

              decos.push(
                Decoration.node(end.pos, end.pos + end.size, {
                  class:
                    "cortex-experiment-block-end" +
                    (isEmpty ? " is-empty" : ""),
                }),
              );

              i = j + 1;
            }

            return DecorationSet.create(doc, decos);
          },
        },
      }),
    ];
  },
});
