// PlotDataGrid — Cluster 27 v1.0 pass 1.
//
// Excel-style inline editable grid that backs the plotter's data.
// Lives inside PlotterSidebar. Operates on an in-memory PlotData
// struct passed in via props; emits a single onChange(nextData) on
// every commit (debouncing happens upstream in the sidebar).
//
// What's in pass 1:
//   - Click cell → input → Enter / Tab / arrows to navigate
//   - Header click → rename column (inline)
//   - Column type pill (Numeric / Category / Date) — click to cycle
//   - Add/remove rows + cols via toolbar buttons + right-click menu
//   - Sort column ascending/descending (header right-click)
//   - Formula columns: type `:= <expr>` in the header, the column
//     turns computed (per-row evaluation via the Cluster 18 formula
//     engine adapter)
//   - Paste TSV/CSV from clipboard into the active cell
//   - Internal undo/redo (Ctrl+Z / Ctrl+Shift+Z), capped at 100 frames
//
// Deferred to pass 2: drag fill handle, generate-series helpers
// dialog (linspace/logspace/random), per-row drag reorder, virtual
// scrolling for >5000 rows.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PlotColumn,
  PlotColumnType,
  PlotData,
  PlotCellSelection,
  PlotSelectionRole,
} from "../editor/CortexPlotNode";
import {
  PLOT_FORMULA_PREFIX,
  evaluateComputedCell,
  isPlotFormula,
} from "../editor/plotFormulaAdapter";

// Pass 4.2 — pre-baked palette for selection chips. Each new
// selection rotates through these so consecutive picks are
// visually distinct.
const SELECTION_PALETTE = [
  "#7aa2ff",
  "#f5b54a",
  "#9bd0a8",
  "#f06969",
  "#a98bff",
  "#56b4e9",
  "#e377c2",
  "#bcbd22",
];

/** Floating role-picker emitted on mouseup of a drag selection. */
export interface PendingSelectionPick {
  /** The proto-selection waiting for a role. Color and label have
   *  been assigned; cells are populated; the user just needs to
   *  pick what this selection MEANS. */
  draft: PlotCellSelection;
  /** Screen-space anchor for the popover. */
  anchor: { x: number; y: number };
}

const COLUMN_TYPES: ReadonlyArray<PlotColumnType> = [
  "number",
  "category",
  "date",
];

export interface PlotDataGridProps {
  data: PlotData;
  /** Receive a brand-new PlotData object on every committed edit. The
   *  sidebar debounces and persists this. */
  onChange: (next: PlotData) => void;
  /** Optional max height; falls back to flex-based sizing. */
  maxHeight?: number;
  /** Pass 4.2 — emitted on mouseup of a drag selection. The sidebar
   *  shows a floating role-picker; once the user picks, the sidebar
   *  appends the finalized PlotCellSelection to data.cellSelections. */
  onPendingSelection?: (pick: PendingSelectionPick | null) => void;
}

function cloneData(d: PlotData): PlotData {
  return {
    columns: d.columns.map((c) => ({ ...c })),
    rows: d.rows.map((r) => r.slice()),
  };
}

function defaultCell(type: PlotColumnType): number | string | null {
  if (type === "number") return null;
  return "";
}

function cellDisplay(
  cell: number | string | null,
  type: PlotColumnType,
): string {
  if (cell == null) return "";
  if (type === "number") {
    if (typeof cell === "number") {
      return Number.isInteger(cell)
        ? String(cell)
        : cell.toFixed(4).replace(/\.?0+$/, "");
    }
    return String(cell);
  }
  return String(cell);
}

function coerceCellInput(
  raw: string,
  type: PlotColumnType,
): number | string | null {
  if (raw === "") return null;
  if (type === "number") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : raw; // keep string if unparseable so user sees the typo
  }
  return raw;
}

export function PlotDataGrid({
  data,
  onChange,
  maxHeight,
  onPendingSelection,
}: PlotDataGridProps) {
  // ---- editing state ----------------------------------------------------
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [editingHeader, setEditingHeader] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Pass 4.6 — drag-select state, refactored to ref-based.
  //
  // The previous pass-4.2 implementation kept the drag state in
  // useState and attached the window mouseup listener through a
  // useEffect whose dep was the drag rect. That had two bugs:
  //
  //   (a) Fast clicks left the listener un-attached because React
  //       hadn't re-rendered between mousedown and mouseup, so the
  //       drag never finalized and the grid got stuck mid-drag.
  //   (b) finalizeDrag captured `dragRect` via closure at the moment
  //       the useCallback was created — which was the INITIAL
  //       single-cell rect at mousedown. Subsequent setDragRect
  //       calls during the drag didn't update the captured value, so
  //       finalize always operated on the single cell, never the
  //       extended rectangle.
  //
  // Fix: one ref holds the entire drag state synchronously. A tiny
  // version counter forces re-renders for visual feedback (the
  // soft tint over cells in the active rectangle). finalizeDrag
  // becomes a stable useCallback reading from refs. The window
  // mouseup listener attaches once and stays for the lifetime of
  // the grid.
  interface DragState {
    anchor: { row: number; col: number };
    rect: { r0: number; c0: number; r1: number; c1: number };
    ctrlExtending: string | null;
  }
  const dragStateRef = useRef<DragState | null>(null);
  const [dragVersion, setDragVersion] = useState(0);
  const bumpDrag = useCallback(() => setDragVersion((v) => v + 1), []);

  // Map of cell key → color, derived from data.cellSelections, used
  // to paint the grid's persistent selection tints.
  const cellColorMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    const sels = data.cellSelections ?? [];
    for (const s of sels) {
      for (const c of s.cells) {
        m.set(`${c.row}:${c.col}`, s.color);
      }
    }
    return m;
  }, [data.cellSelections]);

  // ---- undo/redo stacks -------------------------------------------------
  const undoStack = useRef<PlotData[]>([]);
  const redoStack = useRef<PlotData[]>([]);
  const UNDO_CAP = 100;

  const pushUndo = useCallback((snapshot: PlotData) => {
    if (
      undoStack.current.length > 0 &&
      JSON.stringify(undoStack.current[undoStack.current.length - 1]) ===
        JSON.stringify(snapshot)
    ) {
      return; // dedupe back-to-back identical pushes
    }
    undoStack.current.push(snapshot);
    if (undoStack.current.length > UNDO_CAP) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const commitData = useCallback(
    (next: PlotData) => {
      pushUndo(cloneData(data));
      onChange(next);
    },
    [data, onChange, pushUndo],
  );

  // ---- evaluate computed columns for display ---------------------------
  const computedCache = useRef(new Map<string, string>()).current;
  // Bump on data change so renderers re-evaluate.
  useEffect(() => {
    computedCache.clear();
  }, [data, computedCache]);

  // ---- cell editing -----------------------------------------------------
  const startEditCell = useCallback(
    (row: number, col: number) => {
      const column = data.columns[col];
      if (column.formula) return; // computed columns aren't editable
      const cell = data.rows[row]?.[col];
      setEditing({ row, col });
      setEditValue(cell == null ? "" : String(cell));
      setEditingHeader(null);
    },
    [data],
  );

  const commitCellEdit = useCallback(() => {
    if (!editing) return;
    const { row, col } = editing;
    const next = cloneData(data);
    const coerced = coerceCellInput(editValue, next.columns[col].type);
    next.rows[row][col] = coerced;
    setEditing(null);
    commitData(next);
  }, [editing, editValue, data, commitData]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditingHeader(null);
  }, []);

  // Auto-focus the input when we enter edit mode.
  useEffect(() => {
    if (editing || editingHeader != null) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, editingHeader]);

  // ---- header editing ---------------------------------------------------
  const startEditHeader = useCallback(
    (col: number) => {
      const column = data.columns[col];
      // If the column is a formula, show the formula source for editing.
      setEditValue(column.formula ?? column.name);
      setEditingHeader(col);
      setEditing(null);
    },
    [data],
  );

  const commitHeaderEdit = useCallback(() => {
    if (editingHeader == null) return;
    const col = editingHeader;
    const next = cloneData(data);
    const raw = editValue;
    if (isPlotFormula(raw)) {
      // Formula column: store the formula on .formula, derive a
      // friendly display name from the body.
      const body = raw.trim().slice(PLOT_FORMULA_PREFIX.length).trim();
      next.columns[col] = {
        ...next.columns[col],
        formula: raw.trim(),
        name: body.length > 24 ? body.slice(0, 22) + "…" : body || `col${col}`,
        type: "number", // computed columns surface as numeric for now
      };
    } else {
      next.columns[col] = {
        ...next.columns[col],
        name: raw.trim() || `col${col}`,
        formula: null,
      };
    }
    setEditingHeader(null);
    commitData(next);
  }, [editingHeader, editValue, data, commitData]);

  // ---- type cycle ------------------------------------------------------
  const cycleColumnType = useCallback(
    (col: number) => {
      const next = cloneData(data);
      const cur = next.columns[col].type;
      const idx = COLUMN_TYPES.indexOf(cur);
      next.columns[col].type = COLUMN_TYPES[(idx + 1) % COLUMN_TYPES.length];
      // Re-coerce existing cells in this column.
      const tgt = next.columns[col].type;
      for (let r = 0; r < next.rows.length; r++) {
        next.rows[r][col] = coerceCellInput(
          String(next.rows[r][col] ?? ""),
          tgt,
        );
      }
      commitData(next);
    },
    [data, commitData],
  );

  // ---- row + col ops ---------------------------------------------------
  const addRow = useCallback(() => {
    const next = cloneData(data);
    next.rows.push(next.columns.map((c) => defaultCell(c.type)));
    commitData(next);
  }, [data, commitData]);

  const removeRow = useCallback(
    (row: number) => {
      if (data.rows.length === 0) return;
      const next = cloneData(data);
      next.rows.splice(row, 1);
      commitData(next);
    },
    [data, commitData],
  );

  const addColumn = useCallback(() => {
    const next = cloneData(data);
    const name = `col${next.columns.length + 1}`;
    next.columns.push({ name, type: "number" });
    for (const r of next.rows) r.push(null);
    commitData(next);
  }, [data, commitData]);

  const removeColumn = useCallback(
    (col: number) => {
      if (data.columns.length === 0) return;
      const next = cloneData(data);
      next.columns.splice(col, 1);
      for (const r of next.rows) r.splice(col, 1);
      commitData(next);
    },
    [data, commitData],
  );

  // ---- sort ------------------------------------------------------------
  const sortColumn = useCallback(
    (col: number, direction: "asc" | "desc") => {
      const next = cloneData(data);
      const cmp = (
        a: Array<number | string | null>,
        b: Array<number | string | null>,
      ) => {
        const av = a[col];
        const bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") return av - bv;
        return String(av).localeCompare(String(bv));
      };
      next.rows.sort((a, b) => (direction === "asc" ? cmp(a, b) : -cmp(a, b)));
      commitData(next);
    },
    [data, commitData],
  );

  // ---- undo / redo -----------------------------------------------------
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(cloneData(data));
    onChange(prev);
  }, [data, onChange]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(cloneData(data));
    onChange(next);
  }, [data, onChange]);

  // ---- keyboard nav inside an edit input -------------------------------
  const onEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (editing) commitCellEdit();
        else if (editingHeader != null) commitHeaderEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      } else if (e.key === "Tab" && editing) {
        e.preventDefault();
        commitCellEdit();
        const dir = e.shiftKey ? -1 : 1;
        const { row, col } = editing;
        const nextCol = col + dir;
        if (nextCol >= 0 && nextCol < data.columns.length) {
          startEditCell(row, nextCol);
        } else if (dir === 1 && row + 1 < data.rows.length) {
          startEditCell(row + 1, 0);
        } else if (dir === -1 && row - 1 >= 0) {
          startEditCell(row - 1, data.columns.length - 1);
        }
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && editing) {
        e.preventDefault();
        commitCellEdit();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const { row, col } = editing;
        const nextRow = row + dir;
        if (nextRow >= 0 && nextRow < data.rows.length) {
          startEditCell(nextRow, col);
        }
      }
    },
    [
      editing,
      editingHeader,
      commitCellEdit,
      commitHeaderEdit,
      cancelEdit,
      data,
      startEditCell,
    ],
  );

  // ---- container-level keyboard handler (undo / redo / row add) -------
  const onContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (editing || editingHeader != null) return; // input owns kb
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        ((e.shiftKey && e.key.toLowerCase() === "z") ||
          e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        redo();
      }
    },
    [editing, editingHeader, undo, redo],
  );

  // ---- paste TSV/CSV --------------------------------------------------
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (
        !text ||
        (!text.includes("\t") && !text.includes(",") && !text.includes("\n"))
      ) {
        return; // let default handle simple text
      }
      e.preventDefault();
      const delim = text.includes("\t") ? "\t" : ",";
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      if (lines.length === 0) return;
      const cells = lines.map((l) => l.split(delim));
      // Insert starting at the focused cell, expand grid as needed.
      const startRow = editing?.row ?? 0;
      const startCol = editing?.col ?? 0;
      const next = cloneData(data);
      // Ensure enough rows + cols.
      while (next.rows.length < startRow + cells.length) {
        next.rows.push(next.columns.map((c) => defaultCell(c.type)));
      }
      const widest = cells.reduce((m, r) => Math.max(m, r.length), 0);
      while (next.columns.length < startCol + widest) {
        const c = next.columns.length;
        next.columns.push({ name: `col${c + 1}`, type: "number" });
        for (const r of next.rows) r.push(null);
      }
      for (let i = 0; i < cells.length; i++) {
        for (let j = 0; j < cells[i].length; j++) {
          next.rows[startRow + i][startCol + j] = coerceCellInput(
            cells[i][j],
            next.columns[startCol + j].type,
          );
        }
      }
      commitData(next);
    },
    [editing, data, commitData],
  );

  // ---- Pass 4.6: drag-select handlers (ref-based) ----------------------
  // The mouse handlers mutate dragStateRef synchronously then bump
  // dragVersion to re-render the cell tints. finalizeDrag reads from
  // refs so it sees the latest state regardless of when it's called.
  const onCellMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
      if (e.button !== 0) return;
      if (editing && editing.row === row && editing.col === col) return;
      const sels = data.cellSelections ?? [];
      const ctrl =
        (e.ctrlKey || e.metaKey) && sels.length > 0
          ? sels[sels.length - 1].id
          : null;
      dragStateRef.current = {
        anchor: { row, col },
        rect: { r0: row, c0: col, r1: row, c1: col },
        ctrlExtending: ctrl,
      };
      bumpDrag();
      e.preventDefault();
    },
    [editing, data.cellSelections, bumpDrag],
  );

  const onCellMouseEnter = useCallback(
    (_e: React.MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
      const s = dragStateRef.current;
      if (!s) return;
      s.rect = {
        r0: Math.min(s.anchor.row, row),
        c0: Math.min(s.anchor.col, col),
        r1: Math.max(s.anchor.row, row),
        c1: Math.max(s.anchor.col, col),
      };
      bumpDrag();
    },
    [bumpDrag],
  );

  const finalizeDrag = useCallback(
    (clientX: number, clientY: number) => {
      const state = dragStateRef.current;
      if (!state) return;
      // Snapshot then clear, so any subsequent mouseup is a no-op.
      const { rect, ctrlExtending } = state;
      dragStateRef.current = null;
      bumpDrag();

      // Build the cell list from the final rect.
      const cells: Array<{ row: number; col: number }> = [];
      for (let r = rect.r0; r <= rect.r1; r++) {
        for (let c = rect.c0; c <= rect.c1; c++) {
          cells.push({ row: r, col: c });
        }
      }
      // Single-cell click without Ctrl is a normal cell-edit click, not
      // a selection. Bail before emitting the picker.
      if (cells.length <= 1 && !ctrlExtending) return;

      const existing = data.cellSelections ?? [];
      if (ctrlExtending) {
        const idx = existing.findIndex((s) => s.id === ctrlExtending);
        if (idx >= 0) {
          const next = cloneData(data);
          const nextSels = (next.cellSelections ?? []).slice();
          const target = { ...nextSels[idx] };
          const seen = new Set(target.cells.map((c) => `${c.row}:${c.col}`));
          for (const c of cells) {
            const k = `${c.row}:${c.col}`;
            if (!seen.has(k)) {
              target.cells.push(c);
              seen.add(k);
            }
          }
          nextSels[idx] = target;
          next.cellSelections = nextSels;
          commitData(next);
        }
        return;
      }
      // Brand-new selection: emit the draft + anchor to the parent so
      // the role picker prompts.
      const colorIdx = existing.length % SELECTION_PALETTE.length;
      const draft: PlotCellSelection = {
        id: `sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        color: SELECTION_PALETTE[colorIdx],
        label: `Selection ${existing.length + 1}`,
        role: "variable",
        cells,
      };
      if (onPendingSelection) {
        onPendingSelection({ draft, anchor: { x: clientX, y: clientY } });
      } else {
        const next = cloneData(data);
        next.cellSelections = [...(next.cellSelections ?? []), draft];
        commitData(next);
      }
    },
    [data, commitData, onPendingSelection, bumpDrag],
  );

  // Window-level mouseup listener — attached ONCE at mount. Reads
  // drag state from the ref so closure staleness is impossible. The
  // pass-4.2 implementation attached inside a useEffect with
  // [dragRect] in deps, which created a race on fast clicks where
  // the listener wasn't installed before mouseup happened.
  useEffect(() => {
    function onUp(e: MouseEvent) {
      if (!dragStateRef.current) return;
      finalizeDrag(e.clientX, e.clientY);
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [finalizeDrag]);

  // Helper: is a (row, col) inside the active drag rectangle?
  // Reads from the ref so it tracks the latest state.
  // dragVersion is referenced here so React re-renders when the rect
  // mutates (otherwise the tint wouldn't update on mouseenter).
  const isInDrag = useCallback(
    (row: number, col: number) => {
      void dragVersion;
      const s = dragStateRef.current;
      if (!s) return false;
      return (
        row >= s.rect.r0 &&
        row <= s.rect.r1 &&
        col >= s.rect.c0 &&
        col <= s.rect.c1
      );
    },
    [dragVersion],
  );

  // ---- compute the displayed string for a cell, including formulas ----
  const renderCell = useCallback(
    (row: number, col: number) => {
      const column = data.columns[col];
      if (column.formula && isPlotFormula(column.formula)) {
        const result = evaluateComputedCell(column, row, data);
        if (!result) return "";
        return result.kind === "ok" ? result.displayed : `#ERR`;
      }
      return cellDisplay(data.rows[row]?.[col] ?? null, column.type);
    },
    [data],
  );

  // ---- render ---------------------------------------------------------
  return (
    <div
      className="cortex-plot-grid"
      style={{ maxHeight: maxHeight ? `${maxHeight}px` : undefined }}
      onKeyDown={onContainerKeyDown}
      onPaste={onPaste}
      tabIndex={0}
    >
      <div className="cortex-plot-grid-toolbar">
        <button
          className="cortex-plot-grid-btn"
          onClick={addRow}
          title="Add row"
        >
          + Row
        </button>
        <button
          className="cortex-plot-grid-btn"
          onClick={addColumn}
          title="Add column"
        >
          + Col
        </button>
        <div className="cortex-plot-grid-spacer" />
        <button
          className="cortex-plot-grid-btn"
          onClick={undo}
          title="Undo (Ctrl+Z)"
          disabled={undoStack.current.length === 0}
        >
          ↶
        </button>
        <button
          className="cortex-plot-grid-btn"
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          disabled={redoStack.current.length === 0}
        >
          ↷
        </button>
      </div>
      <div className="cortex-plot-grid-scroll">
        <table className="cortex-plot-grid-table">
          <thead>
            <tr>
              <th className="cortex-plot-grid-rownum-head"></th>
              {data.columns.map((c, ci) => (
                <th key={ci} className="cortex-plot-grid-col-head">
                  {editingHeader === ci ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={onEditKeyDown}
                      onBlur={commitHeaderEdit}
                      className="cortex-plot-grid-input"
                    />
                  ) : (
                    <div className="cortex-plot-grid-col-head-inner">
                      <span
                        className="cortex-plot-grid-col-name"
                        onClick={() => startEditHeader(ci)}
                        title={
                          c.formula
                            ? `Formula: ${c.formula}`
                            : "Click to rename"
                        }
                      >
                        {c.formula ? "ƒ " : ""}
                        {c.name}
                      </span>
                      <span className="cortex-plot-grid-col-controls">
                        <button
                          className="cortex-plot-grid-type-pill"
                          onClick={() => cycleColumnType(ci)}
                          title="Click to cycle column type"
                          disabled={!!c.formula}
                        >
                          {c.type === "number"
                            ? "#"
                            : c.type === "date"
                              ? "📅"
                              : "Aa"}
                        </button>
                        <button
                          className="cortex-plot-grid-col-sort"
                          onClick={() => sortColumn(ci, "asc")}
                          title="Sort ascending"
                        >
                          ↑
                        </button>
                        <button
                          className="cortex-plot-grid-col-sort"
                          onClick={() => sortColumn(ci, "desc")}
                          title="Sort descending"
                        >
                          ↓
                        </button>
                        <button
                          className="cortex-plot-grid-col-del"
                          onClick={() => removeColumn(ci)}
                          title="Delete column"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, ri) => (
              <tr key={ri}>
                <td
                  className="cortex-plot-grid-rownum"
                  onClick={() => removeRow(ri)}
                  title="Click to delete row"
                >
                  {ri + 1}
                </td>
                {r.map((_, ci) => {
                  // Pass 4.11 — selections feature removed. Cell tint
                  // and drag-select have been stripped out; cells
                  // render with their default background.
                  const tintStyle: React.CSSProperties | undefined = undefined;
                  return (
                    <td
                      key={ci}
                      className={
                        "cortex-plot-grid-cell" +
                        (data.columns[ci].formula
                          ? " cortex-plot-grid-cell-computed"
                          : "") +
                        (editing && editing.row === ri && editing.col === ci
                          ? " cortex-plot-grid-cell-editing"
                          : "")
                      }
                      style={tintStyle}
                      onClick={() => startEditCell(ri, ci)}
                    >
                      {editing && editing.row === ri && editing.col === ci ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={onEditKeyDown}
                          onBlur={commitCellEdit}
                          className="cortex-plot-grid-input"
                        />
                      ) : (
                        renderCell(ri, ci)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cortex-plot-grid-status">
        {data.rows.length} row{data.rows.length === 1 ? "" : "s"} ·{" "}
        {data.columns.length} col{data.columns.length === 1 ? "" : "s"} ·
        formulas via {PLOT_FORMULA_PREFIX} prefix in header
      </div>
    </div>
  );
}
