// CortexTableView — Cluster 18 v1.0.1 fix.
//
// When CortexColumnResize disabled prosemirror-tables's `columnResizing`
// plugin (Cluster 18 v1.0), it also took away the `TableView` nodeView
// that prosemirror-tables installs. That nodeView is what translates
// each cell's `colwidth` attribute into actual rendered `<col
// style="width:..."` elements inside the table's `<colgroup>`. Without
// it, the cell attrs update fine but the browser uses its automatic
// table-layout widths — drag-resize and equalize-column-widths only
// "appeared" on next file reload (which forced a fresh render through
// the tableEditing pipeline).
//
// This file ships a minimal stand-in. It's modelled on
// prosemirror-tables's TableView but stripped of the columnResizing
// integration:
//   - No `cellMinWidth` fallback. We require explicit colwidths on
//     cells that want a fixed render width (set by drag, equalize, or
//     the v1.1.4 auto-equalize-on-insert path). Cells without colwidth
//     fall back to the browser's natural column-width algorithm.
//   - No view-update spam. The class only re-renders the colgroup
//     when a transaction changes the table node — `update()` is the
//     only entry point. ProseMirror calls it on transaction-driven
//     node updates, which is exactly what we want.
//   - Cleans up extra `<col>` elements when the column count shrinks
//     (e.g. user deletes a column). Without this, removing the last
//     column leaves a stale `<col>` causing a white line where the
//     table used to extend — that's the v1.0 bug "white line artifact
//     after column delete".

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export class CortexTableView {
  /** Outer wrapper that takes the place of the rendered <table>. */
  dom: HTMLElement;
  /** The <table> ProseMirror writes content into. */
  table: HTMLTableElement;
  /** The <colgroup> the update() method maintains. */
  colgroup: HTMLElement;
  /** ProseMirror writes cells/rows into this — must be a real <tbody>
   *  since browsers wrap orphan rows in an implicit tbody otherwise. */
  contentDOM: HTMLElement;
  /** The current node, kept so update() can compare on incoming changes. */
  node: ProseMirrorNode;

  constructor(node: ProseMirrorNode) {
    this.node = node;
    // .tableWrapper matches the class prosemirror-tables uses, so any
    // existing CSS targeting .tableWrapper continues to apply.
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    this.table.className = "cortex-table";
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.updateColgroup();
  }

  /**
   * Called by ProseMirror whenever the underlying node changes (cell
   * attr edits, row inserts/deletes, column inserts/deletes, etc.).
   * Returning `true` keeps this view alive; returning `false` would
   * destroy and rebuild it.
   */
  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updateColgroup();
    return true;
  }

  /**
   * Walk the first row's cells, expand each by colspan, and write a
   * matching <col> with the cell's colwidth into the colgroup. Set
   * `<table>.style.width` to the sum if every column has an explicit
   * width (so the browser uses fixed-layout); otherwise leave width
   * unset and let the browser auto-size.
   *
   * Why first row only: prosemirror-tables stores colwidth per cell,
   * but column geometry is determined by row 0. Other rows must agree
   * (they share the same <col> elements), and the equalize/drag paths
   * always update every row in lockstep.
   */
  private updateColgroup() {
    const firstRow = this.node.firstChild;
    if (!firstRow) return;

    let totalWidth = 0;
    let fixedWidth = true;
    let nextCol = this.colgroup.firstElementChild as HTMLElement | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firstRow.forEach((cell: any) => {
      const colspan = (cell.attrs?.colspan ?? 1) as number;
      const colwidth = cell.attrs?.colwidth as Array<number | null> | null;

      for (let j = 0; j < colspan; j++) {
        const w =
          Array.isArray(colwidth) && typeof colwidth[j] === "number"
            ? (colwidth[j] as number)
            : null;
        const cssWidth = w != null ? `${w}px` : "";

        if (w != null) {
          totalWidth += w;
        } else {
          fixedWidth = false;
        }

        if (!nextCol) {
          const col = this.colgroup.appendChild(document.createElement("col"));
          col.style.width = cssWidth;
        } else {
          if (nextCol.style.width !== cssWidth) {
            nextCol.style.width = cssWidth;
          }
          nextCol = nextCol.nextElementSibling as HTMLElement | null;
        }
      }
    });

    // Trim any extra <col> elements left from a previous row with more
    // columns. Without this step, deleting a column leaves a stale
    // <col> behind — and the browser renders a "ghost" column (the
    // white line artifact).
    while (nextCol) {
      const next = nextCol.nextElementSibling as HTMLElement | null;
      nextCol.remove();
      nextCol = next;
    }

    if (fixedWidth) {
      this.table.style.width = `${totalWidth}px`;
      this.table.style.minWidth = "";
    } else {
      this.table.style.width = "";
      // Use a min-width so the browser picks a sensible base width for
      // tables whose cells haven't been resized yet.
      this.table.style.minWidth = `${Math.max(totalWidth, 200)}px`;
    }
  }

  /**
   * ProseMirror normally rebuilds a NodeView when it sees DOM mutations
   * it doesn't recognise. Our colgroup updates are exactly that kind of
   * mutation, so we tell it to ignore changes to the colgroup and the
   * table's style attribute. Without this hook, every update() ends in
   * a full nodeView rebuild and we lose the in-progress drag.
   */
  ignoreMutation(record: MutationRecord): boolean {
    if (record.target === this.table && record.attributeName === "style") {
      return true;
    }
    if (
      record.target === this.colgroup ||
      this.colgroup.contains(record.target as Node)
    ) {
      return true;
    }
    return false;
  }
}
