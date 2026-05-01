# verify-cluster-14-v1.2.ps1
# Phase 3 Cluster 14 v1.1 + v1.2 — recurring auto-credit + pie chart tab.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (aggregator now expands recurring)
#   .\verify-cluster-14-v1.2.ps1
#
# What ships
# ----------
#
# v1.1 — Auto-credit recurring events
#
#   Closes the v1.0 limitation that recurring events were silently
#   excluded from time-tracking aggregates (no per-instance actual
#   storage made the math ambiguous). The new model: every recurring
#   instance is auto-credited as fully spent — i.e. the planned
#   duration counts as actual. This matches how you actually use
#   recurring events in practice (standups, classes, weekly reviews
#   — if they happened on the calendar, the time was spent).
#
#   Implementation: get_time_tracking_aggregates now walks
#   collect_events_in_window (which already expands recurrence_rule
#   into per-instance Event rows via expand_recurrence) instead of
#   issuing a raw SELECT against the events table. Per-instance
#   rows inherit the master's category and actual_minutes attribute.
#   Recurring instances skip the actual_minutes lookup and contribute
#   `(end_at - start_at) / 60` minutes to both planned and actual.
#   One-off events still use actual_minutes when present (else
#   contribute 0 to actual but still count toward planned).
#
#   EventEditModal: when repeat !== "none", the Actual minutes input
#   is disabled and shows a "(auto-credited)" placeholder so users
#   don't try to set an actual on the master.
#
# v1.2 — Pie chart tab in the Time tracking view
#
#   The Time tracking view grows a tab toggle next to the date-range
#   picker: Table (default) and Pie chart. On the Pie chart tab a
#   second sub-toggle picks the metric — By planned (default) or
#   By actual.
#
#   PieChart subcomponent renders a hand-drawn 360px SVG: each slice
#   is a wedge from the centre, paths built via M cx,cy L x1,y1 A
#   r,r 0 large,1 x2,y2 Z. Single-slice case (one category gets
#   100%) falls back to two half-arcs that close into a full circle
#   to avoid the wedge math collapsing to a point.
#
#   Slice colours are stable across reloads via a 32-bit FNV-1a
#   hash over the category name modulo a 12-colour PIE_PALETTE. So
#   "Lab work" always renders in the same colour even after a vault
#   restart. Collisions degrade gracefully (two categories share a
#   colour but stay separate slices).
#
#   Each <path> includes a <title> tooltip ("Category — 1h 30m
#   (12.5%)"). The legend column to the right of the chart shows
#   colour swatch / category name / percentage / formatted minutes.
#   Categories with zero contribution under the chosen metric are
#   dropped from the chart and legend (would otherwise render as
#   zero-width slices).
#
#   Empty-state: if there's no time recorded under the chosen metric
#   (e.g. switching to "By actual" when no event has actual_minutes
#   recorded and there are no recurring events), the chart slot
#   shows a message instead of a 0-width pie.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Recurring instances are credited (v1.1):
#   1. Create a recurring event (e.g. "Daily standup", 30 min, repeats
#      weekday). Make sure it has at least 5 instances within the last
#      30 days.
#   2. Open Time tracking. The "Daily standup" category appears with
#      planned ≈ 5×30 = 150m and actual = 150m, ratio 1.00× in text
#      colour.
#   3. Edit the recurring master in the Calendar. The Actual minutes
#      input is disabled and shows "(auto-credited)".
#
# Pass B — One-off events still need actual_minutes (v1.0 carryover):
#   1. Create a one-off event (no recurrence). Don't fill actual_minutes.
#      In Time tracking the row shows planned > 0, actual "—", ratio "—".
#   2. Edit it, set actual_minutes = 90. Time tracking now shows the
#      ratio (colour-cued).
#
# Pass C — Pie chart tab (v1.2):
#   1. Open Time tracking. Click the "Pie chart" tab next to the date-
#      range picker. The view swaps from the table to a 360px pie chart
#      with a legend column to the right.
#   2. Slice colours: each category renders in a stable colour. Reload
#      the app — same category, same colour.
#   3. Hover a slice — a native browser tooltip shows
#      "Category — Xh Ym (P.P%)".
#   4. The largest slice is at the top (12 o'clock) and slices proceed
#      clockwise, sorted largest-first.
#
# Pass D — Pie metric toggle:
#   1. Click "By actual". The chart resizes its slices using
#      actual_minutes_total per row. Recurring categories keep their
#      sizes (auto-credited); one-off-only categories with no actuals
#      drop out.
#   2. Switch back to "By planned". Slices return to planned sizing.
#
# Pass E — Single-category fallback:
#   1. Set the date range to a window containing exactly one category
#      with non-zero time (e.g. delete or hide other categories
#      temporarily).
#   2. The pie renders as a full circle (single slice) with no wedge
#      seam. Legend shows 100.0%.
#
# Pass F — Empty pie state:
#   1. Switch to "By actual" with a date range where no event has
#      actual_minutes and no recurring events fall in the window.
#   2. The pie slot shows the empty-state hint instead of crashing or
#      drawing a 0-width slice.
#
# Pass G — Date range still drives both views:
#   1. With Pie chart tab active, switch from Last 30 days to Last 7
#      days. The chart redraws against the smaller window.
#   2. Switch back to Table tab — same window applies; rows match.
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
    git commit -m "Cluster 14 v1.1 + v1.2 - recurring auto-credit + pie chart tab. v1.1: get_time_tracking_aggregates rewritten on top of collect_events_in_window so recurrence_rule events are expanded into per-instance Event rows. Each recurring instance auto-credits its full planned duration to actual, closing the v1.0 limitation that quietly dropped recurring events from analytics. EventEditModal disables the Actual minutes input when repeat !== 'none' and shows '(auto-credited)' placeholder so users don't try to set an actual on the master. v1.2: TimeTracking.tsx grows a tab toggle (Table | Pie chart) and, when Pie chart is active, a sub-toggle for the slice metric (By planned | By actual). New PieChart subcomponent renders a 360px hand-drawn SVG: each slice is a centre-anchored wedge built via M cx,cy L x1,y1 A r,r 0 large,1 x2,y2 Z, with a single-slice fallback (two half-arcs forming a full circle) for the 100% case. Slice colours are stable across reloads via a 32-bit FNV-1a hash over category name modulo a 12-colour palette — same category always renders the same colour. Slices sorted largest-first starting at 12 o'clock. Native <title> tooltip per <path>. Right-column legend with colour swatch, category, percentage, formatted minutes. Categories with zero contribution under the chosen metric drop from the chart. Empty-state hint when total = 0 (e.g. By actual with no actuals recorded and no recurring events). Date-range presets and refreshKey reactivity continue to drive both views; switching tabs preserves the selected range and pie metric."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-14-v1.2-complete" -ForegroundColor Cyan
git tag -f cluster-14-v1.1-complete
git tag -f cluster-14-v1.2-complete

Write-Host ""
Write-Host "Done. Cluster 14 v1.1 + v1.2 shipped:" -ForegroundColor Green
Write-Host "  - Recurring events auto-credit each instance as fully spent" -ForegroundColor Green
Write-Host "  - EventEditModal disables Actual minutes when repeat != none" -ForegroundColor Green
Write-Host "  - Pie chart tab in Time tracking view (360px, deterministic colours)" -ForegroundColor Green
Write-Host "  - Pie metric sub-toggle: By planned / By actual" -ForegroundColor Green
Write-Host "  - Single-slice fallback, empty-state hint, native title tooltips" -ForegroundColor Green
Write-Host "  - Stacked legend with swatch / category / pct / minutes" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.3+):" -ForegroundColor DarkGray
Write-Host "  - Per-instance recurring overrides (skip individual standup, etc.)" -ForegroundColor DarkGray
Write-Host "  - Per-day rollup view / sparklines" -ForegroundColor DarkGray
Write-Host "  - Export aggregates to CSV / clipboard" -ForegroundColor DarkGray
