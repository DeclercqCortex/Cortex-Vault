# verify-cluster-11-v1.6.ps1
# Phase 3 Cluster 11 v1.6 — drag-resize and drag-move on calendar events.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev      # frontend-only changes; hot-reload picks them up
#   .\verify-cluster-11-v1.6.ps1
#
# What ships
# ----------
#
# Three drag operations on existing event blocks in WeekView:
#
#   1. Drag-resize from the BOTTOM edge — pull the bottom edge down
#      to extend end_at, up to shrink. Snaps to the 15-min grid
#      (DRAG_SNAP_MIN). Cannot collapse below 15 minutes — the floor
#      keeps the event positive-duration.
#
#   2. Drag-resize from the TOP edge — pull the top edge up to extend
#      start_at backward, down to shrink. Same snap and floor.
#
#   3. Drag-move the body — drag the middle of an event block to
#      shift both start_at and end_at while preserving duration.
#      Cross-day move: drag the pointer into another day column and
#      the preview hops to that day; on pointerup the event commits
#      to the new day.
#
# Implementation notes
# --------------------
#
# - Drag kind is detected from offsetY in `handleEventPointerDown`:
#     - top 8 px      -> resize-top
#     - bottom 8 px   -> resize-bottom
#     - else          -> move
#   For very short blocks (< 28 px) only `move` is allowed; the user
#   can still resize via the edit modal.
#
# - During drag, the dragged event renders at preview position with
#   85% opacity and z-index 100 (above all peers). Its origin-day
#   render is suppressed during a cross-day move so the user sees one
#   live preview, not a duplicate.
#
# - Window-level pointermove / pointerup listeners attach when a drag
#   starts and detach when it ends. Cross-column hit-testing walks
#   `dayColRefs` to find which day's column the pointer is over.
#
# - Pure-click vs drag is gated by a 4-px movement threshold. Below
#   threshold the click handler runs as before (open edit modal);
#   above threshold the click that follows pointerup is swallowed via
#   `swallowClickRef` so the modal doesn't pop after a drag commit.
#
# - Read-only events (Google-synced, source === 'google') opt out of
#   drag entirely — pointerdown returns early, the click path still
#   opens the read-only modal.
#
# - Recurring events: a drag commits via `update_event` on the
#   master, shifting EVERY occurrence in the series. Per-instance
#   time overrides (the "Save just this" path for time changes) is
#   still a v1.3 backlog item.
#
# - On commit, `onEventReposition` routes through `Calendar.saveEdit`
#   which preserves every other field (recurrence_rule, notify_*,
#   actual_minutes, body, status, category) and triggers the usual
#   reload + daily-note regen.
#
# Smoke tests
# -----------
#
# Pass A — Drag-resize from the bottom:
#   1. In WeekView, create or pick an existing 1-hour event today.
#   2. Hover near the bottom edge — cursor turns to ns-resize.
#   3. Drag down ~half an hour. The block grows in 15-min snaps with
#      its time range updating live.
#   4. Release. The event commits with the new end_at; reopen via
#      click — the modal shows the new end time.
#
# Pass B — Drag-resize from the top:
#   1. Pick the same or another event. Hover near the top edge.
#   2. Drag up ~half an hour. The block grows upward in 15-min snaps.
#   3. Release. start_at is updated.
#
# Pass C — Drag-resize floors at 15 min:
#   1. Pick an event. From the bottom edge, drag the cursor PAST the
#      event's start time (visually inside the block, past the top).
#   2. The preview floors at start_at + 15 min (block shrinks to 15
#      min wide, but doesn't flip into a negative or zero duration).
#   3. Release. The event becomes 15 min long.
#
# Pass D — Drag-move within a day:
#   1. Pick a 1-hour event. Click and hold in the middle of the
#      block — cursor turns to grabbing.
#   2. Drag down ~2 hours. The block follows the pointer in 15-min
#      snaps; duration stays at 1 hour; time range updates live.
#   3. Release. start_at and end_at both shift by ~2 hours.
#
# Pass E — Drag-move across days:
#   1. Pick a 1-hour event on Monday. Drag it sideways into Wednesday's
#      column.
#   2. Wednesday shows the preview at the appropriate time-of-day;
#      Monday no longer shows the original block (the live preview is
#      now in Wednesday).
#   3. Release. The event moves to Wednesday in the database; the
#      Monday slot is empty.
#
# Pass F — Click without drag still opens the edit modal:
#   1. Pick any event. Single-click in the middle of the block (no
#      drag).
#   2. The EventEditModal opens with the event's current values.
#
# Pass G — Drag commits don't open the modal:
#   1. Pick any event. Drag-move it ~30 min within the same day.
#   2. Release. The modal does NOT open. The event reflects the new
#      time on the grid.
#
# Pass H — Read-only Google events ignore drag:
#   1. With a Google-synced calendar configured, find a Google event
#      in WeekView (G badge in the title).
#   2. Try to drag-move it. Nothing happens.
#   3. Click without drag — the read-only modal opens (Open in Google
#      Calendar link present, no Save / Delete buttons).
#
# Pass I — Drag-move on a recurring event shifts the whole series:
#   1. Create a recurring weekly event ("Standup", every weekday).
#      Save series.
#   2. Drag-move one instance from 09:00 to 10:00. Release.
#   3. Every standup in the visible week now starts at 10:00. Shifting
#      one occurrence shifts them all (master record). Per-instance
#      time-overrides remain a v1.3 backlog item.
#
# Pass J — Tentative + drag interaction:
#   1. Create a tentative event (status: tentative). Drag-move it.
#   2. The dashed-border / hatched background treatment is preserved
#      through the drag preview and after commit.
#
# Pass K — Daily-note splice updates after drag:
#   1. Drag-move yesterday's event to a different time (say it was
#      14:00–15:00 and you make it 16:00–17:00).
#   2. Open today's daily note. The "## Yesterday's time" auto-section
#      reflects the new times in the per-category roll-up (because
#      saveEdit triggers regenerateTodaysDailyNote — same path as
#      a modal save).
#
# Pass L — Drag preview during cross-day clamp:
#   1. Drag the pointer above the day column (above 00:00). The
#      preview clamps at the column's top — no negative-time event.
#   2. Drag below 24:00. The preview clamps at the column's bottom.
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
    git commit -m "Cluster 11 v1.6 - drag-resize and drag-move on event blocks. Three drag kinds detected from offsetY in handleEventPointerDown: top 8 px = resize-top (drags start_at), bottom 8 px = resize-bottom (drags end_at), else = move (drags both, preserving duration). Below MIN_FOR_HANDLES (28 px) only move is allowed. New EventDragOp state tracks pointerId, origin start/end/dayIdx, anchor offset (minutes from event-top where the pointer landed), preview start/end/dayIdx, and a moved flag (4-px threshold). Window-level pointermove + pointerup attach via useEffect when isDraggingEvent flips true and detach when it flips back; the move handler walks dayColRefs to do cross-day hit testing for move ops, snaps to DRAG_SNAP_MIN (15 min), and floors at 15-min duration so resize never produces a negative-duration event. On pointerup, if moved && (start || end changed) the drag commits via the new onEventReposition prop -> Calendar.saveEdit which routes through update_event preserving every other field and triggering reload + regenerateTodaysDailyNote. swallowClickRef gate suppresses the click that follows a drag-commit pointerup so the edit modal doesn't pop. Read-only events (source === 'google') opt out of drag — the click path still opens the read-only modal. Recurring events: drag shifts the whole series via master update; per-instance time overrides remain a v1.3 backlog item. UI: dragged event renders at preview start/end with 85% opacity + zIndex 100 above peers; cross-day move suppresses the origin-day render to avoid duplicates and renders an inert preview block in the destination day's column; cursor switches to ns-resize on top/bottom 8-px zones (via two pointer-events:none divs), grab in the middle, grabbing during a move drag. New dayColRefs ref array (7 slots) attached via callback ref on each day column. 12 smoke passes covering resize-bottom, resize-top, 15-min floor, move-within-day, move-across-days, click-still-edits, drag-commits-dont-edit, Google-readonly-blocks-cant-drag, recurring-shifts-series, tentative-preserves-style, daily-note-splice-updates-after-drag, top/bottom-clamp."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-11-v1.6-complete" -ForegroundColor Cyan
git tag -f cluster-11-v1.6-complete

Write-Host ""
Write-Host "Done. Cluster 11 v1.6 shipped:" -ForegroundColor Green
Write-Host "  - Drag the bottom or top 8 px of an event to resize" -ForegroundColor Green
Write-Host "  - Drag the body to move within a day or across days" -ForegroundColor Green
Write-Host "  - Snaps to 15-min grid; floors at 15-min duration" -ForegroundColor Green
Write-Host "  - Click without drag still opens the edit modal" -ForegroundColor Green
Write-Host "  - Google-synced events stay read-only" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.7+):" -ForegroundColor DarkGray
Write-Host "  - NLP for natural-language event creation" -ForegroundColor DarkGray
Write-Host "  - Per-instance time overrides on recurring events" -ForegroundColor DarkGray
Write-Host "    (drag a single instance shifts that occurrence only)" -ForegroundColor DarkGray
Write-Host "  - Multi-tz / heatmap / density views" -ForegroundColor DarkGray
