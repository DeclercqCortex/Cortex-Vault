# verify-cluster-11-v1.5.ps1
# Phase 3 Cluster 11 v1.5 — calendar layout polish.
# Phase 3 Cluster 14 v1.5 — exclude all-day events from time tracking.
#
# Both ship in the same commit; the script applies two tags so each
# cluster's tag history captures its own change.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend-only + small Rust filter; full restart
#   .\verify-cluster-11-v1.5.ps1
#
# What ships
# ----------
#
# Three calendar layout changes, all in WeekView (with one MonthView
# touch-up for parity).
#
# 1. All-day events stay in the top all-day row.
#
#    The row already existed since Cluster 16 v1.1.4 — this ship
#    documents that decision and confirms it's still the rule. No code
#    change in WeekView's all-day rendering itself.
#
#    MonthView gets a small parity tweak: each day cell's events are
#    now sorted with all-day events first, so they appear at the top
#    of the cell (mirroring WeekView's dedicated row at the top of the
#    week grid).
#
# 2. Time-grid overlap is now a full-width overlay instead of side-by-
#    side columns.
#
#    Pre-v1.5 behaviour: when N events overlapped at a given hour, the
#    column-packing layout split the day-column into N vertical lanes
#    (1/N width each) and rendered each event in its own lane. Visually
#    this signalled "these events conflict" but ate horizontal space
#    and made every block narrow.
#
#    v1.5 behaviour: every timed event takes the full day-column
#    width. Overlapping events stack via z-index, with later starts
#    rendered on top so each block's title appears at its own start
#    time, above any earlier block that extends past it. Same-start
#    ties: the shorter event renders on top so its title stays visible
#    and the longer event's body fills in below.
#
#    Implementation:
#      - WeekView: `left: 0`, `width: calc(100% - 6px)` (was
#        `(col/cols) * 100%` and `100/cols%`).
#      - `zIndex: 1 + idx` on each block (idx = position in sorted
#        array; later starts → higher z).
#      - `boxShadow: 0 0 0 1px var(--bg)` so an event landing on top
#        of another reads as a separate layer instead of a wash.
#      - `layoutEventsForDay` simplified: drops the column-packing
#        algorithm, returns `{ event, col: 0, cols: 1 }` for every
#        event with the new sort (start ASC, then duration DESC).
#
# 3. Block text top-aligned, wraps to second/third line as needed.
#
#    Pre-v1.5: title was `whiteSpace: nowrap; textOverflow: ellipsis`
#    so a long title got cut with `…` regardless of available block
#    height.
#
#    v1.5: title wraps. Block uses `display: flex; flexDirection:
#    column; justifyContent: flex-start` so the title sits at the
#    block's top edge (its start-time edge). `wordBreak: break-word`
#    handles unbroken long words. `overflow: hidden` on the block
#    clips wrapped text past the bottom edge of the block.
#
#    Net effect: a 30-minute block with a 50-character title shows
#    the first ~2 lines of text and clips. A 2-hour block with the
#    same title shows the full title and the time range below. Title
#    stays at the top in both cases.
#
# Cluster 14 v1.5 — exclude all-day events from time tracking
# -----------------------------------------------------------
#
# All-day events (vacation, holiday, anniversary, conference day) are
# typically markers, not work the user is tracking. Including them
# in the analytics rolls 1440 planned minutes into a category for
# every all-day event — distorts totals and the planned/actual ratio.
#
# v1.5 filters `evt.all_day == true` in three places:
#
#   - get_time_tracking_aggregates  (Table view, pie, CSV export)
#   - get_time_tracking_daily_rollup  (Trends tab, sparklines)
#   - aggregate_time_tracking_in_window  (daily-note splice helper)
#
# All three use `collect_events_in_window` which expands recurring
# series, then the per-iteration filter at the top of each loop drops
# all-day events before any planned/actual contribution lands.
#
# UI copy: TimeTracking.tsx subtitle now says "All-day events are
# excluded." so the rule is visible without reading the source.
#
# Skipped recurring instances were already filtered upstream by
# expand_recurrence (Cluster 14 v1.3 override semantics) and stay
# filtered. All-day exclusion composes cleanly on top.
#
# Smoke tests
# -----------
#
# Pass A — All-day events render in the top all-day row:
#   1. Open Cortex → press Ctrl+Shift+C to open the calendar.
#   2. Switch to Week view if not already there.
#   3. Below the day-header row, you see a thin row labelled
#      "all-day". This is the all-day row.
#   4. Create a new all-day event for any visible day (click an empty
#      all-day cell, the EventEditModal opens with all-day pre-set
#      based on its start/end). Save.
#   5. The new event renders as a chip in the all-day row, NOT in the
#      hour body below.
#
# Pass A2 — All-day row grows with the busiest day's count:
#   1. On a single day in the visible week, create three all-day
#      events (e.g. "Holiday 1", "Travel day", "Conference day").
#   2. The all-day row resizes to fit all three chips on that day,
#      with each chip at native height and a 2-px gap between them.
#      No chip is clipped at the row's bottom border.
#   3. Other days in the same week have only their existing chips
#      shown; the cells are taller (matching the busiest day) but
#      empty space is just the cell's padding plus a click-to-create
#      target.
#   4. Delete two of the three. The row collapses back to its
#      single-chip height (or the 32-px minimum if every day is now
#      empty).
#
# Pass B — Overlapping timed events overlay full-width:
#   1. Create two timed events on the same day with overlapping
#      times — e.g. 10:00–12:00 "Long meeting" and 10:30–11:00
#      "Short break".
#   2. Both events render at the FULL day-column width (no longer
#      side-by-side at 50%).
#   3. The "Long meeting" block's title is visible at the 10:00 line.
#   4. The "Short break" block stacks on top of "Long meeting" from
#      10:30 to 11:00 — its title is visible at the 10:30 line.
#   5. From 11:00 to 12:00 the "Long meeting" body is visible again
#      (the short event has ended).
#
# Pass C — Same-start overlap puts the shorter event on top:
#   1. Create two events that share a start time — e.g. 14:00–17:00
#      "Workshop" and 14:00–14:30 "Quick sync".
#   2. The shorter "Quick sync" renders on top from 14:00 to 14:30
#      (its title is visible at 14:00).
#   3. From 14:30 to 17:00 the "Workshop" body is visible.
#
# Pass D — Top-alignment + wrap on a tall block:
#   1. Create a 2-hour event with a long title (e.g. "Quarterly
#      planning offsite — Q3 OKRs and roadmap review with the team").
#   2. The title appears at the TOP of the block, wrapping to two or
#      three lines as space allows.
#   3. The time range (HH:MM–HH:MM) renders just below the title.
#
# Pass E — Top-alignment + clip on a short block:
#   1. Create a 30-minute event with a long title.
#   2. The title appears at the top of the block, wraps, and the
#      bottom of the title is clipped if it doesn't fit. The block
#      doesn't grow taller than its 30-minute footprint.
#
# Pass F — All-day-first ordering in MonthView:
#   1. Switch to Month view. Find a day that has both an all-day
#      event and a timed event.
#   2. The all-day event renders BEFORE (above) the timed event in
#      the day cell.
#
# Pass G — No regression on draft / now-line:
#   1. Click-drag in an empty area of the day column. The draft block
#      still renders (semi-transparent accent colour) at the dragged
#      span.
#   2. The "now" line (red) crosses the day column at the current
#      local time.
#
# Pass H — No regression on tentative / Google badge:
#   1. Tentative events still render with the dashed-border / hatched
#      background treatment.
#   2. Google-synced events still show the "G" badge before the title.
#
# Pass I — All-day events excluded from Time tracking:
#   1. Create an all-day event today in some category (e.g. category
#      "personal", title "Public holiday").
#   2. Open Time tracking (sidebar → ⏱ Time, or Ctrl+Shift+T if wired).
#      Switch range to "Last 7 days".
#   3. The all-day event does NOT appear in the Table view's planned/
#      actual totals for "personal".
#   4. Switch to Pie chart. The all-day event's category does not get
#      inflated by 1440 minutes/day.
#   5. Switch to Trends. The all-day day's planned bar does not spike
#      to 1440. Sparkline in the Table view stays at expected scale.
#
# Pass J — All-day exclusion composes with recurrence:
#   1. Create a recurring all-day event (daily, weekly, etc.). Save
#      series. Expand a few weeks of calendar.
#   2. The recurring all-day instances render in the WeekView all-day
#      row (Pass A) but do NOT contribute to Time tracking aggregates.
#
# Pass K — Daily-note splice excludes all-day:
#   1. Create one timed event yesterday (e.g. 14:00–15:00 "Standup")
#      and one all-day event yesterday ("Conference"). Save both.
#   2. Open today's daily note (Ctrl+D). Find the "## Yesterday's time"
#      section.
#   3. The Standup contributes (1h planned, etc.) but Conference is
#      not in the table.
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
    git commit -m "Cluster 11 v1.5 + Cluster 14 v1.5. Calendar layout polish: WeekView's time grid switches from side-by-side column packing (1/N width per overlap) to full-width overlay; overlapping events stack via z-index by sort order (start ASC, duration DESC, so a shorter event sharing a start time lands on top of a longer one and its title stays visible); each block gets zIndex: 1 + idx and a 1-px box-shadow against --bg so layered blocks read as separate layers; layoutEventsForDay simplified — drops column-packing, returns { event, col: 0, cols: 1 } for every event; block style switched to display: flex / flex-direction: column / justifyContent: flex-start so titles sit at the start-time edge; eventTitle goes from nowrap+ellipsis to whiteSpace: normal + wordBreak: break-word + lineHeight: 1.2 so a long title wraps to second / third line as block height allows; block-level overflow: hidden clips wrapped text past the bottom edge; MonthView day cells now sort all-day events to the top of each cell (mirrors WeekView's dedicated all-day row at the top). All-day row grows with the busiest day's event count — useMemo'd allDayMaxCount tally over events.filter(all_day) per visible day, then row minHeight = max(32, count * ALL_DAY_CHIP_H + (count-1) * ALL_DAY_CHIP_GAP + ALL_DAY_ROW_PAD) so two or more chips on a single day all render without clipping. Time tracking — all-day events excluded: get_time_tracking_aggregates, get_time_tracking_daily_rollup, and aggregate_time_tracking_in_window all gain an early `if evt.all_day { continue; }` filter so vacation / holiday / conference markers don't dump 1440 planned minutes/day into a category and distort the planned/actual ratio. UI subtitle in TimeTracking.tsx documents the rule. Composes with the v1.3 recurrence-override semantics — skipped instances were already filtered upstream; all-day exclusion stacks on top. 12 smoke passes covering layout (all-day row + dynamic-height growth, overlapping overlay, same-start ordering, tall-block wrap, short-block clip, MonthView all-day-first, draft/now-line no-regression, tentative/Google badge no-regression) and time-tracking (all-day excluded from table/pie/trends, all-day recurring excluded, daily-note splice excludes all-day)."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-11-v1.5-complete and cluster-14-v1.5-complete" -ForegroundColor Cyan
git tag -f cluster-11-v1.5-complete
git tag -f cluster-14-v1.5-complete

Write-Host ""
Write-Host "Done. Cluster 11 v1.5 + Cluster 14 v1.5 shipped:" -ForegroundColor Green
Write-Host "  Calendar layout (Cluster 11):" -ForegroundColor Green
Write-Host "    - WeekView overlapping events overlay full-width (no more 1/N lanes)" -ForegroundColor Green
Write-Host "    - z-index stacking by start order; box-shadow separator" -ForegroundColor Green
Write-Host "    - Block title top-aligned, wraps to multiple lines, clips at bottom" -ForegroundColor Green
Write-Host "    - All-day-first sort in MonthView day cells" -ForegroundColor Green
Write-Host "  Time tracking (Cluster 14):" -ForegroundColor Green
Write-Host "    - All-day events excluded from aggregates, rollup, and splice" -ForegroundColor Green
Write-Host "    - Subtitle copy says 'All-day events are excluded.'" -ForegroundColor Green
