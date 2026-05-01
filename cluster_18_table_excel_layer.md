# Cluster 18 — Excel layer for tables (formulas, cell types, freeze rows/cols, custom drag-resize)

*Build order: Phase 3, on demand. Depends on Cluster 16 v1.1+ (HTML table serializer, equalize, vertical alignment). Independent of Cluster 17.*

---

## What this is

Five table features bundled into one cluster, each addressing a daily-friction signal that emerged after Cluster 16 shipped:

1. **Excel-style formulas in cells.** `=MEAN(C1:C3)`, `=SUM(A2:A10)`, `=COUNT(B1:B5)`, `=A1*B1`, etc. Formulas live in the cell's body text starting with `=`; on save (or on cell-blur), they're evaluated and the result is rendered. The original formula is preserved in a per-cell `formula` attribute so it can be edited again.
2. **Cell-type formatting.** Per-cell or per-column "this is money" / "this is a date" / "this is a percent" / "this is a number with N decimals" formatting. Driven by a per-cell `cellType` attribute. The display value is formatted (`$1,234.56`, `2026-04-29`, `42.5%`) but the underlying value is plain text.
3. **Freeze rows / freeze columns.** Mark the first N rows or first N columns as "frozen" — they stay visible when the rest of the table scrolls horizontally or vertically. Implemented via CSS `position: sticky` on the frozen cells.
4. **Custom drag-resize plugin.** Replace prosemirror-tables's `columnResizing` plugin with a Cortex-specific one that doesn't trigger per-hover view updates. **This fully fixes the v1.1.4 known issue "cell-height growth on hover for tables without explicit colwidths."**
5. **Cell-type-aware sort and filter.** Right-click a column → "Sort ascending / descending / clear." Optional v1.1: per-column filter dropdown.

The user explicitly asked for items 1, 2, and 3 in the original Cluster 16 conversation, with the understanding they'd be deferred to a separate cluster. Item 4 is a v1.1.4 bug fix that fits naturally here. Item 5 is a v1.1 candidate after the formula engine works.

## Why we want it

- **Formulas** turn Cortex into a viable scratch-pad for back-of-envelope math without leaving the note (the user's biggest "I keep alt-tabbing to Excel" friction).
- **Cell types** make tables read like proper data: dollar signs, dates, percentages all look right.
- **Freeze rows/cols** lets the user navigate large tables without losing context (header row stays visible when scrolling down a long protocol's reagents list).
- **Custom drag-resize** is the proper fix for the cell-growth bug, not just a workaround.
- **Sort/filter** finishes the "spreadsheet-ish" experience for tables that have many rows.

## Why it's deferred to its own cluster

Each item is non-trivial:

- The formula parser is a lexer + parser + evaluator, ~500 lines. Cell references (`A1`, `B2:B5`), arithmetic operators, parentheses, named functions. Roughly the same effort as a basic templating engine.
- Cell types require a registry of formatters, a per-cell attribute, and a parser to extract the underlying value when editing.
- Freeze panes require careful CSS work + JS for column resizing not to break the sticky positioning.
- The custom resize plugin requires extending or replacing prosemirror-tables internals.

Cluster 18 v1.0 ships items 4 (custom drag-resize) and 1 (formulas). Items 2, 3, 5 land in v1.1+.

## Decisions to lock in (proposed)

- **Custom drag-resize ships first, as Cluster 18 v1.0.** It's the most-needed (fixes a known bug), and once shipped it makes items 1-3 nicer to work on (no more layout-shift when the user is mid-edit).
- **Formula prefix is `=`.** Same as Excel, Sheets, Numbers. Only at the start of a cell's body. The cell's text is stored as-is on disk; on render, if it starts with `=`, the engine evaluates and shows the result in italic + a tooltip showing the formula. Click-to-edit reveals the raw `=` form.
- **Formula references use Excel-style `A1` notation.** Columns by letter (A, B, …, Z, AA, AB, …), rows by 1-based number. Range syntax `A1:B5`. No 3D references (no cross-table refs in v1.0).
- **Functions in v1.0:** `SUM`, `MEAN` (alias `AVG`), `COUNT`, `MIN`, `MAX`, `MEDIAN`, `IF(condition, thenVal, elseVal)`, plus `+`, `-`, `*`, `/`, `^` operators. ~10 functions covers ≥90% of research-notebook math.
- **Cell types in v1.0:** `text` (default), `number`, `money`, `percent`, `date`. v1.1 adds `currency` (per-currency-code) and `custom` (regex-based formatter).
- **Cell type is a per-cell attribute**, not per-column. Set via right-click → "Cell type ▸ Money / Date / …". Per-column would be cleaner data-modeling but harder UX (need a column-header click target). Per-cell is more flexible.
- **Freeze rows and columns are table-level attrs.** `frozenRows: 1`, `frozenCols: 0` typical. Set via right-click → "Freeze first row" or "Freeze first column" toggle.
- **Custom drag-resize is a ProseMirror plugin** that owns its own state (drag in progress, drag start coords, target column index). On mousedown near a cell border, it captures the mouse, listens for mousemove, and dispatches `setNodeMarkup` transactions to update the dragged column's `colwidth` directly. NO `TableView.update` is involved — the plugin doesn't subscribe to view updates.
- **Cluster 16's `Table.configure({ resizable: false })` is reverted via this cluster** because the new plugin replaces the old one. The auto-equalize-on-insert from v1.1.4 stays as a defensive measure.

## Decisions still open

### Formula error display

What happens if a formula fails to parse, references a non-existent cell, or has a div-by-zero? Excel shows `#REF!`, `#DIV/0!`, `#NAME?`. Options:

A. **Excel-style error tags.** Clear and conventional, but unfamiliar to non-spreadsheet users.
B. **Plain "Error: <description>".** More verbose but more readable.
C. **Inline tooltip with the error message + the cell shows "—" or "(error)".**

Going with C, tentatively. Less noisy than A while still surfacing the issue.

### Date format

`2026-04-29` (ISO) is the safe default. Some users want `4/29/2026` or `29 Apr 2026`. Options:

A. **Always ISO.** Simple, unambiguous. Goes against user-friendly UX.
B. **User preference in settings.** Adds complexity.
C. **Per-cell custom format** via cell-type attribute.

C is the most flexible but adds UX. A is simplest. Going with A in v1.0; consider adding format presets in v1.1.

### Formula re-evaluation timing

Options:

A. **On save.** Recompute when the user Ctrl+S's. Simple but stale during typing.
B. **On cell blur.** Evaluate when the cursor leaves the cell. Snappier but may block on every blur.
C. **On every keystroke (debounced 100ms).** Live-update like Excel. Most "magical" but most expensive.

Going with B for v1.0. Simple and predictable. C may be doable later with proper memoization.

### Frozen-cells implementation

`position: sticky` on the cells works, but interacts oddly with `border-collapse: collapse`. Options:

A. **Use `position: sticky` + accept the border quirks.**
B. **Switch the table to `border-collapse: separate`** when freeze is active, with `border-spacing: 0` to fake the same look.
C. **Use a custom layout** — wrap the frozen rows in their own table, etc.

A is simplest, may have minor visual artifacts. C is heaviest. Going with A in v1.0; address artifacts if they bite.

### Sort/filter scope (v1.1)

Sort: stable, sort by clicked column ascending/descending, modifying the underlying ProseMirror doc (re-arranging row nodes). Filter: hide rows that don't match a per-column predicate, via CSS or via an actual doc transformation.

Going with sort first in v1.1 (modifies doc, persists). Filter is harder to round-trip (you'd need to remember the filter state somewhere and re-apply on load). Defer filter to v1.2.

### Custom drag-resize: where is the hit zone?

Options:

A. **Within ~5px of the cell's right border** (matching prosemirror-tables's behavior).
B. **A visible 3px-wide handle that's hit-testable** (like our v1.1.4 visible bar).
C. **Both** — visible bar pluss a 5px buffer for ease of clicking.

C is most usable. Going with C.

### Should the cluster doc detail every formula function?

No. The function set is `SUM`, `MEAN`, `COUNT`, `MIN`, `MAX`, `MEDIAN`, `IF` — semantics match Excel. If a user wants `STDEV` or `VAR`, that's a v1.1 addition. The cluster doc just lists which functions are in v1.0.

## Architecture sketch

### Pass 1 — Custom drag-resize plugin (the bug fix)

```ts
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";

const cortexResizeKey = new PluginKey("cortexColumnResize");

export const cortexColumnResize = new Plugin({
  key: cortexResizeKey,
  state: {
    init: () => ({ dragging: null }),
    apply: (tr, prev) => {
      const meta = tr.getMeta(cortexResizeKey);
      return meta !== undefined ? { ...prev, ...meta } : prev;
    },
  },
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        // Detect if mouse is near a cell's right border.
        // If yes, start a drag: capture window mousemove + mouseup,
        // dispatch setNodeMarkup transactions to update colwidth.
        // ...
      },
    },
  },
});
```

The plugin doesn't use `TableView` (so no per-hover view updates) and doesn't need `displayColumnWidth`. The drag directly modifies the cell node's `colwidth` attr on each mousemove, which the schema's `renderHTML` translates to inline styles.

This eliminates the cell-growth-on-hover bug entirely because there's no per-hover style mutation on the table.

### Pass 2 — Formula engine

A small lexer + parser + evaluator. Probably ~500 lines of TypeScript. Token types: number, string, identifier, range, operator, paren. Parser builds an AST. Evaluator walks the AST against a context object that maps cell references to their values.

```ts
function evaluateFormula(formula: string, ctx: TableContext): FormulaResult {
  const tokens = lex(formula);
  const ast = parse(tokens);
  return evaluate(ast, ctx);
}

interface TableContext {
  cellAt(col: number, row: number): string;
  rangeAt(start: { col: number; row: number }, end: { col: number; row: number }): string[];
}
```

Cell references resolve to the cell's text content (or its formula's evaluated result, if the cell itself has a formula — recursive but bounded by table size).

Formula AST is cached on the cell's `formulaResult` attr; recomputed on cell blur. Render path: if cell has a formula, show its `formulaResult` italic; click-to-edit reveals the raw formula text.

### Pass 3 — Cell-type formatter

A registry of named formatters:

```ts
const formatters: Record<string, (raw: string) => string> = {
  number: (raw) => Number(raw).toLocaleString(),
  money: (raw) => `$${Number(raw).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
  percent: (raw) => `${(Number(raw) * 100).toFixed(1)}%`,
  date: (raw) => new Date(raw).toISOString().split("T")[0],
};
```

Per-cell `cellType` attribute drives which formatter applies. Default `text` (no formatter, raw value passes through).

Right-click context menu adds a "Cell type" submenu with each formatter as an option. Selecting one sets the attribute via `updateAttributes`.

The underlying cell text remains plain — the formatter only affects the rendered display. Click-to-edit reveals the raw text.

### Pass 4 — Freeze rows / cols

Table-level attributes `frozenRows: number` and `frozenCols: number`. Default 0.

CSS:

```css
.cortex-table {
  position: relative;
}
.cortex-table th[data-frozen-row], .cortex-table td[data-frozen-row] {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-deep);
}
.cortex-table th[data-frozen-col], .cortex-table td[data-frozen-col] {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-deep);
}
.cortex-table th[data-frozen-row][data-frozen-col],
.cortex-table td[data-frozen-row][data-frozen-col] {
  z-index: 3;
}
```

The `data-frozen-row` / `data-frozen-col` attributes are set on cells whose row index < `frozenRows` or column index < `frozenCols`. Computed in the table NodeView (or via a decoration) during render.

Right-click → "Freeze first row" / "Unfreeze first row" toggles `frozenRows` between 0 and 1. Same for columns.

### Pass 5 — Sort (v1.1 candidate)

Right-click on a cell → "Sort column ascending / descending / clear". Detects the column from the cell's position via `TableMap.findCell`. Walks the table's row nodes, sorts them by the column's value, dispatches a transaction that replaces the table's content with the sorted rows.

Cell type drives sort comparison: `number` and `money` sort numerically, `date` sorts chronologically, `text` sorts lexicographically.

### Pass 6 — Verify, NOTES, overview, tag

Standard cluster-completion routine.

## What this cluster doesn't include

- **Multi-table formulas.** No `=Sheet1!A1` cross-table references. Out of scope.
- **Formulas in cells outside tables.** Only inside table cells. Markdown body math is its own thing (and there's `katex` if needed someday).
- **Charting.** Bar charts, line charts of cell ranges. Major UX work; defer to a separate cluster (Cluster 19?) if there's demand.
- **CSV import / export.** Click-to-paste or file-drop to populate a table from a CSV. Useful but a separate concern.
- **Cell-level history.** No "undo this cell value to N versions ago." Markdown-level undo via TipTap is sufficient.
- **Conditional formatting.** "Color this cell red if value > 100." Common in Excel but not a typical research-notebook need.

## Prerequisites

Cluster 16 v1.1+ — the HTML table serializer, equalize column widths, per-cell `colwidth` attribute, vertical alignment.

## Triggers to build

- "I keep alt-tabbing to Excel for quick math on table values." (Original Cluster 16 trigger.)
- "My tables look bad without dollar signs / dates formatted properly." (Same.)
- "Long tables are unusable when the header scrolls away." (Common enough that freeze panes is a basic ask.)
- The cell-height growth bug from v1.1.4 — Cluster 18's custom drag-resize is the proper fix.

## Effort estimate

**Cluster 18 v1.0 (custom drag-resize + formulas) — ~2 days**, six passes:

- Pass 1 (~3 hr): custom drag-resize plugin replacing prosemirror-tables's columnResizing.
- Pass 2 (~6 hr): formula engine — lexer + parser + evaluator + cell-render integration.
- Pass 3 (~2 hr): formula UI — click-to-edit, italic display of result, error tooltip.
- Pass 4 (~1 hr): right-click menu integration for "Insert formula" template.
- Pass 5 (~30 min): integration test on a real table.
- Pass 6 (~30 min): verify, NOTES, overview, tag `cluster-18-v1.0-complete`.

**Cluster 18 v1.1 (cell types + freeze) — ~1.5 days**, four passes:

- Pass 1 (~3 hr): cell-type registry + per-cell attribute + right-click menu.
- Pass 2 (~3 hr): freeze rows/cols implementation + CSS sticky positioning.
- Pass 3 (~1 hr): integration testing.
- Pass 4 (~30 min): verify, NOTES, overview, tag `cluster-18-v1.1-complete`.

**Cluster 18 v1.2 (sort) — ~1 day** if demand surfaces.

## What this enables

- **Cluster 14 (planned-vs-actual analytics)** can use formulas to compute aggregates over events and time-tracking data.
- **Cluster 7 (concept graph)** doesn't directly use this, but a cleaner editor experience overall is a nice-to-have.
- **External integrations.** Once formulas exist, importing data from a CSV or copy-pasting from Excel produces a sensible result.
- **Daily-friction wins.** The user can compute totals, averages, percentages without leaving Cortex.

## Open questions to revisit during build

1. The custom drag-resize plugin's hit-detection — is 5px wide enough to feel responsive without making boundaries hard to drag accurately? May need user testing.
2. Formula evaluation: should circular references (A1=B1, B1=A1) error out cleanly, or silently break? Excel detects and shows `#CIRCULAR`. Recommend matching that.
3. Cell-type formatting: should the formatter run on the raw text or on the formula's result? E.g., a cell with `=SUM(A1:A5)` and `cellType: money` — does the result get `$` prefix? Yes, makes sense. Document this.
4. Freeze panes: how do we surface "this row/col is frozen" visually? A border accent? A small lock icon? Probably an accent border on the freeze edge.
5. Should we re-enable prosemirror-tables's column-resize plugin and write our own to LIVE ALONGSIDE? Or fully replace it? Replace is cleaner; coexistence risks the original bug coming back.
6. Migration: existing tables in the user's vault don't have cell types or freeze attributes. Default to `text` / `frozenRows: 0 / frozenCols: 0`. No migration needed.
