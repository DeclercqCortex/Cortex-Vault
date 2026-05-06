// Cluster 21 v1.0 — Marker-pen mode plugin.
//
// While the user has marker-pen mode active in the toolbar, every
// non-empty selection that ends (mouseup / pointerup releasing the
// selection drag) gets the active highlight color applied as a
// CortexHighlight mark and the selection is collapsed. Lets the user
// rapidly highlight text by drag-selecting without having to bounce
// through a toolbar button on each pass.
//
// Activation is owned by the React side (the toolbar's marker toggle
// updates the plugin's state via a meta dispatch). The plugin
// consumes pointerup to check selection state and apply.

import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface MarkerModeState {
  active: boolean;
  color: string;
}

interface MarkerMeta {
  kind: "set";
  active: boolean;
  color?: string;
}

export const cortexMarkerKey = new PluginKey<MarkerModeState>(
  "cortexMarkerMode",
);

export function getMarkerState(state: EditorState): MarkerModeState {
  return cortexMarkerKey.getState(state) ?? { active: false, color: "#ffd166" };
}

/**
 * Build the marker-pen plugin.
 *
 * @param applyHighlight  callback that applies the highlight mark with
 *                        the current marker color to the current
 *                        selection then collapses it.
 */
export function buildCortexMarkerPlugin(
  applyHighlight: (view: EditorView, color: string) => void,
): Plugin<MarkerModeState> {
  return new Plugin<MarkerModeState>({
    key: cortexMarkerKey,
    state: {
      init: () => ({ active: false, color: "#ffd166" }),
      apply(tr, value) {
        const meta = tr.getMeta(cortexMarkerKey) as MarkerMeta | undefined;
        if (meta?.kind === "set") {
          return {
            active: meta.active,
            color: meta.color ?? value.color,
          };
        }
        return value;
      },
    },
    props: {
      handleDOMEvents: {
        pointerup(view) {
          const s = cortexMarkerKey.getState(view.state);
          if (!s?.active) return false;
          const { from, to } = view.state.selection;
          if (from === to) return false;
          // Defer the mutation by a microtask so the browser's own
          // selection-end handling completes before we collapse.
          Promise.resolve().then(() => applyHighlight(view, s.color));
          return false;
        },
      },
    },
  });
}

/** Helper to dispatch a marker-mode state change from outside. */
export function setMarkerMode(
  view: EditorView,
  active: boolean,
  color?: string,
): void {
  view.dispatch(
    view.state.tr.setMeta(cortexMarkerKey, {
      kind: "set",
      active,
      color,
    } satisfies MarkerMeta),
  );
}
