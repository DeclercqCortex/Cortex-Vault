# verify-cluster-14-v1.4.ps1
# Phase 3 Cluster 14 v1.4 — sparklines per category + daily-note splice.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (1 new Tauri cmd)
#   .\verify-cluster-14-v1.4.ps1
#
# What ships
# ----------
#
# v1.4 — Per-category trend sparklines
#
#   New "Trend" column added to the Time tracking Table view, after
#   the Events column. Each row renders an inline 80x24 SVG polyline
#   of that category's daily actual_minutes across the selected
#   window. Colour comes from categoryColour() so the sparkline
#   matches the pie chart and Trends tab line for the same category.
#
#   Implementation reuses the existing get_time_tracking_daily_rollup
#   Tauri command from v1.3 — no new query. The fetch effect's gate
#   widens from "viewMode === 'trends'" to also include
#   "viewMode === 'table'". Pie view still skips the daily-bin cost.
#
#   Densification: the Sparkline component fills missing days with
#   zero so a "no events on Wednesday" reads as a flat line dipping
#   to zero rather than the polyline skipping to the next data day
#   and visually compressing gaps. For the All-time preset the
#   densified range is clamped to the actual data span so a category
#   with three rows doesn't render 36500 zero days.
#
#   Edge cases:
#     - trendsRows is null (data hasn't arrived yet) → empty
#       80x24 placeholder. Table layout stays stable when the
#       sparklines populate a tick later.
#     - series is empty after filter (category has zero rows in the
#       window) → muted em-dash placeholder.
#     - series.length === 1 → a single 2px dot at the centre of the
#       SVG (a 1-point polyline doesn't draw).
#     - max value is 0 → divide-by-zero guarded; line sits at the
#       baseline.
#
# v1.4 — Daily-note splice for time tracking
#
#   New `regenerate_time_tracking_section(vault_path, file_path,
#   tz_offset_minutes)` Tauri command. Mirrors the Cluster 11
#   calendar splice and Cluster 10 GitHub splice patterns:
#
#     - Basename gate: only writes when the target file matches
#       today's local-day basename (YYYY-MM-DD.md). Past daily
#       notes are no-ops by design.
#     - Window: yesterday's local-day [00:00, 24:00) expressed in
#       UTC seconds via the same tz-offset arithmetic
#       regenerate_calendar_section uses.
#     - Aggregation: factored into a helper
#       `aggregate_time_tracking_in_window` so the command shares
#       all the recurring auto-credit + override semantics with
#       get_time_tracking_aggregates. Same code path; small
#       duplication.
#     - Markers: <!-- TIMETRACK-AUTO-START — derived from
#       yesterday's calendar events; do not edit -->
#       and <!-- TIMETRACK-AUTO-END --> bracket a markdown table.
#     - Heading-fallback insertion: if no markers exist but a
#       "## Yesterday's time" heading does, slot under it
#       (replacing prior content up to the next H2). Otherwise
#       append at end of file with a fresh heading + markers.
#     - Idempotent: only writes when the rendered content differs
#       from disk. index_single_file is invoked after a write.
#
#   Body shape: a 5-column markdown table (Category / Planned /
#   Actual / Ratio / Events) with a bolded **Total** row at the
#   bottom. Planned/Actual use a compact "Xh Ym" / "Xm" / "0m"
#   formatter that mirrors TimeTracking.tsx's formatMinutes. Ratio
#   is `actual / planned` to 2 decimals; em-dash when undefined
#   (planned == 0 or no actuals recorded). Empty rows render
#   "_(no events recorded yesterday)_" instead of an empty table.
#
#   Wired into App.tsx's selectFileInSlot daily-log path, after
#   regenerate_calendar_section, with the same tzOffsetMinutes
#   passed through. Failures log a warning but don't block the
#   file open.
#
# Smoke tests
# -----------
#
# Pass A — Sparklines populate in the table view:
#   1. Open the Cortex app. Sidebar → "⏱ Time" to open Time tracking.
#   2. Make sure you're on the Table tab and the range is "Last 30 days"
#      (default). The category rows render with the new "Trend" column
#      at the right.
#   3. After ~100ms (when get_time_tracking_daily_rollup returns)
#      the cells fill with small coloured polylines, one per row.
#      Each line's colour matches the category's pie slice / Trends
#      line.
#
# Pass B — Sparkline range presets:
#   1. Switch range to "Last 7 days". Sparklines redraw against the
#      smaller window. Each polyline now has 7 points (or 1 dot if
#      the category has data on only one day).
#   2. Switch to "Last 90 days". Polylines redraw with denser data.
#   3. Switch to "All time". Sparklines clamp to the actual data
#      range — no thousand-day flat lines.
#
# Pass C — Sparkline empty / missing states:
#   1. Add a brand-new category with no events. (Or remove all
#      events from one.) That row's Trend cell shows a muted em-dash.
#   2. While daily-rollup is still loading (Pass A first 100ms),
#      cells render empty 80x24 placeholders rather than re-flowing
#      the table.
#
# Pass D — Sparkline single-point edge case:
#   1. Find a category with exactly one event in the window (or
#      narrow the range until that's true). Its Trend cell shows a
#      single small dot at the centre rather than an invisible 1-
#      point polyline.
#
# Pass E — Pie still works (no v1.4 regression):
#   1. Switch to Pie chart tab. The pie renders. Don't fetch daily
#      rollup unnecessarily — devtools Network should not show a
#      get_time_tracking_daily_rollup invoke when pie is active.
#   2. Switch back to Table. Sparklines still populated.
#
# Pass F — Trends tab still works (no v1.4 regression):
#   1. Switch to Trends. Lines + legend render exactly as in v1.3.
#      Planned/Actual/Both toggle still works.
#
# Pass G — CSV export still works (no v1.4 regression):
#   1. With the Table tab active, click "Copy CSV". The toast says
#      "Copied ✓". Paste — the format matches v1.3 (no Trend column
#      in the CSV; the sparkline is a UI affordance only).
#
# Pass H — Daily-note splice fresh-injection:
#   1. Close all panes. Press Ctrl+D to open today's daily note.
#      (If today already has a "## Yesterday's time" section from
#      a previous run, delete that section first to test the
#      fresh-injection path.)
#   2. After the file opens, scroll to the bottom (or wherever the
#      auto-section landed). You should see:
#
#        ## Yesterday's time
#
#        <!-- TIMETRACK-AUTO-START — ... -->
#        | Category | Planned | Actual | Ratio | Events |
#        | --- | ---: | ---: | ---: | ---: |
#        | <category> | <planned> | <actual> | <ratio> | <events> |
#        ...
#        | **Total** | **<sum>** | **<sum>** | **<ratio>** | **<sum>** |
#        <!-- TIMETRACK-AUTO-END -->
#
#      ...with one row per category that had events yesterday.
#
# Pass I — Daily-note splice idempotency:
#   1. Save and reopen today's daily note. The auto-section content
#      doesn't change (idempotent regen).
#   2. Edit something OUTSIDE the markers in the daily note. Save.
#      Reopen. Your edit is preserved AND the auto-section is
#      preserved.
#   3. Manually edit something INSIDE the markers (e.g. change a
#      number). Save. Close. Reopen — the auto-section is regenerated
#      from the calendar, your edit is overwritten. (This is the
#      desired behaviour; the "do not edit" comment warns the user.)
#
# Pass J — Daily-note splice past-note safety:
#   1. Open yesterday's daily note (use FileTree → 02-Daily Log →
#      yesterday's filename). The "## Yesterday's time" section is
#      NOT auto-injected. (Past notes are off-limits to the regen.)
#
# Pass K — Empty-day splice copy:
#   1. If yesterday had zero events recorded, the auto-section body
#      should be the italic placeholder "_(no events recorded
#      yesterday)_" rather than an empty table.
#
# Pass L — Splice composes after Calendar splice:
#   1. Today's daily note should have BOTH the Calendar auto-section
#      ("## Today's calendar") and the Time tracking auto-section
#      ("## Yesterday's time"), with calendar appearing first.
#      Re-open the file a few times — both sections regenerate cleanly,
#      neither displaces the other.
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
    git commit -m "Cluster 14 v1.4 - sparklines per category + daily-note splice. Frontend: TimeTracking.tsx grows a 'Trend' column on the Table view. New Sparkline subcomponent renders an 80x24 inline SVG polyline of that category's daily actual_minutes across the selected window. Reuses the existing get_time_tracking_daily_rollup Tauri command from v1.3 — the fetch effect's gate widens from viewMode === 'trends' to (trends || table). Pie view still skips the daily-bin cost. Sparklines reuse categoryColour() (FNV-1a hash) so a category is one consistent colour across pie / Trends / sparkline. Densifies missing days to zero so 'no events on Wednesday' reads as a dip to baseline rather than the polyline skipping. Clamps the All-time preset to the actual data span. Edge cases: null trendsRows -> 80x24 empty placeholder (table layout stays stable), empty series -> muted em-dash, single-point series -> 2px centre dot, max value 0 -> divide-by-zero guarded. Backend: new regenerate_time_tracking_section(vault_path, file_path, tz_offset_minutes) Tauri command mirroring regenerate_calendar_section / regenerate_github_section. Basename gate to today's local-day daily note; yesterday's local-day [00:00, 24:00) window in UTC seconds via the same tz-offset arithmetic. Aggregation factored into aggregate_time_tracking_in_window helper so the command shares all the recurring auto-credit + override semantics with get_time_tracking_aggregates. Markers: <!-- TIMETRACK-AUTO-START — derived from yesterday's calendar events; do not edit --> / <!-- TIMETRACK-AUTO-END --> bracket a 5-column markdown table (Category / Planned / Actual / Ratio / Events) with a bolded Total row. Heading-fallback insertion under '## Yesterday's time' when markers absent (mirrors insert_calendar_under_heading shape). Idempotent — only writes when content differs; index_single_file invoked after writes. Empty rows render '_(no events recorded yesterday)_' italic placeholder. format_minutes_short helper mirrors TimeTracking.tsx's formatMinutes display. Wired into App.tsx selectFileInSlot daily-log path after regenerate_calendar_section, same tzOffsetMinutes plumbing, failures log a warning but don't block file open. Smoke tests: 12 passes covering sparklines (range presets, empty, missing, single-point, no-pie-regression, no-trends-regression, no-csv-regression) and splice (fresh-injection, idempotency, past-note safety, empty-day, composes-after-calendar)."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-14-v1.4-complete" -ForegroundColor Cyan
git tag -f cluster-14-v1.4-complete

Write-Host ""
Write-Host "Done. Cluster 14 v1.4 shipped:" -ForegroundColor Green
Write-Host "  - Per-category Trend sparkline column in Time tracking Table view" -ForegroundColor Green
Write-Host "    Inline 80x24 SVG polyline of daily actual_minutes" -ForegroundColor Green
Write-Host "    Reuses get_time_tracking_daily_rollup; matches pie / Trends colour" -ForegroundColor Green
Write-Host "  - regenerate_time_tracking_section Tauri command" -ForegroundColor Green
Write-Host "    Splices ## Yesterday's time auto-section into today's daily note" -ForegroundColor Green
Write-Host "    Mirrors Calendar/GitHub splice patterns; idempotent + tz-aware" -ForegroundColor Green
Write-Host "  - aggregate_time_tracking_in_window helper factored from the public command" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.5+):" -ForegroundColor DarkGray
Write-Host "  - Title/time overrides on a single recurring instance (carried" -ForegroundColor DarkGray
Write-Host "    over from v1.3 backlog; only skipped + actual_minutes overridable)" -ForegroundColor DarkGray
Write-Host "  - Per-day rollup view (per-event granularity in Time tracking)" -ForegroundColor DarkGray
Write-Host "  - Configurable splice window (today running / last 7 days / yesterday)" -ForegroundColor DarkGray
