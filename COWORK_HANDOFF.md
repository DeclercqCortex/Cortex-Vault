# Cowork session handoff — multi-tab layout (Cluster 6 v1.5)

This doc is the briefing for the next Cowork session. It's a snapshot
of where Cortex stands, the architecture you're inheriting, the
standard dev/ship workflow on this repo, and what to watch for when
starting the next cluster.

---

## Repo layout (read this first)

The repo has a quirk: **the git root is one level above the app
folder**.

```
C:\Declercq Cortex\          ← git repo root, has `.git/`, has `origin`
├── phase_2_overview.md      ← cluster planning + status (project-level)
├── COWORK_HANDOFF.md        ← this file
├── declercq-cortex\         ← Tauri app (npm scripts, Cargo, sources)
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tauri.conf.json (under src-tauri/)
│   ├── src/                 ← React/TS frontend
│   ├── src-tauri/           ← Rust backend (lib.rs is the big one)
│   ├── NOTES.md             ← cumulative architectural decisions
│   └── verify-cluster-N.ps1 ← one per cluster, smoke + commit + tag
```

This means: `pnpm install`, `pnpm tauri dev`, `cargo` commands all run
from `C:\Declercq Cortex\declercq-cortex`. But `git` and any `git push`
work from `C:\Declercq Cortex`.

The verify scripts are written so they handle this correctly (they
`Set-Location $PSScriptRoot` to run prettier/cargo, but `git add .` and
`git commit` walk up to find the `.git/` at the outer level
automatically).

> Earlier in the session a stray inner `.git/` had appeared inside
> `declercq-cortex\`. If you ever see "fatal: No configured push
> destination" while running git from inside that folder, that's the
> sign — `Remove-Item -Recurse -Force "C:\Declercq Cortex\declercq-cortex\.git"`
> and re-run the verify script from PowerShell.

---

## Standard dev + ship protocol

Open two PowerShell windows.

**Window 1 — dev loop (always open while working):**

```powershell
cd "C:\Declercq Cortex\declercq-cortex"
pnpm tauri dev
```

Vite hot-reloads the frontend on save. **Cargo / Tauri config changes
require a full restart** (Ctrl+C the dev server, re-run
`pnpm tauri dev`):
- Anything in `src-tauri/src/*.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/*.json`

If a Cargo change refuses to pick up cleanly, do
`cd src-tauri && cargo clean && cd .. && pnpm tauri dev`.

**Window 2 — git + verify (run when shipping a cluster):**

```powershell
# Verify scripts live inside declercq-cortex/ but write through to the
# outer git root. Run them from there:
cd "C:\Declercq Cortex\declercq-cortex"
.\verify-cluster-N.ps1     # prettier, cargo fmt, cargo check, commit, tag

# Then push from the OUTER folder where origin lives:
cd "C:\Declercq Cortex"
git push
git push origin <tag-name> --force
```

`--force` on the tag is intentional — verify scripts use `git tag -f`
so re-running ships fixups under the same tag. If you'd rather start
preserving history, bump to `cluster-N-v1.X.Y-complete` inside the
verify script before pushing.

**Confirming a push landed:**

```powershell
cd "C:\Declercq Cortex"
git log --oneline -5
git tag --list
git ls-remote --tags origin | Select-String "cluster-"
```

The remote-tags line is the ground truth.

---

## What shipped in this session (Cluster 6 v1.4 → v1.5)

### v1.4 (already shipped before this session started)
- Full PDF reader: render, annotations in 7 colors, sidecar JSON,
  marks-table integration, FTS5 indexing, `::reading` block populator,
  annotations panel, link-to-note popup, in-PDF Ctrl+K search bubble
  with arrows / list / normalization, two-page view, collapsible
  sidebar.
- Tag: `cluster-6-v1.4-complete`.

### v1.5 (the multi-tab layout, shipped this session)

**New components:**
- `src/components/TabPane.tsx` — owns all per-file state for one
  pane: `selectedPath`, `activeView`, `frontmatter`, `fileBody`,
  `editedBody`, `dirty`, `loadingFile`, plus the TipTap editor
  instance ref. Exposes a `TabPaneHandle` via `forwardRef` +
  `useImperativeHandle`:
  ```ts
  type TabPaneHandle = {
    saveIfDirty(): Promise<boolean>;
    reload(): Promise<void>;            // saves dirty, then re-reads from disk
    insertExperimentBlock(name, iter): void;
    insertTable(rows, cols, withHeaderRow): void;
    openPath(path: string | null): Promise<void>;
    setActiveView(view: ActiveView): void;
    getPath(): string | null;
    getActiveView(): ActiveView;
    getDirty(): boolean;
    getDirtySnapshot(): { selectedPath, frontmatter, editedBody };
    isEditorFocused(): boolean;
  };
  ```
- `src/components/LayoutPicker.tsx` — top-right widget. Five layouts:
  single, dual, tri-bottom, tri-top, quad. Each option has a
  miniature CSS-grid preview icon. Selection persists via
  `localStorage`.
- `src/components/LayoutGrid.tsx` — CSS-Grid container with V/H
  divider strips. Dividers are draggable (live resize, clamp 0.15–
  0.85) and double-click to equalize (reset fraction to 0.5). Quad
  uses four distinct grid-area shards (`v1`/`v2`/`h1`/`h2`) all
  driven by the same `colFrac`/`rowFrac` so they move in sync —
  named areas in CSS Grid must be rectangular, which is why the
  first quad attempt silently broke until shards were split.
- `src/components/SlotPicker.tsx` — modal that asks "open in which
  slot?" when a search palette result is clicked while a multi-slot
  layout is active. Press 1–4 to pick by keyboard.
- `PaneWrapper` (inline in `App.tsx`) — wraps each `TabPane` with
  drag-drop file routing. **Capture-phase handlers** (`onDragOverCapture`,
  `onDropCapture`, etc.) so TipTap's bubble-phase listeners don't
  consume the drop. Calls `stopPropagation()` + `preventDefault()`.

**Major App.tsx refactor:**
- Removed all per-file state and effects (now in `TabPane`).
- New state: `layoutMode`, `colFrac`, `rowFrac`, `slotPaths[]`,
  `slotViews[]`, `slotDirty[]`, `activeSlotIdx`, `paneRefs`,
  `activeSlotIdxRef` (synced via `activatePane()` to dodge React's
  stale-closure trap).
- New orchestrator `selectFileInSlot(path, slotIndex)` runs the
  cross-cutting regen passes (persistent destinations, methods
  reagents, daily-log populator) once before delegating to a slot's
  `openPath`. Wikilink-follow, daily-log open, palette pick, and
  ReviewsMenu destinations all funnel through it.
- New router `handleTreeClick(path, ctrlClick)`: plain click → active
  slot; Ctrl/Cmd+Click → next slot in slot order, wrapping. Tri/quad
  also use drag-and-drop into a specific slot.
- `Ctrl+R` is intercepted globally and routed to the active slot's
  pane handle (was previously the browser's reload).
- `Ctrl+S` saves only the active slot.
- Save-on-close + save-on-blur fan out across **every** mounted pane,
  including hidden-stash ones (panes beyond `slotCount` stay mounted
  in a `display: none`-style stash so layout shrinks don't lose
  state and the close handler still finds dirty work in any of
  them).

**Modified components:**
- `src/components/FileTree.tsx`
  - `onSelectFile(path, opts?)` — opts forwards `ctrlClick` so the
    router can route Ctrl/Cmd+Click into the next slot.
  - File rows are `draggable` and set
    `dataTransfer.setData("text/cortex-path", path)`. We deliberately
    **do not** set `text/plain` — TipTap accepts text drops and would
    insert the filename as a string if our capture-phase intercept
    ever missed.
- `src/components/ShortcutsHelp.tsx` — Ctrl+R, click vs Ctrl+Click vs
  drag-tree behaviors documented.
- `src/components/PDFReader.tsx`
  - `wrap` style got `position: relative`.
  - `searchBubble` style went from `position: fixed` (window-anchored)
    to `position: absolute` with `top: 12px; right: 12px` so the
    Ctrl+K bubble pins to **its own tab**, not the global window
    top-right.
- `src/index.css` — `.pdf-pages-single` and `.pdf-pages-two` got
  `min-width: max-content` so zoomed-in pages expand the container
  instead of bleeding off the unreachable left side. `TabPane` also
  drops its `1.5rem` padding when `activeView === "pdf-reader"` so
  the page can use the full slot edge-to-edge.
- `src-tauri/tauri.conf.json` — **`"dragDropEnabled": false`** on the
  window. **This was the root cause of drag-drop not working at
  all.** Tauri 2 on Windows enables OS-level file drag-drop by
  default, which intercepts every drag-drop event before the WebView
  ever sees it. Setting this to false hands drag-drop to the
  WebView, which is what makes our HTML5 capture-phase handlers
  fire.

**Tag:** `cluster-6-v1.5-complete`.

---

## Architecture you're inheriting

### Where each kind of state lives

| Concern                              | Location                                  |
| ------------------------------------ | ----------------------------------------- |
| Open file path, frontmatter, body    | `TabPane` per-pane state                  |
| Editor instance ref                  | `TabPane.editorInstanceRef`               |
| Dirty flag, autosave, commit timer   | `TabPane`                                 |
| `vaultPath`, `indexVersion`, `refreshKey` | `App`                                |
| Layout mode + col/row fractions      | `App`, persisted to `localStorage`        |
| Active slot                          | `App` state + `activeSlotIdxRef` (synced) |
| Modals (palette, hierarchy, table, block, slot picker) | `App`           |
| Theme, sidebar collapsed, color legend | `App`, all persisted to `localStorage`  |

### How a file ends up open in a pane

```
user click in FileTree
   → FileTree.onClick(path, { ctrlClick })
   → App.handleTreeClick(path, ctrlClick)
       chooses slotIndex (active or next)
   → App.selectFileInSlot(path, slotIndex)
       runs cross-cutting regen (persistent / methods / daily-log)
   → paneRefs[slotIndex].current.openPath(path)
       saves dirty if needed
       sets activeView to "pdf-reader" or "editor" based on extension
       sets selectedPath
   → TabPane's [selectedPath, reloadTick] effect reads the file
   → editor / PDFReader / ... renders
```

Every other entry point (palette, ReviewsMenu, wikilink-follow,
daily-log open, hierarchy-modal `onCreated`) lands at
`selectFileInSlot`. Don't add a parallel path; route through it.

### How shortcuts pick a target

| Chord          | Target                                         |
| -------------- | ---------------------------------------------- |
| `Ctrl+S`       | active slot's `saveIfDirty`                    |
| `Ctrl+R`       | active slot's `reload`                         |
| `Ctrl+D`       | opens today's daily log in active slot          |
| `Ctrl+K`       | command palette (or PDF in-pane search if active slot is PDF) |
| `Ctrl+Shift+B` | active slot's `insertExperimentBlock`          |
| `Ctrl+Shift+T` | active slot's `insertTable`                    |
| Hierarchy `Ctrl+N` / `Ctrl+Shift+P/E/I` | hierarchy modal — gated on **no editor anywhere having focus** |
| `Esc`          | closes any open modal                          |

The "any editor anywhere" gate is `isAnyEditorFocused()` in
`App.tsx` — a `document.activeElement.closest('.ProseMirror')` check
that handles the multi-pane case generically.

---

## Implications for the next cluster

### Where to add new things

| Adding…                                  | Land it in…                                         |
| ---------------------------------------- | --------------------------------------------------- |
| A new structured view (like Idea Log)    | New file in `src/components/`. Add the `ActiveView` literal in `TabPane.tsx`. Render branch in `TabPane`'s render. Sidebar button in `App.tsx` calls `paneRefs.current[activeSlotIdxRef.current]?.setActiveView(...)`. |
| A new Tauri command                      | `src-tauri/src/lib.rs` — register in `invoke_handler`. Frontend calls via `invoke<...>("name", { args })`. Naming convention: `snake_case` Rust function, camelCase args (Tauri does the conversion). |
| A new hierarchy kind                     | Extend `HierarchyKind` in `NewHierarchyModal.tsx`. Add a Rust `create_X` command. Wire a `+ X` sidebar button + an `Open X` view button in `App.tsx`. The `onCreated` callback already routes through `selectFileInSlot(path, activeSlotIdx)`. |
| A new modal                              | Component lives in `src/components/`. State (`isOpen`) lives in `App.tsx`. If it operates on the active editor, it dispatches to `paneRefs.current[activeSlotIdx]?.someMethod(...)`. **Never** reach into a TabPane's internal state — always go through the handle. |
| A new per-pane action (verb the user does inside one pane) | Add a method to `TabPaneHandle` in `TabPane.tsx`. Implement in `useImperativeHandle`. Make sure to add the new state vars to its deps array if the method reads state. |
| A new global action that touches the vault but not a specific file | Tauri command + a sidebar button. No pane involvement. |
| A new keyboard shortcut                  | Append to the keydown handler in `App.tsx`. If it acts on the active pane, dispatch via `paneRefs.current[activeSlotIdx]`. **Add the row to `ShortcutsHelp.tsx`** in the right section (Always / Sidebar mode / Editor mode). |
| A new file-tree feature (e.g. context menu on a row) | `FileTree.tsx`. Forward whatever the user picks via the existing `onSelectFile` callback — extend its `opts` rather than adding a parallel callback. |

### Patterns to mirror, not reinvent

- **Cross-cutting regen on file open** (Cluster 3 persistent files,
  Cluster 8 Methods reagents, Cluster 6 reading-log populator) all
  live as branches inside `App.selectFileInSlot`. Adding another
  follows the same shape: detect via path prefix or extension, await
  a Tauri regen command, then delegate to the pane's `openPath`.
  Idempotent regen + "no-op when computed content matches disk" is
  the shared rule across all three.
- **Section-scoped auto-markers** (`<!-- X-AUTO-START -->` …
  `<!-- X-AUTO-END -->`) — used by Cluster 8 to own the Reagents
  table inside a Method file without owning the rest. Reuse the
  same comment shape.
- **Sidecar JSON files next to the asset** — used by PDFs
  (`.annotations.json`). Pattern: `<file>.<feature>.json`,
  pretty-printed, schema versioned, `#[serde(default)]` on every new
  field for forward-compat.
- **`tiptap-markdown` + `html: true`** — mark colors and alignment
  round-trip through HTML inside markdown bodies. New rich-text
  features should follow the same pattern (custom mark or attribute
  → emit HTML via the markdown serializer override → preserve on
  reload).
- **FTS5 single source of truth** — `notes` table, both markdown
  and PDFs. New searchable surfaces should reuse it via
  `index_single_file` rather than introducing a parallel index.

### Watch-outs

- **TabPane handle deps array** — the `useImperativeHandle` deps in
  `TabPane.tsx` include `[selectedPath, activeView, dirty,
  editedBody, frontmatter]`. If you add a method that reads any
  other state, **add it to the deps** or the method will read stale
  values via closure.
- **`activeSlotIdxRef`** — when adding event handlers that need to
  know the active slot, prefer `activeSlotIdxRef.current` over the
  React state. The state is correct in render but lags behind in
  immediate-after-click handlers.
- **Hidden-stash mounting** — all `MAX_SLOTS` panes are always
  mounted. New view components inside `TabPane` will run their
  effects even when not visible. If a new view is heavy on
  initialization (long-running fetches, large allocations), gate it
  behind a `useEffect` that checks visibility, or use
  `requestIdleCallback`.
- **TipTap drag-drop** — the editor accepts text drops. If you
  introduce a new drag operation, make sure it doesn't set
  `text/plain` (or set it to something the editor will handle
  gracefully). The cortex-path drag is precedent.
- **Tauri `dragDropEnabled: false`** — if you ever need OS-level
  file drops (e.g., dragging a PDF from Windows Explorer into the
  app to import it), you'll have to choose: either flip this back
  to `true` and lose in-app HTML5 drag-drop, or implement OS file
  drops via Tauri's `tauri://drag-and-drop` event listener instead.
  We chose in-app.
- **Multi-tab and PDFReader** — PDFReader expects to own its scroll
  container. With the multi-tab refactor, `TabPane` is the scroll
  container. The PDFReader's `wrap` is `position: relative` so the
  Ctrl+K bubble pins to the tab. If you add another floating
  affordance to PDFReader (toolbar, popover, etc.), use
  `position: absolute` against `wrap`, never `fixed`.
- **CSS Grid named areas must be rectangular.** This silently
  broke quad in the first multi-tab pass. Verify with a visualizer
  if you compose a complex grid.

### Phase 3 cluster status (where you are)

Current `phase_2_overview.md` is your authoritative cluster map. As
of `cluster-18-v1.0-complete`:

- ✅ Cluster 8 (Idea Log + Methods Arsenal + Protocols)
- ✅ Cluster 6 (PDF Reader + multi-tab layout)
- ✅ Cluster 10 (GitHub integration)
- ✅ Cluster 11 (Personal Calendar)
- ✅ Cluster 12 (Google Calendar read-only sync)
- ✅ Cluster 15 (Reminders)
- ✅ Cluster 16 (QoL pack — table polish, multi-type blocks, two-way sync)
- ✅ Cluster 17 (Block widget rewrite + Ctrl+Click follow)
- ✅ Cluster 18 v1.2 (Excel layer — drag-resize + formulas + cell types + freeze panes + sort + filter + comparison ops)
- ✅ Cluster 14 v1.0 (Time tracking / planned-vs-actual analytics)
- Cluster 9 (Strong Inference gate) — explicitly dropped earlier
- Roadmap (third sub-view of Cluster 8) — deferred until trigger fires
- Cluster 13 (Outlook Calendar sync) — planned, depends on Cluster 12 scaffold
- Cluster 14 (Time tracking) — planned, depends on Cluster 11
- Cluster 7 (Concept graph) — not started

Pick the next cluster from the overview. The cluster doc convention
is: read the cluster's section in the overview, write a verify script
shell at the top with the smoke-test walk, ship in passes inside one
session, tag `cluster-N-v1.0-complete`, update the overview status,
add a section to `NOTES.md`.

---

## Tag history

| Tag                          | What it captures                                  |
| ---------------------------- | ------------------------------------------------- |
| `week-1-complete`            | vault, file tree, watcher                         |
| `week-2-complete`            | TipTap editor + save + frontmatter + git auto-commit |
| `week-3-complete`            | daily log, FTS5, wikilinks, backlinks, palette    |
| `week-4-complete`            | trial-readiness polish                            |
| `cluster-1-complete`         | Phase 2 Cluster 1                                 |
| `cluster-2-complete`         | Mark System (7 colors, marks table)               |
| `cluster-3-complete`         | Persistent destinations + queues                  |
| `cluster-4-complete`         | Experiment routing + iterations                   |
| `cluster-5-complete`         | (Phase 2 closure)                                 |
| `cluster-8-complete`         | Idea Log + Methods + Protocols                    |
| `cluster-6-v1.4-complete`    | PDF Reader (annotations + sidecar + FTS5 + reading log + UX polish) |
| `cluster-6-v1.5-complete`    | + multi-tab layout, drag-drop, slot picker, PDF horizontal scroll, search-bubble pinned to tab |
| `cluster-16-v1.1.4-complete` | QoL pack: table polish + wikilink shortcut + Ctrl+S scroll fix + multi-type blocks + two-way typed-block routing |
| `cluster-17-v1.0-complete`   | Block widget rewrite — `::TYPE NAME` blocks become a real TipTap custom node (non-editable title bar, inline rename, atomic delete, body holds bullets/lists/code/tables); on-disk format unchanged so Rust routing pipelines need no changes; lift-on-load migration is invisible |
| `cluster-17-v1.1-complete`   | + Ctrl/Cmd+Click on a typedBlock title bar opens the referenced document (new `resolve_typed_block_target` Tauri command — experiment blocks land on the matching iteration file when present, else the experiment index; protocol/idea/method land on their corresponding doc) |
| `cluster-18-v1.0-complete`   | Excel layer v1.0 — custom CortexColumnResize plugin replacing prosemirror-tables's built-in (fully fixes the v1.1.4 cell-height-growth-on-hover bug; never subscribes to view updates), formula engine (`=SUM(A1:A5)`, `=AVG`, `=COUNT`, `=MIN`, `=MAX`, `=MEDIAN`, `=IF`, A1 refs, A1:B5 ranges, circular-ref detection), per-cell `data-formula` + `data-formula-result` attrs round-tripping via HtmlTable, CSS display swap (italic result when not focused, raw formula on focus). Cell types / freeze panes / sort deferred to v1.1+ |
| `cluster-18-v1.0.1-complete` | Three v1.0 bug fixes: (1) drag-resize and equalize column widths apply LIVE (new minimal CortexTableView nodeView that maintains the colgroup, replacing the prosemirror-tables one we lost when disabling columnResizing); (2) no white-line artifact on column delete (CortexTableView trims stale `<col>` elements when column count shrinks); (3) click into formula cell reveals raw formula text (ProseMirror Decoration.node carrying a `cortex-cell-editing` class on the cursor's cell, replacing the never-firing `:focus-within` selector) |
| `cluster-18-v1.1-complete`   | + cell-type formatting (text / number / money / percent / date with Excel-style percent semantics — 0.5 → 50.00%) and freeze rows/columns (0–3 each via right-click submenus). Cell types compose with formulas: `=SUM(A1:A5)` in a money cell renders `$X.XX`. New `cellTypeFormat.ts` registry. Per-cell `data-cell-type` + `data-cell-display` attrs and table-level `data-frozen-rows` + `data-frozen-cols` round-trip through HtmlTable. New `buildFrozenCellsPlugin` walks tables and emits Decoration.node `data-frozen-row` / `data-frozen-col` attrs on cells in the frozen region; CSS uses `position: sticky` with z-index layering (corner cells z-3, edge cells z-2). Sort + filter remain deferred to v1.2 |
| `cluster-18-v1.2-complete`   | + sort columns ascending/descending (cell-type-aware comparator, doc-modifying so order persists; header + frozen rows exempt), filter rows by matching a cell's value (case-insensitive substring; decoration-only via `buildFilteredRowsPlugin`; round-trips via `data-filter-col` + `data-filter-value` table attrs; header + frozen rows exempt), and comparison operators in the formula engine (`>`, `>=`, `<`, `<=`, `==`, `!=`, plus bare `=` as Excel-compat `==`; new `comparison` parser level above `add`, non-chainable; evaluator returns 1/0 numerically so `IF(condition, …)` finally works with natural conditions like `=IF(A1>10, "big", "small")`) |
| `cluster-14-v1.0-complete`   | Time tracking / planned-vs-actual analytics. New `events.actual_minutes` nullable column (idempotent schema migration) + `Event.actual_minutes: Option<i64>`. EventEditModal field "Actual minutes" under Notes (post-hoc; empty → null). New `get_time_tracking_aggregates(vault, range_start, range_end)` Tauri command returning per-category rows (planned from end - start; actual from SUM(actual_minutes); event count + count-with-actual). TimeTracking structured view: range presets 7d/30d/90d/All, overall card, per-category table with colour-cued ratio (green <0.9×, red >1.2×). Sidebar "⏱ Time" button. Recurring events excluded in v1.0 |

When you ship the next cluster, follow the same convention.

---

## Quickstart for the next session

1. Open `phase_2_overview.md` — pick the next cluster.
2. Skim `NOTES.md` end-to-end for context on prior decisions.
3. Read the cluster doc for the chosen cluster.
4. Read this handoff (you're already doing it).
5. Start `pnpm tauri dev` from `C:\Declercq Cortex\declercq-cortex`.
6. Build in passes. New views go in `TabPane`. New global state goes
   in `App`. New Tauri commands go in `lib.rs` and get registered in
   `invoke_handler`. **Always route file opens through
   `selectFileInSlot`.**
7. Write a `verify-cluster-N.ps1` as you go. Tag pattern:
   `cluster-N-v1.0-complete`.
8. Ship: `cd "C:\Declercq Cortex\declercq-cortex"; .\verify-cluster-N.ps1`,
   then `cd "C:\Declercq Cortex"; git push; git push origin <tag> --force`.
