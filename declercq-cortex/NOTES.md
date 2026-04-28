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
