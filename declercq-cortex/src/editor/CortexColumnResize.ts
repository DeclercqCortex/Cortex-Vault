// CortexColumnResize — Cluster 18 Pass 1.
//
// Replaces prosemirror-tables's `columnResizing` plugin with a Cortex-
// specific implementation that fully fixes the v1.1.4 known issue
// "cell-height growth on hover for tables without explicit colwidths".
//
// Why a custom plugin
// -------------------
// prosemirror-tables's `columnResizing` plugin runs `updateColumnsOnResize`
// on every per-hover ProseMirror view update. That function falls back to
// a `defaultCellMinWidth = 100px` for cells that don't carry an explicit
// `data-colwidth`, which mutates `<table>.style.width` and re-runs layout.
// On a doc with stale tables (no explicit widths), every hover near a
// column boundary made empty cells visibly grow vertically. Cluster 16
// v1.1.4 worked around it by auto-equalizing fresh tables; Cluster 17
// added the typedBlock infrastructure that exposed the issue further.
//
// This plugin doesn't subscribe to view updates at all. The drag is
// driven by direct DOM events (mousedown to detect, window-level
// mousemove/mouseup to track) and dispatches `setNodeMarkup`
// transactions to update each affected cell's `colwidth` attr in one
// transaction per move. The cell's schema-side `renderHTML` translates
// `colwidth` to inline `style="width: …px"` — same path Cluster 16
// v1.1's HtmlTable serializer relied on for round-trip.
//
// Hit zone
// --------
// A cell is "draggable" if the mousedown lands within `HIT_ZONE_PX` of
// the cell's right border (inside or up to a few px past). We render a
// visible 3px-wide handle on the right edge of every cell (via the
// existing `.column-resize-handle`-style CSS class kept from v1.0/v1.1.4
// for visual continuity) but the hit detection is geometric — it
// doesn't depend on the handle DOM existing.
//
// Last column behaviour
// ---------------------
// Dragging the last column's right border resizes that column. The
// table's overall width grows or shrinks. We do NOT clamp to the
// container width because Cortex tables already allow horizontal
// overflow (Cluster 6 v1.5's PDF horizontal-scroll work and the
// `.cortex-table` container overflow rules).

import { Plugin, PluginKey, EditorState } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** How close to a cell's right border counts as a drag start. */
const HIT_ZONE_PX = 5;
/** How far past the cell's right border still counts (covers the visible handle). */
const HIT_ZONE_OVERSHOOT_PX = 3;
/** Minimum column width — prevents the user from dragging a column to invisibility. */
const MIN_COL_WIDTH_PX = 30;

interface DragState {
  /** Doc position of the table's `table` node. */
  tablePos: number;
  /** Index of the column being dragged (zero-based, leftmost = 0). */
  columnIndex: number;
  /** Mouse X at drag start, in viewport coords. */
  startX: number;
  /** The column's width at drag start. */
  startWidth: number;
}

interface PluginStateShape {
  /** Non-null while a drag is in progress. */
  drag: DragState | null;
}

const cortexResizeKey = new PluginKey<PluginStateShape>("cortexColumnResize");

/**
 * Walk up from `el` until we find an ancestor that's a table cell DOM
 * (`<td>` or `<th>`). Bounded by `root` so we never escape the editor.
 */
function findCellElement(
  el: Element | null,
  root: HTMLElement,
): HTMLTableCellElement | null {
  let cur: Element | null = el;
  while (cur && cur !== root) {
    if (cur instanceof HTMLTableCellElement) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Given a cell's bounding rect and a mouse X coord, decide whether the
 * mouse is in the right-border drag zone for this cell.
 */
function isInDragZone(rect: DOMRect, clientX: number): boolean {
  return (
    clientX >= rect.right - HIT_ZONE_PX &&
    clientX <= rect.right + HIT_ZONE_OVERSHOOT_PX
  );
}

/**
 * Find the table node + its doc position by walking up from `pos`.
 * Returns null if `pos` isn't inside a table.
 */
function findTableAtPos(
  state: EditorState,
  pos: number,
): { node: ProseMirrorNode; pos: number } | null {
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table") {
      return { node, pos: $pos.before(d) };
    }
  }
  return null;
}

/**
 * Compute the absolute column index (within the table) for a given cell
 * position. Uses TableMap.findCell which returns a rect — `left` is the
 * cell's leftmost column, `right` is the exclusive end.
 */
function cellColumnRect(
  table: ProseMirrorNode,
  tablePos: number,
  cellPos: number,
): { left: number; right: number } | null {
  try {
    const map = TableMap.get(table);
    const rect = map.findCell(cellPos - tablePos - 1);
    return { left: rect.left, right: rect.right };
  } catch {
    return null;
  }
}

/**
 * Sum the explicit colwidth entries across the first row's cells to
 * determine the rendered width of column `columnIndex`. Falls back to
 * 100 if no explicit width is set (shouldn't happen post-equalize).
 */
function currentColumnWidth(
  table: ProseMirrorNode,
  columnIndex: number,
): number {
  const firstRow = table.firstChild;
  if (!firstRow) return 100;
  let col = 0;
  let result = 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  firstRow.forEach((cell: any) => {
    const span: number = cell.attrs?.colspan ?? 1;
    const cw: unknown = cell.attrs?.colwidth;
    for (let i = 0; i < span; i++) {
      if (col === columnIndex) {
        if (Array.isArray(cw) && typeof cw[i] === "number") {
          result = cw[i] as number;
        }
      }
      col++;
    }
  });
  return result;
}

/**
 * Build a transaction that updates colwidth for `columnIndex` to
 * `newWidth` across every cell in the table that spans that column.
 */
function buildResizeTransaction(
  state: EditorState,
  tablePos: number,
  columnIndex: number,
  newWidth: number,
) {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const tr = state.tr;
  const tableEnd = tablePos + table.nodeSize;

  // Walk every cell in the table; for each, if it spans the dragged
  // column, rewrite its colwidth array entry for that column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.doc.descendants((node: any, pos: number) => {
    if (pos < tablePos || pos >= tableEnd) return false;
    const name = node.type.name;
    if (name !== "tableCell" && name !== "tableHeader") return true;
    const rect = cellColumnRect(table, tablePos, pos);
    if (!rect) return false;
    if (columnIndex < rect.left || columnIndex >= rect.right) return false;

    const span = (node.attrs?.colspan ?? 1) as number;
    const incoming: Array<number | null> = Array.isArray(node.attrs?.colwidth)
      ? [...(node.attrs.colwidth as Array<number | null>)]
      : new Array(span).fill(null);
    const idx = columnIndex - rect.left;
    incoming[idx] = newWidth;

    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      colwidth: incoming,
    });
    return false; // don't descend into cell content
  });

  if (!tr.docChanged) return null;
  return tr;
}

/**
 * The plugin instance. Wire into the TipTap extensions list via
 * cortexColumnResizeExtension below.
 */
export function buildCortexColumnResizePlugin(): Plugin<PluginStateShape> {
  return new Plugin<PluginStateShape>({
    key: cortexResizeKey,
    state: {
      init(): PluginStateShape {
        return { drag: null };
      },
      apply(tr, prev): PluginStateShape {
        const meta = tr.getMeta(cortexResizeKey) as
          | Partial<PluginStateShape>
          | undefined;
        if (meta) return { ...prev, ...meta };
        return prev;
      },
    },
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent): boolean {
          if (event.button !== 0) return false; // left-click only
          const target = event.target as Element | null;
          if (!target) return false;

          const cellEl = findCellElement(target, view.dom as HTMLElement);
          if (!cellEl) return false;

          const rect = cellEl.getBoundingClientRect();
          if (!isInDragZone(rect, event.clientX)) return false;

          // Resolve the cell to a doc position.
          const cellStart = view.posAtDOM(cellEl, 0);
          if (cellStart < 0) return false;

          const tableHit = findTableAtPos(view.state, cellStart);
          if (!tableHit) return false;

          // Determine the dragged column index (the cell's rightmost
          // spanned column).
          const cellRect = cellColumnRect(
            tableHit.node,
            tableHit.pos,
            // posAtDOM puts us inside the cell at offset 0, so the cell
            // node itself is one position earlier.
            cellStart - 1,
          );
          if (!cellRect) return false;
          const columnIndex = cellRect.right - 1;

          const startWidth = currentColumnWidth(tableHit.node, columnIndex);

          // Begin the drag.
          event.preventDefault();
          event.stopPropagation();

          const drag: DragState = {
            tablePos: tableHit.pos,
            columnIndex,
            startX: event.clientX,
            startWidth,
          };
          view.dispatch(view.state.tr.setMeta(cortexResizeKey, { drag }));

          // Visual cue while dragging.
          (view.dom as HTMLElement).classList.add("cortex-resize-active");
          document.body.style.cursor = "col-resize";
          // Disable text selection during drag — without this the
          // browser starts a selection on every mousemove which
          // visually jitters and steals events.
          document.body.style.userSelect = "none";

          function onMove(e: MouseEvent) {
            const newWidth = Math.max(
              MIN_COL_WIDTH_PX,
              Math.round(drag.startWidth + (e.clientX - drag.startX)),
            );
            const tr = buildResizeTransaction(
              view.state,
              drag.tablePos,
              drag.columnIndex,
              newWidth,
            );
            if (tr) {
              view.dispatch(tr);
            }
          }

          function onUp() {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            (view.dom as HTMLElement).classList.remove("cortex-resize-active");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            view.dispatch(
              view.state.tr.setMeta(cortexResizeKey, { drag: null }),
            );
          }

          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          return true;
        },

        // Hover affordance: when not dragging, set a col-resize cursor
        // when the mouse approaches a cell's right border so the user
        // discovers the chord. Returns false so the event continues
        // propagating to other handlers.
        mousemove(view: EditorView, event: MouseEvent): boolean {
          // Skip the hover work while a drag is in progress (cursor is
          // already locked via document.body.style.cursor).
          const pluginState = cortexResizeKey.getState(view.state);
          if (pluginState?.drag) return false;

          const target = event.target as Element | null;
          if (!target) return false;
          const cellEl = findCellElement(target, view.dom as HTMLElement);
          if (!cellEl) {
            cellEl_clearCursorCue(view);
            return false;
          }
          const rect = cellEl.getBoundingClientRect();
          if (isInDragZone(rect, event.clientX)) {
            (view.dom as HTMLElement).classList.add("cortex-resize-hover");
          } else {
            cellEl_clearCursorCue(view);
          }
          return false;
        },
      },
    },
  });
}

function cellEl_clearCursorCue(view: EditorView) {
  (view.dom as HTMLElement).classList.remove("cortex-resize-hover");
}

/**
 * TipTap Extension wrapper. Register this in the editor's extensions
 * list (Editor.tsx) AFTER calling
 * `HtmlTable.configure({ resizable: false })` so the prosemirror-tables
 * built-in plugin is not loaded. The Cortex plugin then provides the
 * sole source of truth for column resizing.
 */
import { Extension } from "@tiptap/core";

export const CortexColumnResize = Extension.create({
  name: "cortexColumnResize",
  addProseMirrorPlugins() {
    return [buildCortexColumnResizePlugin()];
  },
});
