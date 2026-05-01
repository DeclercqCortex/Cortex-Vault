# verify-cluster-14.ps1
# Phase 3 Cluster 14 v1.0 — Time tracking / planned-vs-actual analytics.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new schema column + Tauri command)
#   .\verify-cluster-14.ps1
#
# What ships
# ----------
#
#   1. Schema migration (idempotent ALTER): events.actual_minutes
#      INTEGER, nullable. NULL = no actual recorded yet.
#
#   2. Event struct gains `actual_minutes: Option<i64>`. create_event
#      and update_event accept the new field; both clean it
#      (rejects negatives → None). collect_events_in_window selects
#      and maps it. Calendar.tsx invokes pass actualMinutes through.
#
#   3. EventEditModal grows an "Actual minutes" numeric input below
#      Notes. Empty input → null on disk. Loads from existing event;
#      defaults to "" for new events.
#
#   4. New Tauri command `get_time_tracking_aggregates(vault_path,
#      range_start_unix, range_end_unix)` returning per-category
#      rows: planned_minutes_total (computed from end_at - start_at
#      / 60), actual_minutes_total (SUM of actual_minutes),
#      events_count, events_with_actual_count. Recurring events
#      excluded (no per-instance actual storage in v1.0).
#
#   5. New TimeTracking.tsx structured view. Date range presets
#      (7d / 30d / 90d / All). Overall card showing totals + ratio.
#      Per-category table with ratio colour-cued: green if <0.9×
#      (came in under), red if >1.2× (significantly over), text
#      colour otherwise. Counts in parentheses are events that
#      actually have an actual_minutes recorded.
#
#   6. Sidebar "⏱ Time" button (next to Cal). Sets the active
#      slot's view to "time-tracking". TabPane renders the view
#      via the new ActiveView union member.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Schema migration runs cleanly:
#   1. Open Cortex with a vault that already has events from before
#      this cluster shipped. The ALTER TABLE in open_or_init_db is
#      idempotent: existing rows get NULL for actual_minutes; new
#      events default to NULL until the user fills the field in.
#   2. Open the Calendar. Existing events render normally — no data
#      loss, no errors in the console.
#
# Pass B — Record an actual:
#   1. Open the Calendar. Click an existing event (or create a new
#      one). The EventEditModal opens.
#   2. Below Notes, see the "Actual minutes" field with hint
#      "(post-hoc — how long it really took)".
#   3. Type 90. Save. Reopen the same event — the field still shows
#      90.
#   4. Clear the field (empty input). Save. Reopen — field is empty
#      again. The on-disk actual_minutes is back to NULL.
#
# Pass C — Open the Time tracking view:
#   1. Click the "⏱ Time" sidebar button.
#   2. The view opens in the active slot. Header reads "Time
#      tracking" + a hint about filling in "Actual minutes".
#   3. Date range buttons: Last 7 / 30 / 90 / All time. 30 days is
#      selected by default.
#
# Pass D — Per-category aggregates render:
#   1. Have at least 3 events across 2-3 categories within the last
#      30 days. Fill in actual_minutes on at least one of them.
#   2. The view shows an overall card (Planned / Actual / Ratio /
#      Events) and a per-category table.
#   3. Categories without any actuals show "—" for actual / ratio.
#   4. Categories with actuals show the ratio colour-cued. A
#      heavily-overrun category (actual > 1.2× planned) renders
#      red; a well-underrun category (actual < 0.9× planned)
#      renders green.
#
# Pass E — Date range filter:
#   1. Set range to Last 7 days. Aggregates recompute against the
#      smaller window. Empty state shows when there are no events
#      in the past 7 days.
#   2. Set to All time. Every event in the events table participates.
#
# Pass F — Recurring events are excluded (v1.0 known scope):
#   1. Create a recurring event (e.g., daily standup). Don't fill in
#      actual_minutes (you can't — there's no per-instance row in v1).
#   2. The recurring event does NOT appear in the Time tracking
#      aggregates. Documented limitation.
#
# Pass G — Refresh on save:
#   1. With Time tracking open, edit an existing event in another
#      slot (or close + reopen the modal in the same slot) and change
#      its actual_minutes.
#   2. The Time tracking view updates on the next refreshKey bump
#      (which fires from indexVersion via App.bumpIndex). If the bump
#      doesn't trigger automatically, switching range presets
#      forces a re-fetch.
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
    git commit -m "Cluster 14 v1.0 - Time tracking / planned-vs-actual analytics. Schema: events table gains actual_minutes INTEGER (nullable). NULL = no actual recorded; non-null = how long the event actually took, post-hoc, in minutes. Idempotent ALTER TABLE migration in open_or_init_db. Event struct gains actual_minutes: Option<i64>. create_event + update_event Tauri commands accept the new field, clean it (rejects negatives -> None). collect_events_in_window's two SELECTs include actual_minutes in the column list and row mapping; both standalone-events and recurring-master rows now carry the field. Calendar.tsx saveEdit + invoke('create_event') / invoke('update_event') pass actualMinutes through. EventEditModal: new state [actualMinutes, setActualMinutes] (string for empty/loaded numeric coercion), loads from existingEvent.actual_minutes, resets to '' on new event, serializes empty -> null on submit, parses non-empty as parseInt with negativity guard. New numeric input rendered below Notes with hint '(post-hoc - how long it really took)'. Disabled when isReadOnly (Google-synced events). New get_time_tracking_aggregates(vault_path, range_start_unix, range_end_unix) Tauri command returns Vec<TimeTrackingRow> { category, planned_minutes_total, actual_minutes_total, events_count, events_with_actual_count }. SQL: GROUP BY COALESCE(category, 'uncategorized'), planned = SUM(MAX(0, (end_at - start_at) / 60)), actual = SUM(actual_minutes), filtered by start_at >= range_start AND start_at < range_end. Recurring events (recurrence_rule IS NOT NULL) excluded — no per-instance actual storage in v1. New TimeTracking.tsx structured view (~440 lines): date range presets (7d/30d/90d/All), overall card with Planned/Actual/Ratio/Events totals, per-category table with cell-type-aware ratio colour cue (green if <0.9x came in under estimate, red if >1.2x significantly over, text colour 0.9-1.2x on track), counts in parentheses showing events with actuals. Empty state for no events in window. New 'time-tracking' ActiveView union member in TabPane.tsx; render branch invokes <TimeTracking vaultPath refreshKey={indexVersion} onClose={closeStructuredView} />. Sidebar button '⏱ Time' added in App.tsx next to Cal, calls paneRefs.current[activeSlotIdx]?.setActiveView('time-tracking'). Composes naturally with the rest of the calendar stack: events flow through the same create/update path users already know; analytics emerge from data they're already capturing once they fill in actuals."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-14-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-14-v1.0-complete

Write-Host ""
Write-Host "Done. Cluster 14 v1.0 (planned-vs-actual time tracking) shipped:" -ForegroundColor Green
Write-Host "  - events.actual_minutes nullable column, idempotent migration" -ForegroundColor Green
Write-Host "  - 'Actual minutes' field in EventEditModal under Notes" -ForegroundColor Green
Write-Host "  - get_time_tracking_aggregates Tauri command (per-category)" -ForegroundColor Green
Write-Host "  - TimeTracking view: overall card + per-category table" -ForegroundColor Green
Write-Host "    Ratio colour-cued (<0.9x green, >1.2x red, else neutral)" -ForegroundColor Green
Write-Host "  - Date range presets: 7d / 30d / 90d / All" -ForegroundColor Green
Write-Host "  - Sidebar '⏱ Time' button" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.1+):" -ForegroundColor DarkGray
Write-Host "  - Per-instance actuals on recurring events (currently excluded)" -ForegroundColor DarkGray
Write-Host "  - Per-day rollup view (granularity question — defer until trigger)" -ForegroundColor DarkGray
Write-Host "  - Trends over time / sparklines" -ForegroundColor DarkGray
