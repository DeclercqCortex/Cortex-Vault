// FormulaCells — Cluster 18 Pass 3.
//
// Wires the formula engine (formulaEngine.ts) into TipTap's table cells.
// Three pieces:
//
//   1. Two extended cell types — `FormulaTableCell` and
//      `FormulaTableHeader` — that add a `formula` attribute and a
//      `formulaResult` attribute. parseHTML reads `data-formula` and
//      `data-formula-result` from the cell's HTML; renderHTML writes
//      them back. Round-trips through the existing HtmlTable serializer
//      (Cluster 16 v1.1) without format work.
//
//   2. A `FormulaEvaluator` TipTap Extension that installs a ProseMirror
//      plugin. The plugin's `appendTransaction` hook walks every table
//      cell after each transaction and:
//        - For cells whose text starts with `=` AND the cursor is NOT
//          currently inside, evaluates the formula against the table's
//          context (TableMap → grid position → cell text) and stores
//          the result as `data-formula-result`. The raw formula text
//          becomes the cell's text content.
//        - For cells whose text does NOT start with `=` but currently
//          carry a `formula` attr (i.e., the user deleted the `=`),
//          clears the attrs back to null.
//      The plugin is gated against re-entry by setting a transaction
//      meta flag on its own dispatched transactions.
//
//   3. CSS-driven display swap: cells with `data-formula-result` show
//      the result in italic via a ::after pseudo-element overlaying the
//      raw formula text. When the cell is focused (cursor inside), the
//      pseudo-element hides and the raw text appears so the user can
//      edit the formula. Implemented in src/index.css.
//
// Why "evaluate on selection change" rather than "on save"
// --------------------------------------------------------
// The cluster doc's v1.0 decision was "on cell blur" — snappy and
// predictable. We approximate that by walking after every transaction
// and skipping the cell that currently has the cursor. The result: as
// soon as the user clicks (or Tabs) out of a cell, its formula
// evaluates. Saving the file picks up the up-to-date result naturally.

import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TableMap, CellSelection } from "@tiptap/pm/tables";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { evaluateFormula, type TableContext } from "./formulaEngine";
import {
  formatCellValue,
  coerceCellType,
  type CellType,
} from "./cellTypeFormat";

// =====================================================================
// Cell type extensions
// =====================================================================
//
// We extend TableCell (and TableHeader) twice — first with the v1.0
// `verticalAlign` attribute (Cluster 16), now with `formula` and
// `formulaResult`. Single chained .extend() keeps both attribute sets
// on the same node type so cells can carry both at once.

const formulaAttrs = {
  formula: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-formula") || null,
    renderHTML: (attrs: Record<string, unknown>) => {
      const f = attrs.formula as string | null | undefined;
      if (!f) return {};
      return { "data-formula": f };
    },
  },
  formulaResult: {
    default: null,
    parseHTML: (el: HTMLElement) =>
      el.getAttribute("data-formula-result") || null,
    renderHTML: (attrs: Record<string, unknown>) => {
      const r = attrs.formulaResult as string | null | undefined;
      if (r == null) return {};
      return { "data-formula-result": r };
    },
  },
  // Cluster 18 v1.1 — per-cell type formatting. cellType is the
  // user-set kind ("number", "money", "percent", "date" — or null
  // for the default "text" passthrough). cellDisplay caches the
  // formatted display string for non-formula cells; formula cells
  // store the formatted result in formulaResult instead.
  cellType: {
    default: null,
    parseHTML: (el: HTMLElement) =>
      coerceCellType(el.getAttribute("data-cell-type")),
    renderHTML: (attrs: Record<string, unknown>) => {
      const t = attrs.cellType as CellType | null | undefined;
      if (!t || t === "text") return {};
      return { "data-cell-type": t };
    },
  },
  cellDisplay: {
    default: null,
    parseHTML: (el: HTMLElement) =>
      el.getAttribute("data-cell-display") || null,
    renderHTML: (attrs: Record<string, unknown>) => {
      const d = attrs.cellDisplay as string | null | undefined;
      if (d == null) return {};
      return { "data-cell-display": d };
    },
  },
};

/**
 * Same shape as Cluster 16's ValignTableCell, just with the formula
 * attributes layered on top. Editor.tsx imports this and registers it
 * in place of TableCell.
 */
export const FormulaTableCell = TableCell.extend({
  addAttributes() {
    const verticalAlignAttr = {
      verticalAlign: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.verticalAlign?.trim() || null,
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = attrs.verticalAlign as string | null | undefined;
          if (!v) return {};
          return { style: `vertical-align: ${v}` };
        },
      },
    };
    return {
      ...this.parent?.(),
      ...verticalAlignAttr,
      ...formulaAttrs,
    };
  },
});

export const FormulaTableHeader = TableHeader.extend({
  addAttributes() {
    const verticalAlignAttr = {
      verticalAlign: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.verticalAlign?.trim() || null,
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = attrs.verticalAlign as string | null | undefined;
          if (!v) return {};
          return { style: `vertical-align: ${v}` };
        },
      },
    };
    return {
      ...this.parent?.(),
      ...verticalAlignAttr,
      ...formulaAttrs,
    };
  },
});

// =====================================================================
// FormulaEvaluator plugin
// =====================================================================

const formulaUpdateKey = new PluginKey<boolean>("cortexFormulaEvaluator");

/**
 * Walk up from the selection's $from to find the enclosing table cell
 * (if any). Returns the cell's doc position (where setNodeMarkup
 * needs it) or null when the cursor isn't inside a cell.
 */
function currentCellPos(state: EditorState): number | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return $from.before(d);
    }
  }
  return null;
}

/**
 * Build a TableContext over a table node, given its absolute doc
 * position. cellAt(col, row, visited) resolves the cell's text content,
 * recursively following formulas if the cell itself carries one. The
 * visited set is threaded through to detect circular references.
 */
function buildTableContext(
  state: EditorState,
  table: ProseMirrorNode,
  tablePos: number,
): TableContext {
  const map = TableMap.get(table);
  // Build a quick (col, row) → cellPos lookup.
  const cellAtRC = (col: number, row: number): number | null => {
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) {
      return null;
    }
    // map.map is a flat [width × height] array of cell offsets relative
    // to table's content (so absolute pos = tablePos + 1 + offset).
    const offset = map.map[row * map.width + col];
    if (offset == null) return null;
    return tablePos + 1 + offset;
  };

  return {
    columnCount: map.width,
    rowCount: map.height,
    cellAt(col: number, row: number, visited: Set<string>): string {
      const pos = cellAtRC(col, row);
      if (pos == null) return "";
      const cell = state.doc.nodeAt(pos);
      if (!cell) return "";
      const text = cell.textContent;
      // If this cell itself has a formula (text starts with =), recurse.
      if (text.trim().startsWith("=")) {
        const r = evaluateFormula(
          text.trim(),
          {
            columnCount: map.width,
            rowCount: map.height,
            // Inner cellAt closes over the same lookup but threads the
            // visited set further.
            cellAt: (c, rr, v) => {
              const p = cellAtRC(c, rr);
              if (p == null) return "";
              const inner = state.doc.nodeAt(p);
              return inner ? inner.textContent : "";
            },
          },
          visited,
        );
        if (r.kind === "ok") return r.displayed;
        return ""; // error → empty in numeric coercion
      }
      return text;
    },
  };
}

/**
 * The plugin. Re-evaluates every cell-with-a-formula in the doc on
 * every transaction (skipping cells the cursor currently sits in).
 *
 * Cost analysis: a vault has on the order of dozens to low-hundreds of
 * cells per open document. The walk is O(cells), each formula evaluator
 * call is microsecond-scale for typical formulas. Negligible.
 */
function buildFormulaEvaluatorPlugin(): Plugin<boolean> {
  return new Plugin<boolean>({
    key: formulaUpdateKey,
    appendTransaction(transactions, oldState, newState) {
      // Re-entry guard: skip when one of the source transactions came
      // from us.
      if (transactions.some((t) => t.getMeta(formulaUpdateKey))) {
        return null;
      }
      // Skip when nothing changed (no doc edits, no selection moves).
      const anyDocChange = transactions.some((t) => t.docChanged);
      const anySelectionChange = transactions.some(
        (t) => t.selectionSet || t.docChanged,
      );
      if (!anyDocChange && !anySelectionChange) return null;

      const cursorPos = currentCellPos(newState);

      let tr = newState.tr;
      let touched = false;

      // Walk every table in the doc. Build its context once; then
      // walk every cell within the table and re-evaluate.
      newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name !== "table") return true;
        const ctx = buildTableContext(newState, node, pos);
        const tableEnd = pos + node.nodeSize;

        newState.doc.descendants(
          (cellNode: ProseMirrorNode, cellPos: number) => {
            if (cellPos < pos || cellPos >= tableEnd) return false;
            const t = cellNode.type.name;
            if (t !== "tableCell" && t !== "tableHeader") return true;

            // Skip the cell with the cursor (user is editing).
            if (cursorPos !== null && cellPos === cursorPos) {
              return false;
            }

            const text = cellNode.textContent.trim();
            const attrs = cellNode.attrs as {
              formula?: string | null;
              formulaResult?: string | null;
            };

            // Pull cellType into a variable for use in both branches below.
            const cellType = (cellNode.attrs as { cellType?: CellType | null })
              .cellType;
            const fullAttrs = cellNode.attrs as {
              formula?: string | null;
              formulaResult?: string | null;
              cellType?: CellType | null;
              cellDisplay?: string | null;
            };

            if (!text.startsWith("=")) {
              // Non-formula cell. Clear stale formula attrs if present,
              // and apply the cellType formatter to derive cellDisplay.
              const wantFormula: string | null = null;
              const wantResult: string | null = null;
              const wantDisplay =
                cellType && cellType !== "text"
                  ? formatCellValue(cellNode.textContent, cellType)
                  : null;

              const sameFormula = (fullAttrs.formula ?? null) === wantFormula;
              const sameResult =
                (fullAttrs.formulaResult ?? null) === wantResult;
              const sameDisplay =
                (fullAttrs.cellDisplay ?? null) === wantDisplay;

              if (sameFormula && sameResult && sameDisplay) return false;
              tr = tr.setNodeMarkup(cellPos, undefined, {
                ...cellNode.attrs,
                formula: wantFormula,
                formulaResult: wantResult,
                cellDisplay: wantDisplay,
              });
              touched = true;
              return false;
            }

            // Formula cell. Evaluate, then if the cell has a cellType,
            // apply the formatter to the result. cellDisplay is unused
            // for formula cells (formulaResult carries the displayed
            // value).
            const r = evaluateFormula(text, ctx);
            const newFormula = text;
            const baseResult =
              r.kind === "ok" ? r.displayed : `Error: ${r.message}`;
            const newResult =
              r.kind === "ok" && cellType && cellType !== "text"
                ? formatCellValue(baseResult, cellType)
                : baseResult;

            const sameFormula = fullAttrs.formula === newFormula;
            const sameResult = fullAttrs.formulaResult === newResult;
            const sameDisplay = (fullAttrs.cellDisplay ?? null) === null;

            if (sameFormula && sameResult && sameDisplay) {
              return false; // no-op
            }
            tr = tr.setNodeMarkup(cellPos, undefined, {
              ...cellNode.attrs,
              formula: newFormula,
              formulaResult: newResult,
              cellDisplay: null,
            });
            touched = true;
            return false; // don't descend into cell content
          },
        );

        return false; // don't descend further into table
      });

      if (!touched) return null;
      tr.setMeta(formulaUpdateKey, true);
      return tr;
    },
  });
}

/**
 * Cluster 18 v1.0.1 — focused-cell decoration.
 *
 * The CSS display swap for formula cells originally used `:focus-within`
 * on the <td>, but that selector doesn't fire here: when the cursor is
 * inside the cell, ProseMirror's `document.activeElement` is the
 * .ProseMirror editor root — an ANCESTOR of the cell, not a descendant.
 * `:focus-within` matches only when the focused element is a descendant.
 *
 * This plugin maintains a Decoration.node carrying a
 * `cortex-cell-editing` class on whichever cell currently contains the
 * cursor. CSS targets `:not(.cortex-cell-editing)` instead of
 * `:not(:focus-within)`. ProseMirror re-runs decorations on every
 * selection change, so the class moves with the cursor.
 */
const focusedCellKey = new PluginKey("cortexFocusedCell");

function buildFocusedCellPlugin(): Plugin {
  return new Plugin({
    key: focusedCellKey,
    props: {
      decorations(state) {
        const cellPos = currentCellPos(state);
        if (cellPos == null) return null;
        const cell = state.doc.nodeAt(cellPos);
        if (!cell) return null;
        return DecorationSet.create(state.doc, [
          Decoration.node(cellPos, cellPos + cell.nodeSize, {
            class: "cortex-cell-editing",
          }),
        ]);
      },
    },
  });
}

/**
 * TipTap Extension wrapper. Register in Editor.tsx's extensions list.
 * Bundles two plugins: the appendTransaction-based formula evaluator
 * and the decoration-based focused-cell tracker.
 */
/**
 * Cluster 18 v1.1 — freeze rows / freeze columns.
 *
 * The table node carries `frozenRows` and `frozenCols` attrs. This
 * plugin walks every table on every state change and emits a
 * Decoration.node carrying a `data-frozen-row="<rowIdx>"` or
 * `data-frozen-col="<colIdx>"` attribute on cells that fall inside the
 * frozen region. CSS uses those attributes with `position: sticky` to
 * keep frozen cells visible while the rest of the table scrolls.
 *
 * Why decorations rather than baking the data-* into renderHTML: the
 * frozen-ness depends on the cell's grid position (computed via
 * TableMap) and on the table's frozenRows/frozenCols attrs. Both can
 * change without the cell node itself changing, so we want the
 * data-* attributes to come from a re-runnable computation rather
 * than from cell-local renderHTML.
 */
const frozenCellsKey = new PluginKey("cortexFrozenCells");

function buildFrozenCellsPlugin(): Plugin {
  return new Plugin({
    key: frozenCellsKey,
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name !== "table") return true;
          const attrs = node.attrs as {
            frozenRows?: number | null;
            frozenCols?: number | null;
          };
          const fr = Math.max(0, Number(attrs.frozenRows ?? 0) | 0);
          const fc = Math.max(0, Number(attrs.frozenCols ?? 0) | 0);
          if (fr === 0 && fc === 0) return false;

          let map;
          try {
            map = TableMap.get(node);
          } catch {
            return false;
          }
          const tableEnd = pos + node.nodeSize;

          // For each cell, compute its grid rect and emit the
          // data-frozen-row / data-frozen-col attrs accordingly.
          state.doc.descendants((cell: ProseMirrorNode, cellPos: number) => {
            if (cellPos < pos || cellPos >= tableEnd) return false;
            const t = cell.type.name;
            if (t !== "tableCell" && t !== "tableHeader") return true;
            let rect;
            try {
              rect = map.findCell(cellPos - pos - 1);
            } catch {
              return false;
            }
            const inFrozenRow = rect.top < fr;
            const inFrozenCol = rect.left < fc;
            if (!inFrozenRow && !inFrozenCol) return false;

            const decoAttrs: Record<string, string> = {};
            if (inFrozenRow) {
              decoAttrs["data-frozen-row"] = String(rect.top);
            }
            if (inFrozenCol) {
              decoAttrs["data-frozen-col"] = String(rect.left);
            }
            decos.push(
              Decoration.node(cellPos, cellPos + cell.nodeSize, decoAttrs),
            );
            return false;
          });
          return false; // don't descend further into the table
        });

        if (decos.length === 0) return null;
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

/**
 * Cluster 18 v1.1.3 — preserve a CellSelection on right-click inside it.
 *
 * The browser's default right-click behaviour moves the cursor (and
 * with it the editor's selection) to the clicked element. That
 * collapses an active CellSelection before our contextmenu handler in
 * Editor.tsx can read it, which is why right-click → "Cell type → Money"
 * across a multi-cell selection used to only update the cell the right-
 * click landed on.
 *
 * The exception is right-clicking on the cell the cursor was already
 * sitting in — no movement happens, so the CellSelection survives.
 *
 * This plugin watches mousedown events on the editor's view DOM. On a
 * right-click that lands inside the current CellSelection's cell rect,
 * it preventDefault()s to suppress the cursor move. Right-clicks
 * outside the selection still collapse it — the user is starting a new
 * selection at that point, which matches Excel/Sheets behaviour.
 */
const preserveCellSelectionKey = new PluginKey("cortexPreserveCellSelection");

function buildPreserveCellSelectionPlugin(): Plugin {
  return new Plugin({
    key: preserveCellSelectionKey,
    props: {
      handleDOMEvents: {
        mousedown(view, event: MouseEvent): boolean {
          // Right-click only.
          if (event.button !== 2) return false;
          const sel = view.state.selection;
          if (!(sel instanceof CellSelection)) return false;

          // Find the cell the click landed in (if any). We resolve via
          // posAtCoords rather than walking the DOM ancestors so we work
          // for clicks anywhere inside the cell, including padding.
          const coordPos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (!coordPos) return false;

          // Walk up from the click position to find the enclosing cell.
          const $pos = view.state.doc.resolve(coordPos.pos);
          let clickCellPos: number | null = null;
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (
              node.type.name === "tableCell" ||
              node.type.name === "tableHeader"
            ) {
              clickCellPos = $pos.before(d);
              break;
            }
          }
          if (clickCellPos == null) return false;

          // Check whether clickCellPos is inside the current
          // CellSelection. forEachCell hands us each selected cell's
          // doc position; we just need a match.
          let inSelection = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sel.forEachCell((_cell: any, cellPos: number) => {
            if (cellPos === clickCellPos) inSelection = true;
          });

          if (!inSelection) return false;

          // Right-click inside an active CellSelection → suppress the
          // default cursor move so the selection survives long enough
          // for the contextmenu handler to read it.
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

/**
 * Cluster 18 v1.2 — filter rows.
 *
 * The table can carry `filterCol: number | null` and
 * `filterValue: string | null` attrs. When both are set, this plugin
 * walks the table's rows and emits a Decoration.node with
 * `data-filtered="true"` on rows whose cell at filterCol's textContent
 * doesn't match filterValue (case-insensitive substring compare).
 *
 * Frozen rows are exempt — they always stay visible. Header rows
 * (those with any tableHeader cell) are also exempt for the same
 * reason: the user wants column labels visible regardless of filter.
 *
 * CSS hides filtered rows via `display: none`.
 *
 * Round-trip: data-filter-col + data-filter-value attrs on the
 * `<table>` element. The HtmlTable serializer's parseHTML / renderHTML
 * pass them through automatically because we declare them in the
 * Table extension's addAttributes (Editor.tsx).
 */
const filteredRowsKey = new PluginKey("cortexFilteredRows");

function buildFilteredRowsPlugin(): Plugin {
  return new Plugin({
    key: filteredRowsKey,
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name !== "table") return true;
          const attrs = node.attrs as {
            filterCol?: number | null;
            filterValue?: string | null;
            frozenRows?: number | null;
          };
          const filterCol = attrs.filterCol;
          const filterValue = attrs.filterValue;
          if (filterCol == null || filterValue == null || filterValue === "") {
            return false;
          }
          const frozenRows = Math.max(0, Number(attrs.frozenRows ?? 0) | 0);
          const needle = String(filterValue).trim().toLowerCase();

          let map;
          try {
            map = TableMap.get(node);
          } catch {
            return false;
          }
          if (filterCol < 0 || filterCol >= map.width) return false;

          // For each row, find the cell at filterCol and compare its
          // text. Header rows + frozen rows are exempt.
          let rowIdx = 0;
          node.forEach((row: ProseMirrorNode, _offset: number) => {
            const isFrozen = rowIdx < frozenRows;
            // Header detection: any tableHeader cell in the row.
            let isHeader = false;
            row.forEach((cell: ProseMirrorNode) => {
              if (cell.type.name === "tableHeader") isHeader = true;
            });

            if (!isFrozen && !isHeader) {
              // Find the cell at filterCol via the row's children +
              // colspan walk. Locally fast; avoids a TableMap lookup
              // per row.
              let curCol = 0;
              let cellAtCol: ProseMirrorNode | null = null;
              row.forEach((cell: ProseMirrorNode) => {
                if (cellAtCol) return;
                const span = (cell.attrs?.colspan ?? 1) as number;
                if (curCol <= filterCol && curCol + span > filterCol) {
                  cellAtCol = cell;
                }
                curCol += span;
              });
              const text = (cellAtCol?.textContent ?? "").trim().toLowerCase();
              const matches = text.includes(needle);
              if (!matches) {
                // Compute the row's absolute doc position. row is at
                // pos + 1 (table's open token) + accumulated row
                // sizes — but ProseMirror.forEach gives us the offset
                // within the parent already; use that via an indexed
                // walk.
                let rowPos = pos + 1;
                let i = 0;
                node.forEach((r: ProseMirrorNode, off: number) => {
                  if (i === rowIdx) rowPos = pos + 1 + off;
                  i++;
                });
                decos.push(
                  Decoration.node(rowPos, rowPos + row.nodeSize, {
                    "data-filtered": "true",
                  }),
                );
              }
            }
            rowIdx++;
          });
          return false;
        });

        if (decos.length === 0) return null;
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

export const FormulaEvaluator = Extension.create({
  name: "cortexFormulaEvaluator",
  addProseMirrorPlugins() {
    return [
      buildFormulaEvaluatorPlugin(),
      buildFocusedCellPlugin(),
      buildFrozenCellsPlugin(),
      buildPreserveCellSelectionPlugin(),
      buildFilteredRowsPlugin(),
    ];
  },
});
