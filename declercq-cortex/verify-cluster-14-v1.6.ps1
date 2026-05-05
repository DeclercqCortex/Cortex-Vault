# verify-cluster-14-v1.6.ps1
# Phase 3 Cluster 14 v1.6 — per-instance time overrides via drag.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (schema migration + 1 new Tauri cmd)
#   .\verify-cluster-14-v1.6.ps1
#
# What ships
# ----------
#
# Closes the v1.3 backlog item: dragging a single occurrence of a
# recurring event now shifts ONLY that occurrence rather than the
# whole series. Previously (v1.6 of Cluster 11), drag-on-recurring
# routed through `update_event` on the master, shifting every
# occurrence — surprising behaviour for users who only meant to nudge
# one standup.
#
# Backend
# -------
#
# Schema migration (idempotent ALTER TABLE) adds two nullable columns
# to `event_instance_overrides`:
#   - start_at_override  INTEGER  — UTC unix seconds; the instance's
#                                    new start time
#   - end_at_override    INTEGER  — UTC unix seconds; the instance's
#                                    new end time
#
# Both must be Some for the override to apply (a half-set state is
# treated as "no time override" and falls back to the master-computed
# times — defensive for partial writes).
#
# `InstanceOverride` Rust struct gains the two fields; serde defaults
# to None for legacy rows.
#
# `expand_recurrence`'s push_instance closure applies the time
# override AFTER the skipped check and BEFORE the window filter:
#   let (effective_start, effective_end) = match override.start/end {
#       (Some(s), Some(e)) if e > s => (s, e),
#       _ => (computed_start, computed_start + duration),
#   };
# The window check uses the EFFECTIVE times, so a drag can move an
# occurrence into or out of the visible range and the calendar
# updates accordingly.
#
# New helper `resolve_override_pk(conn, master_id, instance_start_unix)`:
#   - if a row exists where start_at_override === input → return that
#     row's PK (the original computed start)
#   - else → return the input (it IS the original computed start)
# Used by every override-mutation surface (set / delete / get / time-
# set) so the modal "Save just this" path and a re-drag commit stay
# coherent against the same row.
#
# New Tauri command `set_event_instance_time_override(vault_path,
# master_id, instance_start_unix, start_at, end_at)`. UPSERT touching
# only start_at_override + end_at_override + updated_at_unix; existing
# skipped / actual_minutes values survive.
#
# Existing commands (`set_event_instance_override`,
# `delete_event_instance_override`, `get_event_instance_override`)
# now use resolve_override_pk to handle both fresh inputs and
# previously-shifted starts.
#
# `get_event_instance_override` SELECT updated to read the two new
# columns so the modal can populate UI for them in v1.7+.
#
# Frontend
# --------
#
# Calendar.tsx's `onEventReposition` callback (passed into WeekView)
# now branches on `ev.recurrence_rule`:
#   - non-recurring → existing saveEdit path (whole-event update via
#     update_event; preserves all unchanged fields).
#   - recurring     → `set_event_instance_time_override` with the
#     event's CURRENT start_at as instance_start_unix. The backend
#     resolves to the right PK whether this is a first drag or a
#     re-drag of an already-shifted instance.
# Both paths trigger reload() + regenerateTodaysDailyNote().
#
# Smoke tests
# -----------
#
# Pass A — Drag a recurring instance once shifts only that occurrence:
#   1. Create a recurring weekly event (e.g. "Standup", every weekday
#      09:00–09:30). Save series.
#   2. In WeekView, drag Wednesday's instance from 09:00 to 11:00.
#   3. Wednesday's instance now shows at 11:00. Monday / Tuesday /
#      Thursday / Friday standups remain at 09:00.
#   4. Switch to next week — every standup back at 09:00.
#
# Pass B — Re-drag an already-shifted instance updates the same row:
#   1. After Pass A, drag the same Wednesday instance from 11:00 to
#      14:00.
#   2. Wednesday now shows at 14:00. Other days unchanged.
#   3. Inspect the SQLite DB (or the get_event_instance_overrides
#      result):
#          SELECT * FROM event_instance_overrides;
#      Exactly ONE row exists for this Wednesday — instance_start_unix
#      is still the original 09:00 unix; start_at_override is 14:00.
#      No duplicate rows.
#
# Pass C — Drag-resize a recurring instance (resize-bottom):
#   1. Drag the bottom edge of Wednesday's 14:00 instance down to
#      15:00.
#   2. Wednesday now shows 14:00–15:00 (a 1-hour event for that
#      occurrence; the rest of the week is still 30 min).
#   3. The override row's end_at_override updated; start_at_override
#      unchanged.
#
# Pass D — Non-recurring drag still routes through saveEdit:
#   1. Create a one-off event "Coffee chat" today, 14:00–15:00.
#   2. Drag-move it to 16:00. Release.
#   3. The event commits via update_event (non-recurring path); the
#      events table has the new times directly. No row in
#      event_instance_overrides.
#
# Pass E — Drag preserves an existing skip override:
#   1. Open Wednesday's instance (the v1.3 modal). Skip this
#      occurrence. Save just this. (Wednesday disappears.)
#   2. Reload. Wednesday is gone.
#   3. Now via DB / dev console, manually delete the skipped state
#      (`UPDATE event_instance_overrides SET skipped = 0 WHERE ...`)
#      so the instance reappears, but keep start_at_override / end_at_
#      override / actual_minutes intact.
#   4. Confirm Wednesday is back at 14:00–15:00 (the time override
#      from earlier stuck around).
#
# Pass F — Drag preserves an existing actual_minutes override:
#   1. Create a recurring weekly event, drag one instance to a new
#      time (Pass A path).
#   2. Open the shifted instance, the v1.3 modal: type 25 in the
#      Actual minutes field. Save just this.
#   3. Drag the same instance to yet another time. Release.
#   4. Open Time tracking view; the actual minutes for that one
#      instance is still 25 (drag didn't clobber it). The instance's
#      time reflects the latest drag.
#
# Pass G — Modal "Save just this" on a shifted instance updates the
#          right row:
#   1. After Pass A, click the shifted Wednesday instance to open the
#      v1.3 modal. Type 22 in Actual minutes. Save just this.
#   2. Inspect event_instance_overrides — still exactly one row for
#      this Wednesday. actual_minutes = 22; start_at_override is the
#      shifted 14:00 unix; end_at_override is the shifted end.
#      `resolve_override_pk` matched start_at_override and updated
#      the existing row instead of creating a duplicate.
#
# Pass H — Daily-note splice picks up the new time:
#   1. After dragging a recurring instance from yesterday, open
#      today's daily note (Ctrl+D).
#   2. The "## Yesterday's time" auto-section reflects the SHIFTED
#      time for that one instance, not the master-computed start.
#
# Pass I — Drag a recurring all-day event still renders all-day:
#   1. Create a recurring weekly all-day event ("Travel day", every
#      Friday). Drag it to Saturday in WeekView's all-day row.
#   2. Friday's all-day cell empties; Saturday's gains the chip.
#      (v1.6 lets you shift an all-day instance across days; the
#      override carries the new day-start as start_at_override.)
#   NOTE: drag-resize on the all-day row is NOT in scope for v1.6
#   (the all-day row's chip layout doesn't expose resize handles).
#   Drag-MOVE between cells via the existing all-day chip click +
#   modal still works for that case.
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
    git commit -m "Cluster 14 v1.6 - per-instance time overrides via drag. Schema migration: event_instance_overrides gains start_at_override and end_at_override INTEGER columns (idempotent ALTER TABLE). InstanceOverride Rust struct gains the two fields with serde defaults. expand_recurrence's push_instance closure applies the time override after the skipped check and before the window filter — when both columns are Some and end > start, render the instance at the user-chosen times; else fall back to the master-computed times (half-set rows are defensive no-ops). Window filter uses effective times so a drag can move an occurrence into / out of the visible range. New resolve_override_pk(conn, master_id, instance_start_unix) helper looks up an existing row whose start_at_override matches the input and returns that row's PK (the original computed start); else returns the input as the PK. Used by every override-mutation command so a re-drag of a previously-shifted instance updates the same row, and the modal Save-just-this path doesn't create a duplicate. New set_event_instance_time_override(vault, master_id, instance_start_unix, start_at, end_at) Tauri command — UPSERT touching only the time columns; refuses non-recurring masters and bad time ranges. Existing set_event_instance_override / delete_event_instance_override / get_event_instance_override updated to use resolve_override_pk and read/write the two new columns. Frontend: Calendar.tsx onEventReposition branches on ev.recurrence_rule — non-recurring routes through saveEdit (existing path); recurring routes through set_event_instance_time_override with master_id=ev.id and instance_start_unix=ev.start_at (current effective start; backend resolves to PK). Both paths reload + regenerateTodaysDailyNote. Closes the v1.3 backlog item ('title/time overrides on a single instance'). 9 smoke passes covering single-instance drag, re-drag updates same row, drag-resize, non-recurring path unchanged, skip+time-override compose, actual_minutes+time-override compose, modal-on-shifted-instance updates same row, daily-note splice picks up shifted time, all-day cross-day drag."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-14-v1.6-complete" -ForegroundColor Cyan
git tag -f cluster-14-v1.6-complete

Write-Host ""
Write-Host "Done. Cluster 14 v1.6 shipped:" -ForegroundColor Green
Write-Host "  - Drag a recurring instance shifts ONLY that occurrence" -ForegroundColor Green
Write-Host "  - start_at_override + end_at_override columns + push_instance branch" -ForegroundColor Green
Write-Host "  - resolve_override_pk helper unifies all override mutations" -ForegroundColor Green
Write-Host "  - set_event_instance_time_override Tauri command" -ForegroundColor Green
Write-Host "  - Skip / actual_minutes / time overrides compose on the same row" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.7+):" -ForegroundColor DarkGray
Write-Host "  - Per-instance title overrides (rename one occurrence)" -ForegroundColor DarkGray
Write-Host "  - Modal time editor for instance mode (type new times instead of drag)" -ForegroundColor DarkGray
Write-Host "  - Configurable splice window for the daily note" -ForegroundColor DarkGray
