# Cluster 24 — QoL pack 2: file operations + review schedule

**One-liner:** Two unrelated quality-of-life additions bundled into a single ship: (a) right-click create / rename / delete for files and folders directly in the vault sidebar, and (b) auto-recurring weekly + monthly all-day review events on the calendar that surface in the notification bell.

---

## Status

✅ v1.0 shipped — `cluster-24-v1.0-complete` (re-tagged after v1.0.1 fixes; v1.0 hadn't shipped to remote yet).

### v1.0.1 — bundled corrections (same tag)

After dogfooding, two issues surfaced:

- **SQL schema mismatch in `cortex24_ensure_review_category`.** The `event_categories` table's columns are `(id, label, color, sort_order)`, but v1.0 used `(id, name, color, created_at)`. Every INSERT failed; `ensure_review_events` errored; auto-init's `.catch` logged a warn that never reached the user. Fixed: correct column names + a SELECT that matches on either `id = 'cat-review'` or `label = 'Review'` so partial prior runs don't double-insert.
- **Auto-init silent on failure.** v1.0 only logged warnings. v1.0.1 surfaces errors via `setError(...)` so any future Tauri-side issue is visible in the App's error banner. Auto-init now uses `get_review_settings` (DB truth) instead of a localStorage flag — if NEITHER review currently exists, both are auto-created; if at least one exists, state is left alone.

Plus the **review-log file** feature (also in v1.0.1):

- New `ensure_review_log_file(vault, kind, date_iso) -> path` Tauri command. Creates `<vault>/Reviews/<Weekly|Monthly>/<date> <Kind> Review.md` with a default template (frontmatter + "What was this review about?" / "What did you learn?" / "Action items" sections) if missing. Idempotent.
- Recurrence expander emits per-instance bodies for review events: each Sunday / first-Sunday instance gets a body containing `[[YYYY-MM-DD Weekly Review]]` (or `Monthly`) plus a one-liner explaining the click. The local date is computed via a 12-hour shift on `effective_start` so any timezone within ±12h of UTC produces the correct calendar day.
- `App.tsx#openWikilinkInActive` detects review-log basename patterns and routes them through `ensure_review_log_file` (skipping the generic "Create note in vault root?" prompt). Click any review event's wikilink → that Sunday's log opens in the active pane, freshly created with the review template if it didn't exist.

### v1.0.1 — Review templates as Cluster 22 doc types (same tag)

The hardcoded review-log body in `ensure_review_log_file` left no way to customize the structure. Two new types added to the Cluster 22 template registry:

- `weekly-review` (lazy-init'd at `<vault>/.cortex/document-templates/weekly-review.md`)
- `monthly-review` (same folder)

`ensure_review_log_file` now goes through `read_or_init_template + apply_placeholders` with `{{date}}`, `{{title}}`, `{{slug}}`, `{{week_number}}`, `{{day_of_week}}` filled in. Defensive fallback to `cortex24_review_log_default_body` if template loading fails. Frontend `TemplatesModal` lists both types ("Weekly review log" / "Monthly review log") at the bottom of the picker, with sample contexts for the live preview.

### v1.0.1 — Auto-credit past non-recurring events (same tag)

Cluster 14 v1.1 auto-credited recurring instances as fully spent when `actual_minutes` was NULL. Non-recurring past events stayed excluded — meaning a user who didn't manually fill `actual` on every meeting saw their totals show planned-only for completed work.

v1.0.1 extends the auto-credit to non-recurring past events in all three aggregator paths (`get_time_tracking_aggregates`, `get_time_tracking_daily_rollup`, `aggregate_time_tracking_in_window`):

- Past + NULL → auto-credit as planned (NEW).
- Future + NULL → 0, planned-only counted (unchanged).
- Recorded actual (Some(m), m ≥ 0) → use m (unchanged — preserves NULL-vs-explicit-0 distinction).

All-day events stay excluded (Cluster 14 v1.5).

## Triggers

- **File ops in sidebar.** "I want to make a new file in this folder without alt-tabbing to Explorer." Especially common after Cluster 22's templates landed — creating new docs is now where the user spends keystrokes.
- **Recurring reviews.** Weekly + monthly review (Cluster 2/3 review-pipeline destinations) need a regular slot on the calendar so the user actually does them. The bell already supports `notify_mode='urgent'`, this just creates the events.

## Dependencies

- File ops: Cluster 6 v1.5 (multi-tab — pane sync on rename / delete) + the existing `read_vault_tree` + watcher.
- Reviews: Cluster 11 (calendar + recurrence expander) + Cluster 14's category table + Cluster 15's notification bell. Adds positional BYDAY support to the recurrence expander (`BYDAY=1SU` for "first Sunday of month").

## Effort

~2 days. File ops is the bulk; reviews is small and reuses existing infrastructure.

---

## Decisions locked before implementation

1. **Files + folders.** Both kinds get a context menu. Folders: New file / New folder / Rename / Delete. Files: Rename / Delete.
2. **OS trash, not permanent delete.** `trash` Rust crate; deleted files land in the Recycle Bin, recoverable.
3. **Update wikilinks on rename.** When a `.md` file is renamed, walk every `.md` in the vault and rewrite `[[old name]]` / `[[old name|alias]]` / `[[old name#section]]` to use the new basename (case-insensitive target match, whitespace preserved). Folder renames don't trigger this — wikilinks reference filenames not paths.
4. **Monthly review on the first Sunday of each month.** RRULE `FREQ=MONTHLY;BYDAY=1SU`. Required extending the recurrence expander to support positional BYDAY tokens.

## Open questions (deferred)

- **Drag-and-drop reorganization** in the sidebar (drag a file into another folder to move it). Possible v1.1 — the FileTree drag-drop infrastructure is already partially in place from the cluster-19 image-drag work.
- **Review templates** — when a daily-log template hooks into a review event, the daily note for that Sunday could include a Weekly-review template section. v1.1+.
- **Per-Sunday monthly review choice** — UI to pick first / second / third / fourth / last. v1.0 hardcodes first. v1.1+.
- **Configurable EVENT_LOOKBACK** for review events specifically — the existing 1-day lookback in the bell means a missed review drops off after Monday. Acceptable for v1.0.

---

## Architecture

### File operations — backend

Four new Tauri commands in `src-tauri/src/lib.rs`, plus a helper layer:

```
create_file_in_folder(vault, parent_dir, name) -> new_path
create_folder_in_folder(vault, parent_dir, name) -> new_path
rename_path(vault, old_path, new_name, update_wikilinks) -> new_path
trash_path(vault, path) -> ()
```

Helpers (all `cortex24_`-prefixed for namespacing):

- `validate_filename_segment` — rejects empty / `.` / `..` / control chars / `/\:*?"<>|` / >255 chars.
- `ensure_within_vault` — lexical containment check (no canonicalize so it works for not-yet-existing destination paths).
- `purge_path_from_index` — DELETE rows from `notes`, `metadata`, `links`, `marks`, `hierarchy` for the given path. Mirrors `index_single_file`'s DELETEs without the INSERTs.
- `walk_for_indexable_files` — recursively gather `.md` and `.pdf` paths under a folder. Used by folder rename + folder trash to know which index rows to purge / refresh.
- `rewrite_wikilinks_in_vault` — scan every `.md`, call `rewrite_wikilinks_in_string`, write back if changed, re-index touched files. Returns count of touched files.
- `rewrite_wikilinks_in_string` — manual scan (no regex) over `[[…]]` runs. Splits target from suffix at the first `#` or `|`, compares target.trim() case-insensitively to the old basename, replaces with the new basename while preserving leading / trailing whitespace inside the brackets.

`rename_path` flow:

1. Validate new_name. Ensure old exists, is in vault.
2. Build new_path = parent / new_filename. If old is a file with no extension in new_name, preserve the original extension (so renaming `note.md` to `renamed` produces `renamed.md`).
3. `fs::rename(old, new)` — same-FS atomic rename.
4. For files: `purge_path_from_index(old)`; if `.md`, `index_single_file(new)`. If `update_wikilinks` and basename changed, run `rewrite_wikilinks_in_vault`.
5. For folders: walk new folder, derive each old path via prefix substitution, purge old + re-index new.

`trash_path`: purge index for the path (and recursively for folders), then `trash::delete(path)`. The OS-level Recycle Bin keeps the file recoverable.

Crate: `trash = "5"` added to `Cargo.toml`.

### File operations — frontend

Three new components:

- `src/components/FileTreeContextMenu.tsx` — right-click menu. Items differ by node type (folder gets New file / New folder; both get Rename / Delete). Mirrors the BlockContextMenu / ImageContextMenu shape. Closes on outside click / Esc. Viewport-clip guard.
- `src/components/DeleteConfirmModal.tsx` — Recycle-Bin-flavored confirmation. Shows path + name + (for folders) contained-file count. Enter confirms, Esc closes.
- `src/components/ReviewSettingsModal.tsx` — two checkboxes for weekly + monthly. Save calls `ensure_review_events`.

`FileTree.tsx` (modified):

- New props: `onContextMenu`, `pendingEdit`, `onPendingEditChange`, `onCommitEdit`.
- Each row gets an `onContextMenu` handler that calls `onContextMenu(e, node)` (App.tsx routes the click to the menu state).
- New `pendingEdit` union state owned by App.tsx: `rename` (existing row's text becomes an `<input>`), `new-file` / `new-folder` (a phantom row with empty `<input>` appears as the last child of the targeted folder; the folder auto-expands).
- New `InlineEditInput` component: focuses on mount; for renames, selects only the basename portion (everything before the last `.`) so the user can overwrite without re-selecting the extension. Enter commits, Esc cancels, blur cancels (matches OS file-explorer behavior).

`App.tsx` (modified):

- New state: `reviewSettingsOpen`, `fileTreeMenu`, `pendingEdit`, `deleteConfirm`.
- `dispatchFileTreeAction(node, kind)` — routes a context-menu action into the appropriate state setter.
- `commitFileTreeEdit(edit)` — dispatches the matching Tauri command; on rename, save dirty panes first, walk paneRefs to re-aim any pane showing the renamed path (or any sub-path of a renamed folder); on success, bump refreshKey + indexVersion.
- `confirmDelete()` — close any pane showing the deleted path or anything beneath it (folder delete), call `trash_path`, bump refreshKey + indexVersion.
- New "Reviews" sidebar button next to "Templates".

### Review schedule — backend

Two new Tauri commands:

```
ensure_review_events(vault, weekly_enabled, monthly_enabled, tz_offset_minutes) -> ()
get_review_settings(vault) -> (bool, bool)
```

Stable IDs for the review events: `cortex-review-weekly`, `cortex-review-monthly`. The commands UPSERT (`SELECT 1 FROM events WHERE id = ?` → INSERT or UPDATE) so re-enabling after disable is idempotent.

Both events:
- `all_day = true`
- `category = "Review"` (auto-created via `cortex24_ensure_review_category` with a calm purple `#a78bfa`)
- `status = 'planned'`
- `notify_mode = 'urgent'` — Cluster 15's bell-handling treats this as "stays visible until acknowledged"
- `recurrence_rule`:
  - Weekly: `FREQ=WEEKLY;BYDAY=SU`
  - Monthly: `FREQ=MONTHLY;BYDAY=1SU`
- `start_at` / `end_at` = the most recent past Sunday at local-midnight (UTC unix), spanning a full day.

The most-recent-past-Sunday calculation uses `tz_offset_minutes` to compute local-day boundaries (Cluster 10 v1.2 / Cluster 14 v1.4 precedent: anything that says "today's local boundary" must accept this from the frontend).

### Review schedule — recurrence expander extension

The pre-Cluster-24 `expand_recurrence` MONTHLY arm only supported `BYMONTHDAY` (or master's day-of-month). Cluster 24 adds positional BYDAY support so the monthly review can land on the first Sunday of each month.

New helpers:

- `cortex24_parse_positional_byday(s)` — parse `1SU`, `-1MO`, `2WE` etc. into `(occurrence, weekday_iso)`. Bare `SU` (without numeric prefix) returns `None` so the WEEKLY-style multi-day BYDAY path is unaffected.
- `cortex24_nth_weekday_of_month(year, month, weekday_iso, n)` — returns the day-of-month of the Nth occurrence of the given weekday in the given month, or `None` if there aren't N occurrences. `n > 0` counts from start; `n = -1` is "last".

The MONTHLY arm now tries positional BYDAY first; falls back to BYMONTHDAY (or master day-of-month) when no positional token is present. Pre-Cluster-24 monthly recurrences are unaffected because they don't carry a positional BYDAY.

### Review schedule — frontend + auto-init

`App.tsx` adds an effect on `vaultPath` change:

```ts
useEffect(() => {
  if (!vaultPath) return;
  const lsKey = `cortex:reviews-initialized:${vaultPath}`;
  if (localStorage.getItem(lsKey) === "true") return;
  invoke("ensure_review_events", {
    vaultPath,
    weeklyEnabled: true,
    monthlyEnabled: true,
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  }).then(() => {
    localStorage.setItem(lsKey, "true");
    setIndexVersion((v) => v + 1);
  });
}, [vaultPath]);
```

So a fresh vault auto-creates both reviews with both flags ON. The localStorage flag prevents re-creation after the user manually deletes via the calendar's right-click. The user can re-enable from the Reviews modal.

---

## Files added

- `src/components/FileTreeContextMenu.tsx` — right-click menu.
- `src/components/DeleteConfirmModal.tsx` — recycle-bin confirmation.
- `src/components/ReviewSettingsModal.tsx` — weekly + monthly toggles.
- `verify-cluster-24-v1.0.ps1`.

## Files modified

- `src-tauri/Cargo.toml` — `trash = "5"`, `regex = "1"` (regex stays as future scaffold; v1.0 uses manual scan).
- `src-tauri/src/lib.rs`
  - New Cluster 24 block at the end (file ops + review events + helpers + `cortex24_parse_positional_byday` + `cortex24_nth_weekday_of_month`).
  - MONTHLY arm of `expand_recurrence` extended to honor positional BYDAY.
  - 6 new Tauri commands registered in `invoke_handler`.
- `src/components/FileTree.tsx` — new props for context-menu + inline-edit; `InlineEditInput` component; phantom new-file / new-folder rows; folder auto-expands when a phantom is targeted at it.
- `src/App.tsx` — imports, state, dispatch handlers, FileTree props, modals, "Reviews" sidebar button, auto-init useEffect.
- `src/index.css` — `.cortex-filetree-ctxmenu` block.

---

## Smoke walk (verify-cluster-24-v1.0.ps1)

### File operations

1. Right-click a folder row in the sidebar → menu appears with "New file here / New folder here / Rename / Delete".
2. Right-click a file row → menu appears with "Rename / Delete" only.
3. New file: pick a folder → "New file here" → folder auto-expands → empty input row → type "test", Enter → `test.md` appears. Click → opens empty in active pane.
4. New folder: same flow → "New folder here" → type "subfolder", Enter → `subfolder/` appears.
5. Rename file: right-click → Rename → input shows current name with basename selected (extension preserved) → type new name, Enter → file renames on disk.
6. Rename file with wikilinks: another note links `[[old name]]`. After rename, that note's content reads `[[new name]]`.
7. Rename folder: works the same; files inside follow the new path.
8. Delete file: right-click → Delete → confirm modal with path + name → Confirm → file lands in Recycle Bin.
9. Delete folder: confirm modal shows "N files inside" → Confirm → folder + contents land in Recycle Bin.
10. Pane sync: file open in pane 1 → rename → pane reopens at new path. Delete file open in pane 2 → pane shows blank.
11. Validation: try invalid name (`a/b`, `..`, empty) → error surfaces in the App-level error banner; pendingEdit closes.
12. Cancel: type during rename → Esc → no change. Blur (click elsewhere) → cancels.

### Reviews

13. First load on a fresh vault → calendar shows "Weekly review" all-day on Sunday and "Monthly review" all-day on the first Sunday of the month.
14. Notification bell on Sunday → both reviews appear; bell badge count includes them.
15. Click "Reviews" sidebar button → modal with both checkboxes checked. Uncheck Weekly → Save → Sundays no longer show the weekly event; bell count drops.
16. Re-open Reviews → check Weekly → Save → events return on the recurring schedule (no manual catch-up needed).
17. RRULE expansion: future Sundays display weekly review; first Sunday of next month displays monthly review.
18. urgent notification persistence: don't dismiss on Sunday → Monday morning, bell still shows the review (within EVENT_LOOKBACK = 1 day).
19. Auto-init guard: delete a review event manually from the calendar → re-launch the app → review does NOT auto-recreate (localStorage flag persists). Open Reviews modal → re-enable → review is back.

---

## v1.1+ deferred

- Drag-and-drop file move within the sidebar.
- Per-Sunday monthly review choice (first / second / third / fourth / last).
- Review templates that splice into the daily note for review days.
- Configurable `EVENT_LOOKBACK_DAYS` for review events specifically.
- Multi-select operations in the FileTree (delete N files at once).
- Undo for trash (Ctrl+Z restores from Recycle Bin via `trash::os_limited::restore_all`).
- Indicator badge on calendar review events so they read distinctly from regular all-day events.
