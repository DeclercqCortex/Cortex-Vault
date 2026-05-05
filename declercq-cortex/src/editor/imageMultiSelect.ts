// imageMultiSelect — Cluster 19 v1.2.
//
// ProseMirror plugin that adds modifier-click multi-selection of
// cortexImage nodes plus a multi-delete on Delete / Backspace.
//
// State: a `Set<number>` of cortexImage positions in the doc. Updated
// via three meta kinds dispatched on transactions:
//
//   - "toggle"  → flip a position in / out of the set
//   - "clear"   → empty the set
//   - "set"     → replace the set wholesale (used by external
//                 callers; not used by the plugin's own handlers)
//
// On every doc change the plugin remaps the stored positions through
// the transaction's mapping and drops any that no longer point at a
// cortexImage node (e.g. the user undid the insert that produced one).
//
// Decorations: Decoration.node({class: "cortex-image-multi-selected"})
// on each selected position. The NodeView's wrapper picks up the
// class; companion CSS in src/index.css renders the visible ring.
//
// Key handlers:
//   - Esc          → clear the set (if non-empty), consume
//   - Delete / Bksp → delete every selected node in reverse order so
//                     position offsets stay valid through the
//                     successive transactions, then clear, consume
//
// Click handler: Alt+click on a cortexImage toggles; plain click (no
// modifier) clears the set if non-empty and falls through so the
// default ProseMirror NodeSelection still takes effect. Ctrl/Cmd is
// deliberately NOT used — that modifier is bound to the annotation-
// edit popover (Cluster 19 v1.0.2) and binding multi-select to it
// would silently steal annotation edits when the set was non-empty.
//
// IMPORTANT: in left/right/break wrap modes the cortexImage NodeView's
// outer wrapper carries data-drag-handle (TipTap drag protocol), and
// HTML5 drag-prep on mousedown with Alt held can intercept the click
// before PM's click pipeline runs. So the on-image Alt+click TOGGLE is
// now actually performed in CortexImageNodeView's React onClick — that
// fires as a plain DOM click regardless of drag-handle wiring. The
// handler below is kept for (a) the off-image clear case (clicks on
// text / other nodes that should drop the set), and (b) as a fallback
// for any environment where the NodeView path is bypassed. Both paths
// converge on the same `kind: "toggle"` meta.
//
// Sequenced follow-ups (carried for v1.3+):
//   - multi-select-aware operations beyond delete (move / resize /
//     wrap / rotate apply only to the topmost single-selected image
//     in v1.2)

import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type Meta =
  | { kind: "toggle"; pos: number }
  | { kind: "clear" }
  | { kind: "set"; set: Set<number> };

export const imageMultiSelectKey = new PluginKey<Set<number>>(
  "cortexImageMultiSelect",
);

export function getImageMultiSelection(state: EditorState): Set<number> {
  return imageMultiSelectKey.getState(state) ?? new Set<number>();
}

export function buildImageMultiSelectPlugin(): Plugin<Set<number>> {
  return new Plugin<Set<number>>({
    key: imageMultiSelectKey,
    state: {
      init: () => new Set<number>(),
      apply(tr, value) {
        const meta = tr.getMeta(imageMultiSelectKey) as Meta | undefined;
        if (meta) {
          if (meta.kind === "toggle") {
            const next = new Set(value);
            if (next.has(meta.pos)) next.delete(meta.pos);
            else next.add(meta.pos);
            return next;
          }
          if (meta.kind === "clear") return new Set<number>();
          if (meta.kind === "set") return meta.set;
        }
        if (tr.docChanged && value.size > 0) {
          const mapped = new Set<number>();
          value.forEach((pos) => {
            const m = tr.mapping.map(pos, -1);
            const node = tr.doc.nodeAt(m);
            if (node && node.type.name === "cortexImage") mapped.add(m);
          });
          return mapped;
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const set = imageMultiSelectKey.getState(state);
        if (!set || set.size === 0) return DecorationSet.empty;
        const decos: Decoration[] = [];
        set.forEach((pos) => {
          const node = state.doc.nodeAt(pos);
          if (node && node.type.name === "cortexImage") {
            decos.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: "cortex-image-multi-selected",
              }),
            );
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
      handleClickOn(view, pos, node, _nodePos, event) {
        if (node.type.name !== "cortexImage") {
          const set = imageMultiSelectKey.getState(view.state);
          // Cluster 19 v1.2 — Alt+Click is the multi-select toggle
          // modifier (Ctrl is reserved for the annotation-edit
          // popover from v1.0.2). Off-image clicks WITHOUT Alt clear
          // the multi-selection; clicks with Alt leave it intact in
          // case the user is mid-flow building up a selection.
          if (set && set.size > 0 && !event.altKey) {
            view.dispatch(
              view.state.tr.setMeta(imageMultiSelectKey, { kind: "clear" }),
            );
          }
          return false;
        }
        if (event.altKey) {
          // Toggle this image in / out of the multi-selection. Don't
          // also place a NodeSelection on it — the multi-selection
          // ring is the visual cue.
          view.dispatch(
            view.state.tr.setMeta(imageMultiSelectKey, {
              kind: "toggle",
              pos,
            }),
          );
          event.preventDefault();
          return true;
        }
        // Plain click on an image — clear any active multi-selection
        // and let ProseMirror's default NodeSelection take effect for
        // single-image operations.
        const set = imageMultiSelectKey.getState(view.state);
        if (set && set.size > 0) {
          view.dispatch(
            view.state.tr.setMeta(imageMultiSelectKey, { kind: "clear" }),
          );
        }
        return false;
      },
      handleKeyDown(view, event) {
        const set = imageMultiSelectKey.getState(view.state);
        if (event.key === "Escape" && set && set.size > 0) {
          view.dispatch(
            view.state.tr.setMeta(imageMultiSelectKey, { kind: "clear" }),
          );
          event.preventDefault();
          return true;
        }
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          set &&
          set.size > 0
        ) {
          // Reverse-sorted positions so the deletes don't shift each
          // other's offsets out from under us.
          const positions = Array.from(set).sort((a, b) => b - a);
          let tr = view.state.tr;
          for (const pos of positions) {
            const node = tr.doc.nodeAt(pos);
            if (node && node.type.name === "cortexImage") {
              tr = tr.delete(pos, pos + node.nodeSize);
            }
          }
          tr.setMeta(imageMultiSelectKey, { kind: "clear" });
          view.dispatch(tr);
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  });
}
