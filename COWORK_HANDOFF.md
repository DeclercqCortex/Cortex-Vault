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
- **Custom TipTap node + NodeView for non-text widgets** (typedBlock,
  cortexImage). Pattern: atom or block node with `data-*` attrs that
  round-trip through `tiptap-markdown`'s `html: true`. NodeView gets
  `editor.storage.<nodeName>` for shared context (e.g. `notePath` so
  relative srcs resolve). Lift/migration transform runs post-`setContent`
  to silently upgrade pre-existing content. See
  `src/components/TypedBlockNodeView.tsx` and
  `CortexImageNodeView.tsx`.
- **Decoration-only mutation for table view state** (sort modifies
  the doc; filter is decoration-only). When the state is "view of
  the data", reach for `Decoration.node` plugins; when it's "the data
  itself", reach for `setNodeMarkup`. Round-trip through table-level
  `data-*` attrs so the view persists across reloads.
- **Hand-rolled OAuth loopback flow** (Cluster 12) — `start_*_oauth`
  + `await_*_oauth_code` + `complete_*_oauth` using
  `std::net::TcpListener` on a localhost loopback. No
  `tauri-plugin-oauth` dep. Refresh tokens stored in vault
  `config.json`. Reuse this for Outlook (Cluster 13) and any future
  OAuth integration.
- **Auto-section markers in daily notes / target docs** —
  `<!-- X-AUTO-START -->` … `<!-- X-AUTO-END -->` (and
  `CORTEX-BLOCK` per-entry markers inside auto-sections that need
  two-way sync). Cluster 8 reagents, Cluster 10 GitHub, Cluster 11
  calendar, Cluster 16 typed-block routing. New auto-sections should
  follow the same shape: idempotent regen Tauri command, run as a
  branch inside `App.selectFileInSlot`, no-op when computed content
  matches disk.
- **Local-day window with `tz_offset_minutes`** — Cluster 10 v1.2
  taught the lesson: anything that says "today's daily note" must
  accept `tz_offset_minutes` from the frontend (`-new
  Date().getTimezoneOffset()`) and compute the local-midnight
  boundary on the Rust side. UTC midnight cross-day rollover is a
  bug source; never use `today_iso_date()` (UTC) for user-visible
  date math.

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
of `cluster-21-v1.1-complete`:

- ✅ Cluster 8 (Idea Log + Methods Arsenal + Protocols)
- ✅ Cluster 6 v1.7 (PDF Reader + multi-tab layout + single-slot Ctrl+K fix)
- ✅ Cluster 10 v1.2 (GitHub integration + local-midnight tz fix)
- ✅ Cluster 11 v1.7 (Personal Calendar — recurrence + tz fixes + per-event notifications + WeekView full-width overlap overlay + top-aligned wrapping titles + MonthView all-day-first sort + drag-resize from top/bottom edges + drag-move within and across days, 15-min snap + per-instance title overrides + modal time editor for instance mode + bundled instance dispatch via `resolve_override_pk`)
- ✅ Cluster 12 v1.0 (Google Calendar read-only sync)
- ✅ Cluster 14 v1.6 (Time tracking — recurring auto-credit, pie chart, Trends tab, per-instance overrides, Copy CSV, sparklines, daily-note splice, all-day exclusion, per-instance time overrides via drag)
- ✅ Cluster 15 v1.0 (Reminders — overlay + bell + dismiss)
- ✅ Cluster 16 v1.1.4 (QoL pack — table polish, multi-type blocks, two-way sync)
- ✅ Cluster 17 v1.1 (Block widget rewrite + Ctrl+Click follow — actually wired in v1.0.3)
- ✅ Cluster 18 v1.2 (Excel layer — drag-resize + formulas + cell types + freeze panes + sort + filter + comparison ops)
- ✅ Cluster 19 v1.3 (Image embeds + ImageViewer + free-position + annotations + flip + non-destructive crop + orphan-attachments GC + multi-select via Alt+click + multi-select-aware context-menu ops + checkbox-driven bulk delete in orphan modal + live crop preview thumbnail)
- ✅ Cluster 20 v1.1 (Shape Editor — v1.0 core + multi-select via Ctrl+Click + lasso; group transform with stable rotation frame; copy/paste; align + distribute; Alt+Shift draw modifiers; movable toolbar; undo/redo; smallest-pick in highlight + transform with multi-set member preference; pointer-events policy that lets you draw on top of existing shapes)
- ✅ Cluster 21 v1.1 (Text editor toolbar overhaul — v1.0 universal toolbar with all comprehensive formatting, marker-pen, particle host, structural blocks, Cortex pipeline, utility tools + v1.1 lowlight code-block syntax highlighting for Python/JS/TS/Rust/Go/JSON/Bash/Shell with toolbar language picker visible only when in code block + interactive Collapsible NodeView with click-to-toggle chevron and double-click-rename summary, open state persisted via data-open + hljs token theme covering both light/dark color schemes + REWORKED Tabs NodeView with panel-per-tab schema: cortexTabsBlock content `cortexTabPanel+`, each cortexTabPanel holds `block+` with its own title attr — fixes the v1.0/v1.1-pre-rework bug where typing Enter inside any tab destroyed the next tab's content via the children-count-sync effect. Drop the sync effect entirely; addTab inserts a panel node, removeTab deletes the panel slice with active-tab clamp in the same transaction, rename uses setNodeMarkup on the panel position; on-disk format `<div class=cortex-tabs data-active-tab=N><div class=cortex-tab-panel data-title=...>blocks…</div>…</div>`)
- ✅ Cluster 22 v1.0 (Document Templates — per-type `.md` templates at `<vault>/.cortex/document-templates/<type>.md` for daily-log/project/experiment/iteration/protocol/idea/method/note; placeholder substitution at creation time; Templates sidebar button + modal with Edit/Reset/preview/Templates-enabled escape-hatch toggle; five new Tauri commands list/read/write/reset/preview_document_template; create_* + ensure_daily_log gain optional use_template arg; find_or_create_iteration always uses template when present; AUTO-GENERATED footer auto-appended to iteration files post-substitution so Cluster 4 routing stays intact even with custom iteration templates)
- ✅ Cluster 24 v1.0 (QoL pack 2 — file operations in the vault sidebar + auto-recurring weekly + monthly all-day reviews + per-Sunday review log files with editable Cluster-22 templates + auto-credit past non-recurring events. v1.0.1 corrects a v1.0 SQL schema bug where `cortex24_ensure_review_category` used `(id, name, color, created_at)` but the actual `event_categories` schema is `(id, label, color, sort_order)` — INSERT failed silently and no review events ever got created. v1.0.1 also adds a new `ensure_review_log_file` Tauri command and routes review-log wikilinks (`[[YYYY-MM-DD Weekly Review]]`) through it so each Sunday's review opens its own log file at `<vault>/Reviews/<Weekly|Monthly>/<date> <Kind> Review.md`, auto-created via the new `weekly-review` / `monthly-review` Cluster-22 template types — editable from the Templates modal so users can customize the "What was this about? / What did you learn?" structure once and have every future review log inherit the changes. The aggregator paths (`get_time_tracking_aggregates`, `get_time_tracking_daily_rollup`, `aggregate_time_tracking_in_window`) now auto-credit non-recurring past events with NULL `actual_minutes` as fully spent (matching the recurring-event behaviour from Cluster 14 v1.1) — so a user who doesn't manually fill `actual` on every completed meeting still sees correct planned-vs-actual totals. Future events with NULL stay at 0 (planned-only counted); explicit 0 stays 0 (preserves the NULL-vs-recorded-zero distinction). EventEditModal grows an "Open this Sunday's review log →" button next to the body for review events (the body's wikilink is non-clickable in a textarea) — dispatches a `cortex:open-file` CustomEvent that App.tsx routes through `selectFileInSlot`. Google sync now detects `invalid_grant` / "Token has been expired" / "revoked" in error messages, surfaces a banner via `setError("Google Calendar connection expired. Open Integrations (GH button) to reconnect.")`, and stops the 5-min polling loop until the next app reload. Right-click any file or folder for create / rename / delete. Inline rename, OS Recycle Bin for delete (`trash` crate), vault-wide `[[wikilink]]` rewrite on rename. Pane sync re-aims affected panes on rename and closes them on delete. New Tauri commands `create_file_in_folder`, `create_folder_in_folder`, `rename_path`, `trash_path`, `ensure_review_events`, `get_review_settings`. Recurrence expander's MONTHLY arm extended to support positional BYDAY tokens (1SU, -1MO etc.) so the monthly review can land on the first Sunday of each month — pre-Cluster-24 BYMONTHDAY-style monthly events unaffected. New components `FileTreeContextMenu`, `DeleteConfirmModal`, `ReviewSettingsModal`. FileTree gains `pendingEdit` / `onContextMenu` / `onCommitEdit` props + an `InlineEditInput` that selects the basename portion of a rename so the user can overwrite without re-selecting the extension. App.tsx adds an auto-init useEffect on vault load that creates both reviews with both flags ON the first time — gated by `localStorage[cortex:reviews-initialized:<vaultPath>]` so manually-deleted reviews don't auto-recreate. "Reviews" sidebar button opens the toggle modal.)
- ✅ Cluster 23 v1.0 (Revision strikethrough — Ctrl+click on any struck range opens a single-line, rectangular, contenteditable bubble that floats directly ABOVE the strike and SPANS THE STRIKE'S WIDTH EXACTLY, with its left and right edges aligned to the strike's left and right edges — the lab-notebook gesture of crossing out and writing the revised idea right above the cross-out, occupying the same horizontal extent; type the replacement, saved on the strike's `data-revision` attr round-tripping via tiptap-markdown's `html: true`; bubble open/closed state is ephemeral, only the revision text persists. New `CortexStrikeRevision` mark in `src/editor/CortexStrikeRevision.ts` extends `@tiptap/extension-strike` with a `revision: string | null` attr; markdown serializer emits `data-revision="…escaped…"` on the open `<s>` tag when non-empty, HTML-escapes `&`/`<`/`>`/`"`; plain strikes round-trip identically to pre-Cluster-23 format so existing files unchanged. New `strikeRevisionPlugin` tracks open ranges as `Array<{id,from,to}>`; `handleClick` detects Ctrl/Cmd+click on a strike, walks outward via `findStrikeRangeAtPos` (resolves `$pos.marks()` both directions while strike present), dispatches `toggle` meta. Positions remap through `tr.mapping` on doc changes; ranges that collapse or no longer carry a strike on their first character are pruned. `setStrikeRevision` helper updates a strike's revision attr via `removeMark + addMark` tagged with `{kind:"ignore"}` meta so the apply-time prune-pass doesn't fire. New `RevisionBubbleOverlay` in `src/components/RevisionBubbleOverlay.tsx` subscribes to editor transactions + wrapper scroll/resize, computes wrapper-local coords via `view.coordsAtPos(b.to)`, anchors at `(coords.right + 8, coords.top - 4)`. Each `<RevisionBubble>` is a contenteditable div (focuses on mount, caret at end of existing revision); per-keystroke `e.stopPropagation()` so editor shortcuts don't fire while focused; Esc / Enter close. Editor.tsx wiring: removed inline `HtmlStrike`, registered `CortexStrikeRevision.extend({addProseMirrorPlugins(){return [buildStrikeRevisionPlugin()]}})`, new `proseWrapperRef` on the `.prose` wrapper with `position: relative` so the absolute-positioned overlay anchors there. CSS `.cortex-revision-bubble` at z-index 50 (above prose, below modals at ≥900 and image bubbles at 800). Reviews pipeline (Cluster 3) reads strike-presence and ignores `data-revision` so resolve semantics are preserved.)
- Cluster 9 (Strong Inference gate) — explicitly dropped earlier
- Roadmap (third sub-view of Cluster 8) — deferred until trigger fires
- Cluster 13 (Outlook Calendar sync) — planned, depends on Cluster 12 scaffold
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
| `cluster-14-v1.1-complete`   | + recurring events auto-credit each instance as fully spent (planned and actual both come from the expanded duration). v1.0 limitation removed. Backend expansion path now contributes per-instance rows to the aggregate before `actual_minutes` is summed. |
| `cluster-14-v1.2-complete`   | + pie chart tab with deterministic-colour slices (FNV-1a hash → 12-colour palette so categories render consistently across reloads). Sub-toggle for what the pie sizes by — "By planned" or "By actual". `ViewMode` union added to TimeTracking.tsx (`"table" \| "pie"`). |
| `cluster-14-v1.3-complete`   | + per-instance overrides for recurring events (new `event_instance_overrides` table keyed by master id + occurrence date; three Tauri commands: `set_event_instance_override`, `get_event_instance_overrides`, `delete_event_instance_override`). EventEditModal dual-save UX with Skip / Save just this / Save series buttons when editing a recurring instance. Trends tab — hand-drawn SVG line chart with one line per category, planned/actual/both metric toggle. New `get_time_tracking_daily_rollup(vault, start, end, tz_offset_minutes)` Tauri command returning per-day per-category bins. Copy CSV button emits per-category aggregates to clipboard (RFC 4180 quoting). Sequenced follow-ups: title/time overrides on a single instance, sparklines per category, daily-note splice for time-tracking summary |
| `cluster-17-v1.0-complete`   | (NOT separately tagged — bundled into the catch-up commit before v1.1 tag.) Block widget rewrite — `::TYPE NAME` blocks become a real TipTap custom node (typedBlock) with a NodeView (non-editable title bar, inline rename, atomic delete). Body holds bullets/lists/code/tables. On-disk format unchanged so Rust routing pipelines need no changes; lift-on-load `liftTypedBlocks` post-setContent transform doubles as invisible migration for pre-v1 content |
| `cluster-19-v1.0-complete`   | (Initial ship, no separate tag — bundled in catch-up commit `9bbef27`.) Image embeds with full editing surface. `assetProtocol` enabled in tauri.conf.json so `convertFileSrc` renders local images. Two new Tauri commands (`ensure_note_attachments_dir`, `import_image_to_note`) copy source files into `<note-basename>-attachments/` next to the note with content-aware dedupe. New `cortexImage` TipTap atom node + React NodeView (`CortexImageNodeView.tsx`); data-* attrs round-trip via `tiptap-markdown`'s `html: true`; NodeView resolves relative `src` via `editor.storage.cortexImage.notePath`. Three corner handles on hover: drag-to-move (switches to free wrap, tracks freeX/freeY), rotate around image centre with Shift snap to 5°, resize horizontally with aspect preserved. 1×2 px shadow + 1px inset outline for "glued in a notebook" feel. Wrap modes: left/right/break/free with `.ProseMirror { position: relative }`. Ctrl+click → annotation popover (URL-encoded storage, blur/Ctrl+Enter saves, 📝 badge on annotated images). Right-click ImageContextMenu (wrap toggles, reset rotation/position/width, edit annotation, delete). New ImageViewer tab view (pan/zoom/fit, checkerboard background) routed by `ActiveView` `"image-viewer"` and TabPane's `IMAGE_EXTENSIONS` matcher. Insertion paths: drag from FileTree (PaneWrapper detects image cortex-path drops inside `.ProseMirror` and calls `insertImageFromPath` at drop coords; else falls back to opening as tab) and Ctrl+Shift+I (`insertImageDialog` via `@tauri-apps/plugin-dialog`). Sequenced follow-ups: orphan-attachments GC, crop/flip controls, multi-select |
| `cluster-19-v1.0.2-complete` | Image polish pass. (1) Corner handles re-anchored via `transform: translate(±50%, ±50%)` so they sit exactly on image corners regardless of float / margin / inline-block descender quirks; `.cortex-image-anchor` got `font-size: 0` + `vertical-align: top` so the box matches the image pixel-for-pixel. (2) Selection outline switched from `outline+outline-offset` to `box-shadow 0 0 0 2px var(--accent)` so it stays self-contained. (3) Annotation badge replaced 📝 emoji with an inline SVG comment-bubble icon (uniform across OSes, themed via `currentColor`); 22×22 circular chip matching the corner-handle visual language. (4) Annotation interaction split: click-to-view (read-only bubble) vs Ctrl+click-to-edit (popover). New `cortex:view-image-annotation` CustomEvent + `ViewImageAnnotationDetail`. Cursor feedback under Ctrl rides on existing `body.cortex-mod-pressed` class (PDF-wikilink-hover precedent). (5) New images default to `wrapMode: 'free'` with seeded (freeX, freeY) computed from drop coords or from `view.coordsAtPos(selection.from)`; images land where you put them and are draggable from frame one |
| `cluster-19-v1.0.3-complete` | Cluster 19 image-cluster cleanup + Cluster 17 v1.1 fix — restore typed-block follow. The Cluster 17 v1.1 docs claimed a `resolve_typed_block_target` Tauri command and an App.tsx `onFollowTypedBlock` wiring, but neither was actually implemented; Ctrl+Click on a typedBlock title bar was a dead gesture. New Rust `resolve_typed_block_target(vault_path, block_type, name, iter_number?)` command. For `block_type='experiment'` queries the hierarchy table, matches by directory basename with the `NN-` numeric prefix stripped (case-insensitive), prefers `iter-NN - *.md` when iter_number is given, falling back to the experiment's `index.md`. For idea/method/protocol scans `04-Ideas/`, `05-Methods/`, `06-Protocols/` for a `*.md` whose stem matches. App.tsx gains `openTypedBlockInActive(attrs)` async helper; TabPane usage gains `onFollowTypedBlock={(attrs)=>{activatePane(i); openTypedBlockInActive(attrs);}}` mirroring the existing `onFollowWikilink` wiring |
| `cluster-14-v1.4-complete`   | Sparklines per category + daily-note splice. Frontend: TimeTracking.tsx grows a "Trend" column on the Table view — inline 80×24 SVG polyline of daily `actual_minutes`. Reuses `get_time_tracking_daily_rollup` (the v1.3 fetch effect's gate widens from `viewMode === 'trends'` to `(trends \|\| table)`; pie still skips the daily-bin cost). Sparklines reuse `categoryColour()` so a category is one consistent colour across pie / Trends / sparkline. Densifies missing days to zero so a "no events on Wednesday" reads as a baseline dip rather than the polyline skipping. Clamps the All-time preset to the actual data span. Edge cases: null trendsRows → matching-size empty placeholder (no table reflow); empty series → muted em-dash; single-point series → 2 px centre dot; max value 0 → divide-by-zero guarded. Backend: new `regenerate_time_tracking_section(vault_path, file_path, tz_offset_minutes)` Tauri command mirroring `regenerate_calendar_section` / `regenerate_github_section`. Basename gate to today's local-day daily note; yesterday's local-day [00:00, 24:00) window in UTC seconds via the same tz-offset arithmetic. Aggregation factored into `aggregate_time_tracking_in_window` helper so the command shares all the recurring auto-credit + override semantics with `get_time_tracking_aggregates`. New `<!-- TIMETRACK-AUTO-START — derived from yesterday's calendar events; do not edit -->` / `<!-- TIMETRACK-AUTO-END -->` markers bracket a 5-column markdown table (Category / Planned / Actual / Ratio / Events) plus a bolded **Total** row. Heading-fallback insertion under `## Yesterday's time` when markers absent. Idempotent — only writes when content differs; `index_single_file` invoked after writes. Empty rows render `_(no events recorded yesterday)_`. Wired into App.tsx's `selectFileInSlot` daily-log path after `regenerate_calendar_section`, with the same `tzOffsetMinutes` plumbing |
| `cluster-11-v1.5-complete`   | WeekView layout polish. (1) All-day events stay in the dedicated top all-day row (rule existed since 16 v1.1.4 — v1.5 confirms). (2) Time-grid overlap moves from column-packing (1/N width slivers per overlap) to a full-width overlay: every timed event takes `width: calc(100% - 6px)`, stacks via `zIndex: 1 + idx` with later starts on top so each block's title appears at its own start time (same-start ties: shorter event on top). `boxShadow: 0 0 0 1px var(--bg)` separates layers. `layoutEventsForDay` simplifies to a flat sort (start ASC, duration DESC). (3) Block titles top-align and wrap (`display: flex; flexDirection: column; justifyContent: flex-start`, `wordBreak: break-word`, `overflow: hidden` clips below). 30-min block shows ~2 lines; 2-h block shows full title + time range. (4) MonthView parity: each day cell sorts all-day-first |
| `cluster-14-v1.5-complete`   | Exclude all-day events from time tracking. Early `if evt.all_day { continue; }` in three aggregator paths: `get_time_tracking_aggregates` (Table + pie + CSV), `get_time_tracking_daily_rollup` (Trends + sparklines), `aggregate_time_tracking_in_window` (daily-note splice helper). Fixes 1440-planned-minutes-per-vacation-day distortion. Composes with skip-overrides (those filter upstream in `expand_recurrence`). UI subtitle says "All-day events are excluded." |
| `cluster-11-v1.6-complete`   | Drag-resize and drag-move on calendar events. Drag-kind from offsetY: top 8 px → resize-top, bottom 8 px → resize-bottom, else move. Snap to 15 min (`DRAG_SNAP_MIN`); floor at 15 min so events can't go zero/negative-duration. Drag-move preserves duration; cross-day moves hop the live preview to the target column and commit on pointerup. During drag, dragged event renders at 85% opacity / `zIndex: 100`; origin-day render suppressed during cross-day to avoid duplicate. Window-level pointermove/up listeners attach on dragstart, detach on dragend. 4-px movement threshold separates click from drag; post-drag click swallowed via `swallowClickRef` so the modal doesn't pop. Read-only Google events opt out (pointerdown returns early). Recurring drag commits via `update_event` on master in v1.6 (every occurrence shifts) — fixed to per-instance in 14 v1.6 |
| `cluster-14-v1.6-complete`   | Per-instance time overrides via drag. Schema: ALTER TABLE `event_instance_overrides` ADD `start_at_override INTEGER`, `end_at_override INTEGER` (both NULL → no override; both Some + e>s → applied; partial → ignored). `expand_recurrence` push_instance applies override AFTER skip check, BEFORE window filter, so a drag can move an occurrence into/out of the visible range. New `resolve_override_pk(conn, master_id, instance_start_unix)` helper: if a row matches `start_at_override`, return its PK (the original computed start); else return the input. Used by every override-mutation surface so re-drags update the same row. New Tauri command `set_event_instance_time_override` (UPSERT touching only the two time columns + `updated_at_unix`; skipped/actual_minutes survive). Existing `set/get/delete_event_instance_override` now go through `resolve_override_pk` to handle previously-shifted starts. Calendar.tsx `onEventReposition` branches on `recurrence_rule`: non-recurring → existing `saveEdit`/`update_event`; recurring → `set_event_instance_time_override`. Both paths reload + regenerate-daily-note |
| `cluster-11-v1.7-complete`   | Per-instance title overrides + modal time editor. Schema: ALTER TABLE adds `title_override TEXT` (NULL = inherit master.title; non-NULL renders this occurrence with the override). `InstanceOverride` Rust struct grows the field; `expand_recurrence` push_instance picks `effective_title = override.title_override.filter(non-empty).unwrap_or(master.title)`. New Tauri command `set_event_instance_title_override(vault_path, master_id, instance_start_unix, title_override)` — UPSERT, empty/whitespace → NULL (revert to master), refuses non-recurring, uses `resolve_override_pk`. EventEditModal `onSaveInstanceOverride` arg shape grows three optional fields (`titleOverride`, `startAtOverride`, `endAtOverride`); `submitInstanceOverride(false)` (Save just this) bundles the deltas vs displayed values so equivalent state is a no-op. Calendar.saveInstanceOverride sequence per submit: 1) `set_event_instance_override` (skip/actual_minutes), 2) `set_event_instance_title_override` if titleOverride present, 3) `set_event_instance_time_override` if start+end present. All three resolve to the same row via `resolve_override_pk`; reload + regen runs once at the end. Override row composition: skipped + actual_minutes + start_at_override + end_at_override + title_override all per-column-orthogonal |
| `cluster-19-v1.1-complete`   | Image flip controls. Two new boolean attrs on cortexImage (`flipH`, `flipV`) that round-trip via `data-flip-h="1"` / `data-flip-v="1"` (false → no attr, clean on disk). NodeView composes flip with rotation in a single CSS transform: `rotate(Xdeg) scale(±1, ±1)` (rotate-then-scale, matches Photoshop / Figma). Identity (no rotation, no flip) → no transform string. ImageContextMenu grows a "Flip" section with two toggles (active dot when set). `handleImageMenuAction` reads the current value from the LIVE doc (not menu snapshot) so a rapid double-toggle ends back at identity rather than racing |
| `cluster-19-v1.2-complete`   | Image polish — non-destructive crop + orphan-attachments GC + multi-select. Closes the v1.0.3 backlog. (1) CROP is non-destructive: four cortexImage attrs `cropX/Y/W/H` in natural pixels, round-trip via `data-crop-x/y/w/h`. NodeView wraps `<img>` in a crop-wrapper with overflow:hidden + (cropW, cropH) at scale; rotation+flip transforms move from img to wrapper when cropped so rotation rotates the cropped result. CropModal seeds with existing crop attrs and shows the ORIGINAL image with the saved rect overlaid, so re-cropping can expand outward as well as shrink inward; Apply writes the four attrs, Reset clears them. The v1 destructive `save_cropped_image` command stays registered (backwards-compat); no new files written. `width` resets to null on Apply so the user-set pixel width doesn't carry over. (2) ORPHAN-ATTACHMENTS GC via `find_orphan_attachments` (walks vault, for each .md checks companion `<note-stem>-attachments/`, lists files whose `<dir-basename>/<file>` substring isn't in the note text) + `delete_orphan_attachment` (vault-prefix safety) + `OrphanAttachmentsModal` (sorted list with note path / attachment / size / Delete; Reload re-scans). Triggered by `Ctrl+Shift+O`. Modal copy notes the "save before scanning" caveat. (3) MULTI-SELECT via `src/editor/imageMultiSelect.ts` ProseMirror plugin: Set<number> of cortexImage positions, three meta kinds (toggle/clear/set), positions remap through transactions and drop if no longer pointing at cortexImage. `Decoration.node` adds `cortex-image-multi-selected` class; CSS ring. Alt+click toggles (Ctrl/Cmd reserved for annotation popover). Implementation note: Alt+click toggle dispatches from the React onClick on the NodeView wrapper, NOT from PM `handleClickOn`, because the wrapper carries `data-drag-handle` in left/right/break wrap modes and HTML5 drag-prep on Alt+mousedown intercepts the click before PM. Esc clears; Delete/Backspace delete every selected node in REVERSE position order. v1.3 backlog: multi-select-aware ops beyond delete |
| `cluster-19-v1.3-complete`   | Closes three of four v1.2 backlog items. (1) MULTI-SELECT-AWARE OPS — when right-clicking an image in an active multi-set, the context menu acts on every selected image. Menu header reads "N images selected"; wrap, reset rotation/position/width, flip H, flip V, delete all bulk-apply. Crop and Edit annotation disabled in multi-mode (single-image inherent). Right-clicking a stranger image drops the multi-set and falls back to single mode. New Editor.tsx helpers: `computeMultiSnapshot(doc, positions)` returns `{count, commonWrap, allFlipH, allFlipV, anyRotated, anyFree, anyHasWidth}` driving consensus dots and any-of enable rules; `patchImageAttrsBulk(positions, patchOrFn)` applies in a single transaction, function form receives per-image attrs (used by flip toggles so `[T,F,T]` becomes `[F,T,F]`); `deleteImagesBulk(positions)` deletes in REVERSE position order + clears the multi-set meta. ImageContextMenu accepts a new `multi` prop; new exported `ImageContextMenuMulti` interface. (2) CHECKBOX-DRIVEN BULK DELETE in OrphanAttachmentsModal — leftmost checkbox column, tri-state header (native indeterminate via ref), new "Delete selected (N)" toolbar button between Refresh and Delete all (disabled when N=0; confirms with count + total bytes; sequences deletes; surfaces partial failures). Selection cleared on refresh and after each successful delete (so a re-click doesn't try to re-delete a now-gone path). (3) LIVE CROP PREVIEW THUMBNAIL in CropModal — small `<canvas>` (≤160×120) in the status row, redrawn on every rect/natural change via `ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, thumbDims.w, thumbDims.h)`; aspect matches the rect; defensive try/catch guards a tainted-canvas case. v1.4 backlog (single deferred item from v1.2): drag the crop region directly on the image (in-place crop) — sized as its own session |
| `cluster-20-v1.0-complete`   | Shape Editor — "Microsoft Paint inside the document" mode for markdown notes. `Ctrl+Shift+D` toggles shape editor on the active markdown pane: the document body dims to 78% opacity with `pointer-events: none` and an SVG overlay snaps over it, capturing pointer events. Tools (R rect / E ellipse / L line / F freehand for DRAW; T transform; H highlight) swap via single-letter keys. Color palette (1–9) reuses the 7 mark colors + black + white. Transform mode renders 8 corner+edge handles + rotation knob 24 px above the bounding box around the selected shape; corner-resize anchors on the opposite corner; Shift on corners locks aspect; Shift on rotate snaps to 15°. Highlight mode applies `<color>33` (~20% alpha) as fill, toggling off if reclicked with same color. Delete (D) removes the selected shape. Storage: sidecar JSON at `<note-stem>.shapes.json` (Cluster 6 PDF-annotation precedent), schema-versioned, every field `#[serde(default)]`, idempotent writes. Templates at `<vault>/.cortex/shape-templates/<name>.json`, sanitized filenames, listed sorted by mtime DESC, loaded ADDITIVELY with fresh shape ids so re-loads don't collide. Six new Tauri commands: read_shapes_sidecar / write_shapes_sidecar / list_shape_templates / read_shape_template / save_shape_template / delete_shape_template. New TS types in `src/shapes/types.ts` (Shape, ShapesDoc, ShapeTool, SHAPE_COLORS, HIGHLIGHT_FILL_ALPHA, newShapeId). New components: `ShapeEditor.tsx` (SVG overlay, owns tool/color/selection/draft/drag state and the pointer pipeline; uses `getScreenCTM()` to map client coords to SVG coords; line/freehand inner geometry stored box-relative so resize scales it), `ShapeEditorToolbar.tsx` (floating top-right toolbar), `ShapeTemplateModal.tsx` (save/load/delete). TabPane grows shapeEditorActive / shapesDoc / shapesDirty state, `editorWrapperRef`, sidecar load effect, ResizeObserver + MutationObserver tracking the wrapper for overlay dimensions, three new handle methods (`toggleShapeEditor`, `getShapeEditorActive`, `saveShapesIfDirty`), and `saveIfDirty` fans out to shapes too. App.tsx Ctrl+Shift+D handler routes to the active pane's toggleShapeEditor. CSS rule on `.cortex-shape-editor-active .ProseMirror` applies the dim+freeze (only the .ProseMirror so panels and modals stay interactive). v1.1+ deferred: stroke-width selector, z-order shortcuts (Ctrl+]/Ctrl+[), multi-select via Shift+click, undo/redo within session, arrow shape, snap-to-grid via Alt, shape editor on PDFs, save selected as template, color picker for arbitrary hex |
| `cluster-21-v1.0-complete`   | Text editor toolbar overhaul. A persistent universal toolbar pinned flush with the very top of the app (above every pane), driving the active editor in any slot. Comprehensive formatting: basic marks (bold / italic / underline / inline code / sub / super / strike-resolve), headings + paragraph styles + drop cap + pull quote + block quote + code block, alignment / spacing / indent / line-height, lists (bullet / ordered / task with checkbox + custom glyph + nest/unnest + collapse), font size + family + weight + italic, text color + highlight + underline-styled pickers (with marker-pen mode), visual text effects (glow / shadow / gradient / animation), particle effects, insertion menus (link / footnote / citation / special character / emoji / symbol / math / date), structural blocks (callout / columns / side-by-side / tabs / decorative divider / collapsible / margin note / frame / pull quote / page break / math block / footnote ref / citation ref / drop cap), Cortex-specific quick actions (experiment / protocol / idea / method blocks routed to the Ctrl+Shift+B modal pipeline), utility tools (find & replace, live counts, outline, zoom, focus / typewriter mode, reading mode, show invisibles, print, DOCX export), and toolbar-level polish (density preset, group reorder, favorites, pause-animations toggle, persistence in localStorage). ARCHITECTURE: EditorToolbar mounted ONCE at App level (flex-shrink: 0 at top of column), `paneEditors[activeSlotIdx]` drives the bound editor. TipTap extension layer under `src/editor/`: `CortexFontStyle` (size+family+weight via data-* attrs), `CortexUnderlineStyled` (color+thickness+style+offset), `CortexTextEffect` (all glow/shadow/gradient/animation effects via data-effect → CSS class), `CortexParticleHost` (data-particle wired to canvas overlay), `CortexBlocks.ts` (14 structural nodes), `CortexMarkerMode.ts` (PM plugin tracking active+color, on selection-end applies ColorMark and clears selection). MARKER WIRED TO COLORMARK: marker picker is a `<select>` of the seven Cluster 2 review-pipeline ColorMark names; the plugin calls `colorMarkType.create({color: name})` so marker-applied highlights flow into the Reviews tab pipeline alongside Ctrl+1-7. MARK_PALETTE order in toolbar matches Reviews pipeline. DIRECT PM DISPATCH for effects + particles — earlier rounds tried `editor.chain().setMark` with selection composition that occasionally dropped the range and routed to `storedMarks` (apply to next-typed char only); v1.0.6 switched to raw `editor.view.dispatch(tr.addMark(from, to, mark))` with explicit ranges from a `resolveRange()` helper that prefers current selection and falls back to `lastSelectionRef` captured by selectionUpdate. Effects categories same-category-replace, cross-category compose. Gradient text gets explicit `::selection` CSS. PARTICLE HOST OVERLAY: `ParticleOverlay.tsx` mounts per-`[data-particle]` canvas via IntersectionObserver, runs 14 renderers (sparkle/star/confetti/snow/heart/ember/smoke/bubble/lightning/pixie/petal/comet/bokeh/coderain) on a single rAF loop; `visible: true` default in ensureHost so particles render before IO fires; respects `prefers-reduced-motion`. CORTEX BUTTONS via `onOpenBlockModal` → `setBlockModalOpen(true)`, reusing ExperimentBlockModal (window.prompt fallback removed). Decorative divider glyph picker is now a TbPopover so cancel doesn't insert. activeMode listener exempts `.cortex-editor-toolbar`, `.cortex-tb-popover`, `.cortex-find-replace-bar` so popover clicks don't switch active slot. `paneEditors` state with `setPaneEditorAt` reference-dedup + `onReadyFiredFor` ref prevent inline-callback identity churn (fixed an OOM during the App-level refactor). Toolbar prefs in localStorage `cortex:editor-toolbar-prefs` (density, collapsed groups, favorites, pauseAnimations, reduceMotion, readingMode, spellcheck, zoom). New extensions: `CortexFontStyle.ts`, `CortexUnderlineStyled.ts`, `CortexTextEffect.ts`, `CortexParticleHost.ts`, `CortexMarkerMode.ts`, `CortexBlocks.ts`. New components: `EditorToolbar.tsx`, `ParticleOverlay.tsx`. Modified: `App.tsx` (mount toolbar at top, paneEditors state, activeMode exemption, onOpenBlockModal), `Editor.tsx` (registers Subscript/Superscript/TextStyle/Color/Highlight/TaskList/TaskItem + all CortexFont/Underline/Effect/ParticleHost/Blocks; onReadyFiredFor guard; marker plugin uses colorMarkType), `TabPane.tsx` (per-pane toolbar removed; new `onEditorChange` and `particlesPaused` props; cleanup fires `onEditorChange?.(null)`), `index.css` (Cluster 21 section: text-effect classes, sticky toolbar, list-style cycling, task-list checkbox replaces bullet, `::selection` rules for gradient, caret visibility, reading mode no longer hides toolbar), `package.json` (7 new TipTap packages: extension-subscript / -superscript / -text-style / -color / -highlight / -task-list / -task-item), `ShortcutsHelp.tsx` (toolbar shortcuts: Ctrl+< / Ctrl+> / Ctrl+F / Ctrl+H / Ctrl+\ / Ctrl+0 / Ctrl++ / Ctrl+- / Ctrl+Alt+F / Ctrl+Alt+R / Ctrl+Alt+I / F7). v1.0.x dot-fix history rolled in: v1.0.1 missing TipTap packages added; v1.0.2 editor.view race wrapped in try/catch + useRef import in Editor.tsx; v1.0.3 universal toolbar refactor + paneEditors dedup + onReadyFiredFor guard; v1.0.4 reading mode no longer hides toolbar + marker switched to ColorMark select + Cortex buttons routed to Ctrl+Shift+B + MARK_PALETTE reordered + glyph TbPopover for divider; v1.0.5 reset highlight unwedged (unsetColorMark + unsetMark("highlight")) + activeMode toolbar exemption; v1.0.6 direct PM dispatch + `::selection` for gradients; v1.0.7 `resolveRange` useCallback hoisted ABOVE `if (!editor) return null` (Rules of Hooks fix — earlier the hook sat after the guard so first-render hook count differed from subsequent renders, producing "Rendered more hooks than during the previous render"). v1.1+ deferred: code block automatic syntax highlighting (Python/console keywords; needs lowlight + highlight.js), Tabs and collapsible NodeViews with click-to-toggle JS, Cluster 22 (document templates) |
| `cluster-20-v1.1-complete`   | Shape Editor polish + multi-select + undo. Consolidates the v1.0.1–v1.0.7 dogfooding patches into one tag. Eleven things: (1) POINTER-EVENTS POLICY — shapes carry `pointer-events: 'all'` only in transform/highlight; draw modes set 'none' so a click on top of an existing shape passes through to the SVG canvas and the user can draw on top normally. The redundant draw branch in `onShapePointerDown` was dropped. (2) SMALLEST-SHAPE PICK in highlight + transform via `findSmallestShapeContainingPoint` (un-rotates the test point into each shape's local frame, then AABB-tests). In transform plain-click, prefers a multi-set MEMBER first; Ctrl+click uses global pick. The member preference fixes the "sometimes drag of multi-set fails" bug — without it, a non-member smaller shape under the cursor (often via a rotated-shape overhang outside the group's logical bbox) would steal the click and collapse the multi-set. (3) ALT + SHIFT DRAW MODIFIERS for rect/ellipse/line — Shift constrains (square / circle / 45° angle), Alt centers on click origin, combo combines. Live reads from the pointer event so they take effect mid-drag. Freehand opts out. (4) MULTI-SELECT — `selectedIds: Set<string>`, Ctrl+Click toggles membership without dragging; plain-click on a member preserves the set + starts group-move. LASSO drag from empty canvas in transform mode (fully-contained semantics, Ctrl+drag additive). Ctrl+click on the group bbox area (which the bbox rect intercepts as it sits on top in z-order) toggles smallest-containing shape rather than dragging — without this the bbox would silently swallow modifier intent. (5) GROUP TRANSFORM — three new DragKind variants `group-move`, `group-resize`, `group-rotate` with snapshot-based per-shape transforms; `writeShapes(Map<id, Shape>)` helper writes all transformed shapes in one transaction. (6) STABLE GROUP-ROTATE FRAME — bboxStart + currentDelta in drag state; GroupSelectionOverlay accepts a `rotationFrame` prop and renders the outer frame (bbox + 8 handles + knob) inside `rotate(delta px py)` around the pivot — rigid frame around the centroid, knob stays anchored. Per-shape thin rings still track live shape positions during the rotation. (7) COPY / PASTE — in-memory clipboard via `Ctrl+C`/`V`, deep JSON clone, 16-px offset on paste, fresh ids, paste auto-selects the duplicates. (8) ALIGN (top/middle/bottom/left/center/right) + DISTRIBUTE (H/V) toolbar buttons visible at 2+ selection; Distribute disabled at <3 (trivially distributed). (9) MOVABLE TOOLBAR — header "Shape editor ⠿" is the drag handle, `position: fixed` (stays visible during scroll), persisted in `localStorage` at `cortex:shape-toolbar-position`, double-click to reset, clampToViewport keeps a 20-px sliver on screen. (10) UNDO / REDO at TabPane level — shapesUndoStack + shapesRedoStack (deep snapshots, capped at 100, dedupe back-to-back identical pushes). pushShapesUndo called by ShapeEditor at every atomic operation start (draw commit, drag start, highlight click, paste, align, distribute, delete) — one push per operation, never per intermediate pointermove. Mid-drag Ctrl+Z cancels the in-flight drag (sets `drag` to `none`) before undoing so the next pointermove doesn't re-apply snapshot deltas. Per-file history (resets on file change). Template-load also pushes undo (TabPane calls it directly). Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo. (11) PROGRESSIVE ESC — clears multi-selection first, then exits on second Esc. v1.2+ deferred: stroke-width selector, z-order shortcuts (Ctrl+]/Ctrl+[), undo coalescing of micro-drags, arrow shape, snap-to-grid, shape editor on PDFs, save-selected-as-template, color picker for arbitrary hex, aspect-preserving group resize for rotated shapes |
| `cluster-21-v1.1-complete`   | Tab panel rework — panel-per-tab schema + two follow-up fixes after dogfooding. v1.0 shipped a tabs block that could never hold more than one paragraph: its content was `block+` with one child block per tab title, and a `useEffect` "children-count-sync" pass would PAD or TRIM the body to match titles.length on every render. Pressing Enter inside any tab made ProseMirror split into two paragraphs in the body — the next render's sync immediately deleted the second paragraph (mistaking it for a stray tab without a title). Typing destroyed sibling tabs' content. v1.1 replaces the model with a real two-level schema: `cortexTabsBlock` content becomes `cortexTabPanel+` and only carries `activeTab`; new `cortexTabPanel` Node (content `block+`, attr `title`, `defining: true` + `isolating: true`) wraps each tab's content. Each tab now holds any block+ — paragraphs, headings, lists, images, nested blocks — and Enter creates a new paragraph INSIDE the same panel without disturbing siblings. NodeView rewritten in `CortexBlockNodeViews.tsx`: titles read from each child's `title` attr (no more pipe-delimited string on the parent), `addTab` inserts a new `cortexTabPanel` with one empty paragraph, `removeTab` deletes the panel slice and clamps active-tab in the SAME transaction (no transient state where active points at a deleted panel), `commitRename` uses `setNodeMarkup` on the specific panel position. Children-count-sync effect dropped entirely. New helpers `getPanelPos(idx)` / `getPanelInnerStart(idx)` for the position math (parentPos + 1 + Σ child[<i].nodeSize). On-disk format: `<div class="cortex-tabs" data-active-tab="N"><div class="cortex-tab-panel" data-title="...">...blocks...</div>...</div>`. v1.0 docs with bare `<p>` children fail schema validation on reopen — v1.0 just shipped earlier today so only test tabs exist; user re-inserts. Files touched: `src/editor/CortexBlocks.ts`, `src/editor/CortexBlockNodeViews.tsx`, `src/components/Editor.tsx`, `src/components/EditorToolbar.tsx`. **Three follow-up fixes after dogfooding the rework — the third (CSS) is the root-cause-of-everything; the first two are defensive depth that turned out not to be load-bearing once the CSS was correct**: (1) `getPanelInnerStart` returned `panelPos + 1`, which resolves to a $pos whose parent is `cortexTabPanel` itself (content rule `block+`, NOT inline content); `TextSelection.create` rejected that pos with a RangeError. Fixed by walking forward from `panelPos + 1` to the nearest valid text-cursor position via `Selection.near($pos, 1)` and taking `sel.from`. (2) PM's view update for a React NodeView schedules an async React state update; PM's `setSelection` on the DOM runs synchronously inside `dispatchTransaction`, so the cursor lands in panel N while the wrapper's `data-active-tab` is still the OLD value. Fixed via a `wrapperRef` on `<NodeViewWrapper>` plus a `revealPanelInDom(idx)` helper that imperatively writes `data-active-tab` to the wrapper DOM via the ref BEFORE PM dispatches. Called from `setActive` / `addTab` / `removeTab`. (3) **THE root cause**: `@tiptap/react`'s `ReactNodeViewRenderer` constructs a `contentDOMElement` (a plain `<div>` with `data-node-view-content-react`) and appends it INSIDE our `<NodeViewContent>` (`.cortex-tab-body`); PM mounts the panels inside THAT wrapper, NOT directly inside `.cortex-tab-body`. The previous selector `.cortex-tab-body > *:nth-child(N+1)` matched React's solo intermediate wrapper, not the panels. Result: `data-active-tab="0"` resolved the wrapper to `display: block` and exposed ALL panels stacked vertically inside it (presenting as "all tabs share the same characters"); any other `data-active-tab` value left the wrapper at `display: none`, dropping the panels' selection target into a `display: none` ancestor — browser refuses contenteditable focus there and snaps the cursor to the line above the tabs block (presenting as "tabs 2+ accept one character then escape"). Fixed by changing the selector from direct-child traversal to a class-based descendant selector that walks through whatever wrappers React inserts: `.cortex-tabs .cortex-tab-panel { display: none; }` + `.cortex-tabs[data-active-tab="N"] .cortex-tab-panel:nth-child(N+1) { display: block; }`. `:nth-child` on the panel counts the panel's position among ITS siblings (all panels, by schema), which React's wrapper doesn't change — just the ancestor chain. **Two UX additions also bundled into the v1.1 tag**: (a) the toolbar's tabs-button insertion appends a trailing empty paragraph (`insertContent([tabsBlock, paragraph])`) so the user has somewhere to keep typing below the block. (b) Clicking × on the last remaining tab now deletes the entire `cortexTabsBlock` node instead of being a no-op — the × is always visible. **Final v1.1 polish pass** (the seven items the user listed for the v1.1 ship): (1) **Zoom** wired — toolbar already wrote `--cortex-editor-zoom` but no CSS rule consumed it. First attempt used `transform: scale()` on `.prose` and **blanked the whole app** (CSS transform on a contenteditable surface broke PM's selection math + MutationObserver-driven view sync; the editor threw during initial render). Switched to `font-size: calc(15px * var(--cortex-editor-zoom, 1))` on `.prose` plus the same value as the inline style on Editor.tsx's prose div (which had a hard-coded `fontSize: "15px"` that would have overridden the CSS rule). font-size scaling keeps the contenteditable surface intact while still visibly resizing all prose; em/rem-based sub-elements inherit the scaling automatically. (2) **Particles** survive edits — `ensureHost` short-circuited via `hostsRef.current.has(el)` so when PM's mutation observer rebuilt an inline-mark span on doc edits and wiped our appended canvas, the cached state thought the canvas was still mounted and we never remounted; fixed via `canvas.isConnected && el.contains(canvas)` check that treats a wiped canvas as a missing host. (3) **Stack glow + gradient** — glow / halo / outline used `currentColor` as the fallback for `text-shadow` / `text-stroke`, but gradient sets `color: transparent` so currentColor became transparent and the glow was invisible; switched the fallback to `var(--text)`. (4) **Font dropdown** — each `<option>` now renders its label in its own `font-family` (Chromium honours that since Chrome 79); added 9 new fonts (Inter, Lora, Crimson Text, Playfair Display, EB Garamond, Source Serif, JetBrains Mono, Fira Code, Bebas Neue, Cinzel, Caveat, Pacifico) loaded via Google Fonts CDN in `index.html`. (5) **Auto-replace pipeline** — new `src/editor/CortexAutoReplace.ts` extension registers ~40 ProseMirror inputRules for text → symbol substitutions (arrows `-->` `<--` `<-->` `=>` `<=>`; comparisons `<=` `>=` `!=`; math `+-` `~=` `:=` fractions; Greek letters via LaTeX `\alpha` `\Sigma` etc.; typography `...` `---` `--`); each rule fires on trailing space, PM's textInputRule helper handles consume + replace atomically, substitutions are undoable. (6) **Insert URL** with no selection — `setLink` used to silently no-op when there was no range to wrap; now the URL is inserted as the link text and wrapped with the link mark in one chain, bare domains get `https://` auto-prepended. (7) **Rich text in find&replace's "replace with"** — replaced the plain `<input>` with a small TipTap editor (StarterKit minus blocks + Underline / TextStyle / Color); mini formatting strip exposes B / I / U / S / `< >` / colour; `onUpdate` serializes inline HTML (stripping wrapping `<p>`); `doReplaceAll` splices that HTML for every literal-text match. Files touched: `src/index.css` (zoom rule, glow/halo/outline fallback, find&replace rich-input styling), `src/components/EditorToolbar.tsx` (Link insertion, font list + per-option style, FindReplaceBar mini-editor), `src/components/ParticleOverlay.tsx` (canvas-still-attached check), `src/components/Editor.tsx` (CortexAutoReplace import + register), `src/editor/CortexAutoReplace.ts` (new), `index.html` (Google Fonts CDN) |
| `cluster-22-v1.0-complete`   | Document Templates. Per-type `.md` template files at `<vault>/.cortex/document-templates/<type>.md` (eight types in v1.0: daily-log / project / experiment / iteration / protocol / idea / method / note). When a doc is created via the existing flows (Ctrl+D, NewHierarchyModal, sidebar +Note/+Idea/+Method/+Protocol/+Proj/+Exp/+Iter buttons), the new file's body is seeded with a deep copy of the template's content with placeholder substitution. Tokens supported in v1.0: `{{date}}`, `{{datetime}}`, `{{title}}`, `{{slug}}`, `{{iteration_number}}`, `{{iteration_number_padded}}`, `{{parent_project}}`, `{{parent_experiment}}`, `{{vault_name}}`, `{{prev_daily_link}}`, `{{week_number}}`, `{{day_of_week}}`, `{{modeling}}`, `{{domain}}`, `{{complexity}}`, plus the special `{{reagents_auto_start}}` / `{{reagents_auto_end}}` tokens that map to the Cluster 8 sentinels at substitution time so the user can edit surrounding markdown without breaking marker syntax. ARCHITECTURE: backend bundles default template strings inline (`DEFAULT_TEMPLATE_DAILY_LOG` / `_PROJECT` / `_EXPERIMENT` / `_ITERATION` / `_PROTOCOL` / `_IDEA` / `_METHOD` / `_NOTE`). `read_or_init_template(vault, doc_type)` lazily writes the bundled default if the file is missing on disk, so first-run UX is "open Templates modal → see entries → click Edit → file already populated". `apply_placeholders(template, ctx)` substitutes — unknown tokens stay literal so the user can spot which haven't been wired. `resolve_template_body(vault, doc_type, use_template)` is the per-create_* helper: when `use_template` is `Some(false)`, returns None and the create_* function takes its existing hardcoded body verbatim (the Templates-enabled escape hatch). Five new Tauri commands: `list_document_templates(vault)` returns DocumentTemplateInfo per type (path + exists + modified_unix), `read_document_template(vault, doc_type)` (lazy init), `write_document_template(vault, doc_type, body)`, `reset_document_template(vault, doc_type)` (re-writes default), `preview_document_template(template_body, ...ctx_fields)` (renders against frontend-supplied sample values for the modal preview pane). All seven `create_*` Tauri commands and `ensure_daily_log` grew an optional `use_template: Option<bool>` arg. `find_or_create_iteration` (Cluster 4 auto-create from `::experiment` blocks in daily notes) always uses the template if present so iteration files have one shape regardless of how they're created — and the AUTO-GENERATED footer is appended after substitution if not already in the template body, keeping Cluster 4 routing intact even if a user customises the iteration template. FRONTEND: `src/components/TemplatesModal.tsx` — list of types + Edit/Reset buttons + live preview pane + "Templates enabled" toggle (localStorage `cortex:templates-enabled`, default `true`). `readTemplatesEnabled()` / `writeTemplatesEnabled()` exported helpers. Edit routes through `selectFileInSlot(templatePath, activeSlotIdx)` — templates are real `.md` files in the vault, so TipTap, the Cluster 21 toolbar, every formatting effect work natively (no extra wiring). App.tsx wires `templatesModalOpen` state, "Templates" sidebar button next to GH, and the modal mount with `onEdit` closing the modal then routing the path. NewHierarchyModal reads the toggle once per submit and threads `useTemplate` into each `create_*` invoke; App.tsx threads it into `ensure_daily_log`. v1.1+ deferred: per-folder default template (the cluster-spec item #10/UI item #5 — depends on a folder→template-path mapping picker, sized as its own session), reading-log entry template (section splice not file creation, bigger refactor), template export/import zip, `{{author}}` placeholder (needs an author config schema), per-doc-type sub-templates, template inheritance, conditional sections, marketplace |
| `cluster-21-v1.2-complete`   | Auto-replace v2 + Frame color picker. AUTO-REPLACE: rules can emit STRUCTURAL BLOCKS, not just characters. New `afterHtml: string` optional field on `AutoReplaceRule`; when present, `CortexAutoReplace.handleTextInput` parses it through `DOMParser.fromSchema(view.state.schema).parseSlice(div)` into a ProseMirror Slice and replaces the matched range via `tr.replaceRange`. Built-ins keep using the plain `after` path (zero data migration). Defensive fallback: if Slice parsing throws, the handler falls through to the plain-text path so the editor never gets stuck mid-keystroke. New `RichAfterEditor.tsx` sub-modal mounts a TipTap editor with the same Cortex extension stack the main editor uses (StarterKit minus strike/link/codeBlock + CortexCodeBlock + CortexAutoReplace + CortexStrikeRevision + Underline / Subscript / Superscript / TextStyle / Color / Highlight / TaskList / TaskItem + CortexFontStyle / CortexUnderlineStyled / CortexTextEffect / CortexParticleHost + ColorMark + Markdown(html: true) + every CortexBlocks node + the three NodeView-enabled nodes). A second `EditorToolbar` instance mounts inside the sub-modal bound to the mini editor — toolbar prefs share the main editor's localStorage key so density/favorites carry over. Save serializes both `editor.getHTML()` (→ afterHtml) and `editor.getText()` (→ after). AutoReplaceModal: scrim's `onClick={onClose}` removed (modal is now STICKY against outside clicks; only Close button / Cancel / Esc dismiss). New state for rich-content drafts (add + edit). RuleDisplayRow shows a ✨ badge for rules with rich content. RuleEditRow gains `hasRichDraft` + `onOpenRichEditor` props + a ✨/✨+ button. Add form gains a ✨ Rich… button + a "Rich snippet attached" indicator with a "clear" link. Sub-modal sticky too (Save/Cancel/Esc only) for parent-modal consistency. FRAME COLOR PICKER: `CortexFrame` gains an optional `color` attr round-tripping via `data-color` + an inline `style="--cortex-frame-color: <hex>"`. CSS rule for `.cortex-frame` switches from `border: 2px solid var(--accent)` to `var(--cortex-frame-color, var(--accent))` so old frames render unchanged. EditorToolbar grows a `frameColor` state seeded from `localStorage[cortex:frame-color]`; the Frame button's glyph reflects the current choice (border tinted hex, or currentColor for default), and an adjacent color-swatch button opens a `ColorPicker` popover. Picking a color persists to localStorage AND, if the cursor is inside a frame, re-colors it via `updateAttributes("cortexFrame", { color: hex })`. Reset clears both. v1.3+ deferred: expand RichAfterEditor's extension whitelist (tables / CortexImage / Wikilink), schema-version `afterHtml` for forward-compat, per-rule preview thumbnail in the rule list, per-doc / per-vault frame-color preference, theme-aware frame color. |
| `cluster-24-v1.0-complete`   | QoL pack 2: file operations in the vault sidebar + recurring weekly / monthly review events. **(A) File ops.** Right-click on a folder row → "New file here / New folder here / Rename / Delete"; right-click on a file → "Rename / Delete". Inline rename: existing row's text becomes an `<input>` with the basename portion auto-selected (extension preserved); Enter commits, Esc / blur cancels. New file / new folder phantom rows appear under the targeted folder, which auto-expands. Delete confirmation modal shows path + name + (folders) contained-file count; Confirm sends to OS Recycle Bin via the new `trash = "5"` crate (recoverable). Wikilink rewrite: when an .md file is renamed, every other .md in the vault has its `[[old name]]` / `[[old name\|alias]]` / `[[old name#section]]` / `[[old name#section\|alias]]` rewritten to use the new basename — case-insensitive target match, whitespace preserved (`[[ Old ]]` → `[[ New ]]`). Manual scan (no regex), splits target from suffix at the first `#` or `\|`. Pane sync: on rename, save any dirty pane that references the renamed path, then walk paneRefs and re-aim any pane whose `getPath()` matches (folder rename also remaps sub-paths via prefix substitution). On delete, close any pane showing the deleted path or anything beneath it. New Tauri commands `create_file_in_folder` / `create_folder_in_folder` / `rename_path(update_wikilinks)` / `trash_path` with `cortex24_validate_filename_segment` / `cortex24_ensure_within_vault` / `cortex24_purge_path_from_index` / `cortex24_walk_for_indexable_files` / `cortex24_rewrite_wikilinks_in_vault` / `cortex24_rewrite_wikilinks_in_string` helpers. New components `FileTreeContextMenu` / `DeleteConfirmModal`; `FileTree.tsx` gains `pendingEdit` (rename / new-file / new-folder) + `onContextMenu` + `onCommitEdit` props plus an `InlineEditInput`. App.tsx grows `dispatchFileTreeAction` / `commitFileTreeEdit` / `confirmDelete`. **(B) Review schedule.** Two recurring all-day events with stable IDs `cortex-review-weekly` (RRULE `FREQ=WEEKLY;BYDAY=SU`) and `cortex-review-monthly` (RRULE `FREQ=MONTHLY;BYDAY=1SU`), both with `notify_mode='urgent'` so the Cluster 15 bell keeps them visible all day until acknowledged. Auto-create review category `Review` (`#a78bfa`) via `cortex24_ensure_review_category`. Anchor `start_at` / `end_at` = the most recent past Sunday at LOCAL-MIDNIGHT (UTC unix); uses `tz_offset_minutes` from the frontend per Cluster 14 v1.4 precedent. New Tauri commands `ensure_review_events(vault, weekly_enabled, monthly_enabled, tz_offset_minutes)` (UPSERT — re-running is idempotent; disabled = DELETE by stable id) and `get_review_settings(vault) -> (bool, bool)`. **Recurrence expander extension**: pre-Cluster-24 the MONTHLY arm only honored BYMONTHDAY (or master's day-of-month). v1.0 adds support for positional BYDAY tokens (1SU = first Sunday of month, -1MO = last Monday, etc.) via new `cortex24_parse_positional_byday` and `cortex24_nth_weekday_of_month` helpers; pre-Cluster-24 monthly events are unaffected because they don't carry a positional token. New `ReviewSettingsModal` with two checkboxes; loads via `get_review_settings`, saves via `ensure_review_events`. Auto-init on first vault load (`useEffect` on `vaultPath`) creates both reviews with both flags ON unless the localStorage flag `cortex:reviews-initialized:<vaultPath>` is already true. New "Reviews" sidebar button next to "Templates". `index.css` adds `.cortex-filetree-ctxmenu` / `-item` / `-divider` / `-shortcut` for the right-click menu chrome. Cargo adds `trash = "5"` and `regex = "1"` (regex reserved for future use; v1.0 uses manual scan). v1.1+ deferred: drag-and-drop file move, per-Sunday monthly choice (first / second / … / last), review-day daily-note templates, configurable EVENT_LOOKBACK for review events, multi-select FileTree ops, undo for trash, indicator badge on calendar review events. |
| `cluster-23-v1.0-complete`   | Revision strikethrough. Ctrl+click on any struck range opens a single-line, rectangular, contenteditable bubble that floats DIRECTLY ABOVE the strike AND SPANS THE STRIKE'S WIDTH EXACTLY (left/right edges aligned to the strike's bbox) — the lab-notebook gesture of crossing out and writing the revised idea right above the cross-out, occupying the same horizontal extent. Anchor: `top = startCoords.top - rootRect.top`, `left = startCoords.left - rootRect.left`; width set inline to `endCoords.right - startCoords.left` (single-line) or `rootRect.right - startCoords.left` (multi-line wrapped fallback), floored at 16 px; bubble's inline `transform: translateY(calc(-100% - 4px))` then pulls it UP by its own height plus a 4-px gap. CSS `box-sizing: border-box` so the inline width includes padding+border (without it the bubble would render ~17 px wider than the strike). Type the replacement; saved on the strike's `data-revision` attr round-tripping via tiptap-markdown's `html: true`. Bubble open/closed state is **ephemeral** — only the revision text persists; on reload every bubble starts closed; reopening shows the saved value pre-populated. New mark `CortexStrikeRevision` (`src/editor/CortexStrikeRevision.ts`) extends `@tiptap/extension-strike` with a `revision: string \| null` attr; markdown serializer is a function-based open tag that emits `<s data-revision="…escaped…">` when non-empty (HTML-escapes `&` `<` `>` `"`) and bare `<s>` otherwise — plain strikes round-trip identically to pre-Cluster-23 format so existing files are unchanged. New `strikeRevisionPlugin` in the same file: state is `Array<{id, from, to}>` of open bubbles, four meta kinds (`toggle` / `close` / `closeAll` / `ignore`); `props.handleClick` detects Ctrl/Cmd+click on a strike, calls `findStrikeRangeAtPos` (walks `$pos.marks()` both directions while strike is present) to get the contiguous strike run, dispatches `toggle`. On `tr.docChanged` with no toggle meta, every range remaps through `tr.mapping`; ranges that collapse or no longer carry a strike on their first character are pruned. Esc dispatches `closeAll` if any bubble is open. `setStrikeRevision(state, from, to, text)` helper updates a strike's revision attr via `removeMark + addMark` tagged with `{kind:"ignore"}` so the apply-time prune-pass doesn't fire. New `RevisionBubbleOverlay` (`src/components/RevisionBubbleOverlay.tsx`) subscribes to `editor.on("transaction")` and the wrapper's scroll/resize, computes wrapper-local coords from BOTH `view.coordsAtPos(b.from)` and `view.coordsAtPos(b.to)` to derive the strike's bbox top + horizontal midpoint, mounts one `<RevisionBubble>` per open bubble. Each `<RevisionBubble>` is a contenteditable div that on mount writes `bubble.revision` to `el.textContent` BEFORE focusing (the v1.0.1 fix — without this seed step, reopening a bubble on a strike that already had a saved revision rendered the bubble empty because the post-focus "external sync" effect early-returns when `document.activeElement === el`; first keystroke then wiped the saved data-revision via setStrikeRevision), then focuses with caret at end so the user appends. Dispatches `setStrikeRevision` on input, closes on Esc / Enter; per-keystroke `e.stopPropagation()` so editor shortcuts (`Ctrl+S`, `Ctrl+1-7`, `Ctrl+Shift+X`) don't fire while focused. Editor.tsx wiring: removed inline `HtmlStrike` in favor of `CortexStrikeRevision.extend({addProseMirrorPlugins(){return [buildStrikeRevisionPlugin()]}})`; new `proseWrapperRef = useRef<HTMLDivElement>(null)` attached to `.prose` div; wrapper gets `position: relative` so absolute-positioned bubbles anchor there; overlay mounted as a sibling of `<EditorContent>` inside the prose wrapper. `index.css` `.cortex-revision-bubble` at z-index 50 — 1.5em tall, `white-space: pre + overflow: hidden + text-overflow: ellipsis` when unfocused (long replacements ellipsis-truncate up to max-width 28rem); on `:focus` the rule swaps to `overflow-x: auto + text-overflow: clip` so the caret stays visible while typing past the visible width. `ShortcutsHelp.tsx` gains a "Ctrl+Click (on strikethrough)" EDITOR_MODE row. Reviews pipeline (Cluster 3 / `extract_marks` on the Rust side) reads strike-presence and ignores `data-revision` so the Cluster 2 resolve semantics are preserved. v1.1+ deferred: visible indicator on strikes that carry a revision (icon / dotted underline), multi-line revisions, rich text inside the bubble, Reviews-pipeline integration ("review my edits" destination), external-source revisions (AI suggestions), per-revision metadata (author / timestamp), hover-to-preview tooltip without opening the bubble, flip-below-when-no-room-above for strikes near the top of the doc, smarter multi-line strike anchoring |
| `cluster-21-v1.1-complete`   | Cluster 21 follow-up. Closes the v1.0 deferred backlog: code-block syntax highlighting + interactive Tabs / Collapsible NodeViews. CODE BLOCKS: new `src/editor/CortexCodeBlock.ts` registers `@tiptap/extension-code-block-lowlight` with a `lowlight` instance that registers Python / JavaScript / TypeScript / Rust / Go / JSON / Bash / Shell (plus aliases py/js/ts/rs/golang/sh/console). StarterKit's built-in codeBlock disabled (`codeBlock: false`); CortexCodeBlock is the only registered code-block node. `CORTEX_CODE_LANGUAGES` constant exports the user-friendly label list. Toolbar gains a `<select>` next to the {} button visible only when the cursor is in a code block (`editor.isActive("codeBlock")`); writes `language` attr via `editor.chain().updateAttributes("codeBlock", {language})` and lowlight's prosemirror plugin re-tokenizes on the next doc change so the colors update immediately. CSS theme: full `.hljs-*` token set (keyword / string / number / comment / title / variable / type / regexp + emphasis / strong) for VS Code light-mode defaults plus a Dracula-adjacent dark palette gated on both `prefers-color-scheme: dark` AND `body.cortex-theme-dark` so OS preference and manual toggles both work. INTERACTIVE NODEVIEWS: new `src/editor/CortexBlockNodeViews.tsx` exports `CortexTabsNodeView` and `CortexCollapsibleNodeView` React components. Both are wired at registration time via `.extend({ addNodeView() { return ReactNodeViewRenderer(...) } })` — the underlying schema in `CortexBlocks.ts` is unchanged for parseHTML compat with v1.0 markdown; the NodeView only owns the chrome. TABS: tab strip is `contentEditable={false}`, click-to-switch dispatches `updateAttributes({ activeTab: idx })` which writes a new node attr that persists through the markdown round-trip via `data-active-tab=<n>`. Active panel display via a CSS custom property `--cortex-tab-active` set on the wrapper, with `.cortex-tab-body > *:nth-child(var(--cortex-tab-active)) { display: block }` rules. ProseMirror keeps owning all child blocks; non-active children are simply `display: none` (rejected: rendering only the active child via React children — fights ProseMirror, which expects to own the full child list and resyncs if rendered count diverges; rejected: moving children into the active state on tab change — destroys content the user typed into other tabs). renderHTML emits `style="--cortex-tab-active: <n+1>"` so the read-mode HTML also displays the right panel without JS. Empty-tabs case (`data-tabs=""`) renders a muted "no tabs — set data-tabs" placeholder. COLLAPSIBLE: summary header is a `contentEditable={false}` flexbox row with a chevron button (rotating SVG) and the summary text. Single-click on either toggles `open` via `updateAttributes({ open: !open })`; double-click on the summary text swaps in an `<input>` for inline rename (Enter commits, Esc cancels and reverts, blur commits). Chevron rotates -90° when closed → 0° when open via a CSS transform with 120ms ease. Body uses `display: none` when the wrapper class doesn't include `open`. The `open` attr round-trips via both the native `open` HTML attribute AND a `data-open="true|false"` attr so the NodeView's div-rendered emit AND the legacy details-rendered emit both parse back correctly; parseHTML accepts both `details.cortex-toggle` and `div.cortex-toggle`. ARCHITECTURAL DECISIONS: lowlight chosen over Shiki / Prism — TipTap-blessed, smaller bundle, opt-in language registry (Shiki ships ~3 MB WASM Cortex doesn't need; Prism's API is older and less prosemirror-friendly). `activeTab` and `open` live as node attrs (not local state) so they persist through file save / reload — same rule as v1.0 toolbar prefs (those persist via localStorage; node-state belongs in the doc). Single-click toggles, double-click renames — standard "edit-in-place" gesture (matches file rename, table column rename); rejected toolbar edit button approach because that consumed real estate and required two clicks even for users who never wanted to rename. Files added: `src/editor/CortexCodeBlock.ts`, `src/editor/CortexBlockNodeViews.tsx`, `verify-cluster-21-v1.1.ps1`. Files modified: `src/components/Editor.tsx` (StarterKit codeBlock: false + register CortexCodeBlock + extend CortexCollapsible/CortexTabsBlock with addNodeView returning ReactNodeViewRenderer + imports), `src/editor/CortexBlocks.ts` (Collapsible parseHTML accepts `div.cortex-toggle`; renderHTML emits `data-open="true|false"`; TabsBlock new `activeTab` attr defaulting 0 with parseHTML/renderHTML through `data-active-tab`; renderHTML emits `style="--cortex-tab-active"` for read-mode), `src/components/EditorToolbar.tsx` (language `<select>` + import CORTEX_CODE_LANGUAGES), `src/index.css` (new Cluster 21 v1.1 section: hljs token theme light/dark/manual, Tabs hover/focus/nth-child show-hide/empty-tabs placeholder, Collapsible chevron rotation/summary input/body display, `.cortex-tb-lang-select` rule), `package.json` (added `@tiptap/extension-code-block-lowlight`, `lowlight`, `highlight.js`). v1.2+ deferred: tabs drag-to-reorder + add/remove inline (currently rename via raw markdown's data-tabs attr), nested-collapsible state survives parent toggles, code blocks line numbers / copy button / "open in external editor" / more language registrations on demand, KaTeX rendering for cortexMathBlock and cortexMathInline (still stylized text in v1.1) |

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
