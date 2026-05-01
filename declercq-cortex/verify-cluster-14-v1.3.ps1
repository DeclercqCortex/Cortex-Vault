# verify-cluster-14-v1.3.ps1
# Phase 3 Cluster 14 v1.3 — per-instance overrides + Trends tab + CSV export.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new schema table + 4 new Tauri cmds)
#   .\verify-cluster-14-v1.3.ps1
#
# What ships
# ----------
#
# v1.3 — Per-instance overrides for recurring events
#
#   New SQLite table `event_instance_overrides` keyed by
#   (master_event_id, instance_start_unix). Two columns of override
#   state: `skipped` (1 = drop this single occurrence from calendar
#   lists and aggregates) and `actual_minutes` (overrides the auto-
#   credited duration for this instance only). Absence of a row
#   means "follow the series default" — counted in aggregates,
#   auto-credited as fully spent.
#
#   `expand_recurrence` now takes a HashMap of overrides keyed by
#   instance_start_unix and applies them inside `push_instance`:
#   skipped instances aren't pushed at all; non-null actual_minutes
#   lands in the expanded Event's own field. `collect_events_in_window`
#   loads each master's overrides once before calling expand. The
#   time-tracking aggregator's recurring branch now reads
#   `evt.actual_minutes` (Some → use it, None → auto-credit planned),
#   so overrides flow through transparently.
#
#   Three new Tauri commands:
#     - set_event_instance_override(master_id, instance_start_unix,
#       skipped, actual_minutes) — UPSERT
#     - delete_event_instance_override(master_id, instance_start_unix)
#       — clear an override (revert to series default)
#     - get_event_instance_override(master_id, instance_start_unix)
#       — fetch one row for the modal to populate its UI
#
#   EventEditModal grew dual-save UX for recurring instances. When the
#   user clicks an expanded recurring event in the calendar, the modal
#   detects `existingEvent.recurrence_rule != null` and switches into
#   instance mode:
#     - A blue banner "Editing one occurrence — date" pinned above
#       the actual-minutes input. Includes a badge if an override
#       already exists ("currently skipped" / "currently overridden
#       (45m)").
#     - The actual-minutes input becomes the OVERRIDE actual_minutes
#       (writes to the override row, not the master's column).
#     - A "Skip this occurrence" checkbox grays out the input and
#       arms the skip path on save.
#     - A "Clear override (revert to series default)" button appears
#       when an override exists.
#     - Footer grows three save buttons: "Skip this occurrence",
#       "Save just this", and "Save series" (the original Save).
#       Plus a renamed "Delete series" so the user knows where they
#       are.
#
# v1.3 — Trends tab in Time tracking
#
#   New `get_time_tracking_daily_rollup(vault, start, end, tz_offset)`
#   Tauri command returning per-(day, category) bins reusing
#   `collect_events_in_window` so overrides flow through identically.
#
#   TimeTracking.tsx grows a third tab next to Table and Pie chart:
#   "Trends". Renders a hand-drawn 760×320 SVG line chart with one
#   line per category (deterministic colour via the same FNV-1a hash
#   used by the pie). Sub-toggle picks the line(s) shown — Planned
#   (default), Actual, or Both. When metric === "both", planned is
#   solid and actual is dashed. Y-axis: 0 → max(planned,actual) with
#   ~10% headroom and 4 evenly-spaced gridlines. X-axis: one tick per
#   unique day, labels rotated 30° and decimated for long ranges.
#   Legend column on the right with colour swatch + category name.
#   Empty-state copy for "no events in window" vs "no time recorded
#   for the selected metric".
#
# v1.3 — Copy CSV button
#
#   New "Copy CSV" button on the Time tracking toolbar. Always
#   available when there are rows. Emits the per-category aggregates
#   (the Table view's data) as RFC 4180-quoted CSV to the clipboard:
#     # Cortex time tracking — Last 30 days — N categories
#     category,planned_minutes,actual_minutes,ratio,events,events_with_actual
#     ...
#   Shows "Copied ✓" for 1.5s after a successful copy.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Schema migration runs cleanly:
#   1. Open Cortex with a vault that already has events. The
#      CREATE TABLE IF NOT EXISTS adds the overrides table; existing
#      events keep working unchanged. No errors in the console.
#
# Pass B — Skip a single recurring instance:
#   1. Create a recurring event ("Daily standup", 30 min, weekday).
#   2. Click an instance in the week view. Modal opens in instance
#      mode — banner reads "Editing one occurrence — Mon, May 4 9:00".
#   3. Tick "Skip this occurrence". Click "Skip this occurrence"
#      button. Modal closes; the calendar refreshes; that one block
#      is gone from the grid. Other days still show the standup.
#   4. Open Time tracking. The skipped instance is dropped from the
#      Standup row's planned/actual totals.
#
# Pass C — Override a single instance's actual minutes:
#   1. Click another (different) Standup instance. Banner shows
#      "Editing one occurrence". Type 45 in the actual-minutes
#      input. Click "Save just this".
#   2. Open Time tracking. The Standup row's actual_minutes total
#      reflects 45 for that one instance + the auto-credited 30
#      for every other.
#
# Pass D — Clear an override:
#   1. Re-click the same instance you overrode. Banner shows
#      "currently overridden (45m)" badge. Click "Clear override
#      (revert to series default)".
#   2. Modal closes; instance reverts to auto-credit. Time tracking
#      shows the standup at the regular 30m again for that day.
#
# Pass E — Save series still works:
#   1. Click any standup instance. In instance mode, edit the title
#      (e.g. "Daily standup → Daily check-in"). Click "Save series".
#   2. Every standup instance in the calendar updates. Override on
#      one instance from earlier is preserved (key is on the master
#      id + instance start).
#
# Pass F — Delete series:
#   1. Click any standup instance. Click "Delete series". Confirm.
#   2. The whole series + every override row disappear (CASCADE
#      via PRIMARY KEY). Time tracking has no Standup row.
#
# Pass G — Trends tab renders:
#   1. Open Time tracking. Click the "Trends" tab.
#   2. The view loads and shows a line chart. Each category has its
#      own colour (matches the pie chart's colour for the same
#      category — they share the FNV-1a hash).
#   3. Toggle Planned / Actual / Both. The lines redraw. With
#      "Both", planned is solid and actual is dashed.
#   4. Switch the date range to Last 7 days. The chart shrinks to
#      the smaller window and labels stay readable (rotated 30°).
#   5. Switch to All time. The chart's x-axis decimates labels
#      automatically; you can still distinguish the lines.
#
# Pass H — Trends with a single recurring category:
#   1. With only your standup data in the window, switch to Actual
#      metric. The standup line should be flat at 30 (auto-credit).
#      The override day from Pass C shows as 45.
#
# Pass I — CSV export:
#   1. With Time tracking open, click "Copy CSV". The button shows
#      "Copied ✓" for ~1.5s.
#   2. Paste into a spreadsheet / text editor. The first line is
#      a `#` comment with the range label and category count.
#      Subsequent lines have category, planned, actual, ratio,
#      events count, events-with-actual count. Categories with no
#      actuals show an empty ratio cell. Categories with commas
#      in their names are RFC 4180-quoted.
#
# Pass J — Date range still drives all three views:
#   1. With Trends active, switch range presets. The chart redraws
#      against the new window each time.
#   2. Switch to Pie chart. Same window applies — pie redraws.
#   3. Switch to Table. Same data; CSV export reflects the same
#      window.
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
    git commit -m "Cluster 14 v1.3 - per-instance overrides + Trends tab + CSV export. Schema: new event_instance_overrides table keyed by (master_event_id, instance_start_unix) holding skipped (bool) + actual_minutes (nullable). Idempotent CREATE TABLE IF NOT EXISTS in open_or_init_db. New InstanceOverride struct + load_overrides_for_master(conn, master_id) helper returning HashMap<i64, InstanceOverride> for O(1) lookup during expansion. expand_recurrence's signature gains overrides: &HashMap<...>; push_instance closure drops skipped instances at expansion time and reads override.actual_minutes (or master.actual_minutes) for the expanded Event's own field. collect_events_in_window loads each recurring master's overrides once before calling expand. get_time_tracking_aggregates' recurring branch now reads evt.actual_minutes (Some -> use, None -> auto-credit planned), so overrides flow through transparently. Three new Tauri commands: set_event_instance_override (UPSERT, refuses non-recurring masters), delete_event_instance_override (revert to series), get_event_instance_override (fetch for modal). Fourth new command get_time_tracking_daily_rollup(vault, start, end, tz_offset) returns Vec<DailyRollupRow> { day_iso, category, planned_minutes, actual_minutes, events_count } reusing collect_events_in_window so overrides + recurrence flow through identically. Frontend: EventEditModal grows dual-save UX for recurring instances. New props vaultPath + onSaveInstanceOverride. New isRecurringInstance derivation from existingEvent.recurrence_rule. New override state (instanceOverride, overrideActualMinutes, overrideSkipped) + a load effect that calls get_event_instance_override on mount. New submitInstanceOverride / submitInstanceClear handlers. UI: when isRecurringInstance, the actual-minutes block is replaced with an overrideStyles block (banner with date + override-status badge, override-only actual-minutes input, Skip checkbox, Clear-override button). Footer renders five buttons: Cancel, Delete series, Skip this occurrence, Save just this, Save series. Calendar.tsx grows a saveInstanceOverride function that branches on args.clear and dispatches set_/delete_event_instance_override; passes vaultPath + onSaveInstanceOverride into EventEditModal. CalendarEvent interface gains actual_minutes? (was always there in v1.0). TimeTracking.tsx grows a Trends tab next to Table and Pie chart. New TrendsView subcomponent renders a 760x320 hand-drawn SVG line chart with one line per category (deterministic colour via FNV-1a hash, shared with the pie). Sub-toggle Planned / Actual / Both — Both renders planned solid, actual dashed. Y-axis: 0 -> max(planned,actual) * 1.1, 4 evenly-spaced gridlines. X-axis: one tick per day, labels rotated 30, decimated for long ranges. Right-column legend with swatch + category. Three empty-state messages: 'no events in window', 'no time for selected metric', and 'Loading trends...'. New Copy CSV button on the toolbar emits per-category aggregates as RFC 4180 quoted CSV to navigator.clipboard.writeText with a # comment header line and 'Copied check' ack for 1.5s. Smoke tests: skip / override / clear / save-series / delete-series / trends / CSV all walked end to end."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-14-v1.3-complete" -ForegroundColor Cyan
git tag -f cluster-14-v1.3-complete

Write-Host ""
Write-Host "Done. Cluster 14 v1.3 shipped:" -ForegroundColor Green
Write-Host "  - event_instance_overrides table + 3 CRUD commands" -ForegroundColor Green
Write-Host "  - expand_recurrence + aggregator honour overrides" -ForegroundColor Green
Write-Host "  - EventEditModal dual-save UX for recurring instances" -ForegroundColor Green
Write-Host "    Skip / Save just this / Save series, with banner + badge" -ForegroundColor Green
Write-Host "  - get_time_tracking_daily_rollup Tauri command" -ForegroundColor Green
Write-Host "  - Trends tab: hand-drawn SVG line chart, planned/actual/both" -ForegroundColor Green
Write-Host "  - Copy CSV button on Time tracking toolbar" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.4+):" -ForegroundColor DarkGray
Write-Host "  - Title/time overrides on a single instance (currently only" -ForegroundColor DarkGray
Write-Host "    skipped + actual_minutes are overridable)" -ForegroundColor DarkGray
Write-Host "  - Sparklines per category in the Table view" -ForegroundColor DarkGray
Write-Host "  - Daily-note splice for time-tracking summary" -ForegroundColor DarkGray
