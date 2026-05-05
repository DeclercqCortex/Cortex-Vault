# verify-cluster-11-v1.7.ps1
# Phase 3 Cluster 11 v1.7 — per-instance title overrides + modal time editor.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev      # full restart (schema migration + 1 new Tauri cmd)
#   .\verify-cluster-11-v1.7.ps1
#
# What ships
# ----------
#
# Closes two pieces from the v1.3 / v1.6 backlog:
#
#  - Per-instance title override: rename one occurrence of a recurring
#    series via the modal's "Save just this" path (e.g. one Wednesday
#    standup becomes "Demo prep" while every other day stays "Standup").
#
#  - Modal time editor for instance mode: when the user changes the
#    start / end time inputs in the modal AND clicks "Save just this",
#    that single occurrence shifts (same backend path as the v1.6
#    drag). Was previously a no-op — the modal silently dropped time
#    edits in instance mode.
#
# Backend
# -------
#
# Schema migration (idempotent ALTER TABLE) adds one column to
# `event_instance_overrides`:
#   - title_override  TEXT  — NULL = inherit master.title; non-NULL =
#                              render this single occurrence with the
#                              override's title
#
# `InstanceOverride` Rust struct + `load_overrides_for_master` SELECT
# updated to include the new column. `expand_recurrence`'s
# push_instance closure renders an effective_title from the override
# row (when non-empty) and writes it to the expanded Event's title
# field — same shape as the existing time / actual override branches.
#
# `get_event_instance_override` SELECT also reads title_override so a
# future v1.8 modal can preview existing overrides if needed (not
# wired yet — the modal currently shows only the effective title via
# existingEvent.title, which already reflects any active override).
#
# New Tauri command `set_event_instance_title_override(vault_path,
# master_id, instance_start_unix, title_override)`:
#   - UPSERT touching only title_override + updated_at_unix
#   - Empty / whitespace-only input clears the column to NULL (so the
#     instance reverts to the master title)
#   - Refuses non-recurring masters
#   - Uses resolve_override_pk so it matches the existing row even if
#     the input is the v1.6 shifted start (a previously time-overridden
#     instance can still be renamed)
#
# Frontend
# --------
#
# EventEditModal:
#   - `onSaveInstanceOverride` arg shape grows three optional fields:
#     `titleOverride`, `startAtOverride`, `endAtOverride`. All three
#     are `undefined` by default, meaning "leave the column alone."
#   - `submitInstanceOverride(false)` (the "Save just this" handler)
#     now bundles the deltas:
#       - title differs from existingEvent.title         → titleOverride = trimmed input
#       - start / end differ from existingEvent.start_at / end_at
#                                                         → startAtOverride / endAtOverride
#     Compared against the DISPLAYED values (which already include any
#     active override), so equivalent state is a no-op.
#   - `Save just this` button title text updated to reflect the broader
#     scope.
#
# Calendar.saveInstanceOverride:
#   - Branches on the new optional fields. Sequence per submit:
#       1. set_event_instance_override   (skip / actual_minutes — existing)
#       2. set_event_instance_title_override  (when titleOverride present)
#       3. set_event_instance_time_override   (when start+end present)
#   - All three commands resolve to the same row via resolve_override_pk,
#     so the row stays singular. Reload + regenerate-daily-note runs
#     once at the end.
#
# Composition rules
# -----------------
#
# A single override row can carry: skipped, actual_minutes,
# start_at_override, end_at_override, title_override. Setting one
# leaves the others untouched (the per-column UPSERTs are
# orthogonal). "Clear override" still wipes the entire row via
# delete_event_instance_override (no per-column clear UI in v1.7).
#
# Smoke tests
# -----------
#
# Pass A — Rename one occurrence:
#   1. Create a recurring weekly event "Standup" Mon–Fri 09:00–09:30.
#      Save series.
#   2. Click Wednesday's instance to open the modal.
#   3. Change the title input from "Standup" to "Demo prep".
#   4. Click "Save just this".
#   5. Wednesday's chip now reads "Demo prep". Mon / Tue / Thu / Fri
#      still read "Standup".
#   6. Switch to next week — every standup back to "Standup".
#
# Pass B — Type a time change in the modal:
#   1. Click Tuesday's standup. In the modal, change the start time
#      input from 09:00 to 10:00 and end from 09:30 to 10:30.
#   2. Click "Save just this".
#   3. Tuesday's instance now sits at 10:00–10:30. Mon / Wed / Thu / Fri
#      still at 09:00–09:30.
#
# Pass C — Title + time + actual-minutes on a single submit:
#   1. Click Thursday's standup. Change title to "Final review",
#      start to 14:00, end to 15:00, actual minutes to 55.
#   2. Click "Save just this".
#   3. Inspect the override (DB or get_event_instance_override):
#      one row exists with all three columns populated:
#        title_override="Final review",
#        start_at_override=Thursday 14:00 unix,
#        end_at_override=Thursday 15:00 unix,
#        actual_minutes=55.
#      No duplicate rows.
#
# Pass D — Renaming a previously time-shifted instance updates the
#          same row:
#   1. Drag Friday's standup from 09:00 to 11:00 (v1.6 drag-shift).
#   2. Click the shifted Friday instance (now at 11:00). Change the
#      title to "Outage retro".
#   3. Click "Save just this".
#   4. The row's title_override is "Outage retro"; start_at_override
#      is still 11:00 unix. resolve_override_pk matched by start_at_
#      override and updated the existing row instead of creating a
#      duplicate.
#
# Pass E — Clear-override wipes title + time + actual together:
#   1. After Pass C (Thursday has title + time + actual override),
#      click Thursday's instance. Click "Clear override (revert to
#      series default)".
#   2. Thursday returns to "Standup" 09:00–09:30 with no recorded
#      actual. The override row is gone.
#
# Pass F — Save just this with no deltas is a no-op:
#   1. Click any unmodified instance. Don't change anything in the
#      modal. Click "Save just this".
#   2. The row's existing skipped/actual stay as is; no title or time
#      overrides are written. (set_event_instance_override always runs
#      with skipped=false, actualMinutes=null — preserves the v1.3
#      semantic that "Save just this with no actual" clears the
#      actual override.)
#
# Pass G — Empty title is rejected:
#   1. Click any instance. Clear the title input completely.
#   2. Click "Save just this".
#   3. Modal shows "Title is required." error; no overrides written.
#
# Pass H — Bad time range is rejected:
#   1. Click any instance. Set end time before start time.
#   2. Click "Save just this".
#   3. Modal shows "End must be after start." error; no overrides
#      written. (Same validation the series-edit path uses.)
#
# Pass I — Series-edit path still works:
#   1. Click any instance. Change title to "Daily check-in" in the
#      modal.
#   2. Click "Save series" (NOT "Save just this").
#   3. Every standup in the visible week updates to "Daily check-in".
#      Pre-existing per-instance overrides on other instances stick
#      around (Pass A's Wednesday "Demo prep" still shows even after
#      the master title changes — the override layer is on top).
#
# Pass J — Non-recurring path unchanged:
#   1. Create a one-off event "Coffee chat" today, 14:00–15:00.
#   2. Click it. Edit title and time. Save.
#   3. Routes through the existing saveEdit path; events table updated
#      directly. No row in event_instance_overrides.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 3/4  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Cluster 11 v1.7 - per-instance title overrides + modal time editor for instance mode. Schema migration: event_instance_overrides gains title_override TEXT (idempotent ALTER TABLE). InstanceOverride Rust struct gains the field with serde default. expand_recurrence's push_instance computes effective_title from override.title_override (non-empty) else master.title — same branching shape as the v1.6 time override. New set_event_instance_title_override Tauri command (UPSERT touching only title_override + updated_at_unix; empty/whitespace input clears to NULL; refuses non-recurring masters; uses resolve_override_pk so renames on previously-shifted instances target the existing row). get_event_instance_override SELECT updated to read the new column. Frontend EventEditModal: onSaveInstanceOverride args grow titleOverride / startAtOverride / endAtOverride optional fields. submitInstanceOverride(false) now bundles deltas — title differs from existingEvent.title -> titleOverride; start/end differ from existingEvent.start_at/end_at -> time override. Validation: empty title rejected, end<=start rejected. Calendar.saveInstanceOverride dispatches in sequence: set_event_instance_override (existing skip/actual), set_event_instance_title_override (when titleOverride present), set_event_instance_time_override (when start+end present). All three commands resolve to the same row via resolve_override_pk so the row stays singular. Reload + regenerateTodaysDailyNote runs once at the end. Save just this button title text updated to reflect broader scope. Closes the v1.3 backlog item ('per-instance title overrides') and the v1.6 backlog item ('modal time editor for instance mode'). 10 smoke passes covering rename one occurrence, modal-typed time change, title+time+actual on single submit, rename a time-shifted instance updates same row, clear override wipes everything, no-deltas is no-op, empty title rejected, bad time range rejected, series-edit still works (with per-instance overrides surviving), non-recurring path unchanged."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-11-v1.7-complete" -ForegroundColor Cyan
git tag -f cluster-11-v1.7-complete

Write-Host ""
Write-Host "Done. Cluster 11 v1.7 shipped:" -ForegroundColor Green
Write-Host "  - Per-instance title overrides via modal Save just this" -ForegroundColor Green
Write-Host "  - Modal time editor for instance mode (typed time change)" -ForegroundColor Green
Write-Host "  - Bundled dispatch: skip/actual + title + time on a single submit" -ForegroundColor Green
Write-Host "  - All overrides compose on a single row via resolve_override_pk" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.8+):" -ForegroundColor DarkGray
Write-Host "  - Per-instance category / status / body overrides" -ForegroundColor DarkGray
Write-Host "  - Modal preview of which fields are currently overridden" -ForegroundColor DarkGray
Write-Host "  - Per-column clear (revert just title, just time, etc.)" -ForegroundColor DarkGray
