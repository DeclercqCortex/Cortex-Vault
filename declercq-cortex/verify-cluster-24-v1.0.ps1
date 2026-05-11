# verify-cluster-24-v1.0.ps1
# Phase 3 Cluster 24 v1.0 — QoL pack 2: file operations + review schedule.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # Cargo changes here — full restart required
#   .\verify-cluster-24-v1.0.ps1
#
# What ships
# ----------
#
# Two unrelated QoL features bundled into a single ship.
#
# (A) File operations in the vault sidebar:
#   - Right-click on a folder → New file here / New folder here / Rename / Delete
#   - Right-click on a file → Rename / Delete
#   - Inline rename: existing row's text becomes an <input>; Enter commits,
#     Esc / blur cancels. Basename portion auto-selected so the user can
#     overwrite without re-selecting the extension.
#   - Inline new-file / new-folder: a phantom row appears under the targeted
#     folder; the folder auto-expands.
#   - Delete: confirmation modal showing path + name + (for folders) count
#     of contained files. Confirm sends to OS Recycle Bin (trash crate).
#   - Wikilink update on rename: when an .md file is renamed, every other
#     .md in the vault has its `[[old name]]` / `[[old name|alias]]` /
#     `[[old name#section]]` rewritten to use the new basename.
#     Whitespace around the target is preserved; match is case-insensitive.
#
# (B) Recurring review schedule:
#   - On first load of a vault that doesn't yet have the events, two
#     all-day recurring events are created:
#       Weekly review  — every Sunday  — RRULE FREQ=WEEKLY;BYDAY=SU
#       Monthly review — first Sunday  — RRULE FREQ=MONTHLY;BYDAY=1SU
#   - Both have notify_mode='urgent' so the Cluster 15 notification bell
#     keeps them visible all day until acknowledged.
#   - "Reviews" sidebar button next to "Templates" opens a modal with two
#     checkboxes (one per review). Save calls ensure_review_events; an
#     unchecked review's stable-ID event is DELETED.
#   - localStorage flag at `cortex:reviews-initialized:<vaultPath>` tracks
#     whether auto-init has run, so manually deleting a review event in
#     the calendar isn't undone on next launch.
#
# Architecture
# ------------
#
# Backend (src-tauri/src/lib.rs):
#
#   New crates: trash = "5", regex = "1" (regex reserved for future use;
#   v1.0 uses manual string scan).
#
#   File ops:
#     create_file_in_folder(vault, parent_dir, name) -> new_path
#       - Validates name (no /\:*?"<>|, no .. / ., no control chars)
#       - Auto-appends .md when no extension supplied
#       - Indexes via index_single_file
#     create_folder_in_folder(vault, parent_dir, name) -> new_path
#       - Same validation; no auto-extension
#     rename_path(vault, old_path, new_name, update_wikilinks) -> new_path
#       - Preserves original extension when new_name has no dot
#       - fs::rename + purge_path_from_index(old) + index_single_file(new)
#       - For folders: walks new path, derives old paths via prefix
#         substitution, purges + re-indexes per file
#       - When update_wikilinks: scans every .md in the vault, calls
#         cortex24_rewrite_wikilinks_in_string per file, writes back
#         changed files, re-indexes them
#     trash_path(vault, path) -> ()
#       - Purges index for the path (recursive for folders)
#       - trash::delete sends to OS Recycle Bin
#
#   Review events (stable IDs cortex-review-weekly / cortex-review-monthly):
#     ensure_review_events(vault, weekly_enabled, monthly_enabled,
#                          tz_offset_minutes) -> ()
#       - Ensures the "Review" event_category exists (auto-create with
#         color #a78bfa if missing)
#       - Computes the most recent past Sunday at local-midnight in UTC
#         seconds (uses tz_offset_minutes per Cluster 14 v1.4 precedent)
#       - For each enabled review: SELECT 1 → INSERT or UPDATE with
#         all_day=1, notify_mode='urgent', recurrence_rule=...
#       - For each disabled review: DELETE FROM events WHERE id = ?
#     get_review_settings(vault) -> (bool, bool)
#       - Returns whether each stable-ID event currently exists
#
#   Recurrence expander extension (expand_recurrence):
#     The MONTHLY arm now supports positional BYDAY tokens (1SU, -1MO,
#     etc.) via two new helpers:
#       cortex24_parse_positional_byday(s) -> Option<(i32, u32)>
#       cortex24_nth_weekday_of_month(year, month, weekday_iso, n) -> Option<u32>
#     Pre-Cluster-24 monthly recurrences (BYMONTHDAY or master day-of-
#     month) are unaffected because they don't carry a positional token.
#
# Frontend:
#
#   New components:
#     src/components/FileTreeContextMenu.tsx
#       - Mirrors BlockContextMenu shape; closes on outside click + Esc
#       - Item set differs by node type
#       - Viewport-clip guard
#     src/components/DeleteConfirmModal.tsx
#       - Esc closes, Enter confirms
#       - Shows path + name + (folder) contained file count
#       - Cancel autoFocused so a casual Enter doesn't accidentally delete
#     src/components/ReviewSettingsModal.tsx
#       - Two checkboxes; loads current state via get_review_settings
#       - Save calls ensure_review_events with tz_offset_minutes
#
#   FileTree.tsx (modified):
#     - New props: onContextMenu, pendingEdit, onPendingEditChange,
#       onCommitEdit
#     - Each row gets onContextMenu handler routing to App.tsx
#     - PendingEdit union: rename / new-file / new-folder
#     - Renaming row swaps text for an InlineEditInput
#     - new-file / new-folder phantom row appears at end of children
#     - Folder auto-expands when a phantom is targeted at it
#     - InlineEditInput selects basename (text before last dot) on focus
#       so renames don't re-type the extension
#
#   App.tsx (modified):
#     - Imports + new state for fileTreeMenu, pendingEdit, deleteConfirm,
#       reviewSettingsOpen
#     - dispatchFileTreeAction(node, kind) routes context-menu actions
#     - commitFileTreeEdit(edit) dispatches the matching Tauri command,
#       saves dirty panes, re-aims paneRefs, bumps refresh + indexVersion
#     - confirmDelete() closes affected panes, calls trash_path
#     - "Reviews" sidebar button next to "Templates"
#     - Auto-init useEffect on vault load (creates both reviews if not
#       previously initialized; localStorage flag prevents re-create)
#
#   index.css:
#     - .cortex-filetree-ctxmenu / .cortex-filetree-ctxmenu-item /
#       .cortex-filetree-ctxmenu-divider / .cortex-filetree-ctxmenu-shortcut
#       — small floating menu chrome
#
# Smoke tests
# -----------
#
# Pass A — Right-click folder / file menus appear:
#   1. Right-click a folder row → menu shows New file here / New folder
#      here / Rename / Delete.
#   2. Right-click a file row → menu shows Rename / Delete only.
#   3. Esc closes the menu. Outside click closes the menu.
#
# Pass B — Create new file:
#   1. Right-click a folder → "New file here" → folder auto-expands.
#   2. Phantom row with empty <input> appears as the last child.
#   3. Type "test", Enter → file `test.md` appears in the tree.
#   4. Click → opens (empty content) in the active pane.
#   5. Re-open the modal Templates → ensure the file's body matches the
#      "note" template (Cluster 22) when Templates-enabled is on.
#      Wait — `create_file_in_folder` does NOT use templates by design
#      (templates are for create_note / hierarchy creates). Empty file
#      is correct.
#
# Pass C — Create new folder:
#   1. Right-click a folder → "New folder here" → empty input row.
#   2. Type "subfolder", Enter → folder appears, expanded.
#   3. Right-click the new subfolder → "New file here" → create a file
#      inside. File appears in the right place.
#
# Pass D — Rename file (basename only auto-selected):
#   1. Right-click a file → Rename → existing name appears in the input.
#   2. The basename portion is selected (extension NOT selected) so
#      typing immediately replaces the basename.
#   3. Type "renamed", Enter → file renames to "renamed.md".
#   4. Open the renamed file → content unchanged.
#
# Pass E — Rename file with wikilinks:
#   1. Create note A with content `Reference to [[B]] and [[B|alias]]`.
#   2. Create note B.
#   3. Rename B to "C".
#   4. Open A → its content now reads `Reference to [[C]] and [[C|alias]]`.
#   5. Section refs: A had `[[B#summary]]` → after rename reads `[[C#summary]]`.
#   6. Case-insensitive: A had `[[b]]` → after rename reads `[[C]]` (the
#      new basename's case is what's written; Cortex resolves
#      case-insensitively so it still works).
#   7. Whitespace preserved: A had `[[ B ]]` → reads `[[ C ]]` (single
#      spaces both sides, not collapsed).
#
# Pass F — Rename folder:
#   1. Rename a folder. Files inside aren't displayed at the old paths;
#      they appear under the new folder name.
#   2. Open one of those files → content unchanged.
#   3. Search palette finds them at their new path.
#
# Pass G — Delete file:
#   1. Right-click → Delete → confirm modal: shows full path, name, and
#      "Will be sent to the Recycle Bin."
#   2. Cancel → no-op.
#   3. Reopen, Confirm → file disappears from the tree.
#   4. Open the Windows Recycle Bin → file is there → restore confirms
#      it goes back to the original location.
#
# Pass H — Delete folder:
#   1. Folder with 3 files inside. Right-click folder → Delete.
#   2. Modal says "contains 3 files".
#   3. Confirm → folder + contents move to Recycle Bin.
#
# Pass I — Pane sync on rename:
#   1. Open file F in pane 1.
#   2. Rename F → pane 1 still shows the same file at the new path
#      (no flash of "file not found").
#
# Pass J — Pane sync on delete:
#   1. Open file F in pane 1.
#   2. Delete F → pane 1 shows blank state.
#
# Pass K — Validation errors:
#   1. Rename → type "a/b" → Enter → error in App banner ("invalid
#      character").
#   2. Rename → type ".." → Enter → "Reserved name".
#   3. Rename → type empty → Enter → cancels (empty trim → close).
#   4. Rename to a name that already exists → "A file or folder with
#      that name already exists".
#
# Pass L — Cancel paths:
#   1. New file → start typing → Esc → phantom row disappears, no file
#      created.
#   2. New file → start typing → click elsewhere → blur cancels (no
#      file created).
#   3. Rename → start editing → Esc → restores the original name.
#
# Pass M — Reviews auto-init on fresh vault (v1.0.1 fix):
#   1. With the vault's events table empty of review rows (fresh vault
#      OR after manually deleting any cortex-review-* events from the
#      DB), launch the app.
#   2. Calendar shows "Weekly review" all-day on this Sunday and
#      "Monthly review" all-day on the first Sunday of the month.
#   3. Both render with the purple "Review" category color.
#   4. ★ v1.0.1 fix: v1.0 had a SQL schema mismatch
#      (event_categories used `name`/`created_at` instead of
#      `label`/`sort_order`) which caused silent INSERT failures and
#      no review events ever appeared. v1.0.1 fixes the columns and
#      surfaces any future error via the App-level error banner.

# Pass M2 — Auto-init uses DB truth, not localStorage (v1.0.1):
#   1. Open Reviews modal → uncheck Weekly → Save. Weekly review
#      vanishes from the calendar; Monthly stays.
#   2. Reload the app. Weekly does NOT auto-recreate (the auto-init
#      check sees Monthly exists, so it leaves state alone).
#   3. Re-open Reviews → re-check Weekly → Save. Weekly returns.
#   4. Manually delete BOTH reviews via the calendar's right-click
#      delete-event option. Reload. Both reviews recreate (auto-init
#      detects neither exists). Acceptable trade-off vs the v1.0
#      localStorage gate that left-them-deleted.

# Pass N1 — Review log files auto-create (v1.0.1):
#   1. Click a "Weekly review" event on a Sunday in the calendar.
#   2. Modal opens; body shows `[[YYYY-MM-DD Weekly Review]]` plus
#      explanatory text.
#   3. Close modal. Open the daily-note splice for that Sunday (or
#      navigate to the Calendar.tsx event-list view).
#   4. The body's wikilink renders as a clickable Cortex link.
#   5. Click it → file at <vault>/Reviews/Weekly/<date> Weekly Review.md
#      is created (with frontmatter `kind: weekly`, `date`, plus three
#      sections "What was this review about?", "What did you learn?",
#      "Action items") and opens in the active pane.
#   6. Click the same wikilink again → existing file opens, no
#      overwrite. Type into "What did you learn?" → save → reload →
#      content survives.
#   7. Repeat for Monthly review. File lands at
#      <vault>/Reviews/Monthly/<date> Monthly Review.md.
#
# Pass N — Reviews appear in notification bell:
#   1. On Sunday (or fast-forward the system clock to Sunday), open
#      the bell. Both reviews appear with the urgent indicator.
#   2. Don't dismiss → bell still shows them on Monday (within
#      EVENT_LOOKBACK = 1 day).
#
# Pass O — Reviews modal toggle:
#   1. Click "Reviews" sidebar button.
#   2. Both checkboxes are ON.
#   3. Uncheck Weekly → Save → Weekly review event disappears from
#      calendar + bell. Monthly stays.
#   4. Re-open Reviews → check Weekly → Save → Weekly returns.
#
# Pass P — Recurrence expander honors BYDAY=1SU:
#   1. With Monthly review enabled, navigate the calendar to next month.
#   2. Confirm an instance appears on the FIRST Sunday of that month.
#   3. Skip ahead 6 months — first Sunday of each month has an instance.
#   4. Pre-Cluster-24 monthly events (with BYMONTHDAY) still expand
#      correctly (regression check).
#
# Pass Q — Auto-init guard:
#   1. Delete the Weekly review event manually via the calendar's
#      right-click → Delete event.
#   2. Reload the app.
#   3. Calendar does NOT re-create the Weekly review (the localStorage
#      flag is still set).
#   4. Open Reviews → Weekly checkbox is UNchecked (matches actual state).
#   5. Re-check → Save → Weekly returns.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check (new crates: trash, regex)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check --quiet
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cluster 24 v1.0)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 24 v1.0 - QoL pack 2: file operations + review schedule. (A) Right-click context menu in the vault sidebar with create / rename / delete for both files and folders; OS-trash (recoverable, trash crate); inline rename with basename auto-selected and extension preserved; new file / new folder phantom rows that auto-expand the targeted folder; rename also rewrites [[wikilinks]] across the vault (case-insensitive target match, whitespace preserved); pane sync on rename / delete walks paneRefs and re-aims or closes affected panes. New Tauri commands create_file_in_folder, create_folder_in_folder, rename_path, trash_path with cortex24_validate_filename_segment / ensure_within_vault / purge_path_from_index / walk_for_indexable_files / rewrite_wikilinks_in_vault / rewrite_wikilinks_in_string helpers. (B) Recurring weekly + monthly all-day review events on the calendar with notify_mode='urgent' so the Cluster 15 bell keeps them visible all day. Stable IDs cortex-review-weekly / cortex-review-monthly with UPSERT semantics. New ensure_review_events / get_review_settings Tauri commands. Recurrence expander's MONTHLY arm extended to support positional BYDAY tokens (1SU, -1MO etc.) so the monthly review can land on the first Sunday of each month. New cortex24_parse_positional_byday + cortex24_nth_weekday_of_month helpers. Auto-init on first vault load creates both reviews with both flags ON; localStorage flag prevents re-create after manual delete. Reviews sidebar button next to Templates opens the toggle modal. New components FileTreeContextMenu, DeleteConfirmModal, ReviewSettingsModal. FileTree.tsx grows pendingEdit / onContextMenu / onCommitEdit props + an InlineEditInput component. App.tsx grows context-menu state, dispatchFileTreeAction, commitFileTreeEdit (with paneRef re-aim on rename), confirmDelete, and the auto-init useEffect. Cargo: trash = 5, regex = 1 (regex reserved for future)."

Write-Host "==> 4/4  tag cluster-24-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-24-v1.0-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-24-v1.0-complete --force'
