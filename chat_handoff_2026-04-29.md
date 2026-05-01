# Chat handoff — 2026-04-29

A summary of everything done in the long working session that ended
2026-04-29 evening. Written for the next chat or future me, so the
state of the repo, the design rationale, and the open issues are all
in one place.

If you want the **short version**: the session shipped Cluster 16
through tag `cluster-16-v1.1.4-complete`. That covers the QoL pack
(table polish, wikilink shortcut, Ctrl+S fix, multi-type blocks),
plus the v1.1 typed-block routing, plus the v1.1.4 patch series
(two-way sync, drag-to-resize, calendar all-day row). One bug is
still open — cell heights grow on hover near a column boundary for
tables that don't have explicit `colwidth` on every cell. Workaround
is documented; proper fix is in `cluster_18_table_excel_layer.md`.

The next two clusters that have docs ready but no implementation:

- `cluster_17_block_widget_rewrite.md` — convert `::TYPE NAME` blocks
  to a real TipTap custom node so they hold bullets, tables, and are
  non-editable as a widget.
- `cluster_18_table_excel_layer.md` — `=MEAN(C1:C3)` style formulas,
  per-cell type formatting, freeze rows/cols, AND the custom
  drag-resize plugin that fully eliminates the cell-growth bug.

---

## What shipped, in order

### Cluster 16 v1.0 — QoL pack

Tag `cluster-16-v1.0-complete`. Six small daily-friction items
bundled into one ship:

1. **Ctrl+S no longer scrolls to the bottom of the document.** Root
   cause was an escaped/unescaped wikilink-bracket mismatch in
   Editor.tsx's content effect: `getMarkdown()` returns
   `\[\[Foo\]\]` while `editedBody` holds the unescaped form, so the
   comparison saw "different" content and triggered a `setContent`
   that reset scrollTop to 0. Fix: apply `unescapeWikilinkBrackets`
   to the comparison side.
2. **Ctrl+Shift+W = wikilink shortcut.** With selected text, wraps
   in `[[…]]`. With no selection, opens the command palette in
   pick-mode — clicking a result inserts `[[Title]]` at the cursor
   instead of opening the file. New `wrapSelectionInWikilink` and
   `insertWikilinkAt` methods on `TabPaneHandle`. New optional
   `onPickResult` prop on `CommandPalette`.
3. **Drag-resize column dividers re-enabled.** `Table.configure({
   resizable: true, handleWidth: 5 })`.
4. **Right-click → Equalize column widths.** Walks the doc, sets
   each cell's `colwidth` to `floor(table_width / column_count)`.
   Uses the table's actual rendered width via
   `view.nodeDOM(tablePos).getBoundingClientRect().width`.
5. **Right-click → Cell alignment ▸ Top / Middle / Bottom.** Per-cell
   custom attribute via `ValignTableCell` and `ValignTableHeader`
   extensions extending TipTap's TableCell / TableHeader. Renders
   as inline `style="vertical-align: …"`.
6. **Multi-type block modal.** `Ctrl+Shift+B` opens a modal with a
   Type dropdown: Experiment / Protocol / Idea / Method. Each
   generates the corresponding `::TYPE NAME` opener and `::end`
   closer. `ExperimentBlockDecoration` regex split: separate regex
   for `::experiment NAME / iter-N` (Cluster 4 routing) vs
   `::(protocol|idea|method) NAME` (visual only in v1.0).

### Cluster 16 v1.1 — Bug fix patch + protocol/idea/method routing

Tag `cluster-16-v1.1-complete`. User reported v1.0 bugs after a day
of dogfooding, plus asked for protocol/idea/method blocks to route
into their corresponding log documents (mirroring Cluster 4's
experiment routing).

- **HTML table serializer.** Tables now serialize as raw `<table>`
  HTML via ProseMirror's `DOMSerializer.fromSchema`. Pipe-table
  markdown has no slot for column widths or vertical alignment, so
  v1.0 silently dropped both on save. v1.1 emits HTML, which round-
  trips through `tiptap-markdown`'s `html: true` parser.
- **Equalize uses real rendered width** instead of hardcoded 150px.
- **Equalize scoped to selected columns.** When the editor has a
  CellSelection, restricts equalisation to the columns the
  selection spans.
- **Right-click handler preserves an active CellSelection** so
  "Merge cells" appears in the menu. v1.0 unconditionally collapsed
  any drag-selection back to a TextSelection on right-click,
  silently breaking merge.
- **Resize handle CSS.** Tightened so cross-cell drag-select isn't
  broken by the handle absorbing mousemove.
- **TableContextMenu repositioning.** `useLayoutEffect` measures the
  rendered rect and clamps top/left into the viewport. `max-height:
  80vh; overflow-y: auto`. `z-index: 5000`.
- **Backend route_typed_blocks.** New `typed_block_routings` table
  + `extract_typed_blocks` + `find_typed_target_path` +
  `regenerate_typed_target_auto_section`. Splices block content
  into a `## From daily notes` section in the chosen 04-Ideas/,
  05-Methods/, or 06-Protocols/ file.
- **BlockModal picks existing log entries.** Free-text input
  replaced with a dropdown driven by `query_notes_by_type`.

### Cluster 16 v1.1.1 → v1.1.4 — Bug-fix iterations

Tag `cluster-16-v1.1.4-complete`. User reported four issues after
v1.1: cell heights growing on hover, no col-resize cursor, two-way
edits not propagating, drag-to-resize regressed (after the v1.1.3
workaround), and the calendar's month/week views diverging. Four
sub-versions over the course of an evening, with the cell-growth
bug still partially open.

- **v1.1.1 — Two-way sync + cursor + first cell-growth attempt.**
  Per-block CORTEX-BLOCK markers in the typed auto-section. New
  `propagate_typed_block_edits` Tauri command compares per-block
  content against the routings table and surgically replaces the
  matching `::TYPE NAME / ::end` block in the source daily note
  when a document edit is detected. `replace_daily_note_typed_block`
  walks the daily note line-by-line (no re-serialization). Cursor
  rule `.ProseMirror.resize-cursor { cursor: col-resize }`.
- **v1.1.2 — `display: none` on the resize handle.** Theory was
  the widget's DOM mutation was the layout-shift trigger.
  Confirmed wrong; cell growth persisted with the handle hidden.
- **v1.1.3 — Disable columnResizing entirely.** `resizable: false`.
  Cell growth gone, but drag-to-resize gone too.
- **v1.1.4 — Re-enable + auto-equalize on insert.** Diagnosed the
  root cause via reading prosemirror-tables 1.8.5 source: the
  cell-growth is `updateColumnsOnResize`'s `defaultCellMinWidth =
  100px` fallback for cells without explicit `colwidth`. Auto-
  equalize on table creation gives every cell an explicit width
  from the start. Plus calendar all-day row added to WeekView.

The full history of the bug hunt and unresolved bits is in
`declercq-cortex/NOTES.md` under "Phase 3 — Cluster 16 v1.1.1 →
v1.1.4 — Bug-fix iterations".

---

## Open issues — ordered by importance

### 🔴 1. Cell-height growth on hover (pre-v1.1.4 tables)

Tables that were created before v1.1.4 don't have explicit
`colwidth` on their cells, so prosemirror-tables's
`updateColumnsOnResize` falls back to `defaultCellMinWidth = 100px`
on every per-hover view update. The browser then re-runs layout
with the new fallback widths and empty cells visibly grow.

Workaround: right-click → Equalize column widths on each affected
table (one-time per table; the explicit colwidths persist via the
HTML serializer).

Proper fix candidates (none built yet):

- **Auto-equalize on document load** if any table has cells without
  colwidths. One-time per document; would migrate all stale tables
  silently the next time the user opens a file.
- **Custom drag-resize plugin** (preferred long-term — captured in
  `cluster_18_table_excel_layer.md`). A small ProseMirror plugin
  that detects mousedown near a cell border and dispatches a
  `setNodeMarkup` transaction directly. No `TableView.update` in
  the hot path; no per-hover layout shift regardless of whether
  cells have widths.
- **Default-width injection at parse time.** When the HTML parser
  sees a `<td>` without `data-colwidth`, inject a default. Awkward
  because per-cell parsing doesn't know the table's column count.

### 🟡 2. CORTEX-BLOCK markers visible in raw markdown

`<!-- CORTEX-BLOCK src="…" idx="…" -->` and `<!-- /CORTEX-BLOCK -->`
show up if the user opens a protocol/idea/method file in a plain
markdown viewer outside Cortex. HTML comments don't render so they
don't appear in formatted output, but they're visible in raw text.

Will be addressed in Cluster 17's block widget rewrite — the right
home to revisit how routed sections surface.

### 🟡 3. Two-way sync race on simultaneous edits

If pane A has the daily note open (with `::protocol Foo / ::end`)
and pane B has the protocol document open with unsaved typed
changes, and the user saves the daily note FIRST, the regen
overwrites pane B's unsaved content (because the propagator only
sees on-disk data).

Mitigation: save the document before the daily note. Proper fix
would require pane-level dirty-buffer awareness in the propagator,
which is overkill for v1.

### 🟡 4. Pre-existing typed routings (v1.1.0 format) are read-only

Auto-sections in protocol/idea/method documents that were generated
under v1.1.0 use the old `### From [[X]]` + `---` separator format,
which has no per-block markers. The propagator finds zero markers
and returns 0 — no propagation from those documents.

Auto-migration: the next time the user saves the corresponding
daily note, `route_typed_blocks` regenerates the auto-section in
the new format. From that point on, bi-directional sync works for
that document. One-time, invisible.

### 🟢 5. All-day row in WeekView doesn't auto-set `all_day: true`

Clicking an empty all-day cell opens the EventEditModal with
`start = midnight, end = next-midnight` but `all_day` is not pre-
toggled. The user has to flip the All-day checkbox manually.

Trivial fix in a future ship: extend `onSlotDraft` to accept an
`allDayHint` flag, and have EventEditModal default `all_day = true`
when the hint is set.

### 🟢 6. Old pipe-tables migrate to HTML on first re-save

This is a one-way migration. If a vault has tables that were
carefully formatted as GFM pipe markdown for compatibility with
external viewers, they become HTML on first save under v1.1+.
v1.0 tables that haven't been re-saved are unaffected.

Acceptable; user explicitly chose "always emit HTML" over a
conditional approach during the v1.1 design conversation.

---

## Architectural decisions worth carrying forward

### Cortex's pacing rule still works

The "1.5 days max per cluster, then go back to using the app for at
least a week" convention from `phase_2_overview.md` continues to
hold up. Cluster 16 v1.0 was 1.5 days and shipped clean. v1.1 was
~1.5 days and shipped. The v1.1.x patches were each tiny because
they were responding to specific user reports during dogfooding —
the right pattern.

When Cluster 16 looked like it might balloon to 3 days (the user
asked for table formulas + cell types + custom widgets all
together), the conversation explicitly sliced it into 16 (QoL),
17 (widget), 18 (Excel layer). That kept each cluster scoped.
Maintain that discipline.

### "Doc-first" really helped

Cluster 16's doc captured the design choices BEFORE writing code,
including which features to defer. That meant when ambiguity came
up during implementation (e.g., "should the resize handle be
visible or hidden?"), there was a written reference. Recommend
sticking with this for 17 / 18.

### Trial-journal-driven build pace

The user's pattern through this session was: build a feature, use
it for hours, report friction, patch. v1.1 → v1.1.1 → v1.1.4 is
this pattern in concentrated form. Honor that pattern: don't
speculatively build features the user hasn't asked for.

### Prosemirror-tables is a leaky abstraction

The cell-growth bug taught a lesson: the columnResizing plugin
has implicit assumptions (cells with explicit widths) that aren't
documented in TipTap's docs. Reading prosemirror-tables 1.8.5
source was necessary to find the root cause. For Cluster 18's
custom drag-resize, plan on going under the hood — extending
prosemirror-tables's plugins, not just configuring TipTap.

### Two-way sync via per-block markers

The CORTEX-BLOCK marker pattern (HTML comments embedding the
routing's primary key) generalizes. If Cluster 17 / 18 adds more
auto-sections to documents, the same pattern applies: emit a
machine-readable marker around each piece of routed content; on
save, parse the markers, compare to a routings table, propagate
deltas. Don't re-invent.

### Test by saving + reopening

The Ctrl+S scroll-jump bug, the column-width-not-persisting bug,
and the vertical-align-not-persisting bug were ALL caught by the
same test: write something, save, close, reopen, see if it's the
same. Nothing fancy. This single workflow is the highest-yield
manual test for a markdown editor.

---

## File map — what was touched in this session

### Files modified

- `declercq-cortex/src/components/Editor.tsx` — table extension
  config, `HtmlTable` HTML serializer, `equalizeColumnWidths` rewrite,
  `equalizeTableColumnWidths` exported wrapper, `ValignTableCell` /
  `ValignTableHeader` extensions, `handleContextMenu` CellSelection
  preservation.
- `declercq-cortex/src/components/TabPane.tsx` — `wrapSelectionInWikilink`
  / `insertWikilinkAt` methods, `insertExperimentBlock` widening to
  multi-type, `insertTable` auto-equalize, `propagate_typed_block_edits`
  call-site, `route_typed_blocks` call-site.
- `declercq-cortex/src/components/ExperimentBlockModal.tsx` — type
  dropdown, existing-entry dropdowns for protocol/idea/method.
- `declercq-cortex/src/components/TableContextMenu.tsx` — equalize +
  valign menu items, viewport-clamping `useLayoutEffect`,
  scrollable, z-index bump.
- `declercq-cortex/src/components/CommandPalette.tsx` — `onPickResult`
  prop, pick-mode banner.
- `declercq-cortex/src/components/Calendar.tsx` — all-day row in
  WeekView + supporting styles.
- `declercq-cortex/src/components/ShortcutsHelp.tsx` — Ctrl+Shift+W
  documentation.
- `declercq-cortex/src/App.tsx` — `wikilinkPickMode` state, new
  Ctrl+Shift+W keyboard branch, ExperimentBlockModal `onConfirm`
  signature.
- `declercq-cortex/src/editor/ExperimentBlockDecoration.ts` —
  `EXPERIMENT_HEADER_RE` + `SIMPLE_HEADER_RE` regex split.
- `declercq-cortex/src/index.css` — table cell + handle CSS
  (iterated through several states), `.ProseMirror.resize-cursor`
  rule, `.tableWrapper { overflow: visible }`, `.selectedCell`
  styling, all-day row styles.
- `declercq-cortex/src-tauri/src/lib.rs` — `typed_block_routings`
  table schema + index, `extract_typed_blocks`,
  `find_typed_target_path`, `regenerate_typed_target_auto_section`,
  `route_typed_blocks` Tauri command, `extract_typed_auto_section`,
  `parse_auto_section_blocks`, `replace_daily_note_typed_block`,
  `propagate_typed_block_edits` Tauri command, `capitalize_ascii`,
  invoke_handler! registrations.

### Files created (project root)

- `cluster_16_qol_pack.md` — original cluster doc.
- `cluster_17_block_widget_rewrite.md` — next cluster, planned.
- `cluster_18_table_excel_layer.md` — cluster after that, planned.
- `chat_handoff_2026-04-29.md` — this file.

### Files created (declercq-cortex)

- `verify-cluster-16.ps1` — v1.0 verify script.
- `verify-cluster-16-v1.1.ps1` — v1.1 verify script.
- `verify-cluster-16-v1.1.4.ps1` — v1.1.4 (final) verify script.

### Tags created

- `cluster-16-v1.0-complete`
- `cluster-16-v1.1-complete`
- `cluster-16-v1.1.4-complete` ← the latest, what to base future
  work on.

---

## What to start with in the next session

1. **Read `declercq-cortex/NOTES.md`** in particular the "Phase 3
   — Cluster 16 v1.1.1 → v1.1.4 — Bug-fix iterations" section.
   That has the full chronology of the cell-growth bug hunt and
   the unresolved candidates for the proper fix.

2. **Decide the next cluster.** Two are docced and ready:
   - Cluster 17 (block widget rewrite) — would also let us drop
     the `<!-- CORTEX-BLOCK -->` markers in favor of native node
     attrs, and could revisit the auto-section UI.
   - Cluster 18 (Excel layer) — the natural home for a custom
     drag-resize plugin that fully fixes the cell-growth bug.

   If the user is still hitting the cell-growth bug daily, **start
   with Cluster 18**. The Excel layer is a 3-4 day cluster, but
   the custom drag-resize is a 1-day extraction that could ship
   first as Cluster 18 v1.0 (resize-only), with the formula /
   cell-type / freeze work as v1.1+.

   If the user wants block widgets first, **start with Cluster 17**.

3. **Don't re-litigate the v1.1.x decisions.** Two-way sync,
   auto-equalize-on-insert, calendar all-day row — those are all
   shipped and stable. The cell-growth workaround (Equalize once
   per stale table) is documented and acceptable until Cluster 18
   ships.

4. **Honor the "1-week of dogfooding between clusters" rule** if
   the user hasn't been actively using Cortex since the last ship.
   Otherwise build.

5. **Verify the calendar all-day row works for Google Calendar
   events too.** I tested with manually-created all-day events but
   didn't verify with a Google sync. Should "just work" because
   the WeekView treats all events the same regardless of `source`,
   but worth a confirmation pass.
