# Cortex — Project Notes

Running log of what's been built, what's quirky, and the decisions that\
wouldn't otherwise be obvious from reading the code. Not for the vault —\
this file is the *project's* memory, not the user's notes.

---

## Phase 1 — Week 1 complete

**Shipped:** vault picker, persistent config, file tree sidebar, expansion\
state persistence, refresh button, filesystem watcher with auto-refresh.

**Cannot yet:** edit files, save anything, search, follow wikilinks, see\
backlinks, index content. All of that is Weeks 2–3.

\[\[2026-04-25\]\]

\[\[2026-04-25 — Saturday\]\]

### Commits (expected by end of Week 1)

- `Day 1 — vault picker and persistent config`
- `Day 2 — file tree sidebar with read-only navigation`
- `Day 3 — persist expansion state, add refresh button`
- `Day 4 — filesystem watcher with auto-refresh`
- `Week 1 complete — foundation: vault, file tree, watcher`
- Tag: `week-1-complete`

---

## Architectural decisions made

Ordered roughly chronologically. These shape later work, so surface them in\
PHASE-1-RETRO before handing off to Phase 2.

### Config file

- `%APPDATA%\declercq-cortex\config.json` — resolved via Tauri's\
  `app.path().app_config_dir()` so it's cross-platform by construction.
- Schema includes `vault_path` AND `last_open_file` from the start, even\
  though Day 1 only writes `vault_path`. Week 2 Day 5 needs the second field;\
  stuffing it in now means no future migration.
- Corrupt or missing config → silently fall back to defaults. First launch\
  must never be an error state.
- `load_vault_config` returns `None` when the saved path has been deleted\
  externally. The frontend treats None identically to "no config yet" and\
  shows the picker. This is the Week 4 "vault-moved" robustness test,\
  landed early.

### File tree

- Hidden entries (names starting with `.`) and `node_modules` are skipped\
  unconditionally. `node_modules` matters — a stray one in a vault could\
  add tens of thousands of files to the tree.
- Sort order: folders before files, alphabetical within each group,\
  case-insensitive. The conventional file-explorer layout.
- `DirEntry::metadata()` instead of `path.is_dir()` — uses the data the OS\
  already returned with the dir listing, avoids a second stat() on Windows.
- `FileNode` is a tagged enum (`#[serde(tag = "type")]`) → on the JS side\
  it's a discriminated union. Lets TS narrow in `if (node.type === ...)`\
  blocks without runtime type checks.

### Expansion state

- Persisted to `localStorage` under key `cortex:expanded:<absolute-path>`.\
  Absolute paths prevent cross-vault collision for free.
- Namespaced with `cortex:` prefix so we never stomp on someone else's keys\
  if this origin ever hosts anything else.
- `try/catch` wraps every `localStorage` call — embedded WebView2 can\
  throw `SecurityError` in some Windows enterprise configurations.
- **Stale keys accumulate**: deleting a folder leaves its expansion entry\
  in localStorage forever. Not worth cleaning up now (booleans, tiny).

### Filesystem watcher

- `notify` crate with `RecommendedWatcher` — uses ReadDirectoryChangesW on\
  Windows.
- Single watcher at a time. Switching vaults drops the old watcher, which\
  drops its channel sender, which causes the old worker thread's `rx.recv()`\
  to return `Err` and exit cleanly. No explicit stop signal needed — Rust\
  ownership does the coordination.
- Debounced at **500ms**. Balances perceived latency against `git pull`\
  style bursts.
- We ignore `notify::Event.kind` — any event means "re-read the tree."\
  Filtering was premature complexity (Windows rename-as-move edge cases\
  would bite us).
- Events signal via a Tauri event called `vault-changed`. The frontend\
  listens and bumps `refreshKey`, which is `FileTree`'s re-fetch trigger.

### Plugins used / skipped

- `tauri-plugin-dialog` — **yes**, needed for the directory picker.
- `tauri-plugin-fs` — **skipped** on purpose. All file IO is in Rust via\
  `std::fs`. The JS fs plugin would be dead weight and a permissions\
  headache. Add it only if/when the frontend needs direct FS access.
- `@tailwindcss/vite` — installed but not loaded in vite.config.ts. Not\
  used in Week 1; Week 2+ will wire it up when the editor needs prose\
  typography.

---

## Known issues / rough edges

### Minor (can live with these through Phase 1)

- `src/App.css` is orphaned — nothing imports it since Day 1. Safe to delete\
  whenever convenient.
- `src/assets/react.svg`, `public/tauri.svg`, `public/vite.svg` — all\
  scaffold leftovers, nothing references them. Delete at will.
- `verify-day-*.ps1` helper scripts are committed to the project. Fine for\
  now; can move to a `scripts/` folder or `.gitignore` them later.
- TipTap, gray-matter, date-fns, tiptap-markdown all in package.json\
  unused. They're planned for Weeks 2–3.

### Watch list (surface in Phase 2 retro if they bite)

- OneDrive / network drives: `notify` is known to be flaky on these.\
  Vault is on plain local disk so we're fine *for now*.
- Windows path length: if the vault is deep, absolute paths can exceed\
  260 chars and `read_vault_tree` may fail. We serialize paths through\
  `to_string_lossy()` which masks some edge cases. If reported, investigate.
- The watcher's 500ms debounce might be too *short* for enormous vaults\
  (thousands of files changing via a `git pull` could still overwhelm the\
  tree fetch). 500ms was picked for small vaults. Revisit if it breaks.

---

## Seven-day trial readiness (for Week 4)

By end of Week 4 the app needs to be trustworthy enough to use as a daily\
driver for seven consecutive days. Week 1's contribution to that bar:

- First-launch flow is warm and explains what a vault is.
- Switching vaults doesn't require restart.
- External changes appear without explicit refresh.
- Expansion state survives restarts — no friction from "oh I collapsed\
  that folder yesterday."
- Corrupt config doesn't brick the app.

Weeks 2–4 add the editor, search, wikilinks, daily log, polish, and the\
actual trial.

---

## Phase 2 — closed

Cluster 1 → 2 → 3 → 5 → 4 shipped in that order. Cluster 9 (Strong Inference
gate) was dropped — see `phase_2_overview.md` for the rationale. Phase 2 proper
is closed.

---

## Phase 3 — Cluster 8, Idea Log

**Shipped:** structured view over `type: idea` notes. Sortable table, status
filter (raw / promising / promoted / abandoned), inline status edit, click-
through to open. New ideas land in `04-Ideas/<name>.md` with a templated
frontmatter and three section headers.

**Sub-view scope:** only Idea Log. Methods Arsenal and Research Roadmap from
the same cluster remain on the shelf until their own triggers fire (per the
overview's Phase 3 "build on demand" rule).

### Architectural decisions

- **Frontmatter parsed on the frontend, not in Rust.** `query_notes_by_type`
  returns the raw YAML block as a string; `IdeaLog.tsx` runs it through the
  existing `gray-matter` dep on a synthetic `---\n…\n---\n` wrapper. This
  avoids adding `serde_yaml` to the Rust dependency tree, and keeps a single
  source of truth for YAML quirks (open-file frontmatter panel uses the same
  parser).
- **Index walks the FS directly.** `query_notes_by_type` does not read from
  the SQLite index; it walks the vault and parses each file. The cluster doc
  explicitly endorses this for now and flags a `note_metadata_extras` cache
  table as a future optimisation if >100 notes are sluggish.
- **Inline status edit reuses the Phase 1 frontmatter round-trip.** The
  dropdown does `read_markdown_file` → `parseFrontmatter` → mutate `status`
  → `serializeFrontmatter` → `write_markdown_file` → `index_single_file`.
  No new "update field" command; less surface area to maintain.
- **`HierarchyKind` extended with `"idea"` rather than introducing a second
  modal.** The existing `NewHierarchyModal` already handled name-only flows
  (notes), so adding ideas was a single-branch addition.
- **No new keyboard shortcut.** Opening Idea Log lives on the sidebar
  "Ideas" button. Adding a `Ctrl+I` shortcut would collide with TipTap's
  italic; `Ctrl+Shift+I` is already the iteration creator. Sidebar discov-
  erability is sufficient for an MVP; revisit if the user starts asking for
  one.

### Files touched

- `src-tauri/src/lib.rs` — `query_notes_by_type`, `create_idea`,
  `extract_frontmatter_block` helper, `IDEAS_DIR` constant; both commands
  registered in `invoke_handler`.
- `src/components/IdeaLog.tsx` — new view.
- `src/components/NewHierarchyModal.tsx` — `HierarchyKind` gains `"idea"`,
  new submit branch wires `create_idea`.
- `src/App.tsx` — `ActiveView` gains `"idea-log"`, render branch added,
  sidebar gets "+ Idea" and "Ideas" buttons.
- `verify-cluster-8.ps1` — verify-script-pattern with smoke-test checklist.

### Known rough edges

- New ideas don't appear in an open Idea Log until the user closes and re-
  opens it (or the watcher's 1.5s reindex bumps `indexVersion`). Acceptable
  because the typical flow is "create idea → write its content → return to
  Idea Log later." If it bites, give `IdeaLog` an internal `bumpFetch` that
  fires when an idea is created.
- Status taxonomy (raw / promising / promoted / abandoned) is the cluster
  doc's v1 guess. May need adjustment after real use — keep flexible.
- `related_concepts` is rendered as a comma-separated list with `[[…]]`
  brackets stripped. It does not yet auto-link. Defer until there's enough
  related-concept data to motivate it.

---

## Phase 3 — Cluster 8, Methods Arsenal

**Shipped:** structured catalogue over `type: method` notes. Sortable table
with five columns (Domain, Title, Complexity, Last used, ✓ Used today),
filterable by domain, with an inline "✓ Used today" action that bumps the
`last_used` field. New methods land in `05-Methods/<name>.md` with a
templated frontmatter and four section headers (What it is / When to reach
for it / Steps / Pitfalls).

### Architectural decisions

- **Reused Idea Log's infrastructure verbatim.** The Rust side needed only
  one new command (`create_method`); the existing `query_notes_by_type`
  serves Methods Arsenal because it filters on the `type` field generically.
  This is the moment the cluster doc's claim that "Day 1 (the shared infra)
  pays off across all three sub-views" was tested — and held.
- **Inline action is "✓ Used today" rather than a domain dropdown.** The
  cluster doc flags `last_used` as the most-bumped field once a catalogue
  is in active use ("dragging an idea from raw to promising is a one-second
  decision the user makes often" — same shape, different field). Domain is
  set at creation time and rarely changes; it's read-only in the table.
- **Complexity rendered as `●●●○○`** rather than a numeric "3/5". Visual
  scan is faster than numeric parsing once you have >10 methods. The
  underlying data is still numeric.
- **Methods can technically live anywhere with `type: method`.** The
  filter is type-based, not directory-based — same rule as Idea Log.
  `05-Methods/` is just the default home for the templated creator.
- **`NewHierarchyModal` extended with `domain` and `complexity` inputs.**
  Both are dropdowns (5-value enum and 1-5 integer respectively), avoiding
  free-text entry that would balloon the taxonomy. Open question from the
  cluster doc — whether complexity should become "expertise required"
  instead — preserved as a v1 guess to revise after real use.

### Files touched

- `src-tauri/src/lib.rs` — `create_method` command and `METHODS_DIR`
  constant; registered in `invoke_handler`. `query_notes_by_type` reused
  unchanged.
- `src/components/MethodsArsenal.tsx` — new view.
- `src/components/NewHierarchyModal.tsx` — `HierarchyKind` gains `"method"`,
  domain + complexity state and inputs added, new submit branch wires
  `create_method`.
- `src/App.tsx` — `ActiveView` gains `"methods-arsenal"`, render branch
  added, sidebar gets "+ Method" and "Methods" buttons.

### Roadmap status

Research Roadmap (the third sub-view of Cluster 8) is **deliberately
deferred**. Its trigger — "you've struggled to articulate where your
research is going in an advisor meeting" — hasn't fired in the trial
journal. It's also the architecturally heaviest of the three: card
layout over the project hierarchy, goal annotations on project
frontmatter, plus a separate "recent iteration activity" timeline
sidebar. Building it speculatively before the trigger fires would
violate the overview's own pacing rule. Revisit if/when the trigger
shows up.

### Known rough edges

- "Used today" is idempotent (the button disables when `last_used` is
  already today) but not reversible. If the user fat-fingers it, they
  edit the file's frontmatter manually. Acceptable; the cluster doc
  flags this exact concern: "Defer this command if it feels heavy."
- Complexity is captured at creation time but the modal doesn't expose
  an edit affordance. Editing complexity means opening the file and
  changing the frontmatter directly. If this becomes friction, add a
  per-row "edit metadata" inline panel later.

---

## Phase 3 — Cluster 8 v2 — Methods rework + Protocols subsystem

User-driven evolution of the Methods design after the v1 build.

### What changed and why

**Method template restructured.** The v1 template (What it is / When to
reach for it / Steps / Pitfalls) is replaced by a five-section template
that better matches how methods are actually used in the lab/modeling
work: Protocols List, Objective, Reagents/Parts List, Steps, Outcome.

**`last_used` removed from Method frontmatter.** A manually-bumped field
goes stale; file mtime carries the same signal at zero maintenance cost.
The `MethodsArsenal` view's column is now "Last modified" rendered as a
relative time (`5m ago`, `3d ago`, ISO date for older entries).

**The "✓ Used today" inline action is gone.** Followed `last_used`
out the door.

**New: Protocols subsystem.** Protocols are atomic units (a single
specific operation) that own their own reagents/parts. Methods are
*compositions of protocols* leading to a scientific result. New folder
`06-Protocols/`, new `type: protocol`, new sidebar buttons (`+ Protocol`,
`Protocols`), new view (`ProtocolsLog.tsx`), new Tauri creator
(`create_protocol`).

**New: auto-fed Reagents/Parts table.** A Method's Reagents/Parts List
section regenerates on file-open from the protocols the user wikilinks
under "## Protocols List". Reuses Cluster 3's auto-section pattern but
with section-scoped HTML-comment markers (`<!-- REAGENTS-AUTO-START -->`
… `<!-- REAGENTS-AUTO-END -->`) so only the table region is owned by
Cortex; everything else in the Method file is the user's.

### Architectural decisions

- **Wikilinks, not frontmatter, for the Method→Protocols relationship.**
  The user is going to be authoring `## Protocols List` content
  anyway; making it the source of truth means no schema duplication.
  Cortex parses the section, extracts `[[…]]` tokens, resolves each to
  a protocol file (filename match → H1 match → unresolved-warning row).
- **Reagents schema lives on protocols.** Each protocol's frontmatter
  has `reagents: [{ name, description, quantity, price }]`. Methods
  re-derive on open; Methods never store reagent data. Single source of
  truth, no sync bugs. The cost is one filesystem walk per Method open
  — measured negligible on the trial vault, will be reconsidered if it
  hits.
- **Hand-rolled YAML reagents parser.** Resisted adding `serde_yaml` to
  Cargo.toml. The reagents shape Cortex itself writes is simple
  (flat list of objects with 4 known scalar keys), so a tuned parser
  that walks the indentation structure is enough. `parse_reagents_yaml`
  in `lib.rs`. If users hand-edit complex YAML and break the parser,
  the regen function silently produces an empty table rather than
  corrupting the file — a "no reagents" outcome is recoverable;
  truncation is not.
- **Section-scoped auto-markers, not file-global.** Cluster 3's
  persistent files own everything below their marker. Methods can't
  do that — Steps and Outcome are user content that follow the
  Reagents/Parts section. The fix is two markers (START + END)
  bracketing only the table. The regenerator has three branches:
  both markers present → splice between them; markers missing but
  the heading exists → insert markers under the heading; heading
  missing entirely → append a fresh section at EOF.
- **Wikilink resolver in Rust, not JS.** Auto-regen runs server-side
  during file-open. Re-implementing the (filename-then-H1) resolution
  in Rust avoided a frontend round-trip. Walks the vault twice in the
  worst case (once for filenames, once for H1s); negligible at trial
  scale.
- **Trigger for regen: file open inside `05-Methods/`.** Same hook
  point as Cluster 3's `PERSISTENT_FILE_BASENAMES` check. On every
  `selectFile` call, if the path is under `05-Methods/`, invoke
  `regenerate_method_reagents` before reading. Idempotent — if the
  user edits the Protocols List, saves, and reopens, the table
  refreshes; if nothing changed, the file is rewritten only when the
  computed table differs from disk (saves a no-op git commit).

### Files touched (v2 + Protocols)

- `src-tauri/src/lib.rs`
  - Constants: `PROTOCOLS_DIR`, `REAGENTS_AUTO_START`, `REAGENTS_AUTO_END`
  - `create_method` — template rewritten, `last_used` removed
  - `create_protocol` — new Tauri command
  - `regenerate_method_reagents` — new Tauri command
  - Helpers: `extract_protocols_list`, `parse_reagents_yaml`,
    `assign_kv`, `resolve_wikilink`, `build_reagents_table`,
    `escape_cell`, `insert_under_heading`
  - Three new commands registered in `invoke_handler`.
- `src/components/MethodsArsenal.tsx` — column rename and "Used today"
  removal; relative-time helper added.
- `src/components/ProtocolsLog.tsx` — new view (mirrors MethodsArsenal
  shape with a `# Reagents` column).
- `src/components/NewHierarchyModal.tsx` — `HierarchyKind` += `"protocol"`,
  domain dropdown, submit branch.
- `src/App.tsx` — `ActiveView` += `"protocols-log"`, sidebar
  `+ Protocol`/`Protocols` buttons, render branch, regen hook in
  `selectFile` for `05-Methods/` files.

### Known rough edges

- Protocol reagents are edited by hand-editing the YAML inside the
  `06-Protocols/<name>.md` file. There's no inline reagent editor in
  the Protocols Log view yet. Fine for v1 — most users will set
  reagents once and rarely change them. Add a side-panel editor if
  this becomes friction.
- The wikilink resolver walks the whole vault twice (filename pass,
  H1 pass) per regen invocation. For vaults under ~1000 notes this
  is well under a frame. If the user reports lag opening Method
  files, cache the protocol lookup table.
- The hand-rolled YAML parser handles the simple flat-object shape.
  Anchors, references, multiline strings, and nested objects are
  silently ignored. If a user writes a `reagents:` entry the parser
  doesn't understand, that entry is dropped from the table without
  error. This is intentional — the alternative (panicking or
  surfacing a parse error) would be louder than necessary for an
  edge case the documented schema doesn't reach.
- "Last modified" relative-time on the Methods/Protocols views is
  computed at render time, not on a timer. A view that's been open
  for an hour will say "5m ago" forever until the user re-mounts it.
  Acceptable — these views are dip-in dip-out, not always-on.

---

## Phase 3 — Cluster 8 v2.1 — Reagents move from frontmatter to body table

User-driven correction immediately after v2 shipped. The original v2 put
each protocol's reagents into a `reagents:` YAML array in frontmatter.
v2.1 flips that: reagents now live in a markdown table inside the
protocol body, under the `## Reagents/Parts List` heading. Methods
aggregate by reading those tables, not by reading frontmatter.

### Why the flip

- **Editing structured data inside YAML is painful.** A markdown table
  is the right authoring surface for tabular data — it renders inline,
  it's columnar in the editor, it doesn't require remembering where to
  put quotes and dashes. The first attempt at v2 already exposed this
  pain: the "smoke test" for protocols required hand-editing the YAML
  array, which was friction the user noticed immediately.
- **Symmetry with the consuming surface.** A Method's auto-generated
  Reagents/Parts table is a markdown table. Now the protocol's authoring
  surface is the same shape. Aggregation is conceptually
  "concatenate these tables and add a Source column" — the visual
  format is identical from input to output.
- **No YAML-shape surprises.** The hand-rolled YAML reagent parser is
  gone. Markdown table parsing is a far more constrained problem and
  the implementation is simpler and more robust.

### What changed

- **`create_protocol` template** — `reagents: []` removed from
  frontmatter; a `## Reagents/Parts List` body section added with a
  starter table (header + separator + one empty row).
- **`parse_reagents_yaml` deleted; replaced with `parse_reagents_table`.**
  The new parser walks the body, finds the `## Reagents/Parts List`
  heading, skips the header row, detects and skips the separator
  (cells of dashes/colons only — also handles tables without a strict
  separator), then reads each subsequent pipe-delimited row as a data
  row. Cells are positional: name / description / quantity / price.
  All-empty rows (the template placeholder) are filtered out.
- **`assign_kv` deleted.** It was a YAML-only helper.
- **`regenerate_method_reagents`** — calls `parse_reagents_table(&body, …)`
  instead of `parse_reagents_yaml(&yaml, …)`. The wrapping logic
  (resolve wikilinks, aggregate rows, splice between markers) is
  unchanged.
- **`ProtocolsLog.tsx`** — dropped the `# Reagents` column and its
  sort option. Counting reagents now requires reading each protocol's
  body, which is too chatty to do on every list render. Re-add later
  with a cached count if needed. Columns are now: Domain / Title /
  Last modified.

### Trade-offs accepted

- **Pipe characters in reagent fields are not supported.** `escape_cell`
  still does the work for Methods' regenerated tables, but the protocol
  parser does basic split-by-pipe with no unescape pass. Names like
  "PBS|saline" would split incorrectly. Acceptable for v1 — the
  reagent fields (name, short description, quantity, price) almost
  never contain pipes in real chemistry/biology data.
- **Reagent count column is gone.** Cost/benefit didn't favour the
  extra body-parse-per-row needed to compute it.
- **Old protocols with `reagents:` in frontmatter will produce an
  empty Method table.** No migration is needed because v2 shipped less
  than a session ago and no real data exists yet. If reagents were
  populated, hand-port them into the body table — the same shape.

### Files touched (v2.1)

- `src-tauri/src/lib.rs` — `create_protocol` template; replaced
  `parse_reagents_yaml`/`assign_kv` with `parse_reagents_table`;
  `regenerate_method_reagents` updated to call the new parser.
- `src/components/ProtocolsLog.tsx` — column / sort / blurb tweaks.
- `verify-cluster-8.ps1` — smoke-test refreshed to reflect the new
  protocol-editing flow.

---

## Phase 3 — Cluster 8 v2.1.1 — TipTap actually has table support now

User reported "the markdown table did not work." Diagnosis: TipTap's
StarterKit ships without table extensions, and `tiptap-markdown`'s
`html: true` was preserving HTML in *content* but couldn't conjure a
Table node into TipTap's schema. Result: opening a protocol file
flattened the markdown table to paragraphs of pipe-delimited text;
edits broke the format on save.

### Fix

- **Added four TipTap deps** at the same major version as the rest:
  `@tiptap/extension-table`, `@tiptap/extension-table-row`,
  `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`.
  User must `pnpm install` before running.
- **Registered them in `Editor.tsx`** with `Table.configure({ resizable: true })`
  for column drag-handles. `TableRow`, `TableHeader`, and a custom
  `TableCellWithTab` (extending `TableCell`) are added to the
  extensions array.
- **Custom Tab keymap** — TipTap's default Tab behaviour navigates to
  the next cell but escapes the table on the last cell of the last
  row. We override Tab so it tries `goToNextCell` first; if that
  fails (we're at the end), it appends a fresh row and moves the
  cursor into it. This is the natural authoring flow for filling
  reagent tables.
- **Baseline table CSS in `index.css`** — Tailwind Typography's `.prose`
  class strips table borders by default. We re-add cell borders, a
  header tint (`var(--bg-deep)`), zebra-stripes (`var(--bg-elev)`), a
  visible-on-hover column resize handle, and the `.selectedCell`
  highlight TipTap uses for cell selection.
- **`Tab (in table)` and `Shift+Tab (in table)` added to ShortcutsHelp**
  so the behaviour is discoverable.

### Files touched (v2.1.1)

- `package.json` — four new TipTap deps.
- `src/components/Editor.tsx` — table-extension imports, `TableCellWithTab`
  custom node, extensions registered.
- `src/index.css` — table CSS section.
- `src/components/ShortcutsHelp.tsx` — Tab/Shift+Tab table rows added
  to the active-shortcuts list.
- `verify-cluster-8.ps1` — `pnpm install` step made explicit; smoke
  test now describes the actual editing flow (click cells, Tab,
  resize columns).

### v2.1.1 follow-ups (post-ship corrections)

- **TipTap v3 named-import fix.** First boot after wiring the table
  extensions hit a `does not provide an export named 'default'`
  syntax error from Vite. The four `@tiptap/extension-table-*`
  packages ship as **named** exports in v3, unlike the older
  Link/Placeholder/Strike packages which kept default-export
  backward-compat. Imports were corrected to `import { Table }`
  form. The custom `TableCellWithTab` keybinding override was
  also removed (its call to `editor.commands.goToNextCell()`
  was the most plausible runtime failure point if the rest of
  the wiring shifted under it). Plain `TableCell` is now
  registered; Tab/Shift+Tab still navigate cells via TipTap's
  built-in table keybindings.

---

## Phase 3 — Cluster 8 v2.1.2 — Insert-table UX (any note)

User wanted to insert tables anywhere, not just protocols, with both
a keyboard shortcut and a right-click menu, plus Excel/Word-style
row/column operations.

### What landed

- **`InsertTableModal.tsx`** — small dialog asking for rows × cols
  plus a "with header row" checkbox. Defaults 3×3 with header on.
  Reachable via `Ctrl+Shift+T` and via the editor's right-click
  "Insert table…" item.
- **`TableContextMenu.tsx`** — fixed-position popup menu rendered
  by the editor on right-click. Click-outside or Esc closes it.
  Items vary by context:
  - **Outside a table:** "Insert table…"
  - **Inside a table:** Insert row above/below, Insert column
    left/right, Delete row/column/table (red), Toggle header row,
    Merge cells (gated on `editor.can().mergeCells()`), Split
    cell (gated on `editor.can().splitCell()`), and a footer
    "Insert another table…".
- **Editor.tsx wiring:** `onContextMenu` handler that translates the
  click coordinates to a doc position, moves the selection there
  (so `editor.isActive('table')` reflects the click point, not
  whatever was selected before), snapshots `inTable` / `canMerge`
  / `canSplit` for the menu's lifetime (the predicates are reactive
  and would otherwise change underneath the menu), and dispatches
  TipTap chain commands when an item is picked.
- **App.tsx wiring:** `tableModalOpen` state, `Ctrl+Shift+T`
  shortcut, `onRequestInsertTable` callback into the Editor so the
  right-click menu can ask the App to open the modal. Submit calls
  `editorInstanceRef.current.chain().focus().insertTable({ rows,
  cols, withHeaderRow }).run()` — same instance pattern Cluster 4
  established for experiment-block insertion.

### Architectural choices

- **App owns the modal, Editor owns the context menu.** Modals are a
  consistent App-level UI surface here (palette, hierarchy, block,
  shortcuts, etc.); adding tables to that list keeps the discovery
  story consistent. The context menu is editor-scoped — its items
  are TipTap commands and its "is in a table" predicate comes from
  the editor's selection — so it lives in the Editor component.
- **Snapshot `canMerge` / `canSplit` at right-click time.** TipTap's
  `editor.can().X()` is reactive — it re-evaluates as the selection
  changes. If the menu re-read it on every render, the items could
  flicker on/off when the cursor briefly leaves the original cell.
  Frozen booleans give a stable menu.
- **Right-click moves the cursor before opening the menu.** This is
  what users expect (Excel/Word do this). It's also what makes
  `editor.isActive('table')` correct for the click point rather
  than for whatever the previous selection was.
- **No keyboard navigation in the context menu (yet).** Mouse-driven
  to start; v1 covers the documented ask. Adding arrow-key and
  Enter handling later is a small, isolated change inside
  `TableContextMenu.tsx`.

### What's intentionally deferred

- **Cell alignment / cell shading / text colour.** The TipTap table
  extension exposes `setCellAttribute` for arbitrary attrs, but a
  proper alignment toolbar wants both a UI affordance and a
  serialisation contract for round-tripping through markdown. Not
  in this round.
- **Drag-resize columns.** `Table.configure({ resizable: true })`
  was removed during the v2.1.1 white-screen triage and not put
  back. Easy to re-enable once we confirm it doesn't conflict
  with the Tauri WebView's pointer event handling.
- **Persist column widths to markdown.** Markdown has no native
  representation for column widths; persistence would require
  embedding HTML tables instead. Skipping.
- **Excel-style formula cells.** Out of scope.

### Files touched (v2.1.2)

- `src/components/InsertTableModal.tsx` — new component.
- `src/components/TableContextMenu.tsx` — new component.
- `src/components/Editor.tsx` — `onContextMenu` handler, ctxMenu
  state, `runTableAction` dispatcher, `onRequestInsertTable`
  prop, render menu.
- `src/App.tsx` — `tableModalOpen` state, Ctrl+Shift+T binding,
  modal rendered, callback into Editor.
- `src/components/ShortcutsHelp.tsx` — Ctrl+Shift+T and
  "Right-click in editor" rows.

---

## Phase 3 — Cluster 8 v2.1.3 — Text alignment + focus-aware shortcuts

User wanted Ctrl+Shift+L/E/R for left/centre/right alignment, but
Ctrl+Shift+E was already taken by "new experiment." Fix is two-sided:
add the alignment extension with TipTap's keymap (which only fires
when the editor has focus), then gate the App-level hierarchy
shortcuts on focus state so they don't fight TipTap when the user is
typing.

### What landed

- **`@tiptap/extension-text-align`** added at `^3.22.4` matching the
  rest of the TipTap stack. User must `pnpm install` before testing.
- **`TextAlignWithShortcuts`** in `Editor.tsx` — the base extension
  doesn't ship its own keymap, so we extend it with
  `addKeyboardShortcuts`:
    - `Mod-Shift-l` → `setTextAlign("left")`
    - `Mod-Shift-e` → `setTextAlign("center")`
    - `Mod-Shift-r` → `setTextAlign("right")`
  Configured for `["heading", "paragraph"]` types — alignment doesn't
  make sense on inline marks, lists, or table cells in v1.
- **Focus-aware App shortcuts.** New helper `isEditorFocused()` checks
  `document.activeElement.closest('.ProseMirror')`. `Ctrl+N`,
  `Ctrl+Shift+P`, `Ctrl+Shift+E`, `Ctrl+Shift+I` now require
  `!isEditorFocused()` to fire. When the editor has focus, these
  chords fall through to TipTap's keymap; when the editor doesn't
  (sidebar buttons, empty main pane, modals open, etc.), they fire
  the App's hierarchy modals as before.
- **`ShortcutsHelp` restructured** into three sections — Always
  active / Sidebar mode / Editor mode — so the focus-conditional
  behaviour is discoverable.

### Architectural choices

- **TipTap keymaps are bound to the editor DOM root** by ProseMirror's
  keymap plugin. They only fire when the editor has focus. Window-level
  `keydown` handlers (which is what App uses) always fire. With both
  in play and ProseMirror not stopping propagation, both handlers
  would run for the same chord — the gate on `isEditorFocused()` is
  what prevents the App handler from firing the sidebar action when
  TipTap has already done the alignment.
- **`document.activeElement.closest('.ProseMirror')`** rather than a
  React-tracked focus state. No effect listeners, no stale state, no
  ref plumbing — a one-line check at keydown time. The class is
  TipTap's stable contract for the editable root.
- **`Mod-Shift-*` (TipTap notation) instead of `Ctrl-Shift-*`** so the
  shortcuts auto-translate to `Cmd-Shift-*` on macOS. Cortex is
  Windows-first today but cheap cross-platform discipline pays off
  later.
- **Alignment round-trips through markdown via `html: true`.** TipTap
  serialises an aligned paragraph as `<p style="text-align:center">`,
  which `tiptap-markdown` preserves verbatim because the Markdown
  extension was already configured with `html: true` (originally for
  the colour-mark `<mark>` tags). Reload re-parses the inline style
  and re-applies the textAlign attribute. No new YAML or sidecar
  metadata.
- **What's NOT gated:** `Ctrl+Shift+B` (insert experiment block) and
  `Ctrl+Shift+T` (insert table) intentionally remain always-active.
  They both open modals that act on the editor through
  `editorInstanceRef`; gating them on focus would mean the user has
  to click in the editor before pressing the shortcut, which is the
  opposite of the intended convenience.

### Files touched (v2.1.3)

- `package.json` — `@tiptap/extension-text-align` added.
- `src/components/Editor.tsx` — TextAlign import + extended with
  shortcuts; registered in extensions list.
- `src/App.tsx` — `isEditorFocused()` helper; gated `Ctrl+N`,
  `Ctrl+Shift+P`, `Ctrl+Shift+E`, `Ctrl+Shift+I`.
- `src/components/ShortcutsHelp.tsx` — three-section restructure
  (Always / Sidebar mode / Editor mode), added Ctrl+Shift+L/E/R rows.

### Known rough edges

- **Alignment isn't visible on table cells.** The TextAlign config
  only applies to paragraphs and headings. To align text inside a
  table cell, you'd need to wrap the cell content in a paragraph and
  align that. Standard markdown tables don't model cell alignment
  well anyway. Revisit if it becomes friction.
- **`Ctrl+Shift+L` behaviour outside the editor:** when the editor
  is NOT focused, this chord is unhandled. (`Ctrl+L` toggles the
  legend; `Ctrl+Shift+L` does nothing in sidebar mode.) Acceptable
  — alignment doesn't have a sidebar meaning.
- **Browsers and IMEs.** `Ctrl+Shift+E` isn't a stock browser
  shortcut, but some IMEs intercept Ctrl+Shift combinations for
  language switching. Not Cortex's problem to solve, but if a user
  with a Chinese/Japanese IME reports the chord stops working,
  that's the cause.

---

## Phase 3 — Cluster 6 — PDF Reader (full cluster, iterative ship)

The cluster doc estimated 8-12 days at low confidence. This was
shipped in one session as nine cohesive passes; the doc's "minimal
version" path was rejected in favour of building the full surface so
the marks-table and reading-log integrations are present from day
one. Passes are described below in the order they landed.

### Pass 1 — render anything

- New Tauri command `read_binary_file(path) -> Vec<u8>`. Tauri 2
  serialises this as a JS Number[] over IPC, which the frontend
  wraps with `new Uint8Array(...)` before handing to PDF.js. The
  Number[] form has ~5x byte overhead compared to native binary,
  acceptable for v1; documented as a pivot to `convertFileSrc` if
  long-PDF performance bites.
- New dep: `pdfjs-dist@^4.10.38`. Worker URL wired via Vite's
  `import "...pdf.worker.min.mjs?url"` pattern so the bundler emits
  the worker as a hashed asset and Tauri's webview can resolve it.
- New component `PDFReader.tsx` renders every page into its own
  canvas at `cssScale * devicePixelRatio` resolution and CSS-scales
  back. Crisp on HiDPI without doubling the layout.
- `App.tsx` extended: `ActiveView` += `"pdf-reader"`; `selectFile`
  detects `.pdf` and routes there instead of the markdown editor.
- `index_single_file` short-circuits on `.pdf` until Pass 6/7
  replace it with proper PDF indexing.

### Pass 2 — toolbar

- Sticky header with page navigation (prev/next arrows + a
  click-to-edit page input that gotos on Enter or blur), a zoom
  group (-, percent-as-button-resets, +, fit-width), and a counter
  of "X annotations" (set by Pass 5).
- Page-tracking via `IntersectionObserver` plus a `MutationObserver`
  that re-attaches it when canvases get re-rendered at a new zoom.
  Observed at thresholds [0.1, 0.5, 0.9] and the page with the
  highest visible ratio wins.
- Re-render pipeline split: bytes are loaded once in a path-keyed
  effect; zoom changes trigger a separate render-only effect that
  reuses the in-memory `pdfDoc`. Avoids re-fetching bytes every time
  the user adjusts zoom.
- Fit-width measures the first canvas's CSS width, divides by the
  current zoom to recover the natural-at-1.0 width, and chooses a
  zoom that makes that width fit the scroll container minus 24px.

### Pass 3 — sidecar JSON I/O

- New Tauri commands `read_pdf_annotations(pdf_path)` and
  `write_pdf_annotations(pdf_path, sidecar)`.
- Sidecar lives at `<pdf>.annotations.json` next to the PDF, JSON
  pretty-printed for git-friendly diffs.
- Schema mirrors the cluster doc:
  `version`, `pdf_path`, `annotations[{ id, kind, page, rects[],
  text, note, created_at, resolved }]`. Coords are in PDF points,
  top-left origin (the frontend converts to/from screen coords).
- Reading a non-existent sidecar returns an empty `AnnotationSidecar`
  rather than erroring — that's the normal first-encounter state.

### Passes 4 + 5 — annotation creation, rendering, editing

- Per page, three stacked layers inside one wrapper div:
  1. `<canvas>` — the bitmap render
  2. `pdf-text-layer` — PDF.js's invisible-but-selectable spans,
     which give us native text selection for free
  3. `pdf-annotation-overlay` — coloured `<div>`s, one per
     annotation rect, with `pointer-events: auto` on each rect and
     `pointer-events: none` on the layer so clicks fall through
     to the canvas/text layer except where rects are
- Selection -> floating colour bubble: `selectionchange` listener
  computes the selection's `getClientRects()`, offsets by the page
  wrapper's bounding rect, divides by zoom to get PDF coords, and
  shows the bubble above the first rect. Captured to a ref so the
  React re-render that hides the bubble doesn't lose the data
  before the click handler runs.
- The bubble's `onMouseDown` calls `preventDefault` so clicking a
  swatch doesn't clear the selection. Same trick on annotation
  rects so clicking an existing annotation doesn't invalidate the
  text selection mid-flow.
- Annotation IDs are `ann-YYYY-MM-DD-N` where N is a per-vault
  monotonic counter (length of annotations array + 1). Predictable
  for git diffs.
- Side panel: jump-to-page link, blockquote-formatted highlighted
  text, colour-swatch row (current outlined), note textarea
  (writes on blur), resolved checkbox (toggles overlay opacity),
  delete button.
- Every mutation persists the whole sidecar via
  `write_pdf_annotations`, then triggers `index_single_file` so
  Pass 6's marks integration stays consistent. Race-free because
  the sidecar is the single source of truth and mutations are
  serialised through React state.

### Pass 6 — marks-table integration

- `index_single_file`'s top-of-function PDF check now branches into
  `index_pdf_file`, which:
  1. Wipes existing rows for the path from notes/metadata/marks
  2. Sets title from filename stem (no H1 to extract from PDFs)
  3. Calls `extract_pdf_text` (Pass 7) — non-fatal on failure
  4. Inserts into FTS5 `notes` with the title and extracted body
  5. Reads sidecar; for each annotation, inserts a row into the
     `marks` table with `source_path = pdf_path`,
     `kind = annotation.kind`, `text`, `context` (text + note),
     `line_number = page` (reused field — Cluster 3 destinations
     prefix it with "L" so a page-7 highlight shows "L7"; cosmetic
     but honest enough)
- Net effect: PDF highlights flow uniformly into all the existing
  Cluster 3 destination views (weekly review, Anti-Hype,
  citations-to-use, etc.) alongside the corresponding daily-note
  highlights. The "Cortex is one research surface" claim from the
  cluster doc is now real.

### Pass 7 — PDF text extraction for FTS5

- New crate dep `pdf-extract = "0.7"`. Pure-Rust, no system PDF
  library required.
- `extract_pdf_text(file_path) -> Option<String>`. Returns `None`
  on:
  - `pdf-extract` errors (encrypted, malformed)
  - empty extracted text (image-only/scanned PDFs)
  - PANICS in dependency code (we wrap in `catch_unwind` because
    `pdf-extract` has been observed to panic on rare malformed
    inputs and we don't want one bad paper to take the indexer
    down)
- The body is fed into FTS5 via the existing `notes` table, so the
  command palette searches PDF text alongside markdown.
- No caching yet: every reindex re-extracts. Acceptable on small
  vaults; a `<vault>/.research-hub/pdf-cache/<hash>.txt` cache is
  ready to add when extraction time becomes a measurable
  bottleneck.

### Pass 8 — `::reading DATE ::end` reading-log block

- Mirrors Cluster 4's `::experiment` pattern but simpler — no
  database table, no auto-creation. Just a body rewriter.
- New Tauri command `populate_reading_log(vault_path, daily_note)`:
  reads the file, walks lines for `::reading DATE` headers, finds
  the matching `::end`, replaces the inner content with a markdown
  list of every PDF annotation across the vault whose `created_at`
  starts with `DATE`. Sorted by PDF then page for stable output.
- Source of truth: walks `*.annotations.json` sidecars rather than
  the marks table, because the marks table's `created_at` is the
  indexing time (drifts) while the sidecar's is the actual user-
  creation time.
- Hooked into App's `selectFile`: when opening anything under
  `02-Daily Log/`, the populator runs. Idempotent — no-op when no
  blocks are present, and a no-op when the computed content already
  matches disk (no spurious git commits).
- Empty result for a date is rendered as
  `_(no PDF annotations on this date — yet)_` so the block is still
  visually present.

### Architectural choices worth flagging

- **PDF.js, not PDFium.** Cluster doc explicitly endorses this for
  the prototype; PDF.js's text layer gives us native selection for
  free, which would require its own selection-layer implementation
  with PDFium. Performance may be a problem on long PDFs (>200
  pages); pivot to PDFium documented but deferred until measured.
- **PDFs are walked into the SQLite index alongside markdown.** No
  separate "pdf_index" table. Title, FTS5 body, and the marks rows
  all share the schema with markdown notes, which means every
  existing query (palette search, backlinks-by-text, mark-queue
  views) just works.
- **No `convertFileSrc` asset protocol — yet.** Bytes go over the
  Tauri IPC bridge as Vec<u8>. Faster path documented but not
  needed for sub-10MB papers.
- **Sidecars are git-tracked.** No special handling required; the
  vault's existing git repo backs them up alongside the PDFs.
  Renaming or deleting a PDF leaves the sidecar orphaned (we don't
  track that yet) — flagged below.
- **Reading log walks the FS, not the index.** Robust against
  drift; cheap on small vaults; will be revisited if a vault has
  >100 PDFs and the daily-log open feels slow.

### Files touched

- `package.json` — added `pdfjs-dist@^4.10.38`
- `src-tauri/Cargo.toml` — added `pdf-extract = "0.7"`
- `src-tauri/src/lib.rs`:
  - new `read_binary_file` command
  - new `AnnotationRect`, `PdfAnnotation`, `AnnotationSidecar`
    types
  - new `read_pdf_annotations` and `write_pdf_annotations`
    commands
  - new `index_pdf_file` plumbed through `index_single_file`'s
    top-level extension check
  - new `extract_pdf_text` helper (`pdf-extract` crate, with
    `catch_unwind` panic guard)
  - new `populate_reading_log_for`, `process_reading_blocks`
    helpers
  - new `populate_reading_log` Tauri command
  - all four registered in `invoke_handler`
- `src/components/PDFReader.tsx` — new component (canvas + text
  layer + annotation overlay + toolbar + selection bubble + side
  panel)
- `src/index.css` — new `.pdf-text-layer` and friends so the text
  layer aligns with the canvas and selections render with the
  Cortex blue
- `src/App.tsx` — `ActiveView` += `"pdf-reader"`, `.pdf` route in
  `selectFile`, `selectedPath` effect early-exit on PDFs, `02-Daily
  Log/` open hook for `populate_reading_log`, `<PDFReader>` render
  branch
- `verify-cluster-6.ps1` — new
- `phase_2_overview.md` — Cluster 6 status updated

### Known rough edges

- **Bytes-over-IPC for large PDFs.** A 30-MB book's worth of bytes
  goes through Tauri's IPC as a JS Number[]. This works but is
  perceptibly slow (several seconds). Pivot to `convertFileSrc`
  ready when needed.
- **`pdf-extract` quality.** Plain text extraction. Tables come out
  as space-separated runs. Math/equations are unreliable. Scanned
  PDFs return nothing. The cluster doc explicitly accepts this for
  v1.
- **Sidecar orphans on PDF rename/delete.** If you rename
  `paper.pdf` to `paper-v2.pdf` outside Cortex, the sidecar at
  `paper.pdf.annotations.json` is left behind and a fresh
  `paper-v2.pdf.annotations.json` would be created on next
  annotation. Documented in cluster doc's open questions; deferred.
- **No `::reading` block ProseMirror decoration.** The block
  markers (`::reading DATE` / `::end`) render as plain text in the
  TipTap editor. Cluster 4's `::experiment` blocks have a
  decoration that styles them as a green strip; we deliberately
  did not mirror that for `::reading` to keep this cluster
  shippable. Add later if visual noise becomes friction.
- **Bubble + side-panel coexistence.** It's possible to have both
  visible at once if the user creates an annotation, then drag-
  selects again before clicking elsewhere. Not strictly a bug — the
  bubble offers "create another", the panel shows the most-recent
  selected — but a future polish pass might dismiss one when the
  other appears.
- **No within-PDF Ctrl+F yet.** PDF.js can do this, but wiring the
  match-highlighting layer is its own afternoon's work and was
  deferred. Workaround: command palette already searches across
  the FTS5 index for the PDF's body.
- **Annotation rect colour is RGBA-coded inline,** not via the
  CSS variables Cluster 2 uses. Easy to refactor when the colour
  semantics drift; for now hard-coded RGBA values match the
  Mark System palette.

### v1.1 — bug fixes + UX additions (post-ship)

User-reported issues from the first real-world session:

- **Every annotation/zoom action scrolled to top and back.** Cause:
  `renderAllPages` cleared `container.innerHTML` and rebuilt every
  page on every state change, including pure annotation mutations.
  Fix: split the lifecycle so the page wrapper divs are created
  once, the canvas+text-layer is re-rendered only on zoom, and the
  annotation overlay div is replaced independently when the
  sidecar mutates. Three separate functions
  (`setupWrappers`, `renderPageContent`, `updatePageOverlay`)
  with three separate `useEffect` triggers.
- **Highlight rectangles bleeding across columns / appearing
  multi-layered for a single highlight.** Cause: `getClientRects()`
  returns several overlapping/nested rects per Range — sometimes a
  full-line rect plus per-character rects, sometimes per-line plus
  per-span. Fix: dedup pass that sorts the raw rects by area
  descending and drops any rect fully contained within an already-
  kept rect (1px epsilon). Single-action highlights now render as
  one solid region. Multi-highlight stacking still darkens, which
  the user explicitly wanted preserved.
- **Plain click on a highlight popped the editor panel.** Annoying
  while reading. Fix: click handler requires `e.ctrlKey ||
  e.metaKey` to open the panel; plain clicks are no-ops. Tooltip
  on each highlight reads "Ctrl+Click to edit · &lt;text&gt;" so
  the affordance is discoverable.
- **No way to see all annotations at once.** Fix: the toolbar's
  "X annotations" counter is now a button. Clicking it flips the
  side panel into list mode (sorted by page), each row showing
  colour swatch, page number, the highlighted text, and any note
  / linked-notes. Clicking a row jumps to that page and re-opens
  the single-annotation panel. The single-panel header now has a
  ☰ button to switch back to list mode.
- **Annotations had no way to link out to notes.** Fix: each
  annotation grew a `linked_notes: string[]` field (default empty
  on existing sidecars via `#[serde(default)]` on the Rust struct,
  defensive normalisation on the JS side). Side panel exposes
  current links as removable chips and a "+ Link to note…" button
  that opens a popup over `list_all_notes`; type-to-search,
  Enter-to-pick-first, click-to-pick. Already-linked notes are
  shown disabled in the list. Stored as the wikilink target only
  (the title) — no path resolution at write time, so renames
  Just Work via the existing wikilink-resolution machinery in the
  editor.

Pass 7 (PDF text in FTS5) didn't actually work in the first
release because `rebuild_index` was filtered to `.md` only. The
PDF branch in `index_single_file` would only fire when the user
opened a PDF (which calls `index_single_file` directly through
`persistSidecar`), never during the full-vault rebuild. Fixed by
loosening the extension filter in `rebuild_index` to also accept
`.pdf` (case-insensitive).

Pass 8 (`::reading DATE ::end`) silently produced empty output
when the user wrote anything that wasn't a YYYY-MM-DD prefix
(e.g., a PDF title in angle brackets). Three improvements:

- Empty argument or `today` → today's annotations
- YYYY-MM-DD prefix → that date's annotations
- Anything else → treated as a PDF stem, case-insensitive
  substring match against PDF filenames; lists *all* annotations
  from that PDF regardless of date
- Empty result message tells the user which filter produced it
  (`(no PDF annotations dated 2026-04-28 — yet)` vs
  `(no PDF annotations matching `Hydrogels` — yet)`).

`today_iso_date()` is hand-rolled via Howard Hinnant's
civil-from-days algorithm to avoid pulling in `chrono`. Local-vs-
UTC drift around midnight is inherited from `SystemTime::now`;
documented as accepted.

### Files touched (v1.1)

- `src-tauri/src/lib.rs`:
  - `rebuild_index` — now walks `.pdf` alongside `.md`
  - new `looks_like_iso_date`, `today_iso_date`, `parse_reading_arg`
    helpers
  - `populate_reading_log_for` — accepts date / "today" / pdf-stem
  - `PdfAnnotation` — gained `linked_notes: Vec<String>` with
    `#[serde(default)]` for backwards-compat
- `src/components/PDFReader.tsx` — refactored:
  - `setupWrappers` (one-time) / `renderPageContent` (zoom) /
    `updatePageOverlay` (sidecar) split
  - selection rect dedup
  - Ctrl+Click for the editing panel
  - clickable annotation count → `panelMode = "list"`
  - new `AnnotationListPanel`, `LinkNotePopup` components inside
    the same file (kept co-located with the React state they
    drive)

---

## Phase 3 — Cluster 6 v1.5 — Multi-tab layout

User-driven feature: the main pane can now host 1, 2, 3, or 4
panes in five layouts (single, dual, tri-bottom, tri-top, quad).
Each pane is fully independent — its own open file, structured
view, dirty state, editor instance — and the existing
close/switch/open functionality continues to work per-pane.

### What landed

- **`TabPane.tsx`** — extracts every per-file concern from App.tsx
  (selectedPath, activeView, frontmatter, fileBody, editedBody,
  dirty, loadingFile, editorInstanceRef) into a `forwardRef`
  component that exposes a `TabPaneHandle` via
  `useImperativeHandle`. Methods: `saveIfDirty`, `reload`,
  `openPath`, `setActiveView`, `insertExperimentBlock`,
  `insertTable`, plus getters and `getDirtySnapshot` for the
  close handler. App holds an array of refs (`paneRefs`) and
  drives panes via these methods.
- **`LayoutPicker.tsx`** — the top-right toggle. Five options,
  each with a small SVG-ish CSS-grid preview icon. Active option
  is highlighted with the accent border. Selection is persisted
  to `localStorage` so the user's layout survives a restart.
- **`LayoutGrid.tsx`** — CSS Grid container. Layout-specific
  templates: dual is `1fr / colFrac:gap:1-colFrac`, tri-bottom is
  three rows ("a v b" / "h h h" / "c c c"), tri-top mirrors it,
  quad is the standard 2×2 with both dividers. Resize handles
  (`VDivider`, `HDivider`) are draggable strips that listen for
  `mousedown`, attach window-level `mousemove`/`mouseup`, and
  update `colFrac`/`rowFrac` clamped to [0.15, 0.85]. Sizes
  persist alongside the layout choice.
- **`SlotPicker.tsx`** — modal that pops when a search-palette
  result is clicked while in a multi-slot layout. Shows N tiles
  (one per visible slot) with the layout preview, slot number,
  and the file currently in that slot (or "empty"). Press 1–4
  to pick by keyboard; Esc cancels.
- **`PaneWrapper`** in `App.tsx` — wraps each `TabPane` with
  `onDragOver`/`onDrop` handlers. The data type is
  `text/cortex-path` (set in `FileTree`'s draggable file rows).
  When a drop lands, the wrapper calls
  `selectFileInSlot(path, slotIndex)` regardless of the layout
  — this is the primary routing path for tri/quad.
- **`FileTree`** got `draggable={true}` on file rows + an
  `onSelectFile(path, opts?)` signature change to forward
  `e.ctrlKey || e.metaKey`. Click → slot 0 (or slot 1 if
  Ctrl-modified, dual only). Drag → drop target's slot.

### Routing rules (file-tree click → slot)

- **Single layout:** always slot 0.
- **Dual:** plain click → slot 0, Ctrl+Click → slot 1.
  Always L/R, regardless of which slot is currently active.
  This matches the user's spec word-for-word.
- **Tri/quad:** plain click → currently active slot. Drag-and-drop
  is the recommended way to target a non-active slot. Search
  palette routes via the SlotPicker modal.

### Architectural choices

- **All `MAX_SLOTS` panes are always mounted.** When the layout
  shrinks (e.g., quad → dual), slots beyond the visible count
  go into a hidden div (zero-size, `visibility: hidden`,
  `pointer-events: none`). State, editor instance, dirty flag,
  and refs all survive the layout change. The close handler
  iterates every mounted pane (not just the visible ones) so
  dirty work in a temporarily-hidden slot is still saved
  before the window closes.
- **Per-pane file load is a `useEffect` bound to that pane's
  `selectedPath` and `reloadTick`.** Each pane has its own
  effect chain — they don't share state, don't race each other,
  and `reload()` (Ctrl+R in this pane) bumps the tick to force
  a re-read. The save-if-dirty step inside `reload` runs first
  so explicit reload doesn't drop unsaved typing.
- **`useImperativeHandle` deps include all state read by methods.**
  This re-creates the handle on every meaningful state change.
  The parent reads `paneRefs.current[idx]` only at event time
  (Ctrl+S press, modal submit, etc.), so the freshest handle is
  always observed. The cost is minor — the pane's render is
  already happening; building a small object on top is free.
- **Active slot tracked via `mousedown` and `focusin` on each
  pane.** `TabPane`'s outer div fires `onActivate` which calls
  `setActiveSlotIdx`. This means clicking the pane *or*
  putting focus into its editor activates it. The active pane
  shows a 2px accent outline and the top bar reflects "Active:
  slot N" when N > 1.
- **`selectFileInSlot(path, slotIndex)`** is the single
  orchestrator — it runs the persistent-destination regen,
  Methods reagent regen, and daily-log populator (the same
  cross-cutting logic from the old `selectFile`) once per
  open-call before delegating to the slot's `openPath`.
  Wikilink-follow, daily-log open, palette result, and
  ReviewsMenu destination picks all funnel through it.
- **Save-on-close fans out across every pane.** The window
  close handler synchronously calls `event.preventDefault()`,
  collects `getDirtySnapshot()` from every mounted pane that
  reports dirty, kicks off serialised saves in an IIFE, then
  calls `win.destroy()` (which doesn't re-fire
  `onCloseRequested`). Same shape as the old single-pane
  handler, just iterated.
- **Ctrl+R is intercepted globally and routed to the active
  slot.** Browsers default Ctrl+R to "reload page" — a
  Tauri webview also honours that, which would blow away the
  whole app's state. Intercepting at the window level and
  scoping the action to one pane is the correct UX.

### Files touched (v1.5)

- `src/components/TabPane.tsx` — new component (≈600 lines).
  Owns all per-file state and effects; exposes
  `TabPaneHandle` via `forwardRef` + `useImperativeHandle`.
- `src/components/LayoutPicker.tsx` — new component.
- `src/components/LayoutGrid.tsx` — new component (CSS Grid
  + draggable VDivider/HDivider strips).
- `src/components/SlotPicker.tsx` — new component (search-result
  slot picker modal).
- `src/components/FileTree.tsx` — `onSelectFile` signature
  forwards Ctrl-state; file rows are now draggable.
- `src/App.tsx` — major refactor:
  - Removed all per-file state and useEffects (now in TabPane)
  - New: `layoutMode`, `colFrac`, `rowFrac`, `slotPaths[]`,
    `slotViews[]`, `slotDirty[]`, `activeSlotIdx`, `paneRefs`
  - New: `selectFileInSlot(path, slotIndex)` orchestrator
  - New: `handleTreeClick(path, ctrlClick)` router
  - New: Ctrl+R interceptor (active slot only)
  - Save-on-close + save-on-blur iterate all panes
  - Sidebar buttons (Ideas/Methods/Protocols, ReviewsMenu)
    target the active slot via `paneRefs[activeSlotIdx]`
  - LayoutPicker + active-slot label render in a new top bar
- `verify-cluster-6.ps1` — Pass 9 walkthrough added; commit
  message + tag bumped to `cluster-6-v1.5-complete`.

### Known rough edges

- **Plain click in tri/quad opens in the active slot.** This is
  the most reasonable default but may confuse users who expect
  drag-or-nothing behaviour. If it bites, switch to a no-op
  with a hint banner ("drag to a slot"). Drag-and-drop and the
  search-palette slot picker are the documented routing paths
  for tri/quad.
- **Hidden-stash mounting keeps memory in use for closed
  layouts.** With four panes each able to hold a PDFReader
  (which is the heaviest view), a user who opens four PDFs
  and shrinks to single still has four PDFReaders mounted.
  Acceptable at MAX_SLOTS=4. If we ever raise the cap, this
  becomes a savings target.
- **No "save all" shortcut.** Ctrl+S saves only the active
  slot. Multi-pane save is implicit on layout change, blur,
  or window close. Add `Ctrl+Shift+S` for explicit save-all
  if it becomes friction.
- **Single global `colFrac` for quad layout.** Both the top
  and bottom rows share the same column split. CSS Grid with
  named areas can't do per-row column splits without
  separate templates. If users want independent splits per
  row, the implementation is a second `colFracBottom` plus a
  layout-specific renderer for quad. Deferred until asked.
- **The active-slot indicator is subtle.** A 2px accent
  outline plus the top-bar label. If users miss which slot is
  active, the indicator can be made bolder later.

---

## Phase 3 — Cluster 10 v1.0 — GitHub integration

The first read-only integration. Calendar and Overleaf are deliberately
out of scope for this cluster — the cluster doc is explicit about
"build only the integration whose trigger has fired."

### What landed

- **`VaultConfig.github: Option<GitHubConfig>`** with `#[serde(default)]`
  on the new field so existing pre-Cluster-10 `config.json` files load
  without migration. The token + repos list live alongside `vault_path`
  in `%APPDATA%\declercq-cortex\config.json`. Same schema-additivity
  rule as Phase 1 Week 1's "stuff `last_open_file` in early to avoid
  migration."
- **`reqwest = { version = "0.12", default-features = false, features
  = ["rustls-tls", "json"] }`** as the only new Rust dep. rustls keeps
  Cortex off OpenSSL on Linux/Windows so dev / CI builds don't need a
  system crypto library.
- **Six new Tauri commands**:
  - `get_github_config` — for the modal's initial load.
  - `set_github_config` / `clear_github_config` — modal save / disconnect.
  - `fetch_github_summary` (cache-respecting) — used by the Ctrl+Shift+G
    insert-at-cursor flow and by `regenerate_github_section` so the
    cache is honoured uniformly.
  - `fetch_github_summary_now` (cache-bypassing) — used by the modal's
    Test connection button so the user always gets a fresh probe.
  - `regenerate_github_section` — splices today's daily note via the
    same auto-marker pattern Cluster 8 v2 introduced for Methods.
- **`IntegrationsSettings.tsx`** modal: token field with show/hide,
  per-repo rows (add/remove), Save / Disconnect / Test connection /
  Close actions, inline test-result panel that shows the markdown
  preview and the last-fetch ISO timestamp (or the error string on
  failure). Reachable via Ctrl+, or the new "GH" sidebar button.
- **`Ctrl+Shift+G`** keyboard shortcut: fetches a fresh summary
  (cache-respecting) and inserts a "## Today's GitHub activity"
  heading + body at the cursor in the active pane. Mirrors
  Ctrl+Shift+B's experiment-block flow exactly.
- **Auto-populate today's daily note** via a new branch in
  `App.selectFileInSlot` — opening anything under `02-Daily Log/`
  invokes `regenerate_github_section`, which is itself gated to the
  current ISO date so past daily notes stay frozen.
- **`ShortcutsHelp.tsx`** updated: Ctrl+, and Ctrl+Shift+G land in
  the "Always active" section; the "Settings (later)" placeholder
  in "Coming later" is removed.

### Architectural choices

- **Section-scoped HTML markers (`<!-- GITHUB-AUTO-START -->`,
  `<!-- GITHUB-AUTO-END -->`).** Same shape Cluster 8 v2 uses for the
  Reagents/Parts table inside a Method file: Cortex owns the region
  between the markers, the user owns everything else. Three insertion
  branches: both markers present → splice between them; markers
  missing but `## Today's GitHub activity` heading exists → insert
  markers under the heading; heading missing entirely → append a
  fresh section at EOF. `insert_github_under_heading` is a copy-and-
  adjust of `insert_under_heading`.
- **Idempotent regen.** The file is rewritten only when the computed
  content differs from disk, so opening today's daily note twice in
  10 minutes doesn't burn a git commit. `populate_reading_log` and
  `regenerate_method_reagents` already follow this pattern.
- **Today-only auto-populate.** `regenerate_github_section`
  short-circuits when the basename ≠ `<today_iso>.md`. Past daily
  notes stay as the day's snapshot — opening yesterday's note with
  GitHub configured does NOT overwrite the section that was current
  yesterday. The cluster doc's "_(no PDF annotations dated…)_"
  precedent told me freezing past daily content is the right default.
- **Two caches, both in-process, both invalidated on config change.**
  - `GITHUB_USER_LOGIN_CACHE`: `(token_prefix, login)` tuple keyed on
    the first 8 chars of the token. The login doesn't change for a
    given token, so a forever-in-process cache is correct;
    invalidation only happens when the token actually changes.
  - `GITHUB_SUMMARY_CACHE`: 10-minute TTL keyed on a fingerprint of
    `(token_prefix, joined_repos)`. The fingerprint avoids serving a
    stale cache after a settings change without leaking the full
    token into a key. `Mutex<Option<...>>` in `static` (Rust 1.63+
    const Mutex::new); explicit `lock().ok().and_then(...)` so a
    poisoned mutex degrades to a fresh fetch instead of crashing.
- **Token storage in config.json, not OS keychain.** Cluster doc's
  explicit Phase 3 v1 trade-off: OS keychain integration is reserved
  for v2. The config file lives under `%APPDATA%\declercq-cortex\`
  which Windows ACLs to user-only by default. Acceptable for a
  single-user personal tool; flagged below as a v2 candidate if the
  user ever shares the vault folder.
- **PR filter is client-side.** `/repos/{owner}/{repo}/pulls?state=open`
  returns every open PR; we keep only those whose `user.login` matches
  the authenticated user. The alternative (`/search/issues?q=…`)
  would be one round-trip total but adds a secondary parsing surface
  and a different rate-limit bucket. Per-repo iteration is one extra
  request per repo; cheap at the scale a single user works at.
- **Lenient PR JSON parsing.** Open PRs are parsed via
  `serde_json::Value` rather than a typed struct so an unexpected
  GitHub API field doesn't crash the deserialiser. Each PR's `number`
  and `title` are pulled defensively with `.and_then(|v| v.as_…())`
  and a sentinel filter (skip PRs with `number == 0`). Commits use
  the typed `GhCommitItem` because the shape is more stable.
- **Empty repo (HTTP 409 from /commits)** is treated as "no commits",
  not an error. GitHub returns a 409 specifically for this case;
  surfacing it as an error would create misleading "couldn't fetch"
  rows for empty repos that are otherwise fine.
- **Client-side timeout of 15 seconds.** `reqwest::Client::builder().timeout(...)`.
  Long enough to absorb a slow hop, short enough that opening a daily
  note never waits forever for a network that's actually down.
- **Markdown insertion mirrors `::experiment` precedent.** The
  Ctrl+Shift+G handler builds an array of TipTap paragraph nodes,
  not a parsed-and-rendered markdown blob. The user sees raw
  `**repo**` syntax briefly; tiptap-markdown's `html: true` parser
  renders it fully on save+reload. This is the same UX trade-off as
  experiment blocks; consistent enough that we don't need a new
  pattern for "insert formatted markdown."

### Files touched

- `src-tauri/Cargo.toml` — added `reqwest` (rustls + json features).
- `src-tauri/src/lib.rs` —
  - `VaultConfig.github: Option<GitHubConfig>` (new struct, both
    serde-defaulted).
  - Marker constants `GITHUB_AUTO_START` / `GITHUB_AUTO_END`,
    heading constant `GITHUB_HEADING`, user-agent + accept headers,
    `GITHUB_CACHE_TTL_SECS`.
  - Static caches: `GITHUB_USER_LOGIN_CACHE`,
    `GITHUB_SUMMARY_CACHE` (with `GitHubSummaryCache` envelope).
  - `GitHubSummary` (serde-friendly response struct returned to the
    frontend).
  - `GhUser`, `GhCommitItem`, `GhCommitInner`, `GhPullItem` —
    deserialisers for the GitHub responses we read.
  - Helpers: `github_config_fingerprint`, `iso_utc_from_unix`,
    `iso_now`, `iso_24h_ago`.
  - Async helpers: `gh_get_user_login`, `gh_recent_commits`,
    `gh_open_prs` (the last uses `serde_json::Value` for lenience).
  - Pure formatter: `format_github_markdown`.
  - Inner orchestrator: `fetch_github_summary_inner` — handles cache
    lookup, client construction, login fetch, per-repo fan-out,
    formatting, and cache write.
  - `insert_github_under_heading` (sibling of `insert_under_heading`).
  - Six Tauri commands (see "What landed").
  - `invoke_handler` registers all six.
- `src/components/IntegrationsSettings.tsx` — new modal.
- `src/components/TabPane.tsx` —
  - `TabPaneHandle` gains `insertGitHubMarkdown(markdown: string)`.
  - Implementation in `useImperativeHandle` (mirrors
    `insertExperimentBlock`'s shape).
- `src/components/ShortcutsHelp.tsx` — Ctrl+, and Ctrl+Shift+G in
  ALWAYS; "Settings (later)" removed from PLANNED.
- `src/App.tsx` —
  - Import `IntegrationsSettings`.
  - `integrationsOpen` state.
  - Ctrl+, and Ctrl+Shift+G keyboard handlers (the latter dispatches
    to `paneRefs.current[activeSlotIdx].insertGitHubMarkdown`).
  - `selectFileInSlot` daily-log branch invokes
    `regenerate_github_section` after `populate_reading_log`.
  - Sidebar "GH" button next to ReviewsMenu.
  - `<IntegrationsSettings>` rendered alongside the other modals.
- `verify-cluster-10.ps1` — new.
- `phase_2_overview.md` — Cluster 10 status flipped to "GitHub
  shipped (v1.0); GCal + Overleaf deferred."

### Known rough edges

- **Calendar + Overleaf are not built.** The cluster doc explicitly
  says to build only the integration whose trigger has fired. The
  GitHub trigger ("you alt-tab to GitHub multiple times a day while
  writing daily notes") was the user's pick; Calendar / Overleaf
  triggers haven't fired in the trial journal.
- **Token in config.json.** Per-user file ACLs on Windows protect
  this from other users on the same machine, but the token is on
  disk in plaintext. v2 candidate: `tauri-plugin-stronghold` or the
  Windows Credential Manager. Until then, document this in the
  modal's hint text so the user knows.
- **No rate-limit handling.** GitHub's REST API is 5000 reqs/hour
  authenticated; with N repos and the 10-min cache, the worst case
  is ~6 × N reqs/hour per user — well below the limit. Add 429
  handling if a user reports it.
- **No refresh-token logic** because GitHub PATs don't expire on a
  schedule — they're long-lived until revoked. The 401 path tells
  the user to check their token in the modal's error string.
- **Markdown-as-text in the inserted block.** Ctrl+Shift+G inserts
  raw markdown (`**repo**`, `- ` prefixes) which renders only after
  save+reload. The `::experiment` block has the same UX. If this
  becomes friction (it didn't for experiment blocks), the path is
  to convert the markdown to HTML in JS via a minimal converter and
  call `editor.commands.insertContent(html)`.
- **Empty/non-existent repos render as italic error rows.** "_(couldn't
  fetch: HTTP 404)_" is honest but ugly. A nicer UX would prune these
  silently after a single 404 with a "remove?" hint in the modal.
  Defer until it bites.
- **No "PR last updated" timestamp.** The summary just shows
  `#42 "title"`. `updated_at` is parsed but unused — easy to add
  back if the user asks.
- **Iso timestamps are UTC.** The "last fetch" line in the modal
  shows e.g. `2026-04-28T14:32:00Z`. Local-time formatting is a
  small UX win deferred to v1.1.
- **Mutex poisoning on a panicking caller** would silently bypass
  the cache (next fetch runs, then fails to write because the
  mutex is poisoned). This is acceptable degradation — the user
  gets a slow but correct fetch every call until the process
  restarts.

---

## Phase 3 — Cluster 11 v1.0 — Personal Calendar

The first local-first calendar surface inside Cortex. The user-stated
long-term vision is much bigger (Google + Outlook sync, recurrence,
NLP input, heat map, pie analytics, multi-tz strip, density toggle,
day view, time-tracking analytics), but the cluster doc explicitly
slices that into Cluster 11 v1.0 → v1.6 + Cluster 12 (Google sync) +
Cluster 13 (Outlook) + Cluster 14 (planned-vs-actual). This entry
covers v1.0 — the foundation everything else builds on.

### What landed

- **Two new SQLite tables** in the existing `<vault>/.research-hub/
  index.db`: `events` (id, title, start_at, end_at, all_day, category,
  status, body, created_at, updated_at) and `event_categories` (id,
  label, color, sort_order). `CREATE TABLE IF NOT EXISTS` so existing
  vaults migrate themselves on first open.
- **Five seeded categories** on first init: Work / Personal / Health
  / Learning / Social. Only seeded if the categories table is empty
  so user edits aren't overwritten.
- **Eight Tauri commands**: `list_events_in_range`, `create_event`,
  `update_event`, `delete_event`, `list_event_categories`,
  `upsert_event_category`, `delete_event_category`,
  `regenerate_calendar_section`. All registered in `invoke_handler`.
- **`Calendar.tsx`** — top-level component hosted in `TabPane` like
  the other structured views. Hand-rolled CSS Grid; no
  `react-big-calendar`, no FullCalendar.
- **Embedded WeekView** — 7 day columns × 24 hour rows, click-and-
  drag drafting (15-min snap), event blocks with category-tinted
  backgrounds, side-by-side conflict layout, "now" line that updates
  each minute, tentative diagonal-stripe styling.
- **Embedded MonthView** — 6 rows × 7 columns. Focus month at full
  opacity; surrounding days dimmed. Click a day → opens new-event
  modal defaulted to 9 am. Click an event chip → opens edit modal.
- **`EventEditModal.tsx`** — title, datetime-local inputs (date-only
  when "all-day" is on), category dropdown with swatch preview,
  confirmed/tentative status, body textarea, Ctrl+Enter to save,
  Escape to cancel. Existing events show a Delete button on the
  left of the footer.
- **`CategoriesSettings.tsx`** — list + edit + add + delete with a
  soft 8-category warning ("visual signal degrades past this", per
  the user spec).
- **`ActiveView` += `"calendar"`** in `TabPane.tsx`; render branch
  added between protocols-log and pdf-reader.
- **Sidebar "Cal" button** in `App.tsx` routes
  `paneRefs.current[activeSlotIdx]?.setActiveView("calendar")`,
  same shape as the existing Ideas / Methods / Protocols buttons.
- **Daily-note auto-section** at `## Today's calendar` between
  `<!-- CALENDAR-AUTO-START -->` / `<!-- CALENDAR-AUTO-END -->`.
  Same shape as the GitHub auto-section; gated to today's basename
  only; idempotent rewrite + reindex.

### Architectural choices

- **SQLite, not one-file-per-event.** Events are small, uniform, and
  there will be hundreds. The sidecar pattern that works for PDFs
  (where the asset is the PDF and the JSON is small) is the wrong
  shape here. The events table also gets indexes on `start_at`,
  `end_at`, `category`.
- **Times stored UTC, rendered local.** `start_at` / `end_at` are
  unix seconds in UTC. The frontend converts to local time via
  standard `new Date(secs * 1000)`. Cortex's existing
  `today_iso_date` already accepts the same UTC-vs-local drift
  around midnight; mirror.
- **Hand-rolled grid, no calendar library.** `react-big-calendar`
  would have given drag/drop + recurrence rendering for free, but
  it's a 200kB dep that doesn't match Cortex's aesthetic and
  doesn't customise easily. The hand-rolled WeekView is ~150 lines
  of layout code; comparable effort to wiring + theming a library.
  Revisit if recurrence (v1.1) gets nasty.
- **Click-and-drag uses pointer-capture + 15-min snapping.**
  Pointer-capture means a single column owns the drag from
  pointer-down through pointer-up regardless of where the pointer
  travels. 15-min snap matches Google/Apple/Outlook defaults.
- **"Now" line updates on a 1-minute interval.** Cheap; one
  `setState` per minute. The line only renders if `now` falls
  inside the visible window — past/future weeks don't draw it.
- **Conflict layout is global-cluster width.** When N events
  overlap anywhere in a column, all overlapping events render at
  `1/N` width. Not perfect for sparse overlaps but visually
  consistent and easy to reason about. v1.1 candidate: per-cluster
  width via interval-graph colouring.
- **Tentative styling: solid background → diagonal stripe.** Per
  the user's spec ("solid for confirmed, hatched/outlined for
  tentative"). Implemented as a `repeating-linear-gradient`
  background plus a dashed border. ~5 lines of CSS.
- **Body field is a plain textarea, not TipTap.** Mounting TipTap
  inside a modal adds notable complexity (editor instance ref,
  onUpdate / setContent dance, wikilink decoration plumbing). The
  body's `[[wikilinks]]` survive verbatim in storage and resolve
  for free in the daily-note auto-section. Upgrade to TipTap in
  v1.1 if the textarea feels limiting.
- **Day-of-week start = Monday (ISO).** Cluster doc decision.
  `mondayStartLocal` derives the anchor from any unix timestamp.
- **Delete-category gate.** `delete_event_category` refuses if any
  events still reference the category. The error string tells the
  user how many events block the deletion. v1's stance is "fail
  loudly" rather than orphaning events — the alternative ("re-
  categorise to default") would be invisible damage.
- **Daily-note section is gated to today only.** Past daily notes
  stay frozen as the day's snapshot — same rule the GitHub
  auto-section follows. If you open yesterday's note, the
  calendar section there reflects what was on the calendar
  yesterday, not what's there today.

### Files touched

- `src-tauri/src/lib.rs` —
  - `events` and `event_categories` tables added to
    `open_or_init_db`'s `execute_batch`.
  - 5-default seeding logic at the end of `open_or_init_db`.
  - New marker constants `CALENDAR_AUTO_START` / `CALENDAR_AUTO_END`
    / `CALENDAR_HEADING`.
  - Public structs `Event` and `EventCategory`.
  - Helpers `unix_now`, `next_event_id`, `local_hhmm_for`,
    `format_calendar_markdown`, `insert_calendar_under_heading`.
  - Eight Tauri commands.
  - Eight new entries in the `invoke_handler!` macro.
- `src/components/Calendar.tsx` — new (~600 lines).
- `src/components/EventEditModal.tsx` — new.
- `src/components/CategoriesSettings.tsx` — new.
- `src/components/TabPane.tsx` — `ActiveView` += `"calendar"`,
  `Calendar` import + render branch.
- `src/App.tsx` — `Cal` sidebar button (routes to active slot's
  `setActiveView('calendar')`); `selectFileInSlot`'s daily-log
  branch invokes `regenerate_calendar_section` after the GitHub
  regen.
- `verify-cluster-11.ps1` — new.
- `cluster_11_personal_calendar.md` (at repo root) — cluster doc.
- `phase_2_overview.md` — index updated, cluster 11 listed as in
  flight, clusters 12/13/14 listed as planned follow-ups.

### Known rough edges

- **Multi-slot live update.** If the calendar is open in slot 1
  and slot 2, an event created in slot 1 doesn't refresh slot 2
  until the user navigates / clicks Today / re-opens that pane.
  v1.0 doesn't have a cross-slot pub-sub channel; the Calendar
  reloads on its own range change. Add a `bumpIndex`-style
  signal for events in v1.1 if this bites.
- **Day-spanning events.** Render in the start day's column from
  the event's start time to 24:00, and in the end day's column
  from 00:00 to the end time. The block's title appears in both
  segments, but there's no visual cue that they're the same
  event. Add a tiny "↘ continues" indicator in v1.1.
- **Conflict layout uses global-cluster width.** As noted above,
  not optimal for sparse overlaps. v1.1 candidate.
- **No drag-resize / drag-move on existing events.** v1.0 supports
  edit-via-modal only. Drag-resize + drag-move are deferred to
  v1.1 alongside recurrence, since both touch the same drag
  infrastructure.
- **`regenerate_calendar_section` uses UTC midnight bounds.**
  Around midnight in non-UTC zones, today's events at the very
  edge of the day might fall outside the splice window. Same
  drift the rest of Cortex's daily-note machinery accepts; revisit
  if it bites.
- **`local_hhmm_for` uses UTC times.** The daily-note splice shows
  HH:MM in UTC, not the user's local time. The calendar UI itself
  renders local time correctly via `new Date()`. Local-time
  rendering in the splice is a v1.1 polish.
- **Body textarea doesn't render wikilink decorations.** The
  textarea displays `[[Foo]]` as plain text. Wikilinks are still
  honoured by the daily-note auto-section because the body is
  spliced verbatim into a markdown context. Upgrade to TipTap in
  v1.1 if visual feedback inside the modal becomes useful.
- **Categories panel doesn't expose `sort_order`.** Categories are
  ordered by their seeded `sort_order`. New categories get
  `sort_order = categories.length`. Reordering requires hand-
  editing the SQLite table or a v1.1 drag-handle UI.
- **`upsert_event_category` doesn't validate the colour string.**
  It's stored verbatim. The colour input is a `<input type="color">`
  which always produces valid `#RRGGBB`, but a future migration
  could store CSS variable names and break.
- **Future clusters depend on this schema.** Cluster 12 (Google
  sync) will need `external_id` + `external_provider` columns on
  `events` to dedupe round-trips. Adding them later via `ALTER
  TABLE` is straightforward but worth noting now.

---

## Phase 3 — Cluster 11 v1.1 — Calendar follow-ups + recurrence

User-driven follow-ups within the same session as v1.0:

1. Wikilinks the user typed in event bodies didn't appear in daily
   notes (the splice only emitted title/time/category — bug).
2. New events didn't register to the daily note while the daily
   note was already open (a known v1.0 limitation; the user
   experienced it as "events don't register to daily notes").
3. "Repeat modal field" — recurrence support: every week / multi-
   times-per-week / biweekly / monthly / custom (the v1.1 work the
   cluster doc had originally deferred to a separate session).

### What changed

**Body content in the daily-note splice.** `format_calendar_markdown`
now indents the event body (markdown verbatim) under each event's
bullet. Wikilinks survive verbatim and resolve via the daily note's
TipTap render — so `[[Idea — XYZ]]` typed in an event body lands as
a live link in the daily note and counts in the backlinks panel.
Empty-body events are unchanged.

**Post-mutation regen.** `Calendar.saveEdit` and `Calendar.deleteEdit`
explicitly invoke `regenerate_calendar_section` on today's daily
note path after a successful mutation. The regen function is
idempotent and no-ops if today's daily note doesn't exist yet.
Means the daily note is up-to-date the moment a user adds / edits /
deletes an event, even if the daily note isn't currently open in
any pane. Multi-slot live update: still requires the user to click
into the daily note's pane to see the new content (TabPane caches
its body in state and re-reads on `reloadTick`); v1.2 candidate.

**Visible regen failure surface.** If `regenerate_calendar_section`
returns an error (most likely cause: stale Tauri binary because
the user didn't restart `pnpm tauri dev` after a Rust change), the
calendar's banner now shows a pointed message rather than a silent
`console.warn`. Diagnostic, not a fix — but it means the user
catches the "I need to restart the dev server" issue immediately.

**Schema migration.** `ALTER TABLE events ADD COLUMN
recurrence_rule TEXT` (idempotent — fails silently if the column
already exists). `Event` struct gets `recurrence_rule:
Option<String>` with `#[serde(default)]` so existing rows
deserialise fine.

**Hand-rolled RRULE expander.** No `rrule` npm package on the
frontend; instead `expand_recurrence(master, window_start,
window_end) -> Vec<Event>` in Rust. Supports the subset Cluster 11
v1.1 ships through the modal UI:

- `FREQ=DAILY|WEEKLY|MONTHLY` (required)
- `INTERVAL=N` (default 1)
- `BYDAY=MO,TU,WE,TH,FR,SA,SU` (WEEKLY only; defaults to master's
  weekday when unspecified)
- `BYMONTHDAY=N` (MONTHLY only; defaults to master's day-of-month)
- `COUNT=N` (cap on emitted occurrences)
- `UNTIL=YYYYMMDDTHHMMSSZ` (inclusive cutoff)

Anything else is silently ignored — best-effort. A buggy rule is
bounded by both `window_end` and a hard 5000-occurrence cap so it
can't run away.

**Shared helper.** `collect_events_in_window(conn, start, end)` is
a private function called by both `list_events_in_range` (the
calendar UI) and `regenerate_calendar_section` (the daily-note
splice). Two passes: standalone events with overlap query, then
recurring masters with full scan + per-master expansion. Sort by
start. Without this, the splice wouldn't include recurring
occurrences and the calendar's day view would silently disagree
with the daily note about what's scheduled.

**Repeat field in `EventEditModal`.** New "Repeat" section between
Status and Notes. Top-level dropdown:

- Doesn't repeat
- Every day
- Every week on…
- Every 2 weeks on…
- Every month (same date)
- Custom (RRULE)

Weekly / biweekly options expose a 7-button day-of-week multi-
select. Custom shows a free-text RRULE input. The end-condition
sub-row picks one of: Never / On date / After N occurrences.
Existing rules round-trip back to UI state via `parseRRuleToUi`;
exotic rules (BYSETPOS, BYWEEKNO, anything the parser doesn't
recognise) fall into "Custom" so the user can still edit them as
text.

**React key composition.** Recurring events surface multiple
instances with the same master `id` from `list_events_in_range`.
WeekView and MonthView now key event blocks by `${id}@${start_at}`
so React doesn't collapse the occurrences into a single entry.

### Files touched (v1.1)

- `src-tauri/src/lib.rs`
  - Schema migration `ALTER TABLE events ADD COLUMN
    recurrence_rule TEXT`.
  - `Event` struct: `recurrence_rule: Option<String>` with
    `#[serde(default)]`.
  - `expand_recurrence` (the RRULE engine).
  - Helpers: `parse_rrule_until`, `days_from_civil`,
    `unix_from_ymd_hms`, `days_in_month`, `ymd_from_unix`,
    `hms_from_unix`, `weekday_iso_for_unix`,
    `weekday_iso_index_from_short`.
  - `collect_events_in_window` (shared by the two callers).
  - `list_events_in_range` rewritten to delegate.
  - `regenerate_calendar_section` rewritten to delegate.
  - `format_calendar_markdown` indents event body under each event.
  - `create_event` / `update_event` accept `recurrence_rule:
    Option<String>` and persist the cleaned value.
- `src/components/Calendar.tsx`
  - `CalendarEvent` interface: `recurrence_rule?: string | null`.
  - `saveEdit` / `deleteEdit`: invoke
    `regenerate_calendar_section` on today's daily note after
    success.
  - `regenerateTodaysDailyNote` helper, with visible error banner
    on failure.
  - `todayLocalIso` helper (matches Rust's `today_iso_date`).
  - WeekView + MonthView render keys composed from `id + start_at`.
- `src/components/EventEditModal.tsx`
  - `RepeatPreset` / `EndCondition` types.
  - State: `repeat`, `repeatDays`, `endCondition`, `customRRule`.
  - Repeat UI block (dropdown + day-of-week buttons + custom
    RRULE input + end-condition row + caveat hint).
  - `parseRRuleToUi` (load existing rule into UI state).
  - `buildRRuleFromUi` (UI state → RRULE string for save).
  - `submit` includes `recurrence_rule` in the payload.
  - New styles for the recurrence block.
- `verify-cluster-11.ps1` — bumped tag pattern + commit message
  to v1.1; v1.0 tag is preserved as a checkpoint.

### Known rough edges (v1.1)

- **Whole-series edits only.** Editing any occurrence of a
  recurring event modifies the master, which propagates to every
  instance. Cluster doc explicitly flagged this as the hard
  problem; v1.2 candidate. Until then, "delete just this one"
  isn't possible — the user has to delete the series and recreate
  the rule with the desired exception manually.
- **No EXDATE / RDATE.** Unsupported in v1.1's expander. Custom
  RRULE input accepts EXDATE/RDATE strings but the expander
  ignores them.
- **`regenerate_calendar_section` uses UTC midnight bounds** —
  unchanged from v1.0. Around midnight in non-UTC zones, edge-of-
  day events may fall outside the splice window. Same drift
  Cortex's `today_iso_date` already accepts elsewhere.
- **`local_hhmm_for` still emits UTC HH:MM in the splice.** The
  calendar UI itself renders local time correctly via `new
  Date()`. Local-time splice rendering deferred (was a v1.1
  candidate; pushed because the recurrence work soaked the
  session).
- **Custom RRULE has no validator.** An unparseable string is
  stored verbatim; the expander treats unknown FREQ as
  "single occurrence at master start". Bad rules degrade to
  non-recurring rather than crashing.
- **The "After N occurrences" count counts ALL occurrences from
  the master's start**, not just those inside the visible window.
  So COUNT=10 with a master in 2024 means 10 instances total
  starting 2024, of which the user may see 0 in the current
  visible window. Standard RRULE semantics, but worth knowing.
- **Multi-slot live update for the daily note** still requires
  re-clicking into the daily note's pane. The post-save regen
  rewrites the file on disk; if the daily note is open in
  another slot, that pane caches `editedBody` until the user
  bumps `reloadTick` (Ctrl+R or click another file then back).
  v1.2 candidate.
- **`parseRRuleToUi` falls into "custom" for any rule shape it
  doesn't recognise.** That means a rule the parser couldn't
  classify presents as a free-text input on next edit, which is
  honest but slightly clunky. Acceptable for v1.1.

---

## Phase 3 — Cluster 11 v1.2 — Calendar timezone fixes

User report: "It only registers the event that the 'Now' line is on,
and the hours are wrong." Both symptoms had the same root cause:
v1.0 / v1.1's daily-note splice was UTC-everything.

### What was wrong

`regenerate_calendar_section` computed the "today" window as UTC
midnight to UTC next-midnight:

```rust
let day_start = today_secs - (today_secs % 86_400);  // UTC midnight
let day_end = day_start + 86_400;
```

Events are stored in UTC unix seconds (correct). But the user's
"today" runs from local midnight to local midnight. For the user
in Arizona (MST = UTC-7), Arizona midnight = 07:00 UTC, so the
splice's window covered 17:00 MST yesterday through 17:00 MST
today — a UTC-anchored 24h slice, not a local day. Events created
after 5pm local fell into the *next* UTC day and were spuriously
excluded from "today's" splice. The user's "now" event happened to
straddle the UTC midnight, which is why it appeared to be the only
one that registered.

The matching half ("hours are wrong") was the splice's HH:MM
formatter. `local_hhmm_for(secs)` despite the misleading name
formatted UTC HH:MM — so a 12:00 noon MST event (= 19:00 UTC)
rendered as `"19:00"` in the markdown.

The basename check (`today_iso_date()` vs the daily note's
filename) was also UTC-vs-local mismatched. During the hours when
the user's local date trailed the UTC date by one (5pm-midnight
Arizona = 00:00-07:00 UTC next day), the basename check returned
early and the splice did nothing at all.

### What changed

- **`regenerate_calendar_section` takes `tz_offset_minutes: i32`**.
  Frontend passes `-new Date().getTimezoneOffset()` (positive east
  of UTC, negative west — Arizona = -420). The basename check
  compares against local-today via the new `local_iso_date_for`
  helper. The day-window calculation shifts unix seconds by the
  offset, rounds to local-day boundaries, and converts back to UTC
  unix seconds before issuing the SQL query.
- **`format_calendar_markdown` takes `tz_offset_minutes`** and
  formats HH:MM via the new `local_hhmm_for_with_offset` helper.
- **Old `local_hhmm_for` removed** — the misleading-name UTC-HH:MM
  helper no longer has callers. Cleanup, not a behaviour change.
- **Two call sites updated**: `App.selectFileInSlot`'s daily-log
  branch and `Calendar.regenerateTodaysDailyNote` both pass
  `tzOffsetMinutes: -new Date().getTimezoneOffset()` on every
  invocation.

### Architectural choice: pass-the-offset vs add-a-tz-crate

I did NOT add a Rust timezone crate (`chrono`, `time`, `tzfile`).
Reasons: (a) the project's existing date helpers are hand-rolled
to avoid `chrono` (see the comment on `today_iso_date`), and (b)
the offset is trivially available from JS via standard browser
APIs. The frontend is the source of truth for "what is the user's
local time"; the Rust side just receives the answer. Saves ~1MB
of binary, no system tz database lookup, no DST transitions
during a fetch, no surprise stale tz tables.

The trade-off: if the user changes their system clock /
timezone while Cortex is open and doesn't refresh the page,
the offset Rust receives can drift from reality. Acceptable
— the same drift would affect any browser app and is corrected
by any new daily-note open.

### Files touched (v1.2)

- `src-tauri/src/lib.rs`
  - New helpers: `local_hhmm_for_with_offset(utc_secs,
    tz_offset_minutes)`, `local_iso_date_for(utc_secs,
    tz_offset_minutes)`.
  - Removed: `local_hhmm_for`.
  - `format_calendar_markdown` signature gains
    `tz_offset_minutes: i32`.
  - `regenerate_calendar_section` signature gains
    `tz_offset_minutes: i32` and uses local-day window logic +
    local-today basename check.
- `src/App.tsx` — `selectFileInSlot` calendar branch passes
  `tzOffsetMinutes`.
- `src/components/Calendar.tsx` — `regenerateTodaysDailyNote`
  passes `tzOffsetMinutes`.
- `verify-cluster-11.ps1` — bumped to tag `cluster-11-v1.2-complete`,
  preserving v1.0 / v1.1 checkpoints.

### Known rough edges (v1.2)

- **`list_events_in_range` does not currently take an offset**
  because the frontend already computes its window in local
  terms (`mondayStartLocal` returns the UTC unix-second
  equivalent of local Monday midnight). So the calendar UI was
  always correct — only the splice was wrong. This means there
  are now two independent paths to the same SQL query, both
  producing the right window in different ways. v1.3 candidate:
  thread the offset through `list_events_in_range` for symmetry,
  even though it doesn't change behaviour.
- **DST transitions** mid-event are not handled — an event
  spanning a DST boundary uses a single offset for both ends.
  `getTimezoneOffset()` returns the offset for the moment it's
  called, not for each event's start. For Arizona this is
  irrelevant (no DST observed). For other zones, an event from
  01:00 to 03:00 on a "spring forward" night would have its
  splice hours off by one. Acceptable for v1.2; v1.3 if it bites.
- **The `Now` line in WeekView** is also derived from a JS
  `Date.now()`, which is local-time-correct already. No fix
  needed there.

---

## Phase 3 — Cluster 10 v1.2 + Cluster 6 v1.7 follow-ups

Two unrelated regressions reported in the same session.

### Cluster 10 v1.2 — yesterday's commits in today's daily note

`fetch_github_summary_inner` was passing `iso_24h_ago()` as the
`?since=` parameter to GitHub's commits API — a rolling 24-hour
window from now. The `## Today's GitHub activity` heading promises
"today's" activity, but a rolling window naturally includes commits
made yesterday afternoon when opened today morning. User reported
this as a bug.

Fix: introduce `since_local_midnight_today_iso(tz_offset_minutes)`
which computes the UTC unix-second timestamp of "the start of
today's local day" (using the same shift-then-round-then-shift
trick the v1.2 calendar fix uses). Replaced the `iso_24h_ago` call
with this. Removed `iso_24h_ago` (had no other callers).

The cache fingerprint now includes `local_today_iso` so a cache
populated yesterday is automatically considered stale today,
regardless of the 10-minute TTL.

Three Tauri commands took on a new `tz_offset_minutes: i32`
parameter — `fetch_github_summary`, `fetch_github_summary_now`,
`regenerate_github_section`. Three frontend call sites updated:
`App.selectFileInSlot` (daily-log GitHub regen), `App.tsx`'s
`Ctrl+Shift+G` insert-at-cursor handler, and
`IntegrationsSettings.testConnection`. All pass
`tzOffsetMinutes: -new Date().getTimezoneOffset()`. The
`regenerate_github_section` basename check also moved from
`today_iso_date()` (UTC) to `local_iso_date_for(unix_now(),
tz_offset_minutes)` so the splice runs against the right daily
note when the user's local date and UTC date disagree.

### Cluster 6 v1.7 — Ctrl+K on PDFs broken in single-slot

User reported "Ctrl+K search on PDFs is not working anymore."
Root cause was a v1.6 regression I introduced when adding the
`isActive` gate to PDFReader's window keydown listener.

App.tsx had been passing `isActive={activeSlotIdx === i &&
slotCount > 1}` to TabPane — semantically "this is the active
slot AND we're in multi-slot mode," which doubled as both the
keyboard-routing signal AND the visual accent-outline trigger.
In single-slot mode `slotCount > 1` is false, so `isActive` was
false on the only pane. My v1.6 PDFReader gate `if (!isActive)
return;` then suppressed every Ctrl+K press in single-slot.

Fix: split the prop. `isActive` now means purely "this is the
active slot" (true for the only pane in single-slot AND for the
active pane in multi-slot). A new `multiSlot: boolean` prop
drives the visual chrome — the accent outline on `paneRoot` and
the SlotBadge — both of which only render when `multiSlot &&
isActive`.

This restores single-slot Ctrl+K (PDFReader's gate now lets the
event through) while preserving the existing visual behaviour
(no outline / badge in single-slot mode, since the user has
nothing to disambiguate against). Multi-slot Ctrl+K behaviour
is unchanged: only the active slot's PDFReader toggles its
search bubble, since `isActive` is still false for inactive
slots in multi-slot mode.

### Files touched (v1.2 / v1.7)

- `src-tauri/src/lib.rs`
  - New `since_local_midnight_today_iso(tz_offset_minutes)`.
  - Removed `iso_24h_ago`.
  - `github_config_fingerprint` signature gained a
    `local_today_iso` parameter.
  - `fetch_github_summary_inner` signature gained
    `tz_offset_minutes: i32`; uses it for the cache fingerprint
    and the `?since=` window.
  - Three Tauri commands updated to pass through
    `tz_offset_minutes`.
  - `regenerate_github_section`'s basename check switched to
    `local_iso_date_for(unix_now(), tz_offset_minutes)`.
- `src/App.tsx`
  - `<TabPane isActive=...>` changed from `activeSlotIdx === i
    && slotCount > 1` to `activeSlotIdx === i || slotCount === 1`.
  - New `multiSlot={slotCount > 1}` prop.
  - Three GitHub invoke calls updated to pass
    `tzOffsetMinutes`.
- `src/components/TabPane.tsx`
  - `TabPaneProps` gained `multiSlot: boolean`.
  - Outline and SlotBadge render gated on `isActive && multiSlot`
    (was `isActive`).
- `src/components/IntegrationsSettings.tsx`
  - `fetch_github_summary_now` invoke includes
    `tzOffsetMinutes`.
- `verify-cluster-10.ps1` — bumped to tag
  `cluster-10-v1.2-complete` + `cluster-6-v1.7-complete` on the
  same commit, preserving v1.0 / v1.1 / v1.6 checkpoints.

---

## Phase 3 — Cluster 15 v1.0 — Reminders (+ Cluster 11 v1.3 calendar shortcut)

User-driven feature in a single message: pop-up reminder overlay
(modal-style, like the command palette — not a slot view), a
notification bell with a count badge + sound + red urgency, line-
based parser that splits date / time / description, and resolve =
remove from disk.

### Architectural choices

- **Single file at `<vault>/Reminders.md`.** Visible in the file
  tree, hand-editable as a regular markdown note, indexed in FTS5
  alongside everything else. No SQLite table — overkill for this
  shape of data and would invite a UI-only edit path that the
  user couldn't fix with their text editor when needed.
- **Line-based, not YAML or JSON.** The user's spec is "each line
  is a reminder." The parser stays tolerant: anything it can't
  parse (no leading date, no leading time) becomes a "no date / no
  time / always-pending" reminder with the line as its
  description. There's no failure mode where a line is silently
  dropped.
- **Markdown headings + checkboxes recognised.** Lines starting
  with `#`/`##`/etc. are skipped (so users can group reminders
  under sections without those headings becoming bogus reminders).
  Checkbox prefixes (`- [ ]`, `- [x]`) and bare list-item prefixes
  (`-`, `*`, `+`) are stripped before parsing — pasting a
  Markdown todo list into Reminders.md "just works."
- **Resolve = delete the line.** Per the user's spec ("once it
  has been marked as resolved in the notification, remove that
  reminder line from the reminder document"). Simpler than a
  per-line `[x]` flag and matches the user's mental model. The
  Tauri command matches on trimmed-content equality so a stale
  notification panel resolving an already-edited line either
  removes the right one or no-ops gracefully.
- **WebAudio beep, no asset.** A 120ms 440Hz tone with a quick
  fade-out, generated lazily per call. No `.wav` to ship, no
  audio file in the binary, no licensing footnote. The
  AudioContext is created and torn down each time so we don't
  hold an open audio session indefinitely.
- **30-second poll cadence.** Same precedent as the calendar's
  "now" line. Cheap, and gives at most 30s of latency between a
  reminder entering the 1-hour window and the bell reacting. Plus
  the overlay's `onChanged` callback bumps a `refreshTick` prop
  so the bell refreshes immediately after a save without waiting
  for the next poll.
- **Alerted state in `localStorage`.** Keyed on a 32-bit FNV-1a
  hash of `(date, time, normalised description)`. Editing any of
  those three fields produces a different hash and re-arms the
  alert. Re-launching Cortex preserves the alerted state — so the
  user doesn't get re-alerted at lunchtime for the morning's
  approaching reminders. The alerted-state-key is removed when
  the reminder is resolved, so re-creating an identical line
  later behaves like a fresh reminder.
- **Status bucket semantics.**
  | Bucket | Meaning |
  |---|---|
  | `anytime` | No date, no time. Always in the bell badge. |
  | `all-day-active` | Date == today, no time. In the bell badge for the whole day. |
  | `approaching` | Date+time scheduled within the next 1 hour. Triggers a beep on transition. |
  | `future` | Date+time more than 1 hour away. NOT in the bell badge — just lives in the file. |
  | `past-due` | Date+time has passed (or all-day with date < today). In the bell badge AND forces the bell colour to red. |

  Time-only entries (`14:30 Quick errand` with no date) are
  interpreted as today; once the day rolls past, they re-classify
  as past-due.
- **Two adjacent UIs, not one.** The `ReminderOverlay`
  (Ctrl+Shift+M) is a scrim-modal for editing the file as a
  whole; the `NotificationBell` is for at-a-glance count + per-
  reminder resolve. The user explicitly asked for both surfaces;
  combining them would force a tab UI that didn't add anything.

### Files touched (Cluster 15 + Cluster 11 v1.3)

- `src-tauri/src/lib.rs`
  - New constant `REMINDERS_FILENAME = "Reminders.md"`.
  - New helper `reminders_path(vault_path)`.
  - Three Tauri commands: `read_reminders`, `write_reminders`,
    `delete_reminder_line`. The last one matches by trimmed-
    content equality.
  - `write_reminders` and `delete_reminder_line` both call
    `index_single_file` so the file participates in FTS5.
  - All three registered in the `invoke_handler!` macro.
- `src/utils/reminders.ts` — new utility module:
  - `parseReminderFile`, `parseReminderLine`.
  - `computeStatus(r, now)`.
  - `isActiveReminder`, `sortByUrgency`.
  - `reminderHash` (32-bit FNV-1a of date|time|description).
  - `playBeep` (WebAudio).
  - `localIsoDate(d)` helper.
- `src/components/ReminderOverlay.tsx` — new modal.
  - Quick-add input that prepends a new line on Enter.
  - Textarea showing the file verbatim.
  - "Save & close" / "Cancel" / "Open in pane" actions.
  - Click on the scrim → save-and-close (mirrors the rest of
    Cortex's modal idiom).
- `src/components/NotificationBell.tsx` — new top-bar button.
  - 30-second poll + reload from disk + classify.
  - Count badge with red urgency on past-due, accent otherwise.
  - Click → dropdown panel with Resolve buttons.
  - Plays a beep on approaching/past-due transitions; alerted
    state in localStorage.
  - Click-outside closes the dropdown.
- `src/App.tsx`
  - Imports + render of `ReminderOverlay` and `NotificationBell`.
  - `reminderOverlayOpen` state, `reminderRefreshTick` state.
  - `Ctrl+Shift+C` keyboard handler → active slot's
    `setActiveView("calendar")` (Cluster 11 v1.3).
  - `Ctrl+Shift+M` keyboard handler → `setReminderOverlayOpen(true)`.
  - Esc clears the overlay along with other modals.
  - `<NotificationBell>` rendered immediately to the LEFT of the
    `LayoutPicker` in the main top bar (per the user's spec).
- `src/components/ShortcutsHelp.tsx` — Ctrl+Shift+C and
  Ctrl+Shift+M rows added.
- `cluster_15_reminders.md` (repo root) — new cluster doc.
- `phase_2_overview.md` — index updated.
- `verify-cluster-15.ps1` — new.

### Known rough edges (v1.0)

- **Time-only with no date crosses midnight inelegantly.** A line
  like `23:30 Wrap up` opened at 23:45 reads as past-due
  (23:30 today already passed), but at 00:15 the next day it'd
  re-read as "approaching" (23:30 today, ~22 hours away — wait,
  that's "future"). The interpretation "today" can drift across
  midnight. Acceptable for v1.0; the user can add a date to pin.
- **Hand-editing the file while the overlay is open** is fine
  for the bell (next poll picks it up, ≤30s) but the overlay
  caches its own copy — if the user edits the file in another
  pane while the overlay is open, the overlay won't reflect the
  external change. Closing + reopening the overlay re-reads.
  v1.1 candidate: a "refresh from disk" button.
- **Sound played on app startup if a reminder is already past-due
  and hasn't been alerted-for-past-due yet.** This is intended
  (you should be reminded), but if the user has a long list of
  unresolved past-due items, only one beep fires (we don't beep
  N times for N transitions in the same render). Per-reminder
  alerted tracking still works; the visual badge shows them all.
- **AudioContext "needs user interaction" warning on first beep**
  is theoretically possible but unlikely in practice — opening
  Cortex IS a user interaction, and even a single click into the
  app counts. Documented for the rare case where the first beep
  is silent; subsequent ones work.
- **The bell's `error` state** ("Couldn't read reminders: …") is
  the diagnostic we surface when the Tauri binary doesn't yet
  have the new commands. Same pattern as Cluster 11's "restart
  pnpm tauri dev" hint.
- **Dropdown panel position is anchored to the bell.** With the
  bell next to the LayoutPicker in the top bar, the dropdown
  reaches down into the calendar / editor area. If a TabPane has
  modals open above the dropdown's z-index, the dropdown could
  occlude them. v1's z-index is 1100 — below the modal scrims at
  1300+ — so this should be fine. Worth checking if a future
  modal overlaps awkwardly.
- **Resolving a recurring task** (e.g., a daily standup written
  as a single line) deletes the line entirely. v1.1 candidate:
  recognise patterns like `daily 09:00 Standup` or
  `weekly MON 10:00 1:1` and re-anchor instead of deleting.
  Until then, recurring commitments belong on the Cluster 11
  calendar with a real RRULE.

---

## Phase 3 — Cluster 11 v1.4 — per-event notifications

User-driven feature: each calendar event can carry a notification
config (none / all-day / urgent / ahead-of-time with user-specified
lead). The notification bell merges these alongside the existing
file-source reminders, so a single bell + dropdown surfaces both
"things you typed in Reminders.md" and "events with notify enabled."

### Architectural decision: synthetic, not file-side-effect

Two ways to surface event notifications:

**A.** When an event is saved, also write a corresponding line into
   `Reminders.md` (with a hidden marker linking back to the event
   id). Save/edit/delete of the event keeps that line in sync.
**B.** When the bell polls, also fetch events with `notify_mode` set
   and synthesise reminder rows from them on the fly. Nothing is
   written to `Reminders.md` as a side effect.

I went with B. Two reasons:

- `Reminders.md` stays the user-typed truth source; events stay the
  calendar truth source. There's no "find-and-update-by-marker"
  logic to maintain when an event time moves. No risk of phantom
  lines accumulating in `Reminders.md` if the linkage breaks.
- Recurring events get notifications for free.
  `list_events_in_range` already expands the master into instances
  with their own `start_at`; each expanded instance generates its
  own synthetic reminder. Approach A would have required either
  N reminder lines per recurring event or an in-place lookup
  scheme, both worse.

The trade-off: synthetic reminders aren't visible in the
`ReminderOverlay`'s textarea, and the user can't hand-edit them
(the way they can hand-edit a line in `Reminders.md`). To "snooze"
or change an event notification you go back to the calendar event
modal. Acceptable — these are two surfaces with two purposes.

### Status semantics per mode

| mode      | trigger time           | bell visibility | bell colour            | beep when                        |
|-----------|------------------------|-----------------|------------------------|----------------------------------|
| all_day   | event date all day     | event date only (past-due if event date is in the past) | accent (today) / red (past)  | first poll where status crosses to past-due  |
| urgent    | n/a                    | always (until dismissed) | red (forced past-due)  | first poll where the synthetic appears       |
| ahead     | event_start - lead     | from trigger to event_start (approaching), thereafter past-due | accent then red       | first poll where now ≥ trigger              |

The `future` bucket (status hasn't reached the trigger yet) is
filtered out of the bell so users don't see scheduled-but-not-yet-
fired notifications cluttering the panel. Once the trigger is
reached, the synthetic appears, the badge increments, and the
beep fires on the same render cycle (via the existing alerted-
once tracking in `localStorage`).

### Resolution semantics

Resolve dispatches by source:

- `source === "file"`: existing path. `delete_reminder_line`
  removes the line from `Reminders.md`. The localStorage alerted
  flag is cleared so re-creating an identical line later behaves
  like a fresh reminder.
- `source === "event"`: new path. `localStorage.setItem(
  "cortex:event-notif-dismissed:<eventId>@<instanceStart>", "1")`.
  No backend call. The event itself stays untouched on the
  calendar. A `dismissTick` state in the bell forces an immediate
  re-derive so the dismissed entry vanishes without waiting for
  the next 30s poll.

Per-instance keying (`eventId@instanceStart`) means dismissing
this Monday's "Standup" doesn't silence Tuesday's. For non-
recurring events it just degrades to one key.

### Schema migration

```sql
ALTER TABLE events ADD COLUMN notify_mode TEXT;            -- NULL / 'all_day' / 'urgent' / 'ahead'
ALTER TABLE events ADD COLUMN notify_lead_minutes INTEGER; -- only for 'ahead'
```

Same idempotent `let _ = conn.execute(...)` pattern as the existing
`recurrence_rule` and `injected_at` migrations. Old vaults pick up
the columns on first open with no migration step.

A new `clean_notify_mode` helper whitelists the three valid mode
strings server-side, so a frontend bug can't poison the table with
an unknown value. `notify_lead_minutes` is auto-cleared to NULL
when the mode isn't `ahead`.

### UI

`EventEditModal` gains a Notification block between the Repeat
section and the Notes textarea. Mode dropdown (None / All day /
Urgent / Ahead of time…). When mode === "ahead", a sub-row appears
with a preset selector (5 / 10 / 15 / 30 / 60 / 120 / 1440 minutes
+ Custom) and a number input (the same field — the preset
selector just snaps the number). A short hint text below explains
what the picked mode does ("Notification fires 15 min before…").

Existing events round-trip the saved values back into the UI on
edit. Clearing the mode (back to "None") nulls both columns on
save.

### Files touched (v1.4)

- `src-tauri/src/lib.rs`
  - Schema migration: two `ALTER TABLE events ADD COLUMN` calls.
  - `Event` struct: `notify_mode: Option<String>`,
    `notify_lead_minutes: Option<i64>`, both with `#[serde(default)]`.
  - `clean_notify_mode(s)` helper to whitelist the value.
  - `create_event` / `update_event` signatures gain the two
    parameters; INSERT and UPDATE statements include the new
    columns.
  - Both `collect_events_in_window` SELECT statements include the
    new columns; the row-mapping closures construct the new fields.
  - `expand_recurrence`'s `push_instance` closure carries the
    notify fields through to expanded instances.
- `src/components/Calendar.tsx`
  - `CalendarEvent` interface gains `notify_mode?: string | null`,
    `notify_lead_minutes?: number | null`.
  - `saveEdit` payload type extended; both `update_event` and
    `create_event` invoke calls forward
    `notifyMode` / `notifyLeadMinutes`.
- `src/components/EventEditModal.tsx`
  - `NotifyMode` type; `LEAD_PRESETS` constant.
  - `notifyMode` / `notifyLead` state.
  - Round-trip from `existingEvent.notify_mode` /
    `notify_lead_minutes` in the open-state effect.
  - New Notification block in the JSX (between Repeat and Notes).
  - `submit()` includes the two fields in the onSave payload.
  - `formatLeadLabel(minutes)` helper.
- `src/components/NotificationBell.tsx`
  - Imports `CalendarEvent`, `localIsoDate`.
  - `EVENT_DISMISSED_LS_PREFIX`, `EVENT_LOOKBACK_DAYS`,
    `EVENT_LOOKAHEAD_DAYS` constants.
  - `BellReminder` extends `ReminderWithStatus` with `source`,
    `eventId`, `instanceStart`.
  - `synthesizeEventReminders(events, now)` — three branches.
  - `eventDismissKey`, `isEventDismissed`.
  - State: `events`, `dismissTick`.
  - `reload` now fetches events alongside reminders content.
  - `eventReminders` memo + merged into `active`.
  - `resolve` dispatches by source.
  - List `key=` per row composed from source + identifier.

### Known rough edges (v1.4)

- **Editing notify_mode on a recurring event affects all
  instances** — same whole-series-edit limitation as v1.1
  recurrence. Per-instance notification overrides are reserved
  for the same v1.5+ pass that adds per-instance event
  modifications.
- **Dismissed urgent events stay dismissed across reloads** —
  good for the user (won't re-alert tomorrow) but slightly
  surprising if they expect "urgent" to mean "always re-warn me."
  The intent is "remind me until I acknowledge"; once
  acknowledged it's silent.
- **No "snooze" on event notifications.** Resolve is permanent
  (per instance). Same v1.5 candidate as the reminder snooze.
- **Event with `notify_mode = "ahead"` and a lead longer than
  EVENT_LOOKAHEAD_DAYS (14 days)** would never appear in the
  bell — the event isn't fetched into the polling window. The
  default 14-day lookahead covers the LEAD_PRESETS up to 1 day,
  which covers the realistic cases. Bumping the lookahead is a
  one-line constant change if needed.
- **EVENT_LOOKBACK_DAYS = 1** means past-due events stay in the
  bell only while their date is within the last day; older
  past-due events drop off. For urgent mode that's relevant —
  an urgent flag on an event 3 weeks ago would not surface.
  Document; v1.5 candidate to either bump the lookback or use a
  separate query for urgent events specifically.
- **The synthetic's React key** uses `eventId@instanceStart`
  which is stable across renders. If the user moves the event's
  start_at, the synthetic gets a new key — React unmounts and
  remounts the row, the dismissed flag (also keyed on
  instanceStart) is independent. This means moving the event's
  start_at by even one minute creates a "fresh" notification
  surface. Acceptable; matches users' mental model that "moving
  the meeting" is a real change worth re-warning on.

---

## Phase 3 — Cluster 12 v1.0 — Google Calendar (read-only sync)

User explicitly picked Cluster 12 + read-only scope after Cluster 11
v1.4 shipped. The cluster doc walked the design before code (cluster
12's "Decisions already made" + "Architecture sketch" sections).

### Architectural choices worth flagging

- **One-way sync, Google → Cortex.** Two-way sync (write-back) is
  v2.0. v1.0 doesn't need conflict resolution, doesn't need PATCH
  endpoints, doesn't have to reason about "what if both sides
  edited the same event." Read-only enforcement happens at the UI
  layer (modal banner, disabled inputs, hidden Save/Delete) rather
  than at the database layer — `source = 'google'` events are
  perfectly editable in SQL, but the UI doesn't expose the path.
- **Hand-rolled loopback OAuth flow.** No `tauri-plugin-oauth`
  dependency. The flow is ~150 lines of `std::net::TcpListener` +
  a single-request HTTP/1.1 parser + a `tauri::async_runtime::
  spawn_blocking` wrapper around the accept call. Same minimum-
  dependencies ethos as Cluster 6's PDF.js choice and Cluster 11's
  hand-rolled grid.
- **User-provided OAuth credentials.** Cortex doesn't ship a baked-
  in `client_id` / `client_secret`. The user creates their own
  Google Cloud OAuth client (5 minutes of clicking through Google
  Cloud Console; setup steps surfaced in the IntegrationsSettings
  panel). This is the standard model for open-source desktop apps:
  no shared secret to leak, no "our" project to maintain at scale,
  no privacy concern about Cortex routing requests.
- **`source` column on events.** Adds provenance without schema
  duplication. Local events get `source = 'local'` (or NULL,
  treated identically by readers); Google events get `source =
  'google'`, `external_id = google_event_id`, `external_etag` for
  change detection, `external_html_link` for the Open-in-Google
  button. Composite index on `(source, external_id)` for upsert
  speed.
- **Full-fetch with deletion sweep**, not `syncToken` delta sync.
  v1 fetches all events in a 30-day-back / 90-day-forward window
  every poll and DELETEs Google-sourced events not in the response.
  Google's incremental `syncToken` API is meaningfully cheaper at
  scale, but the bookkeeping (storing the token, handling 410-Gone
  fallbacks, full-resync recovery) is complexity v1 doesn't need.
- **`singleEvents=true` for recurrence.** Google expands recurring
  masters server-side and we receive concrete instances. Saves us
  writing a Google-RRULE-to-Cortex-RRULE translator. Each instance
  carries a unique `id`, so the upsert/sweep handles them one at a
  time naturally.
- **5-minute auto-sync cadence + on-startup + manual button.**
  Google's API limit (1M queries/day on default project quota) is
  generous enough that this is well below polite usage. Plus the
  `Sync now` button in IntegrationsSettings for users who want
  immediate refresh.
- **Tokens stored in `config.json`.** Same trade-off Cluster 10
  made for the GitHub PAT — per-user `%APPDATA%` ACL is the v1
  protection. OS keychain integration is a future security pass
  that covers GitHub + Google + Outlook together.
- **Default `external` category seeded on first sync.** All Google
  events start there; user can recategorise via SQL if they want
  (the modal's category dropdown is disabled for Google events).
  `INSERT OR IGNORE` keeps it idempotent.
- **App.tsx fires the auto-sync** as a `useEffect` keyed on
  `vaultPath`. The IntegrationsSettings panel's manual sync calls
  the same Tauri command. Both paths share the same
  `sync_google_calendar` implementation; no divergence.

### Files touched (Cluster 12 v1.0)

- `cluster_12_google_calendar_sync.md` (repo root) — new cluster
  doc.
- `src-tauri/src/lib.rs`
  - Schema: 4 idempotent `ALTER TABLE events ADD COLUMN` calls
    (source / external_id / external_etag / external_html_link)
    + 2 `CREATE INDEX IF NOT EXISTS` calls.
  - `Event` struct gains four `Option`-typed fields with
    `#[serde(default)]`.
  - `VaultConfig.google_calendar: Option<GoogleCalendarConfig>` +
    the new struct.
  - Constants: `GOOGLE_OAUTH_AUTH_URL`, `GOOGLE_OAUTH_TOKEN_URL`,
    `GOOGLE_OAUTH_USERINFO_URL`, `GOOGLE_CAL_API_BASE`,
    `GOOGLE_CAL_SCOPE`.
  - `PendingOAuth` + `PENDING_OAUTH` static for in-flight handshake
    state.
  - Helpers: `random_state_token`, `url_encode`, `url_decode`,
    `hex_val`, `parse_oauth_callback`, `parse_google_datetime`,
    `parse_rfc3339_to_unix`, `ensure_external_category`,
    `refresh_google_access_token`, `ensure_fresh_access_token`.
  - Tauri commands: `start_google_oauth`,
    `await_google_oauth_code`, `complete_google_oauth`,
    `get_google_calendar_config`, `disconnect_google_calendar`,
    `set_google_calendar_id`, `list_google_calendars`,
    `sync_google_calendar`. Eight new commands; all registered in
    `invoke_handler!`.
  - `create_event` / `update_event` continue to set
    `source = 'local'` on locally-created events; the four new
    fields default to None there.
  - `expand_recurrence` carries the new fields through to expanded
    instances (Google recurring events received with
    `singleEvents=true` arrive pre-expanded so they don't go
    through `expand_recurrence`, but local recurring events
    naturally have `source = 'local'` and the carry-through is
    correct).
  - Both `collect_events_in_window` SELECTs include the new
    columns; row-mapping closures construct the new fields.
- `src/components/Calendar.tsx`
  - `CalendarEvent` interface: four new optional fields.
  - WeekView event-block render and MonthView event-chip render
    surface a `G` badge when `source === 'google'`. Tooltip
    appends "— Google Calendar". `googleBadge` style in the
    styles map.
- `src/components/EventEditModal.tsx`
  - `isReadOnly = existingEvent?.source === 'google'` derived
    flag.
  - Read-only banner with an "Open in Google Calendar" link
    (uses `@tauri-apps/plugin-opener`'s `openUrl` lazily).
  - All inputs gain `disabled={isReadOnly}`.
  - Footer: Save and Delete hidden when read-only; the Cancel
    button reads "Close" instead.
  - `readOnlyStyles` const for the banner.
- `src/components/IntegrationsSettings.tsx`
  - Now takes `vaultPath` prop (App.tsx forwards it).
  - Replaced the v1.0 "Google Calendar / Overleaf (later)"
    placeholder with a real `GoogleCalendarSection` component.
  - The section: setup-steps collapsible, client_id /
    client_secret inputs (with show/hide), Connect / Disconnect /
    Sync-now / calendar-picker UI, last-sync-timestamp +
    most-recent SyncSummary display.
  - The connect flow chains `start_google_oauth → openUrl(auth_url)
    → await_google_oauth_code → complete_google_oauth →
    list_google_calendars` end-to-end with single-click UX.
- `src/App.tsx`
  - Imports updated.
  - `IntegrationsSettings` invoke now passes `vaultPath`.
  - New `useEffect` keyed on `vaultPath` runs an immediate
    `sync_google_calendar` then schedules one every 5 minutes.
    No-op if Google Calendar isn't connected; transient errors
    are `console.warn`'d (the settings panel surfaces persistent
    state).

### Known rough edges (v1.0)

- **Disconnecting doesn't auto-clean Google events.** After
  Disconnect the previously synced events stay in the calendar
  table — the next `sync_google_calendar` is a no-op (no config),
  so the deletion sweep doesn't run. Users who want a clean slate
  can run `DELETE FROM events WHERE source = 'google'` directly.
  v1.1 candidate: add a one-shot cleanup on disconnect.
- **Cancelled OAuth flow leaves a dangling listener** in the
  `PENDING_OAUTH` slot until Cortex restarts. The OS reclaims the
  port at process exit, so it's not a resource leak — but a
  stuck flow blocks the next Connect attempt with "No OAuth
  flow in flight." Acceptable; fix is to add an idle timeout +
  abort to `await_google_oauth_code`.
- **Refresh-token revocation surfaces as a 401.** When Google
  revokes the refresh token (user changed password, security
  event, 6 months of inactivity), `refresh_google_access_token`
  returns "Token refresh returned non-200: ..." and the next
  sync fails. v1 doesn't auto-detect this and prompt
  reconnection; user has to notice the failed-sync banner and
  Disconnect+Reconnect manually. v1.1 candidate.
- **All-day Google events use UTC midnight bounds, not local
  midnight.** Google's `start.date` value is a YYYY-MM-DD
  without timezone; we map it to UTC midnight. In zones far
  from UTC this could shift the displayed date by ±1 day at
  the boundaries. Same drift the rest of Cortex's
  hand-rolled date helpers accept (see Cluster 11's tz notes).
- **Read-only enforcement is UI-only.** A motivated user could
  edit Google events directly via SQL or by manipulating the
  calendar's invoke calls. v1 trusts the UI gate; this becomes
  important when v2 enables write-back and we need a clearer
  contract.
- **No conflict surfacing for events that exist in both Cortex
  and Google with similar metadata.** They'll appear as two
  separate events in v1.0. v2 candidate: detect (by title +
  start_at within ±5 min) and offer to merge.
- **Sync window: [now − 30d, now + 90d].** Events outside this
  window are not synced and are not subject to the deletion
  sweep. If Google has a meeting 100 days out, it won't appear
  until the day passes into the sync window. Bumping the
  forward bound is a one-line constant change (search for
  `90 * day` in `sync_google_calendar`).
- **`@tauri-apps/plugin-opener`'s `openUrl` is not available on
  every Tauri 2 build configuration**. The IntegrationsSettings
  Connect flow gracefully falls back to surfacing the auth URL
  in an error banner so the user can copy/paste, but in
  practice the plugin is in `package.json` and works.
- **A future Cluster 13 (Outlook)** will reuse most of the
  OAuth scaffold but with Microsoft-specific endpoints and the
  Graph API for events. Estimated 1-2 days extension since the
  loopback listener + state validation + token refresh patterns
  are already established here.

---

## Phase 3 — Cluster 16 v1.0 — QoL pack

Frontend-only ship: six small features the user reported as daily
friction, bundled into a single 1.5-day cluster. Each item is too
small to deserve its own cluster but big enough to need a doc and a
paper trail. The cluster doc (`cluster_16_qol_pack.md`) explicitly
slices the bigger original ask into Cluster 16 (this) +
Cluster 17 (block widget rewrite) + Cluster 18 (Excel layer for
tables); user picked Cluster 16 first.

### Architectural choices worth flagging

- **Ctrl+S scroll fix is on the comparison side, not via
  scrollTop snapshot/restore.** The original symptom was
  "Ctrl+S jumps to the bottom of the doc." Diagnosis: when
  `saveCurrentFile` runs, the post-save effect re-derives
  `editedBody` and pushes it to `Editor.tsx`'s `content` prop;
  the editor's content effect compares `getMarkdown()` against
  `content`, sees them as different (because tiptap-markdown
  *escaped* the `[[…]]` brackets to `\[\[…\]\]` in `getMarkdown()`
  but `editedBody` had unescaped brackets), fires `setContent`
  with `emitUpdate: false`, and ProseMirror's content swap resets
  scrollTop to 0. The fix applies `unescapeWikilinkBrackets()`
  to `getMarkdown()` before the comparison, so identical content
  *is* recognised as identical and `setContent` doesn't fire.
  This is approach B from the cluster doc — fixing the cause
  rather than papering over it with a snapshot/restore. The
  fallback (snapshot) was kept on the table but didn't end up
  needed.
- **Wikilink shortcut is `Ctrl+Shift+W`, editor-mode only.**
  `Ctrl+L` is taken (legend), `Ctrl+K` is taken (palette / PDF
  search), no editor-markdown convention claims `Ctrl+Shift+W`.
  Mnemonic ("W for wikilink"). The App-level keyboard handler
  gates it on editor focus so it doesn't fire inside other modal
  inputs.
- **Wikilink wrap delegates through TabPaneHandle, not directly
  through a global ref.** New methods `wrapSelectionInWikilink():
  boolean` and `insertWikilinkAt(title: string): void` on
  `TabPaneHandle`, mirroring the existing `insertExperimentBlock`
  / `insertTable` / `insertGitHubMarkdown` API. The wrap method
  returns a boolean so App.tsx can fall through to pick-mode when
  the selection is empty; the insert method is fire-and-forget
  for the palette callback.
- **Palette pick-mode is a single optional prop.**
  `<CommandPalette onPickResult>` — when provided, replaces the
  default `onOpenFile` behaviour for result clicks and Enter.
  App.tsx passes `onPickResult` only when `wikilinkPickMode`
  state is true. A small banner across the top of the panel
  surfaces the mode so the user knows what clicking a result will
  do. Esc closes the palette and clears `wikilinkPickMode` in one
  step.
- **Multi-paragraph selections collapse to text-only on wrap.**
  `editor.state.doc.textBetween(from, to, "\n", "\n").trim()`
  flattens any structural content. v1 acceptable; the wikilink
  syntax doesn't accept multi-line names, so squashing to spaces
  is correct. Edge case noted in verify smoke-test.
- **Column resize is `Table.configure({ resizable: true,
  handleWidth: 5 })`.** This was disabled in an earlier table
  fix because of a pointer-events conflict; revisited in this
  cluster and the conflict is gone (the table-context-menu
  click handler stops propagation correctly). If the bug
  resurfaces, it'll likely show up as drag-flicker or
  ghost-divider artifacts and should be diagnosed against the
  Tauri WebView2 build version.
- **Equalize columns walks `tr.doc.descendants` once and sets
  each cell's `colwidth` via `tr.setNodeMarkup`.** Target width
  is `floor(table_width / column_count)` — `table_width` is
  read off the table node's wrapper if present, otherwise
  estimated from the sum of existing cell widths. Merged cells
  (`colspan > 1`) get their `colwidth` array filled with N
  copies of the target so the merged cell stays merged-width
  across the equalisation. ProseMirror's table layout takes
  care of the actual rendering.
- **Vertical alignment is a per-cell custom attr on extended
  TableCell + TableHeader nodes**, not a CSS class. The
  `verticalAlign` attr defaults to `null` (not `top`!) so
  existing tables that have no attr render at the browser
  default (typically baseline). Only newly-aligned cells
  emit the inline `style="vertical-align: …"` HTML; everything
  else round-trips through tiptap-markdown's `html:true`
  parser unchanged. No retroactive migration touched existing
  tables.
- **`ValignTableCell` extends `TableCell` and `ValignTableHeader`
  extends `TableHeader`** (separate extensions because TipTap's
  `Table` extension references both base types separately). The
  `addAttributes` body is identical between them, but factoring
  it out into a shared mixin would have crossed the
  diminishing-returns line for a 20-line duplicate.
- **Multi-type blocks share the v1 plain-paragraph format.**
  `::experiment NAME / iter-N` was the only header v1.0 of
  Cluster 4 introduced. Cluster 16 widens the recognised
  prefixes to `::experiment | ::protocol | ::idea | ::method`
  but keeps the same paragraph-level decoration approach (no
  custom node — that's Cluster 17). The decoration regex split
  into two: `EXPERIMENT_HEADER_RE` for the iter-bearing flavour
  and `SIMPLE_HEADER_RE` for `protocol | idea | method`. The
  loop tries both and builds the data-title overlay
  accordingly ("name · iter N" vs "Capitalized · name").
- **Cluster 4's Rust-side `route_experiment_blocks` is
  unchanged.** Only `::experiment` blocks route into iteration
  daily-log auto-sections on save. `::protocol` / `::idea` /
  `::method` are visual conveniences in v1 — they decorate the
  same way but don't trigger any server-side splice. Cluster 17
  may extend the routing if the v2 widget makes it natural; for
  now the user gets a consistent affordance without semantic
  routing for the simpler types.
- **`ExperimentBlockModal` keeps its filename and component
  name** even though it now handles four types. Renaming to
  `BlockModal` was on the table but the import-fanout cost
  outweighed the clarity benefit for a single-cluster ship.
  Cluster 17's widget rewrite is the natural moment to rename.
  Same logic for `ExperimentBlockDecoration.ts` — renamed file
  was on the table; deferred for the same reason.
- **`Ctrl+Shift+W` documented in `ShortcutsHelp.tsx`** under
  "Editor mode" with the dual-mode action description ("wrap
  selected text in [[…]], or open palette pick-mode if nothing
  selected"). Discoverability is part of shipping.

### Files touched (Cluster 16 v1.0)

- `cluster_16_qol_pack.md` (repo root) — new cluster doc.
- `src/components/Editor.tsx`
  - Content effect: `unescapeWikilinkBrackets(getMarkdown())`
    on the comparison side before deciding to call
    `setContent` (Pass 1 fix).
  - `Table.configure({ resizable: true, handleWidth: 5 })`
    re-enabled (Pass 4).
  - New `ValignTableCell` and `ValignTableHeader` extensions
    extending `TableCell` / `TableHeader` with a
    `verticalAlign` attr; replaced the base `TableCell` /
    `TableHeader` in the `extensions` array (Pass 6).
  - `runTableAction` switch handles new cases:
    `equalizeColumns`, `valignTop`, `valignMiddle`,
    `valignBottom` (Pass 5 + 6).
  - `equalizeColumnWidths(editor)` helper: walks descendants
    inside the active table, computes target width, sets each
    cell's `colwidth` via `tr.setNodeMarkup`.
- `src/components/TableContextMenu.tsx`
  - `TableAction` type extended with `equalizeColumns`,
    `valignTop`, `valignMiddle`, `valignBottom`.
  - New "Equalize column widths" item.
  - New "Cell alignment" header + Top/Middle/Bottom indented
    items.
  - New `MenuItemHeader` component, new `indented` prop on
    `MenuItem`, new `itemHeader` style.
- `src/components/TabPane.tsx`
  - `TabPaneHandle` interface gains
    `wrapSelectionInWikilink(): boolean` and
    `insertWikilinkAt(title: string): void`.
  - `useImperativeHandle` implements both: wrap reads
    `editor.state.doc.textBetween` and replaces the selection
    with `[[trimmed]]`; insert uses
    `editor.chain().focus().insertContent('[[trimmed]]')`.
  - `insertExperimentBlock` signature widens to
    `(type, name, iter?)` and the header line is built per
    type.
- `src/components/ExperimentBlockModal.tsx`
  - Exports `BlockType` union (`"experiment" | "protocol" |
    "idea" | "method"`).
  - `onConfirm` signature is now
    `(type: BlockType, name: string, iterNumber?: number) => void`.
  - New `blockType` + `genericName` state.
  - JSX: Type dropdown at top; conditional render of the
    experiment branch (existing experiment dropdown + iter
    input) vs. a single name input for protocol/idea/method.
  - `submit()` branches on type and dispatches the right
    `onConfirm` shape.
- `src/editor/ExperimentBlockDecoration.ts`
  - Regex split: `EXPERIMENT_HEADER_RE` keeps the original
    `::experiment NAME / iter-N` shape;
    `SIMPLE_HEADER_RE` matches
    `::(protocol|idea|method)\s+NAME`.
  - Decoration loop tries both regexes, builds data-title
    accordingly ("name · iter N" or "Capitalized · name").
  - Same green-strip class names for both — visual treatment
    is uniform.
- `src/components/CommandPalette.tsx`
  - New optional `onPickResult?: (path, title) => void` prop.
  - Pick-mode = `!!onPickResult`; banner UI surfaces the mode.
  - Enter / click handlers branch by mode.
- `src/App.tsx`
  - New `wikilinkPickMode` state.
  - `Ctrl+Shift+W` keyboard branch: calls
    `wrapSelectionInWikilink`; falls through to
    `setWikilinkPickMode(true)` when wrap returns `false`.
  - `Esc` clears pick-mode.
  - `<CommandPalette>` render passes `onPickResult` only in
    pick-mode and clears the mode on close.
  - `<ExperimentBlockModal onConfirm={(type, name, iter) => …}>`
    — call site updated to pass `type` through to
    `handle.insertExperimentBlock(type, name, iter)`.
- `src/components/ShortcutsHelp.tsx`
  - New row under "Editor mode": `Ctrl+Shift+W` —
    "Wikilink: wrap selected text in [[…]], or open palette
    pick-mode if nothing selected".

No Rust changes. The cluster touches frontend exclusively and the
verify script runs `cargo fmt + check` only as a sanity guard.

### Known rough edges (v1.0)

- **Multi-paragraph wikilink wrap collapses structure.** A
  selection that spans paragraphs becomes
  `[[paragraph1 paragraph2]]` (newlines → spaces). The wikilink
  syntax doesn't accept multi-line names so this is correct, but
  if the user expected separate links per paragraph they'd be
  surprised. v1.1 candidate: per-paragraph wrap mode.
- **Equalize columns ignores the wrapper's `style="width: …"` if
  it's set in `em` or `%`** — only `px` widths are parsed for the
  total. Falls back to summing existing cell widths if the parse
  fails. Practically all tables in Cortex are pixel-sized so this
  hasn't bitten yet.
- **Vertical-align HTML inside markdown** depends on
  tiptap-markdown's `html:true` setting, which is on. If a future
  ship turns it off (e.g. for safer markdown export) the
  per-cell alignment attr won't round-trip and would need its
  own serialisation hook.
- **Right-click `Cell alignment` operates only on the
  right-clicked cell**, not on a multi-cell selection. v1
  acceptable; "align all selected cells" is a Cluster 18-era
  feature when the table model gets richer.
- **Block decoration regex is anchored at line start** (`^::`),
  so a leading space breaks recognition. If the user types
  ` ::experiment Foo / iter-1` (note the space) the green strip
  doesn't render. Acceptable rough edge — the raw text is still
  there and Save/Routing still works server-side.
- **`Ctrl+Shift+W` inside a code block** wraps the code-text
  content in `[[…]]`. Acceptable in v1 but flagged: a future
  pass could gate the shortcut on the active mark/node type.
- **Pick-mode banner uses inline styles**, not a separate
  styled component. Consistent with the rest of CommandPalette,
  but the palette is overdue for a CSS-vars sweep.
- **No telemetry on shortcut usage**, so we won't know if users
  reach for `Ctrl+Shift+W` more than the existing
  `[[` autocomplete or vice versa. Manual observation only.

### Sequenced follow-ups

- **Cluster 17 — Block widget rewrite.** Convert `::TYPE NAME`
  blocks to a real custom TipTap node so they hold bullets +
  tables, render as a non-editable widget, and right-click
  delete is atomic. Same on-disk markers, schema change is
  editor-side only. Estimated 2 days.
- **Cluster 18 — Excel layer for tables.** Formula parser
  (`=MEAN(C1:C3)`, `=SUM(…)`, …), cell-type formatting (money /
  date / percent / number), freeze rows / columns. Builds on
  the column-resize foundation here. Estimated 3-4 days; the
  formula evaluator is the bulk of it (lexer + parser + a small
  set of stdlib fns + cell-reference resolver).

---

## Phase 3 — Cluster 16 v1.1 — QoL pack patch + typed-block routing

User reported v1.0 bugs after a day of dogfooding:
1. Column widths weren't persisted across save/reload.
2. Vertical alignment wasn't persisted across save/reload.
3. Hovering a column boundary made the title row visibly grow.
4. Equalize column widths shrank tables narrower than the page.
5. Equalize had no way to scope to specific columns.
6. Click-and-drag cell selection didn't appear to work, so the
   "Merge cells" affordance never appeared in the right-click menu.
7. The right-click menu wasn't scrollable and bled off the bottom of
   the app when right-clicking near the viewport edge.

…plus one new feature ask:
8. `::protocol` / `::idea` / `::method` blocks should route the same
   way `::experiment` blocks do — pick from existing log entries,
   splice the block content into the chosen document on save.

The user explicitly chose to bundle all of this into a single ship
(Cluster 16 v1.1) rather than slice into multiple patches. v1.1 is
~1.5 days of work — at the high end of the project's "split if
more than 1.5 days" rule, but the bug fixes and the routing
feature genuinely interleave (both touch the BlockModal, both
update the routing-on-save call site in TabPane).

### Architectural choices worth flagging

- **HTML tables in markdown, always.** The root cause of bugs 1
  and 2 is that GFM pipe-table syntax has no slot for
  `colwidth` or `style="vertical-align: …"` — those attributes
  were silently dropped on every save. Rather than invent a
  per-attribute side-channel (HTML comment block, frontmatter
  metadata, etc.) we serialize tables as `<table>…</table>`
  HTML inside markdown. tiptap-markdown's `html: true` parser
  preserves the HTML on reload; markdown-it follows the
  CommonMark "type-6 HTML block" rule which doesn't re-parse
  content inside `<table>` as markdown, so the cell innards
  round-trip cleanly. Implementation uses ProseMirror's
  `DOMSerializer.fromSchema(node.type.schema)` so we don't have
  to reimplement each cell's rendering — the schema's `toDOM`
  rules emit the right HTML (including `data-colwidth` for
  column widths, `style="vertical-align: …"` for valign,
  `colspan`/`rowspan` for merges, and inline `<strong>` /
  `<em>` / `<mark>` for cell content marks). Old pipe-table
  files keep loading because markdown-it's GFM table plugin
  parses them on first open; on next save they migrate to HTML
  format. This is a one-way migration and was an explicit
  trade-off (user picked "always emit HTML" over "emit HTML
  only when needed").
- **Resize-handle is permanently `pointer-events: none`.** v1.0
  had `pointer-events: auto` on hover so the col-resize cursor
  would activate. The actual hit-detection for column dragging
  is handled inside prosemirror-tables's columnResizing
  plugin via cell-coordinate comparisons — NOT by attaching
  listeners to the visible handle DOM. Setting the handle to
  `pointer-events: auto` was actively harmful: it absorbed
  mousemove events during a cross-cell drag, silently
  preventing prosemirror-tables from extending the
  CellSelection across the column boundary, which then
  silently broke the "Merge cells" affordance because
  `editor.can().mergeCells()` requires a CellSelection.
- **Right-click handler preserves active CellSelection.** v1.0
  unconditionally called `setTextSelection(pos)` on every
  right-click, which collapsed any drag-selected range back to
  a single caret — making `editor.can().mergeCells()` always
  return false even after a successful drag. v1.1 only re-aims
  the selection when the current selection isn't already a
  `CellSelection`. Together with the pointer-events fix above,
  cross-cell drag-and-merge now works.
- **CellSelection background is accent-tinted, not bg-elev.**
  v1.0 used `var(--bg-elev)` which on zebra-striped even rows
  was indistinguishable from the row's existing background.
  v1.1 uses `color-mix(in srgb, var(--accent) 18%, var(--bg))`
  plus an inset 1px accent border so a CellSelection is
  visually unmistakable — half of the v1.0 "drag doesn't work"
  perception was actually "drag works but is invisible".
- **Equalize reads `view.nodeDOM(tablePos).getBoundingClientRect()`
  for the table's actual rendered width.** v1.0 hardcoded
  TARGET = 150 with the comment "the rendered measurement is
  racy with the dispatch." It isn't — `view.nodeDOM` is sync
  and returns the live DOM node, and we use the measurement
  read-only (we dispatch a transaction with computed colwidths,
  and ProseMirror lays out from those — no race). Fallbacks:
  sum of existing colwidths, then `colCount * 150`.
- **Equalize is column-scoped via TableMap.** When the
  selection is a `CellSelection`, the helper calls
  `TableMap.get(tableNode)` and `map.findCell(cellPos)` to
  resolve each selected cell's column rect, collecting the
  set of column indices to scope the equalisation to. When no
  CellSelection (just a caret), the helper falls back to whole-
  table equalize. The column-scoped target width is computed
  from the *sum of selected columns' current widths* divided
  by their count, so equalising a 2-column slice doesn't
  globally shrink the table — the slice's total stays the
  same.
- **TableContextMenu uses `useLayoutEffect` to measure-then-
  clamp.** v1.0 used a static `menuHeightEstimate = 360` for
  the off-screen check, which was wrong for the new "Cell
  alignment" subgroup and didn't account for genuinely tall
  menus. v1.1 renders at the requested coords first, then in a
  layout effect measures the menu's actual `getBoundingClient
  Rect()` and clamps `top` / `left` so the menu fully fits in
  the viewport. `max-height: 80vh; overflow-y: auto` adds
  scroll for genuinely-too-tall menus. `z-index: 5000` (up
  from 1100) places the menu above bell/palette/all other
  floats.
- **Typed-block routing mirrors Cluster 4 architecture.** New
  `typed_block_routings` table (separate from
  `experiment_routings` so each table's queries stay simple),
  new `extract_typed_blocks` parser (handles all three types
  via a small per-line `parse_typed_header` helper), new
  `find_typed_target_path` resolver (walks the `notes` table
  for matches in `04-Ideas/`, `05-Methods/`, or `06-Protocols/`
  by title or filename-stem), new
  `regenerate_typed_target_auto_section` splicer, new
  `route_typed_blocks` Tauri command. The on-disk auto-section
  uses `<!-- TYPED-DAILY-NOTES-AUTO-START -->` / `-END` markers
  bracketing a `## From daily notes` heading — so the user can
  freely edit the surrounding document without losing the
  routing block, and re-save with no changes is idempotent.
- **Routing call site in TabPane.tsx is a parallel invoke**.
  After save, both `route_experiment_blocks` and
  `route_typed_blocks` are called with independent
  `.then` / `.catch` chains. A failure in one doesn't mask
  warnings from the other. Both surface their first warning
  via `setError` so the user sees the most recent un-routed
  block.
- **Modal dropdown + free-text name input both supported.**
  The protocol/idea/method branch of the BlockModal exposes an
  "Existing protocol/idea/method" dropdown loaded from
  `query_notes_by_type`, plus a "Name to insert in block
  header" text input that auto-populates from the dropdown on
  pick. Typing a name that doesn't match any existing entry
  still inserts the block — Cluster 4's "soft-failure"
  philosophy: the block decoration is purely visual and
  doesn't depend on routing succeeding; on save the unmatched
  name produces a "X not found" warning, which goes away once
  the user creates the matching log entry via the
  IdeaLog/ProtocolsLog/MethodsArsenal creator.
- **`route_typed_blocks` doesn't take a date_iso argument.**
  Unlike `route_experiment_blocks` which uses `date_iso` for
  auto-creating missing iteration files, the typed router
  doesn't auto-create protocol/idea/method documents — the
  user explicitly creates those through their respective log
  views. The argument was unneeded and dropped from the v1.1
  signature.

### Files touched (Cluster 16 v1.1)

- `src-tauri/src/lib.rs`
  - Schema: new `typed_block_routings` table + index.
  - `TypedBlock` struct (block_type / name / content).
  - `extract_typed_blocks(body)` — line walker handling
    blockquote-prefixed `::protocol|idea|method NAME` headers
    paired with `::end`.
  - `find_typed_target_path(conn, vault_path, block_type,
    name)` — resolves to a path under 04-Ideas/, 05-Methods/,
    or 06-Protocols/ via the notes table (title-match then
    filename-stem fallback).
  - `regenerate_typed_target_auto_section(conn, target_path)`
    — splices a `## From daily notes` block bracketed by
    TYPED_AUTO_START/END comment markers; preserves manual
    content above and below.
  - `route_typed_blocks(vault_path, daily_note_path)` Tauri
    command — mirrors `route_experiment_blocks` shape.
  - `capitalize_ascii` small helper for the type-name in
    warning strings ("Protocol \"Foo\" not found …").
  - Registered `route_typed_blocks` in `invoke_handler!`.
- `src/components/Editor.tsx`
  - Imports `DOMSerializer` from `@tiptap/pm/model` and
    `CellSelection`, `TableMap` from `@tiptap/pm/tables`.
  - New `HtmlTable = Table.extend(...)` with a
    `addStorage().markdown.serialize` override that emits the
    table as raw HTML via `DOMSerializer.fromSchema`. Replaces
    the bare `Table.configure(...)` in the extensions array.
  - `equalizeColumnWidths` rewritten to read real rendered
    width and accept a `CellSelection`-derived column scope.
    Per-cell `colwidth` is rebuilt entry-by-entry when the
    user has a multi-column selection.
  - `handleContextMenu` preserves an active CellSelection
    (only re-aims via `setTextSelection` if the current
    selection isn't already a `CellSelection`).
- `src/index.css`
  - `.column-resize-handle` is now `pointer-events: none`
    permanently; hover only changes opacity + cursor. Width
    tightened to 2px, `right: -1px`, height pinned to `100%`.
  - `.tableWrapper` forced to `overflow: visible`.
  - `.selectedCell` background uses `color-mix(in srgb,
    var(--accent) 18%, var(--bg))` plus an inset 1px accent
    border via `::after` so CellSelections are visually
    unmistakable.
- `src/components/TableContextMenu.tsx`
  - Imports `useLayoutEffect`, `useState`.
  - Replaces static height-estimate clamp with measure-then-
    clamp in a layout effect.
  - Menu style gains `maxHeight: 80vh; overflow-y: auto;
    overflow-x: hidden`.
  - `zIndex: 5000` (was 1100).
- `src/components/ExperimentBlockModal.tsx`
  - Adds `NoteWithMetadata` interface + `protocols` /
    `ideas` / `methods` state arrays, all loaded in parallel
    on open via `query_notes_by_type`.
  - New `genericPath` state for the dropdown selection.
  - Replaces the protocol/idea/method "free-text name only"
    JSX with an "Existing X" dropdown + a "Name to insert"
    text input that auto-populates from the dropdown.
  - `submit()` prefers the dropdown's selected entry,
    falling back to the typed name.
- `src/components/TabPane.tsx`
  - After save, invokes `route_typed_blocks` alongside
    `route_experiment_blocks` (independent failure paths).

### Known rough edges (v1.1)

- **Old pipe-tables migrate to HTML on first re-save.** This
  is a one-way migration. If the user reads the file in an
  external markdown viewer (Obsidian, GitHub preview), HTML
  tables render correctly. But if a vault has tables that
  were carefully formatted as pipe markdown for compatibility
  with another tool, those are now HTML. v1.0 tables that
  haven't been re-saved are unaffected.
- **`<table>` HTML in markdown breaks markdown-it's tightLists
  setting near tables.** Specifically: a list immediately
  following a table can render with extra spacing because the
  HTML block's blank-line boundary forces a paragraph break.
  Acceptable for v1.1; the alternative is a custom serializer
  that's careful about block boundaries (which would re-
  introduce the kind of complexity we're avoiding by using
  DOMSerializer).
- **Cross-cell drag selection still ignores the column-resize
  hit area.** If the user starts a drag within ~5px of a
  column boundary, prosemirror-tables interprets it as a
  column-resize drag instead of a cell-select drag. The
  workaround is to start the drag in the middle of a cell.
  v1.1 didn't reduce `handleWidth` from 5 to 3 because that
  would also reduce the resize affordance precision; the
  trade-off is acceptable.
- **Equalize with `colCount * 30 > totalWidth` falls through
  to the per-column constant.** This protects against a
  zero-width measurement (rare; happens if the table is
  inside a hidden parent). The threshold is conservative
  enough that practical narrow tables still measure
  correctly.
- **Right-click in a CellSelection that doesn't include the
  click-target cell.** The handler preserves the existing
  selection (correct), but the menu's `inTable` check is
  computed from `editor.isActive("table")` which is true so
  the table options appear. Equalize-scoped works as
  expected; per-cell valign updates only the cells in the
  CellSelection. Hover discoverability of which cells will be
  affected isn't there in v1.1; user has to trust the visual
  selectedCell tint.
- **`route_typed_blocks` doesn't fire on FIRST save of a
  daily note that already has typed blocks.** Reason: blocks
  in just-loaded files are technically routed on the *next*
  save (the call is hooked into the post-save effect). This
  matches `route_experiment_blocks`'s behaviour and is a
  Cluster 4-era trade-off; not worth changing for this
  cluster.
- **The auto-section markers are visible in raw markdown.**
  `<!-- TYPED-DAILY-NOTES-AUTO-START -->` / `-END` show up if
  the user opens the protocol/idea/method file outside
  Cortex. Markdown viewers won't render the comments, but
  they're plain HTML comment text in the raw file. Cluster
  17's widget rewrite may want to revisit how routed sections
  surface.
- **Schema additions are idempotent.** `CREATE TABLE IF NOT
  EXISTS typed_block_routings` is safe on existing vaults;
  no migration needed for users upgrading from v1.0.

---

## Phase 3 — Cluster 16 v1.1.1 → v1.1.4 — Bug-fix iterations

User-driven patch series after dogfooding v1.1. Four sub-versions
ship in this same span; tagging only the final state as
`cluster-16-v1.1.4-complete` because the earlier intermediates were
work-in-progress around a still-not-fully-resolved layout bug. The
chronology and reasoning are kept here verbatim because the bug
hunt itself is the takeaway — three different "fixes" landed and
the user kept seeing the same symptom, which is informative for
whoever picks this up next.

### What user reported between v1.1 and v1.1.4

1. *(v1.1)* Hovering over a column boundary makes the title row
   grow vertically.
2. *(v1.1.1 reproduction)* Same growth, now visibly affecting all
   rows in the table — empty cells especially "doubled" in size on
   hover near a boundary.
3. The col-resize cursor (double-arrow) wasn't appearing at column
   boundaries.
4. Edits to a routed protocol/idea/method document's auto-section
   weren't propagating back to the source daily note's block
   ("creates a new block instead of updating in place").
5. Drag-to-resize columns was needed (regressed when columnResizing
   was disabled in v1.1.3 as a workaround for the growth bug).
6. The calendar's month view showed events that were missing from
   the week view.

### What was tried, in order

**v1.1.1 — first cell-growth attempt:**

- Tightened `.column-resize-handle` styling (`right: -1px → 0`,
  added `box-sizing`, `z-index`, etc.).
- Restored handle to `pointer-events: none` always.
- Added `.ProseMirror.resize-cursor { cursor: col-resize }` so the
  cursor reflects prosemirror-tables's near-boundary state class
  (the standard pattern; the plugin sets the class on `view.dom`
  whenever `activeHandle > -1`).
- Added the **two-way sync** for typed blocks (Cluster 16 v1.1.1
  feature): per-block `<!-- CORTEX-BLOCK src="…" idx="…" -->`
  markers in the auto-section, plus a new `propagate_typed_block
  _edits` Tauri command that runs on every save. The command
  parses the saved file's auto-section, compares each block's
  current content against `typed_block_routings`, and for any
  changed block updates the routing AND surgically replaces the
  matching `::TYPE NAME … ::end` block in the source daily note.
  Bidirectional editing now works WITHOUT creating new blocks —
  the original `::TYPE NAME` markers are preserved on both sides.
  Race condition documented: if the user edits the document but
  doesn't save it before saving the daily note, the daily-note
  regen wins. Acceptable v1 behaviour.

  Result: cursor change works. Two-way sync works. Cell growth
  on hover persists.

**v1.1.2 — `display: none` on the resize handle:**

- Theory: the prosemirror-tables widget (the visible
  `<div class="column-resize-handle">`) being inserted into / removed
  from the active cell's DOM on hover triggers a layout pass that
  shifts cells.
- Set `.column-resize-handle { display: none }` so the widget never
  participates in layout. Cursor change still works (it's set on
  view.dom, not the handle). Drag-to-resize still works
  (prosemirror-tables's hit-detection is in JS, not via the handle
  DOM).

  Result: handle invisible. Cursor change works. Cell growth
  STILL persists. So the widget DOM mutation isn't the cause.

**v1.1.3 — disable columnResizing entirely:**

- Set `Table.configure({ resizable: false })`. The columnResizing
  plugin doesn't load. No widgets, no `resize-cursor` class, no
  `TableView.update()` per-hover.

  Result: cell growth gone. But drag-to-resize is gone too.

**v1.1.4 — re-enable + auto-equalize on insert:**

- Diagnosed via reading prosemirror-tables 1.8.5 source: the
  cell-growth root cause is `updateColumnsOnResize()` running on
  every per-hover ProseMirror view update, and falling back to
  `defaultCellMinWidth = 100px` for cells without explicit
  `data-colwidth`. With every cell having an explicit `colwidth`,
  `fixedWidth = true` and the function sets `table.style.width =
  totalWidth + "px"`; subsequent runs assign the same value, and
  the browser detects no change and skips the layout pass.
- `resizable: true` is back. Handle is visible again (a 3px accent
  bar on the cell's right edge, fading in to 0.45 opacity on
  hover, with a smooth 80ms transition).
- `TabPane.insertTable` now calls `equalizeTableColumnWidths(editor)`
  on `requestAnimationFrame` after the insert so a freshly-created
  table immediately has explicit colwidths everywhere.
- Calendar all-day row added to the WeekView (between header and
  hour grid) so events created in MonthView as all-day no longer
  appear missing in the week view. Mirrors the month-view chip
  styling for visual continuity.

  Result: drag-to-resize works again. Auto-equalize-on-insert
  prevents new tables from hitting the 100px-fallback path.
  Calendar parity restored. **Cell growth still reported by user
  on existing tables that haven't been equalized.**

### Architectural notes worth flagging

- **Two-way sync uses surgical block replacement, not file
  rewrite.** `replace_daily_note_typed_block` walks the daily note
  line-by-line, counts typed blocks in document order, and replaces
  only the body lines of the Nth block (between header and `::end`),
  preserving everything else. No re-serialization through tiptap-
  markdown; no chance of clobbering unrelated edits.
- **Per-block markers carry the routing's primary key.** Format:
  `<!-- CORTEX-BLOCK src="<daily_note_path>" idx="<block_index>"
   -->\ncontent\n<!-- /CORTEX-BLOCK -->`. The `(src, idx)` pair
  matches `typed_block_routings`'s composite PK. Chosen over a
  separate UUID column because (a) it requires no schema change
  and (b) it lets the user inspect raw markdown and immediately
  see which daily note a block came from.
- **Migration: existing v1.1.0 documents work but don't propagate
  yet.** v1.1.0's auto-section format (`### From [[X]]` + `---`
  separators, no per-block markers) won't parse into routing
  tuples. The propagator returns 0 and is a no-op. The migration
  is automatic: the next time the user saves the corresponding
  daily note, `route_typed_blocks` regenerates the document's
  auto-section in the new per-block-marker format, and bi-
  directional sync starts working from that point on. One-time,
  invisible.
- **Auto-equalize-on-insert is a `requestAnimationFrame` deferral.**
  TipTap's `insertTable().run()` dispatches the transaction
  synchronously, but the resulting DOM (including the new table's
  cell positions) isn't queryable inside the same tick. Deferring
  to the next animation frame ensures `equalizeColumnWidths` finds
  the table via the editor's selection.
- **`equalizeTableColumnWidths` is exported from Editor.tsx** so
  TabPane can call it without re-importing TipTap pm internals.
  The internal implementation is unchanged from v1.1.0; only the
  export wrapper is new.
- **WeekView all-day row sits sticky below the day-header.** The
  weekHeader uses `position: sticky; top: 0` so the day labels
  remain visible when the user scrolls hours; the all-day row uses
  `top: 56px` (height of the day-header) so it sits just below.
  Click on an empty cell creates a new event template with start
  = midnight, end = next-midnight; the user toggles "All day" in
  the modal.
- **Calendar code path is single-source-of-truth for events.** Both
  WeekView and MonthView consume the same `events` array filtered
  per-day. The previous all-day-hidden-in-week bug was a filtering
  oversight (`!e.all_day` in the body filter, no other render path
  for all-day) — not a sync issue. Adding the all-day row was
  purely a render fix.
- **Calendar.tsx month vs week date ranges differ on purpose.**
  Week range = anchor → anchor + 7 days. Month range = Monday of
  week containing the 1st of focus month → +42 days. Switching
  views recomputes the range and re-fetches events. Both pulls go
  through the same `list_events_in_range` Rust command which
  expands recurrence rules. So the SAME events appear in both
  views when their range overlaps; the bug was in the WeekView
  render, not the data layer.

### Known issues / unresolved (for the next iteration)

- **🔴 Cell-height growth on hover STILL reproduces on tables
  without explicit colwidths.** The auto-equalize-on-insert in
  v1.1.4 only covers tables created from now on. Pre-existing
  tables in the user's vault still lack `data-colwidth` and hit
  the `defaultCellMinWidth = 100px` fallback in
  `updateColumnsOnResize`. Workaround: the user right-clicks →
  Equalize Column Widths once on each pre-existing table to give
  every cell a `colwidth`. After that, hover is stable.

  **Proper fix candidates (not yet built):**
  1. *Auto-equalize on first edit of a stale table.* When the
     editor encounters a table where any cell lacks `colwidth`,
     dispatch an equalize transaction immediately. Risk: surprising
     the user with a layout shift on first edit.
  2. *Auto-equalize on document load if any table lacks colwidths.*
     Same idea, just earlier in the lifecycle. Only fires once
     per document because subsequent saves include the colwidths.
  3. *Custom drag-resize that doesn't go through prosemirror-
     tables's `columnResizing` plugin.* A small ProseMirror plugin
     that detects mousedown near a cell border and dispatches a
     `setNodeMarkup` transaction directly. No `TableView.update`
     in the hot path, so no per-hover layout shifts at all,
     regardless of whether cells have widths. ~1 day of work.
  4. *Default-width injection at parse time.* When the HTML table
     parser sees a `<td>` without `data-colwidth`, inject a
     reasonable default (e.g. equal share of the table width).
     Hooks into ValignTableCell's `parseHTML`. Requires knowing
     the table's column count at parse time, which is awkward.

  Option 3 is the cleanest long-term fix and is captured in the
  cluster-17/18 follow-ups.

- **CORTEX-BLOCK markers visible in raw markdown.** Same situation
  as v1.1's TYPED_AUTO_START/END markers: HTML comments don't
  render in markdown viewers but are visible if the user opens the
  file in a plain text editor. Acceptable; Cluster 17's widget
  rewrite is the right place to revisit how auto-sections surface.

- **Two-way sync race on simultaneous edits.** If the user has the
  daily note open in pane A and the protocol document open in pane
  B, edits to both, and saves the daily note FIRST: the document
  regen (via `regenerate_typed_target_auto_section`) overwrites
  pane B's unsaved-but-typed content. The propagator only fires on
  document save, and an unsaved buffer never makes it to disk for
  comparison. Mitigation: encourage the user to save documents
  before saving daily notes, or only have one of the two open. A
  proper fix would require pane-level dirty-buffer awareness in
  the propagator, which is overkill for v1.

- **All-day row in WeekView doesn't auto-set `all_day: true` on
  click.** Clicking an empty all-day cell opens the EventEditModal
  with `start = midnight, end = next-midnight` but `all_day` is
  not pre-toggled. The user has to flip the All-day checkbox.
  Trivial fix in a future ship: extend `onSlotDraft` to accept an
  `allDayHint` flag.

### Files touched (Cluster 16 v1.1.1 → v1.1.4)

- `src-tauri/src/lib.rs`
  - New constants: `TYPED_AUTO_START` / `TYPED_AUTO_END` are
    repurposed; per-block markers are inline (no constant).
  - New helpers: `extract_typed_auto_section`,
    `parse_auto_section_blocks`, `replace_daily_note_typed_block`.
  - New Tauri command: `propagate_typed_block_edits`.
  - `regenerate_typed_target_auto_section` rewritten to emit
    per-block `<!-- CORTEX-BLOCK src=… idx=… -->` markers.
  - SQL query updated to `SELECT br.daily_note_path, br.block_index,
    br.content, COALESCE(n.title, …)` (added `block_index`).
  - `propagate_typed_block_edits` registered in `invoke_handler!`.
- `src/components/Editor.tsx`
  - `equalizeTableColumnWidths` exported wrapper around the
    internal `equalizeColumnWidths`.
  - Table extension config bounced through three states:
    `resizable: true` → `false` → `true` again (final).
- `src/components/TabPane.tsx`
  - `insertTable` calls `equalizeTableColumnWidths(editor)` on
    `requestAnimationFrame` post-insert.
  - Save flow invokes `propagate_typed_block_edits` after every
    save (Rust short-circuits when no typed-auto section).
- `src/index.css`
  - Iterated handle styling: tightened (v1.1.1) → `display: none`
    (v1.1.2) → restored visible 3px bar with `pointer-events: none
    always` and `transition: opacity 80ms` (v1.1.4).
  - `.ProseMirror.resize-cursor` rule added (v1.1.1).
  - `.selectedCell::after` removed (v1.1.1) — was a layout-shift
    suspect; turned out not to be the cause but stayed removed
    because the background tint alone is sufficient.
- `src/components/Calendar.tsx`
  - New all-day row in WeekView (above the hour grid).
  - New styles: `allDayRow`, `allDayLabel`, `allDayCol`,
    `allDayChip`.

### What ships under tag `cluster-16-v1.1.4-complete`

- Drag-to-resize columns (working for tables created post-v1.1.4
  and for pre-existing tables that have been Equalized once).
- Two-way sync for `::protocol` / `::idea` / `::method` blocks via
  per-block CORTEX-BLOCK markers + `propagate_typed_block_edits`.
- Calendar all-day events visible in both WeekView and MonthView.
- col-resize cursor at column boundaries.

### What remains open

- The cell-height-growth-on-hover bug for tables without explicit
  colwidths (workaround: Equalize once).
- Cluster 17 — Block widget rewrite (custom TipTap node).
- Cluster 18 — Excel layer for tables (formulas, cell types, freeze
  rows / columns) — would also be the natural home for the custom
  drag-resize plugin that fully eliminates the layout-shift bug.

## Phase 3 — Cluster 17 v1.0 — Block widget rewrite

User-driven follow-up to Cluster 16. The `::TYPE NAME … ::end` blocks
that Cluster 4 introduced (and Cluster 16 v1.1 widened from
experiment-only to all four types) lived as a paragraph-decoration
extension over plain-text content. That worked for the v1.0 ask
(visual treatment + routing) but couldn't:

  - hold rich content in the body (bullets, ordered lists, code
    blocks, tables) — the decoration painted over flat paragraphs
    only;
  - prevent the user from putting a caret in the `::experiment`
    title and accidentally breaking the parse on save;
  - support a one-click atomic delete (the user had to hand-select
    header + body + ::end and press Backspace).

Cluster 17 converts the blocks to a real ProseMirror custom node.

### What ships

A new `typedBlock` ProseMirror node (`src/editor/TypedBlockNode.tsx`)
with:

  - `name = "typedBlock"`, `group = "block"`, `defining: true`,
    `isolating: true`.
  - Content rule:
    `(paragraph|bulletList|orderedList|codeBlock|table)+` —
    deliberately excludes headings (would break the document outline),
    images (image handling is its own future cluster), nested
    typedBlocks (no block-in-block), and blockquotes.
  - Attrs `blockType` (experiment / protocol / idea / method),
    `name`, `iterNumber` (only meaningful for experiment).
  - parseHTML / renderHTML for a `<div data-typed-block>` element so
    HTML round-trips work for completeness, even though the markdown
    serializer below emits plain text.

A React NodeView (`src/components/TypedBlockNodeView.tsx`) that:

  - Renders a `contentEditable={false}` title bar across the top
    with the formatted title (`Method · NAME` or `Experiment · NAME
    · iter N`), a pencil button (Edit name), and a trash button
    (Delete block).
  - On Edit name, swaps the title text for a small `<input>` that
    auto-focuses and selects. Enter or blur commits (committing
    via `updateAttributes`); Escape cancels. For experiment blocks
    a second input lets the user change the iter number; Tab moves
    focus from name to iter.
  - On Delete, calls `deleteNode` from NodeViewProps.
  - Listens for a `cortex:edit-typed-block` CustomEvent on
    `editor.view.dom`. The BlockContextMenu's "Edit name" action
    dispatches that event with the block's doc position; the
    NodeView whose `getPos()` matches flips into edit mode.
  - Wraps the body in `<NodeViewContent />` so TipTap handles all
    body rendering and editing natively — bullet lists, code blocks,
    tables all work without special-casing.

A markdown serializer (`src/editor/TypedBlockSerializer.ts`) that
extends `TypedBlockNode` with a `markdown.serialize` hook (matching
the existing HtmlTable / AlignmentAwareParagraph pattern). Emits:

```
::TYPE NAME [/ iter-N]

<body content rendered through tiptap-markdown's normal pipeline>

::end
```

The same on-disk format the v1.0/v1.1 inserter wrote. **This is the
critical design choice** — the Rust-side parsers
(`extract_experiment_blocks`, `extract_typed_blocks`,
`parse_auto_section_blocks`, `replace_daily_note_typed_block`) and
the routing pipelines (`route_experiment_blocks`,
`route_typed_blocks`, `propagate_typed_block_edits`) all keep working
unchanged. Cluster 17 is an editor-only refactor.

A markdown parser transform (`src/editor/TypedBlockTransform.ts`)
named `liftTypedBlocks`. tiptap-markdown has no token for our custom
node, so on load every `::TYPE NAME` paragraph in the file becomes a
plain paragraph in the doc. The transform:

  - Walks the doc's top-level children.
  - Finds paragraphs whose textContent matches a typed-block header
    regex.
  - Walks forward (across any child node type — paragraphs, lists,
    code blocks, tables) until finding a paragraph matching `::end`.
  - Filters the inner nodes against the typedBlock content rule
    (logs warnings on dropped node types — should be rare).
  - Replaces the `[header_pos, end_pos+1]` range with a typedBlock
    node containing the inner nodes.
  - Applies in reverse order so positions stay stable across
    multiple replacements.

The transform runs inside `Editor.tsx`'s post-setContent useEffect,
unconditionally — initial load (where the editor's seeded content
matches our compare-side `content` prop and no setContent is called)
still needs the lift. Idempotent: a doc with already-lifted regions
passes through untouched. The dispatched transaction is gated with
`setMeta("addToHistory", false)` so the user can't Ctrl+Z back to
the pre-lifted state.

A BlockContextMenu (`src/components/BlockContextMenu.tsx`) that
opens when right-click lands inside a typedBlock node and not inside
a nested table. Mirrors `TableContextMenu`'s structure (positioned
float, click-outside-to-close, viewport clamping via
`useLayoutEffect`). Two actions: Edit name (dispatches the
`cortex:edit-typed-block` event) and Delete block (dispatches
`tr.delete` over the block's range via an editor.chain command —
single history step).

### Migration

Cluster 17 ships with no migration UI. The lift transform handles
v1.0/v1.1 documents on first open: their `::TYPE NAME … ::end`
paragraph runs become typedBlock nodes immediately. First save
re-emits the same on-disk text. From the user's perspective, blocks
just look better and behave better starting the moment Cluster 17
ships.

For any document touched while Cluster 17 is in place, fresh blocks
are born as typedBlock nodes (TabPane.insertExperimentBlock now
inserts a typedBlock directly via `insertContentAt` rather than four
paragraphs). The lift transform isn't on the critical path for
those.

### Why no Rust changes

The cluster doc anticipated a "Pass 5" Rust update to dual-format
the propagator (recognise both new node-attr-based markers and
legacy CORTEX-BLOCK comments). On closer reading, the doc's locked-in
constraint — *"The on-disk format stays exactly the same as v1.1.x"*
— means the existing CORTEX-BLOCK comment format continues to be
emitted by `regenerate_typed_target_auto_section` and parsed by
`parse_auto_section_blocks` with no code change. The only Rust-side
edit was a comment in lib.rs documenting the design choice so a
future reader doesn't expect a parser overhaul that isn't there.

The "drop the markers entirely" goal in the cluster doc would
require introducing a per-routed-entry custom node for the
auto-section in target documents (so the source path + block index
could live as node attrs instead of HTML comments). That's a bigger
change than v1.0 of Cluster 17 needs and is left as a follow-up.

### Why the click-detection routes table-first

When a typedBlock contains a table and the user right-clicks inside
a cell, two ancestors match (typedBlock, table). The handler walks
`$pos` from the deepest depth to the doc root and tracks the
**first** typedBlock ancestor seen, but if any ancestor is a table
the BlockContextMenu is suppressed. Rationale: the immediate
context (a table cell) is the more specific surface; the user's
intent is almost certainly a table action. Right-clicking inside
the body but outside the table still opens the block menu.

### Architectural decisions worth carrying forward

- **Editor representation can change without touching on-disk
  format.** When a custom node serializes to text identical to what
  the user could have typed by hand, the Rust side stays unaware of
  the editor's internal model. This is a clean boundary; preserve
  it for any future block-like feature.
- **Lift-on-load is the right migration shape for plain-text-marker
  formats.** The on-disk `::TYPE NAME … ::end` syntax is
  human-readable and tool-agnostic; the editor's job is to lift it
  into a richer in-memory representation. Don't invent an HTML
  variant of the format unless there's a reason the plain-text
  form actively breaks something.
- **CustomEvent on view.dom for cross-component editor signals.**
  The Edit-name dispatch from the right-click menu to the matching
  NodeView is naturally pane-local without any extra state plumbing
  (each pane has its own view.dom). Reuse this pattern for similar
  one-off "talk to the active node by position" needs.
- **The body content rule is small on purpose.** Excluding headings
  and nested blocks keeps the schema validations tight and removes
  whole classes of edge cases (a heading inside a block confusing
  the document outline; a block-in-block recursion that would need
  special migration handling). Add to the content rule only when a
  user-visible feature explicitly asks for it.

### Files touched

#### New files

- `src/editor/TypedBlockNode.tsx` — node schema + parseHTML /
  renderHTML / addNodeView, plus header-format / header-parse
  helpers.
- `src/editor/TypedBlockSerializer.ts` — TypedBlockNode extended
  with a tiptap-markdown serialize hook.
- `src/editor/TypedBlockTransform.ts` — `liftTypedBlocks` and
  `docContainsLegacyTypedBlocks`.
- `src/components/TypedBlockNodeView.tsx` — React NodeView with
  inline edit-name input + delete button + Edit-name event listener.
- `src/components/BlockContextMenu.tsx` — right-click menu for
  typedBlock nodes.
- `verify-cluster-17.ps1` — verify script with full smoke checklist.

#### Modified files

- `src/components/Editor.tsx`
  - Drop `ExperimentBlockDecoration`; add `SerializingTypedBlockNode`.
  - Add `liftTypedBlocks` call in the post-setContent useEffect.
  - Add typedBlock-detection branch in `handleContextMenu` (walks
    `$pos` ancestors; routes to BlockContextMenu when a typedBlock
    is found without an intervening table ancestor).
  - Add `runBlockAction` (editName / deleteBlock).
  - Render `<BlockContextMenu>` in JSX.
- `src/components/TabPane.tsx`
  - `insertExperimentBlock` inserts a typedBlock node directly via
    `insertContentAt` (vs. four plain paragraphs in v1.0/v1.1).
- `src/index.css`
  - New `.cortex-typed-block` rules: card chrome, title-bar layout,
    edit-name input focus styling, danger-coloured trash button,
    body first/last-child margin tightening for paragraphs / lists
    / code blocks / tables.
  - Legacy `.cortex-experiment-block-*` rules kept (the deprecated
    decoration class names are no longer applied, so the rules are
    inert; left in tree for any old build artefacts).
- `src/editor/ExperimentBlockDecoration.ts`
  - Deprecated to a no-op stub. Header points to the typedBlock
    files. Live extension list no longer registers this.
- `src-tauri/src/lib.rs`
  - Comment-only addition in the propagator section explaining
    that the on-disk format is unchanged so the parsers don't need
    changes.

### Known issues carried forward (unchanged from Cluster 16 v1.1.4)

- 🔴 Cell-height growth on hover for tables without explicit
  `data-colwidth`. Cluster 18's custom drag-resize plugin is the
  proper fix. Workaround: right-click → Equalize once per affected
  table.
- 🟡 CORTEX-BLOCK markers visible in raw markdown viewers. Cluster
  17 v1.0 doesn't address this — the markers continue to be emitted
  by `regenerate_typed_target_auto_section` because dropping them
  requires a separate custom node for routed auto-section entries
  (out of scope for v1.0).

### What ships under tag `cluster-17-v1.0-complete`

- typedBlock custom node with non-editable title bar.
- Inline rename + atomic delete via title-bar buttons or right-click.
- Body holds bullets, ordered lists, code blocks, and tables.
- BlockContextMenu (right-click inside a typedBlock).
- Invisible migration of v1.0/v1.1 documents via lift-on-load.
- Cluster 4 + Cluster 16 routing pipelines unaffected.

## Phase 3 — Cluster 17 v1.1 — Ctrl+Click block title navigates to the referenced document

User-asked follow-up immediately after v1.0 shipped. The typedBlock
node renders a clean title bar ("Method · Foo", "Experiment · Bar ·
iter 3"), but clicking that title did nothing — to navigate to the
referenced document the user had to scroll, find a wikilink to it
elsewhere, or open the file tree. v1.1 adds Ctrl/Cmd+Click on the
title bar as a one-shot navigation chord.

### What ships

- **NodeView title-bar handler** (`src/components/TypedBlockNodeView.tsx`).
  The title bar div now has an `onClick` that, when Ctrl/Cmd is held
  and the rename input isn't open, dispatches a
  `cortex:follow-typed-block` CustomEvent on `editor.view.dom` with
  `{ blockType, name, iterNumber }` in detail. Same DOM-event-on-
  view-dom pattern as the v1.0 edit-name signal (pane-local scope,
  no global emitter). Native `title=""` tooltip ("Ctrl/Cmd+Click to
  open the referenced document") gives the user a discoverability
  hint on hover.

- **Editor-side listener** (`src/components/Editor.tsx`). New prop
  `onFollowTypedBlock?: (attrs) => void`. The editor listens for the
  follow event and forwards the detail upward. Editor stays free of
  vault-path knowledge — the host handles the resolve+open.

- **App handler** (`src/App.tsx`). Wires onFollowTypedBlock per pane:
  activates the originating pane, invokes the new
  `resolve_typed_block_target` Tauri command, and — when the
  resolver returns a path — passes it to `selectFileInSlot(path, i)`.
  No-op (with a console.info log) on null resolution; a console.warn
  on Rust errors. No toast / banner for v1; the user sees it didn't
  navigate.

- **Rust resolver** (`src-tauri/src/lib.rs`). New
  `resolve_typed_block_target(vaultPath, blockType, name, iterNumber)`
  Tauri command. For experiment blocks, walks the hierarchy table to
  find the experiment's index file, then prefers the matching
  iteration's path when iterNumber is set; falls back to the
  experiment's index when the iteration doesn't exist. For
  protocol/idea/method, delegates to the existing
  `find_typed_target_path`. Read-only — no auto-creation of missing
  files (route_experiment_blocks's find_or_create_iteration is the
  right place for that; clicking shouldn't have side effects).

- **CSS hover affordance** (`src/index.css`). On hover of the title
  bar, the title text gets an accent-coloured underline and the
  cursor flips to pointer. CSS can't directly observe the Ctrl key
  state, so the affordance is "this title is interactive" rather
  than "Ctrl held → click target"; the title attribute clarifies the
  chord.

- **Shortcut docs** (`src/components/ShortcutsHelp.tsx`). New rows:
  Ctrl+Click on a block title, and the right-click block menu (which
  v1.0 missed mentioning).

### Why route through onFollowTypedBlock instead of onFollowWikilink

The simplest implementation would have been: dispatch
`onFollowWikilink(name)` and let the existing wikilink resolver
(`resolve_wikilink`) find the file. That works for protocol/idea/method
because their files are typically named after the block (filename
stem or H1 title match). It DOESN'T work for experiments because:

  - Iteration files are named `iter-NN - <date>.md`, not after the
    experiment name.
  - The wikilink resolver finds the experiment's index file at best,
    leaving the user one extra navigation step away from the
    iteration the block actually feeds into.

A small Rust resolver that knows the typed-block-to-file mapping is
worth the dozen lines. It also documents the navigation contract:
"the document a typed block references" is well-defined for all four
types and can evolve (e.g., land on iteration when present, fall
back gracefully when not).

### Architectural decisions worth carrying forward

- **DOM events are the pane-local signal pattern.** v1.0 introduced
  `cortex:edit-typed-block`, v1.1 adds `cortex:follow-typed-block`.
  Both fire on the editor's `view.dom`, both stay scoped to the
  pane that owns the editor. If you need NodeView → host
  communication for any future feature, reach for this pattern
  first; it composes with TipTap's existing structure without any
  state management.

- **Editor.tsx stays free of vault knowledge.** The host (App)
  knows vaultPath, sessions, and how to route opens. Editor takes
  callbacks. This boundary keeps Editor reusable and easy to test.

- **Read-only navigation.** `resolve_typed_block_target` never
  creates files. Clicking is a query; it should never modify the
  vault. Auto-creation of missing iterations is reserved for
  routing flows where the user has actively typed a block and the
  iteration absence is meaningful.

### Files touched (v1.1 only)

- `src/components/TypedBlockNodeView.tsx` — exported
  `FOLLOW_TYPED_BLOCK_EVENT`, added `handleTitleClick`, attached to
  the title bar's onClick + native title attribute.
- `src/components/Editor.tsx` — new optional `onFollowTypedBlock`
  prop, listener on view.dom forwarding the event.
- `src/components/TabPane.tsx` — pass-through prop.
- `src/App.tsx` — handler that invokes Rust resolver and routes
  through `selectFileInSlot`.
- `src-tauri/src/lib.rs` — new `resolve_typed_block_target` Tauri
  command + invoke_handler! registration.
- `src/index.css` — hover affordance on the title text.
- `src/components/ShortcutsHelp.tsx` — Ctrl+Click and right-click
  rows.

### What ships under tag `cluster-17-v1.1-complete`

- Ctrl/Cmd+Click on a typedBlock title bar opens the referenced
  document in the active pane.
- Experiment blocks land on the matching iteration file when one
  exists; otherwise on the experiment's index file.
- Protocol / idea / method blocks land on their corresponding
  document under 06-Protocols / 04-Ideas / 05-Methods.
- Hover tooltip + underline affordance signal the chord.
- Read-only — no file creation on click.

## Phase 3 — Cluster 18 v1.0 — Excel layer for tables: custom drag-resize + formulas

User-driven follow-up to Cluster 16 v1.1.4 + Cluster 17. Two things land
in v1.0: a custom column-resize plugin that replaces prosemirror-tables's
built-in (closing the long-standing cell-height-growth bug from
v1.1.4), and a small formula engine that lets the user write
`=SUM(A1:A5)` directly in a cell. Cell-type formatting, freeze panes,
and sort/filter are deferred to v1.1+.

### What ships

**CortexColumnResize plugin** (`src/editor/CortexColumnResize.ts`).
Pure-DOM-event drag, never subscribes to view updates, so there's no
per-hover `updateColumnsOnResize` call and no `defaultCellMinWidth =
100px` fallback path. Hit zone: 5px inside the cell's right border + 3px
overshoot to cover the visible accent strip. Visible 3px-wide handle on
each cell's right edge (CSS), hover-driven via a body-level
`.cortex-resize-hover` class that the plugin's mousemove handler sets.
30px minimum column-width clamp prevents dragging a column to
invisibility. Shipped as a TipTap Extension wrapper
(`CortexColumnResize`) registered in Editor.tsx alongside
`HtmlTable.configure({ resizable: false })`. Auto-equalize-on-insert
from v1.1.4 stays as a defensive measure for fresh tables.

**🟢 The v1.1.4 known issue is closed.** Tables without explicit
`colwidth` attributes no longer grow vertically on hover. No workaround
needed — both fresh and pre-existing tables behave correctly.

**Formula engine** (`src/editor/formulaEngine.ts`, ~670 lines). Three
phases:

  - **Lexer** — tokenises numbers (with scientific notation), strings
    (single or double quotes), identifiers (function names + cell
    refs in A1 form, distinguished by regex match), operators
    (`+ - * / ^`), parens, commas, colons.
  - **Parser** — precedence climbing: `expr` (`+ -`) → `term` (`* /`)
    → `power` (`^`, right-associative) → `unary` (`-`) → `primary`
    (number / string / cell-or-range / function call / parens).
    Recursive-descent class with a position cursor.
  - **Evaluator** — walks the AST. `Value` is `number | string |
    Value[]` (arrays for ranges). Cell refs resolve via a
    `TableContext` interface the host implements; the host's
    `cellAt(col, row, visited)` reads cell text and recursively
    follows formulas if the target cell itself starts with `=`,
    threading the visited set so circular refs throw a clear
    "Circular reference at A1" error rather than overflowing the
    stack.

Function set: `SUM`, `AVG` (alias `MEAN`), `COUNT`, `MIN`, `MAX`,
`MEDIAN`, `IF`. `IF` uses lazy evaluation of the unused branch so
`=IF(0, 1/0, 42)` returns 42 instead of erroring (Excel-compat).
`COUNT` only counts numerically-coercible values, matching Excel's
`COUNT` (vs `COUNTA` which counts all non-empty).

Tagged result type: `{ kind: "ok", value, displayed }` or
`{ kind: "error", message }`. The `displayed` field is the
human-friendly format for the cell — integers stay integer-looking
(no `.00`), floats get up to 6 decimal places trimmed of trailing
zeros to dodge the classic `0.1 + 0.2 = 0.30000000000000004` noise.

**FormulaCells extension** (`src/editor/FormulaCells.ts`). Three
pieces in one file:

  - `FormulaTableCell` + `FormulaTableHeader` extend the v1.1.4
    `ValignTableCell` / `ValignTableHeader` with `formula` and
    `formulaResult` attributes. `parseHTML` reads `data-formula` and
    `data-formula-result`; `renderHTML` writes them back. The
    inline-style `vertical-align` attr from Cluster 16 stays alive
    in the same node (chained via `addAttributes` returning all
    three).
  - `FormulaEvaluator` TipTap Extension installs a ProseMirror
    plugin that walks every table cell on every appendTransaction.
    Skips the cell currently containing the cursor (so the user can
    type `=` without flickering through intermediate parse errors).
    For other cells whose text starts with `=`, evaluates against
    the table's `TableContext` (built from `TableMap.get(table)` so
    `(col, row)` maps to a cell pos in O(1)), and stores the result
    in `data-formula-result`. Re-entry guarded by a plugin-key meta
    flag on the dispatched transactions.
  - `buildTableContext` constructs the `TableContext` interface from
    a table node + its doc position. `cellAt` returns the cell's
    raw text, OR (if the cell itself contains a formula) recursively
    evaluates it with the same visited set — so `A1 = =B1`,
    `B1 = 5`, `C1 = =A1*2` all work transitively.

**CSS display swap** (`src/index.css`). Cells with
`data-formula-result`:

  - Body color → transparent (on the contained `<p>`) when not
    focused, hiding the raw formula text.
  - `::after` pseudo-element overlays the result text in italic via
    `content: attr(data-formula-result)`. `position: absolute` over
    the cell, `pointer-events: none` so right-click and hover still
    target the underlying `<td>`.
  - `:focus-within` (cursor inside) reveals the raw formula text and
    hides the pseudo. Click-to-edit comes free.
  - Errors with the `Error:` prefix render the `::after` content in
    `--danger` via attribute substring matching
    (`[data-formula-result^="Error:"]`).
  - Formula-bearing cells (`[data-formula]`) get an `--accent-bg`
    background tint so the user can spot which cells are computed at
    a glance.

Visible 3px accent strip on each cell's right edge for the resize
affordance — opacity 0 by default, 0.45 on hover when the
`.cortex-resize-hover` body class is set, also 0.45 during an active
drag.

### Architectural decisions worth carrying forward

- **Replace, don't coexist.** The cluster doc considered keeping
  prosemirror-tables's columnResizing alongside ours. We replaced it
  fully (`Table.configure({ resizable: false })`). Coexistence
  risks the original layout-shift bug coming back when both plugins
  fight for the same events. Replace is cleaner.

- **Formulas stored AS cell text + cached AS attribute.** The cell's
  body text IS the formula (`=SUM(A1:A5)`). The attribute caches the
  evaluated result. CSS handles the display swap via `::after`. This
  is simpler than keeping the result as text and the formula in an
  attribute (which would need NodeView-level swap logic for the
  click-to-edit path). Cost: every load re-evaluates because the
  cached `data-formula-result` is also written to disk; on reload
  the FormulaEvaluator plugin verifies it and updates if necessary.
  In practice the verify is a no-op when the inputs haven't changed.

- **Selection-change re-evaluation.** The plugin runs on every
  transaction, not just on save. Snappier than the cluster doc's
  "on save" alternative; the cost is microsecond-scale per
  transaction (one walk over cells, no doc rewrites unless something
  changed). `appendTransaction` is the right hook because it fires
  on selection moves AND doc changes, and dispatching a follow-up
  transaction in `appendTransaction` is officially supported and
  groups cleanly with the originating transaction.

- **Visited-set threaded through cell resolution.** Circular ref
  detection lives in the engine, not the evaluator. The host's
  `TableContext.cellAt(col, row, visited)` is responsible for
  passing the set through any nested formula evaluation. The engine
  adds and removes the cell's `(col,row)` key to `visited` around
  each `cellAt` call so siblings can both reference the same target
  without false positives.

### Files touched

#### New files

- `src/editor/CortexColumnResize.ts` — drag-resize plugin + Extension
  wrapper.
- `src/editor/formulaEngine.ts` — lexer / parser / evaluator.
- `src/editor/FormulaCells.ts` — FormulaTableCell, FormulaTableHeader,
  FormulaEvaluator plugin, buildTableContext helper.
- `verify-cluster-18.ps1` — verify script with 8-pass smoke checklist.

#### Modified files

- `src/components/Editor.tsx`
  - Drop inline `ValignTableCell` / `ValignTableHeader` (replaced by
    imports from FormulaCells).
  - `HtmlTable.configure({ resizable: false })`.
  - Register `FormulaTableCell`, `FormulaTableHeader`,
    `CortexColumnResize`, `FormulaEvaluator` in extensions list.
- `src/index.css`
  - New rules for `data-formula-result` display swap, error colour,
    formula-cell tint, resize-handle accent strip.

### Known issues / unresolved

- 🟡 No comparison operators in formulas (`>`, `<`, `=`, `!=`). `IF`
  works but the condition has to be derived from arithmetic
  (e.g. `=IF(A1-10, "big", "small")` to test "is A1 > 10"). Adding
  comparison operators is a v1.1 follow-up.

- 🟡 Date arithmetic isn't supported. Cells with date strings
  (`2026-04-29`) coerce to NaN in numeric contexts. Cell-type
  formatting (v1.1) is the natural home for date semantics.

- 🟡 The `data-formula-result` cache on disk can drift if the user
  edits the file in an external editor between sessions. The
  FormulaEvaluator plugin re-evaluates on load, so the cell's
  displayed result self-corrects on next open + first transaction.
  Acceptable.

### What ships under tag `cluster-18-v1.0-complete`

- CortexColumnResize plugin replacing prosemirror-tables's built-in.
- Cell-height-growth-on-hover bug from v1.1.4 fully resolved.
- Formula engine: `=SUM/AVG/COUNT/MIN/MAX/MEDIAN/IF`, A1 refs,
  A1:B5 ranges, circular-ref detection, error reporting.
- Display swap: result italic when not focused, raw formula on focus.
- Round-trips via `data-formula` and `data-formula-result` HTML
  attributes.

## Phase 3 — Cluster 18 v1.0.1 — Three bug fixes after v1.0 dogfooding

User reports surfaced three regressions in v1.0:

1. Cell-width changes (drag and equalize) didn't appear live — only on
   next file reload.
2. Removing a column left a white-line artifact where the deleted
   column had been.
3. Clicking into a formula cell didn't reveal the raw formula text.

All three trace to two root causes:

### Root cause #1: Lost TableView nodeView

When v1.0 set `Table.configure({ resizable: false })` to disable
prosemirror-tables's `columnResizing` plugin (the source of the
v1.1.4 cell-height-growth-on-hover bug), it also took out the
`TableView` nodeView that prosemirror-tables installs. That
nodeView is what reads each cell's `colwidth` attribute and writes
matching `<col style="width:Xpx">` entries into the table's
`<colgroup>`.

Without the nodeView, cell colwidth changes (from drag, equalize,
or column delete) updated the doc but never re-rendered the
colgroup. The browser kept using its previous layout decisions
until something forced a fresh render — which only happened on
file reload.

### Fix: CortexTableView

`src/editor/CortexTableView.ts` is a minimal stand-in for
prosemirror-tables's TableView. ~160 lines. Owns:

  - The outer `.tableWrapper` div, the `<table>`, the `<colgroup>`,
    and the `<tbody>` (which becomes `contentDOM` for ProseMirror
    to write rows into).
  - An `update(node)` method that re-runs `updateColgroup()` on
    every transaction-driven node update.
  - An `ignoreMutation(record)` method that tells ProseMirror to
    skip rebuilds for our own colgroup writes and table-style
    updates.

`updateColgroup()` walks the first row's cells, expands each by
colspan, and writes a matching `<col>` for each spanned column. If
the colgroup already has more `<col>`s than the new column count
needs (column was just deleted), it trims the extras — closing
bug #2.

Cells with explicit colwidths sum to the table's `style.width`
(fixed-layout). Cells without explicit colwidths fall back to
browser auto-sizing with a sensible `min-width`.

Wired into Editor.tsx via `HtmlTable.extend({ addNodeView })`. One
view instance per `<table>` node.

### Root cause #2: :focus-within doesn't fire on the cell

The v1.0 CSS used `:not(:focus-within)` to detect "cursor is inside
this cell" and reveal the raw formula text. But `:focus-within`
matches only when `document.activeElement` is a *descendant* of
the element. In ProseMirror, the cursor's `activeElement` is the
`.ProseMirror` editor root — an *ancestor* of every cell. So
`:focus-within` on a `<td>` ancestor of the cursor never matches.

### Fix: Focused-cell decoration

New plugin `buildFocusedCellPlugin` in `FormulaCells.ts`. Uses
ProseMirror's `props.decorations` hook to attach a
`Decoration.node` carrying a `cortex-cell-editing` class on the
cell currently containing the cursor. ProseMirror re-runs
decorations on every selection change, so the class moves with
the cursor exactly the way `:focus-within` would have.

The `FormulaEvaluator` extension's `addProseMirrorPlugins` now
returns both the appendTransaction-based evaluator AND this new
decoration plugin, bundled under the same Extension wrapper for
clean registration.

CSS swaps four selectors from `:not(:focus-within)` to
`:not(.cortex-cell-editing)`. Behaviour matches the original
intent: text visible only when the cursor is in the cell, ::after
result overlay shown otherwise.

### Architectural notes worth carrying forward

- **NodeView lives at the Extension level, not the plugin level.**
  Plugins and nodeViews are different ProseMirror concepts.
  Plugins can install nodeViews via `props.nodeViews` BUT for
  TipTap extensions the cleaner home is `addNodeView` on the
  extending node itself. This keeps node-shape concerns local to
  the node definition.

- **Decorations are the correct way to attach state-derived
  classes to nodes.** Whenever we want CSS to react to ProseMirror
  state (selection, cursor position, transaction-driven flags),
  Decoration.node is the right tool. It composes with existing
  classes via `class: "..."` semantics — ProseMirror merges them
  with whatever the node's renderHTML produces.

- **`:focus-within` is unsafe for ProseMirror cell-level state.**
  Anywhere we want a "this cell has the cursor" CSS hook, reach
  for a Decoration.node with a class. Don't trust focus-within.

### Files touched (v1.0.1 only)

- **NEW** `src/editor/CortexTableView.ts` — the minimal nodeView.
- `src/editor/FormulaCells.ts` — added `Decoration` /
  `DecorationSet` imports, `buildFocusedCellPlugin`,
  `focusedCellKey`. FormulaEvaluator now bundles both plugins.
- `src/components/Editor.tsx` — `HtmlTable.extend` now adds
  `addNodeView` returning a CortexTableView; CortexTableView import.
- `src/index.css` — four selectors swapped from
  `:not(:focus-within)` to `:not(.cortex-cell-editing)`. Header
  comment updated to flag the v1.0.1 fix.
- `verify-cluster-18-v1.0.1.ps1` — verify script with 5-pass smoke
  checklist.

### What ships under tag `cluster-18-v1.0.1-complete`

- 🟢 Drag-resize and equalize column widths apply LIVE.
- 🟢 No white-line artifact on column delete.
- 🟢 Click-to-edit on formula cells reveals raw formula text.
- v1.1.4 cell-height-growth-on-hover fix is intact (CortexColumnResize
  plugin still owns drag input, never subscribes to view updates).

## Phase 3 — Cluster 18 v1.1 — Cell type formatting + freeze rows/cols

User-driven follow-up to v1.0.1. Two features land in v1.1: per-cell
type formatting (number / money / percent / date) and table-level
freeze rows / freeze columns (0–3 each). Sort and filter remain
deferred to v1.2.

### What ships

**cellTypeFormat module** (`src/editor/cellTypeFormat.ts`, ~150
lines). Pure registry: `formatCellValue(raw, type) → string` for the
five v1.1 types. Empty / unparseable input passes through unchanged
so the user can see and fix typos rather than getting `NaN` or a
silent hide. Date parsing uses UTC components to dodge timezone
shifts near midnight. Percent uses Excel-style semantics (0.5 →
50.00%) per the v1.1 scoping decision — composes correctly with
formulas like `=A1+0.1` between percent-typed cells.

**Cell attributes** (`src/editor/FormulaCells.ts`). Two new attrs
layered onto `FormulaTableCell` / `FormulaTableHeader`:

  - `cellType: CellType | null` — round-trips via
    `data-cell-type`. Defaults to `null` (≡ "text" passthrough).
  - `cellDisplay: string | null` — round-trips via
    `data-cell-display`. Caches the formatted display string for
    non-formula cells with cellType. Formula cells store the
    formatted result in `formulaResult` instead.

The `FormulaEvaluator` plugin's appendTransaction pass extended:

  - For **non-formula cells with cellType**: applies
    `formatCellValue(cellText, cellType)` and writes to
    `cellDisplay`.
  - For **formula cells with cellType**: applies the formatter to
    the formula's evaluated result, stores in `formulaResult` (so
    the existing CSS path renders the cellType-formatted result
    without needing new selectors).
  - For cells without either: clears any stale attrs to `null`.

The plugin's re-entry guard (transaction-meta flag) keeps the
recursive update loop bounded.

**Freeze panes** (`src/editor/FormulaCells.ts`,
`src/components/Editor.tsx`). Two table-level attrs on `HtmlTable`:

  - `frozenRows: number` (0–3 in v1.1).
  - `frozenCols: number` (0–3 in v1.1).

Round-trip via `data-frozen-rows` / `data-frozen-cols` HTML attrs.

A new `buildFrozenCellsPlugin` walks every table on every state
change, reads the freeze attrs, and uses `TableMap.findCell` to
compute each cell's grid rect. Cells inside the frozen region get
a `Decoration.node` carrying `data-frozen-row="<rowIdx>"` and/or
`data-frozen-col="<colIdx>"` attributes.

CSS uses these data-* attrs with `position: sticky` and z-index
layering:

  - Cells in frozen rows pin to `top: 0`, z-index 2.
  - Cells in frozen columns pin to `left: 0`, z-index 2.
  - Corner cells (both row and col frozen) z-index 3 so they
    overlay scrolled content from both axes.

`.tableWrapper` gains `overflow: auto; max-height: 70vh` so a
scroll surface exists. Without this, sticky has nothing to stick
to.

**Right-click menu** (`src/components/TableContextMenu.tsx`). Three
new submenus:

  - **Cell type** — Text / Number / Money / Percent / Date.
  - **Freeze rows** — Off / 1 row / 2 rows / 3 rows.
  - **Freeze columns** — Off / 1 column / 2 columns / 3 columns.

Selection sets the corresponding action; `Editor.tsx`
`runTableAction` dispatches via TipTap's `updateAttributes` chain
on `tableCell` / `tableHeader` (for cellType) or on `table` (for
freeze).

### Architectural decisions worth carrying forward

- **Decorations for grid-position-derived state.** Cell freeze
  status depends on (a) the cell's grid position (computed from
  TableMap) and (b) the table's frozen* attrs. Neither lives on
  the cell node itself, so we compute them in a plugin and emit
  Decoration.node attrs. CSS selectors target `[data-frozen-*]`.
  Same pattern as the focused-cell decoration from v1.0.1; reuse
  this any time CSS needs to react to derived state.

- **Display caching via attributes.** Both formula evaluation and
  cell-type formatting cache their display in attributes
  (`data-formula-result`, `data-cell-display`). On reload, the
  cache is read from disk and re-displayed instantly; the
  FormulaEvaluator plugin re-validates and updates if anything
  has shifted. Avoids recomputing every formula on every render.

- **Excel-style percent.** Critical for math composability. Letting
  formulas operate on raw fractions and the formatter add the % at
  display time means `=A1/B1` or `=A1+0.1` does the right thing in
  a percent-typed cell without surprises.

- **CellType passthrough on parse failures.** When the formatter
  can't parse the input (non-numeric in a number cell, unparseable
  date, etc.), it returns the raw text unchanged. The user sees
  exactly what they typed and can fix it. No `NaN`, no silent
  empty-cell.

### Files touched (v1.1 only)

- **NEW** `src/editor/cellTypeFormat.ts` — formatter registry +
  CellType union + coerceCellType helper.
- `src/editor/FormulaCells.ts` — added `cellType` and
  `cellDisplay` attrs; FormulaEvaluator plugin extended to call
  formatCellValue; new buildFrozenCellsPlugin; FormulaEvaluator
  Extension now bundles three plugins.
- `src/components/Editor.tsx` — HtmlTable.addAttributes (frozenRows
  / frozenCols); runTableAction handles 9 new actions.
- `src/components/TableContextMenu.tsx` — TableAction union extended
  with 13 new members; new menu items rendered in three submenus.
- `src/index.css` — cell-display swap selectors; subtle accent on
  typed cells; .tableWrapper overflow: auto / max-height; sticky
  positioning for data-frozen-* cells with z-index layering.
- `verify-cluster-18-v1.1.ps1` — verify script with 10-pass smoke
  checklist.

### Known issues / unresolved

- 🟡 `attr()` in CSS `top: calc(var(--cortex-row-h, 1.8em) *
  attr(data-frozen-row number, 0))` is a relatively new syntax
  (CSS attr() Module Level 5). It works in current Chromium but
  older WebView versions may fall back to `top: 0` for all frozen
  rows, causing rows beyond the first to overlap. If users hit
  this, switch to a JS-side computation that writes inline
  `top: ${row * height}px` in the decoration.

- 🟡 `position: sticky` interacts oddly with `border-collapse:
  collapse` — frozen cells may show a faint gap or border doubling
  on some browsers. Acceptable for v1.1 (the cluster doc decision
  was "use sticky + accept the border quirks").

- 🟡 Cell types beyond the v1.1 set (currency code, custom regex
  formatter) deferred to v1.2.

### What ships under tag `cluster-18-v1.1-complete`

- Cell types: text / number / money / percent / date with
  Excel-style percent semantics.
- Per-cell formatting composes with formulas — `=SUM(...)` in a
  money cell shows `$X.XX`.
- Freeze rows / freeze columns at 0/1/2/3 depths via right-click
  submenus.
- Frozen cells stay visible while the rest of the table scrolls;
  corner cells layered correctly via z-index.
- Round-trips on disk through HtmlTable's data-* attribute path.
- All v1.0 + v1.0.1 fixes carried forward unchanged.

## Phase 3 — Cluster 18 v1.2 — Sort + filter + comparison operators

User-driven follow-up to v1.1. Three things land in v1.2:

  1. Comparison operators in the formula engine.
  2. Sort columns ascending / descending.
  3. Filter rows by matching a cell's value.

### What ships

**Comparison operators in formulas** (`src/editor/formulaEngine.ts`).
The lexer learned to peek-ahead for two-character operators: `<=`,
`>=`, `==`, `!=`, plus the bare single-char `<` and `>`. Bare `=`
mid-formula is also accepted as `==` (Excel-compat — the leading
`=` of the formula is consumed before the lexer runs).

The parser gained a new `comparison` precedence level sitting above
`add`:

```
expr        := comparison
comparison  := add ( (== | != | < | <= | > | >=) add )?  -- non-chainable
add         := term (+|- term)*
```

Non-chainable was a deliberate design call: `1 < 2 < 3` would be
ambiguous (Python-style chained vs C-style left-associative), so we
error out and let the user be explicit with `IF`/`AND` later. Excel
errors on this too.

The evaluator returns `1` (true) or `0` (false) numerically, which
composes naturally with arithmetic (`=(A1>10) * 5` yields 5 when
A1>10 else 0) and feeds `IF` cleanly (IF treats non-zero as truthy).
Closes the v1.0 limitation where `IF(condition, …)` could only use
arithmetic-derived booleans.

**Sort columns** (`src/components/Editor.tsx` `sortTableColumn`
helper). Right-click in a cell → Sort column ▸ Ascending /
Descending. Implementation:

  - Find the cursor's enclosing cell + table.
  - Compute the column index via `TableMap.findCell`.
  - Pull `cellType` from the clicked cell to choose the comparator.
  - Walk every row, partition into header rows + frozen rows
    (skipped) vs body rows (sortable). Header detection: any cell
    in the row is a `tableHeader`. Frozen detection: row index <
    `frozenRows`.
  - For each body row, find the cell at the target column via a
    colspan-aware scan; build a sort key.
  - Sort body rows with cell-type-aware comparison:
    - `number` / `money` / `percent` → strip `$`, `%`, `,` then
      `Number()`. NaN-safe: unparseable numerics bubble to the end
      regardless of direction.
    - `date` → `new Date(text).getTime()`. NaN-safe.
    - text or null → `String.localeCompare` with `sensitivity:
      "base"` and `numeric: true` (so "10" sorts after "9" in
      mixed-text columns).
  - Reassemble row list (headers + frozen first, sorted body
    after), check for no-op (already in this order), build a new
    table node via `tableNode.copy(content.constructor.from(rows))`,
    dispatch one transaction.

The sort modifies the doc — sorted order persists on save and is
reflected in formulas referencing cell positions (`A1`, `B5`, etc.).
This was the v1.2 scoping-question pick. Stable sort (V8/Chromium's
`Array.sort` is stable).

**Filter rows** (`src/editor/FormulaCells.ts`
`buildFilteredRowsPlugin` + `Editor.tsx` `setTableFilter`). Two
table-level attrs:

  - `filterCol: number | null` — 0-based column index to filter on.
  - `filterValue: string | null` — case-insensitive substring rows
    must contain in that column to remain visible.

Round-trip via `data-filter-col` / `data-filter-value` on the
`<table>` element through HtmlTable's parseHTML / renderHTML.

A new `buildFilteredRowsPlugin` runs as a `props.decorations` hook.
On every state change it walks every table; when a filter is
active, it walks each row, finds the cell at `filterCol` via a
colspan-aware scan, compares the cell's text (lowercase-trimmed)
against the filter (lowercase-trimmed) for substring containment.
Rows that don't match get a `Decoration.node` carrying
`data-filtered="true"`. Header rows + frozen rows are exempt — the
plugin never tags them, so they always remain visible. CSS
(`tr[data-filtered="true"] { display: none }`) does the hiding.

Right-click menu: Filter rows ▸ Match this cell sets the filter
using the clicked cell's column + text. Clear filter resets both
attrs to `null`.

### Architectural decisions worth carrying forward

- **Comparisons return 1/0, not boolean.** Spreadsheet idiom — lets
  comparisons compose with arithmetic and slot into IF without a
  separate boolean type. If we ever add explicit boolean values
  (TRUE/FALSE keywords), they should also coerce to 1/0 numerically.

- **Sort modifies the doc.** The v1.2 scoping question pick. Sort-
  as-view-state was the alternative — would have required plumbing
  a sortKey/sortDir attr through CortexTableView and the freeze
  decoration, breaking formulas that reference cell positions, and
  losing the sorted order on close. Doc-modifying sort is what
  Excel does and what the user expects.

- **Filter is decoration-only.** Opposite of sort: filter doesn't
  touch the doc, just paints attributes ProseMirror's CSS picks up.
  Reason: filter is a transient view state ("show me only rows
  with X today"); the user shouldn't have to undo to see the full
  table again. Round-tripping via the table's attrs preserves the
  setting across reloads.

- **Header + frozen rows are special-cased identically across
  features.** Sort skips them; filter never tags them. This gives
  the user a consistent mental model: the top N rows (header +
  frozen) are "labels", the rest are "data".

- **Cell-type-aware comparators.** The v1.1 cellType attr now
  drives sort comparison — number-typed columns sort numerically,
  date-typed sort chronologically. The user can fix sort behaviour
  by setting the right cellType, which is also the same thing they
  do to fix display formatting. Single source of truth.

### Files touched (v1.2 only)

- `src/editor/formulaEngine.ts`
  - Lexer: two-char operator branch with peek-ahead; new tokens
    `<=`, `>=`, `==`, `!=`, plus bare `<`, `>`, `=`.
  - Parser: new `parseComparison` level above `parseAdd`;
    `parseExpr` now delegates to `parseComparison`. Old
    `parseExpr` body renamed to `parseAdd`.
  - Evaluator: new switch cases for `==`, `!=`, `<`, `<=`, `>`,
    `>=` returning 1 / 0.
- `src/components/Editor.tsx`
  - `HtmlTable.addAttributes` extended with `filterCol` /
    `filterValue` round-tripping via `data-filter-col` /
    `data-filter-value`.
  - New `sortTableColumn(editor, direction)` helper +
    `setTableFilter(editor, col, value)` helper.
  - New `computeSortKey(text, cellType)` internal that mirrors
    `cellTypeFormat`'s parsing logic for sort key derivation.
  - `runTableAction` switch adds 4 cases:
    `sortAsc / sortDesc / filterMatch / filterClear`.
- `src/editor/FormulaCells.ts`
  - New `buildFilteredRowsPlugin` decoration plugin.
  - `FormulaEvaluator` extension's `addProseMirrorPlugins` now
    returns five plugins (formula evaluator, focused-cell,
    frozen-cells, preserve-cell-selection, filtered-rows).
- `src/components/TableContextMenu.tsx`
  - `TableAction` union extended with `sortAsc / sortDesc /
    filterMatch / filterClear`.
  - Two new menu sections at the bottom of the in-table block.
- `src/index.css`
  - New rule `tr[data-filtered="true"] { display: none }`.
- `verify-cluster-18-v1.2.ps1` — verify script with 9-pass smoke
  checklist.

### What ships under tag `cluster-18-v1.2-complete`

- Comparison operators in formulas (`>`, `>=`, `<`, `<=`, `==`,
  `!=`, plus bare `=` as Excel-compat `==`).
- `IF(condition, …)` with natural numeric and string comparisons.
- Sort columns ascending / descending, cell-type-aware, doc-
  modifying.
- Filter rows by matching a cell's value, decoration-only,
  round-tripping via table attrs.
- Header + frozen rows exempt from sort and filter.
- All v1.0 + v1.0.1 + v1.1 features carry forward unchanged.

## Phase 3 — Cluster 14 v1.0 — Time tracking / planned-vs-actual analytics

User-driven follow-up to the calendar (Cluster 11) once the Excel layer
shipped. Composes naturally with the events the user has already been
recording — the analytics layer just asks one extra field on save.

### What ships

**Schema migration** — `events.actual_minutes INTEGER` (nullable),
idempotent ALTER TABLE in `open_or_init_db`. NULL means "no actual
recorded yet"; non-null means "how long this event actually took, in
minutes, post-hoc". Existing events default to NULL and pass through
without modification on next migration.

**Event struct + create/update commands** — `Event` gains
`actual_minutes: Option<i64>`. `create_event` and `update_event` accept
the field as their last positional argument; both clean it (rejects
negatives → None). `collect_events_in_window` adds the column to its
SELECT and to the row mapping in both branches (standalone events +
recurring masters). `Calendar.tsx`'s `saveEdit` and the two
`invoke()` calls (`create_event` / `update_event`) thread
`actualMinutes` through.

**EventEditModal field** — new numeric input under Notes with hint
"(post-hoc — how long it really took)". State held as a string
(`actualMinutes` / `setActualMinutes`) so empty input is preserved as
"no actual yet" rather than coerced to 0. On submit:
`parseInt(actualMinutes.trim(), 10)` with `Number.isFinite` +
non-negative check; empty string → `null` on disk. Disabled for
read-only (Google-synced) events.

**Tauri command — `get_time_tracking_aggregates`**

```rust
fn get_time_tracking_aggregates(
    vault_path: String,
    range_start_unix: i64,
    range_end_unix: i64,
) -> Result<Vec<TimeTrackingRow>, String>
```

Returns `Vec<TimeTrackingRow>` with `category`,
`planned_minutes_total`, `actual_minutes_total`, `events_count`,
`events_with_actual_count`. SQL groups by `COALESCE(category,
'uncategorized')` over `start_at >= range_start AND start_at <
range_end`. Planned minutes derived from `MAX(0, (end_at - start_at)
/ 60)` so backwards events don't blow up the aggregate. Actual minutes
is a straight `SUM(actual_minutes)` (NULL contributes 0 to the sum
but doesn't increment `events_with_actual_count`, which uses
`SUM(CASE WHEN actual_minutes IS NOT NULL THEN 1 ELSE 0 END)`).

Recurring events (`recurrence_rule IS NOT NULL`) are excluded in
v1.0. Reasoning: `expand_recurrence` generates instances on the fly
without persisting them, so there's no row to attach an
`actual_minutes` to per occurrence. v1.1 candidate if recurring time
tracking surfaces as a daily-friction need.

**TimeTracking.tsx view** — new structured view, ~440 lines.
Mirrors the IdeaLog / MethodsArsenal pattern. Date range presets
(7d / 30d / 90d / All), with All using `[0, 253402300800]` to span
year 9999. Overall stats card: Planned / Actual / Ratio / Events
counts. Per-category table: Category | Planned | Actual | Ratio |
Events. Ratio is colour-cued via `ratioColour()`:

  - planned == 0 OR no actuals recorded → muted
  - actual / planned < 0.9 → success (green)
  - actual / planned > 1.2 → danger (red)
  - 0.9–1.2 inclusive → text colour (on track)

`formatMinutes` collapses 0 → "0m", <60 → "Xm", else "Xh Ym" with
trailing-zero trimming. Counts in parentheses are events with an
`actual_minutes` recorded.

**Sidebar button + ActiveView wiring** — `time-tracking` added to the
`ActiveView` union in `TabPane.tsx`. Render branch in TabPane invokes
`<TimeTracking vaultPath refreshKey={indexVersion} onClose=
{closeStructuredView} />`. Sidebar button "⏱ Time" added next to
"Cal" in `App.tsx`'s sidebar, calling `paneRefs.current[
activeSlotIdx]?.setActiveView("time-tracking")`.

### Architectural decisions worth carrying forward

- **Single field, derived everything else.** `actual_minutes` is a
  flat scalar. Planned is derived from the existing start/end. Ratio
  is computed at display time. No redundant fields, no
  recompute-on-write costs. The data shape stays minimal; analytics
  emerge from queries.

- **Empty input ≠ zero.** The input is a string, and the empty
  string maps to `null` on disk. Setting it to "0" would mean "this
  event took 0 minutes" (probably an error or a cancellation). The
  distinction matters for `events_with_actual_count` — only events
  the user has explicitly recorded an actual for participate in
  ratio-meaningful counts.

- **Recurring events are out of scope for v1.** Recurring instances
  aren't persisted as rows, so there's no place to hang an
  `actual_minutes` per instance. Adding instance-level overrides is
  a meaningful schema change (a new `event_instance_overrides`
  table keyed by master id + occurrence date) and only worth it if
  the user starts asking about meeting time-spend. Document the
  limitation, defer to v1.1.

- **Aggregates over ranges, not over individual events.** The Rust
  command does the GROUP BY. The frontend never sees individual
  events — just the per-category rollup. This keeps the network
  surface small and makes future granularity additions (per-day,
  per-week) just a different SQL query.

- **Colour cues are display-side only.** No "calibration target"
  stored anywhere. The user reads the ratios and adjusts their
  estimates by hand. v1.1 could add a "target ratio" preference
  per category, but that's premature without data on whether
  users actually want to override the 0.9 / 1.2 thresholds.

### Known issues / open follow-ups

- 🟡 Recurring events excluded (see above).

- 🟡 No per-day rollup. The cluster doc question asked about
  per-category vs per-day vs per-event granularity; v1.0 ships
  per-category only. Per-day or per-event are reasonable v1.1
  additions.

- 🟡 No automatic "I forgot to fill in actual_minutes" prompt. An
  event ends, the user moves on, the actual stays NULL. v1.1 could
  surface a count of "completed events without actuals" somewhere
  (notification bell? subtle toast on next calendar open?).

- 🟡 The TimeTracking view's `refreshKey` comes from `indexVersion`
  which bumps on file changes, not on event edits. Editing an
  event's actual in another slot won't auto-refresh the view; the
  user has to switch range presets or close+reopen. Acceptable
  for v1.0 but worth flagging if it bites.

### Files touched

- `src-tauri/src/lib.rs`
  - `actual_minutes INTEGER` migration line in `open_or_init_db`.
  - `Event` struct gains `actual_minutes: Option<i64>`.
  - `create_event` / `update_event` signatures + INSERT/UPDATE +
    return Event literal.
  - `collect_events_in_window` SELECT + row map (both branches).
  - New `TimeTrackingRow` struct + `get_time_tracking_aggregates`
    command + invoke_handler! registration.
- `src/components/Calendar.tsx`
  - `CalendarEvent` interface gains `actual_minutes?: number | null`.
  - `saveEdit` payload type extension.
  - Both `invoke()` calls pass `actualMinutes`.
- `src/components/EventEditModal.tsx`
  - `onSave` payload type extension.
  - `actualMinutes` state + load from existingEvent + reset on new.
  - Submit serialisation to int-or-null.
  - New `<input type="number">` rendered under Notes.
- **NEW** `src/components/TimeTracking.tsx` — structured view.
- `src/components/TabPane.tsx`
  - `ActiveView` union gains `"time-tracking"`.
  - `TimeTracking` import.
  - Render branch.
- `src/App.tsx`
  - "⏱ Time" sidebar button next to "Cal".
- `verify-cluster-14.ps1` — verify script with 7-pass smoke
  checklist.

### What ships under tag `cluster-14-v1.0-complete`

- Post-hoc actual-minutes capture on calendar events.
- Per-category planned-vs-actual aggregate view.
- Date range presets (7d / 30d / 90d / All).
- Colour-cued ratio (green / red / neutral).
- Composes with the existing calendar stack — no new data the user
  hasn't already been entering, just one extra field.
