# verify-cluster-11.ps1
# Phase 3 Cluster 11 — Personal Calendar (v1.2)
#
# v1.2 follow-ups vs v1.1:
#   - Timezone bug fixes. The daily-note splice was computing the
#     "today" window using UTC midnight bounds, so users in any
#     non-UTC timezone saw events spuriously excluded around the
#     local-vs-UTC date boundary. Worst case (Arizona MST = UTC-7):
#     events created after 5pm local fell into the next UTC day
#     and never appeared in today's splice. Fixed by passing
#     tz_offset_minutes (signed minutes east of UTC, sourced from
#     `-new Date().getTimezoneOffset()`) on every regen call and
#     using it to compute the local-day window AND to format HH:MM
#     in local time. The basename check now compares against local
#     today rather than UTC today.
#
# v1.1 follow-ups vs v1.0:
#   - Body content now flows into the daily-note ## Today's calendar
#     section (indented under each event). Wikilinks the user typed
#     in the event body resolve as live links via the daily note's
#     TipTap render. Closes the "wikilinks don't appear in the note"
#     report.
#   - Calendar.saveEdit / deleteEdit explicitly invoke
#     regenerate_calendar_section on today's daily note path after
#     any mutation. Daily note stays current even when the user
#     hasn't re-clicked it.
#   - Visible error banner if regen fails (typically: stale Tauri
#     binary needs a `pnpm tauri dev` restart after Rust changes).
#   - Recurrence engine. Schema migration added events.recurrence_rule
#     (RRULE string per RFC 5545; NULL = standalone). New Repeat
#     field in EventEditModal: Doesn't repeat / Daily / Weekly on N
#     days / Biweekly on N days / Monthly (same date) / Custom RRULE.
#     End condition: Never / On date / After N occurrences. Existing
#     rules round-trip back to UI state where possible; exotic ones
#     fall into "custom" so the user can still edit them.
#   - Hand-rolled Rust RRULE expander supports FREQ=DAILY/WEEKLY/
#     MONTHLY plus INTERVAL, BYDAY, BYMONTHDAY, COUNT, UNTIL.
#     list_events_in_range and regenerate_calendar_section share
#     the same expander via a new collect_events_in_window helper.
#
# v1.1 deliberately defers (per cluster doc):
#   - Per-instance modification ("edit just this one occurrence").
#     v1.1 is whole-series-only. v1.2 candidate.
#   - EXDATE / RDATE exceptions.
#   - Drag-resize and drag-move on existing events.
#   - The TipTap-mounted body editor (textarea remains in v1.1).
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install            # nothing new on JS side
#   pnpm tauri dev          # smoke-test (see checklists below)
#   .\verify-cluster-11.ps1 # commit + tag
#
# Cluster 11 v1.0 is local-first only. Cluster 12 (Google Calendar
# sync), Cluster 13 (Outlook), and Cluster 14 (planned-vs-actual
# analytics) are future clusters that depend on this v1.0 schema.
#
# ---------------------------------------------------------------------------
# Pass 1 — backend (events schema + CRUD)
# ---------------------------------------------------------------------------
#   1. First launch after this build: opening any vault auto-creates
#      the `events` and `event_categories` tables in
#      <vault>/.research-hub/index.db, and seeds 5 default categories
#      (Work / Personal / Health / Learning / Social).
#   2. Eight new Tauri commands registered: list_events_in_range,
#      create_event, update_event, delete_event, list_event_categories,
#      upsert_event_category, delete_event_category,
#      regenerate_calendar_section.
#   3. The CREATE TABLE IF NOT EXISTS pattern means existing vaults
#      pick up the new tables without migration. Nothing else changes.
#
# ---------------------------------------------------------------------------
# Pass 2 — Calendar component (week + month grid)
# ---------------------------------------------------------------------------
#   1. Sidebar -> "Cal" button. The active slot's view flips to the
#      calendar. Default landing view is the current week.
#   2. Header bar shows: Back, Today, ◀ ▶, the visible week range,
#      Week/Month toggle, "+ New event", "Categories" button.
#   3. "Now" line: a thin red horizontal line on today's column at
#      the current local time. It updates each minute.
#   4. Click-and-drag inside any empty area of a day column: a
#      semi-transparent draft block tracks the pointer. Release
#      opens the new-event modal with start/end pre-filled (snapped
#      to 15-min increments).
#   5. Plain click (no drag) on an empty area opens a 1-hour event
#      starting at the clicked minute.
#   6. Existing events render as colored blocks tinted to the
#      category's color (33% alpha background, 3px solid left
#      border). Tentative events render with a diagonal stripe
#      pattern + dashed border so they read different from confirmed.
#   7. Overlapping events render side-by-side at fractional width.
#   8. Switch to Month: 6×7 grid of cells; the focus month is full
#      opacity, surrounding days are dimmed. Today's cell has an
#      elevated background. Click a day -> opens new-event modal
#      defaulting to 9–10 am that day. Click an event chip -> opens
#      the edit modal.
#
# ---------------------------------------------------------------------------
# Pass 3 — Event edit modal
# ---------------------------------------------------------------------------
#   1. Modal fields: Title (required), Start, End (datetime-local
#      inputs that switch to date-only when "All-day" is checked),
#      "All-day event" toggle, Category dropdown (with color swatch
#      preview), Status (Confirmed / Tentative buttons), Notes
#      textarea (supports [[wikilinks]] verbatim).
#   2. Ctrl+Enter saves. Escape cancels. Existing events show a
#      "Delete" button on the left of the footer; new events don't.
#   3. Validation: empty title -> error message. End < start ->
#      error message. No category selected -> error message.
#   4. Saving an existing event: returns to the calendar; the event
#      reflects the changes immediately.
#   5. Creating a new event: returns to the calendar with the new
#      event rendered.
#   6. Body field accepts free markdown including [[wikilinks]].
#      They render as plain text in the modal but feed into the
#      daily-note auto-section as live links.
#
# ---------------------------------------------------------------------------
# Pass 4 — Sidebar wiring + tentative styling + categories
# ---------------------------------------------------------------------------
#   1. Sidebar "Cal" button works in all layouts (single, dual,
#      tri-bottom, tri-top, quad). Routes to the active slot.
#   2. Multi-slot: open Calendar in slot 1 and a markdown note in
#      slot 2 — calendar's keyboard/click events stay scoped to its
#      pane.
#   3. Categories button (top-right of calendar) opens the
#      Categories modal. List shows 5 seeded categories (color
#      swatch + label + id). Each row has Edit / Delete.
#   4. Edit a category: change label or color, Save -> calendar
#      events using that category re-render with the new color.
#   5. Add a new category: "+ Add category" -> form with Label +
#      Color -> Save -> appears in the list and in the event modal's
#      dropdown.
#   6. Delete a category that's still used by events: refuses with
#      the message "Can't delete category `X` — N event(s) still
#      use it. Reassign them first."
#   7. Add a 9th category: the modal's hint adds "(above the
#      recommended 8 — visual signal degrades past this)" — a soft
#      warning, not a hard limit.
#
# ---------------------------------------------------------------------------
# Pass 5 — Daily-note auto-section
# ---------------------------------------------------------------------------
#   1. Open today's daily note (Ctrl+D). The file gains a
#      `## Today's calendar` section with HTML markers
#      <!-- CALENDAR-AUTO-START --> ... <!-- CALENDAR-AUTO-END -->
#      and a list of today's events:
#         - 09:00–10:00 — **Standup** _(Work)_
#         - **All day** — **Project deadline** _Work_ _(tentative)_
#   2. With no events scheduled, the section reads
#         _(no events scheduled for today)_
#   3. Open YESTERDAY's daily note: NOT modified — past notes stay
#      frozen as the day's snapshot.
#   4. Edit an event in the calendar, then re-open today's daily
#      note: the section updates to reflect the change. No-op git
#      commit if nothing changed.
#
# ---------------------------------------------------------------------------
# Manual edge cases worth touching
# ---------------------------------------------------------------------------
#   a. Create an event spanning midnight (e.g. 23:00 today to 02:00
#      tomorrow). Today's day column shows the block from 23:00 to
#      24:00; tomorrow's column shows 00:00 to 02:00.
#   b. Drag-create an event at the very top of a day column (00:00).
#      Snaps to 0–0:15 (15-min default).
#   c. With the calendar open and the event modal showing, press
#      Esc -> modal closes. Press Esc again with no modal -> nothing
#      bad happens (the global Esc handler covers other modals only).
#   d. Open the calendar in two slots simultaneously. Create an
#      event in slot 1 -> slot 2's calendar reloads on next click /
#      navigation (no live cross-slot reload in v1.0 — known rough
#      edge, reload via prev/next or Today refreshes).
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
    git commit -m "Cluster 11 v1.2 - Calendar timezone fixes: regenerate_calendar_section now takes tz_offset_minutes (signed minutes east of UTC, frontend passes -new Date().getTimezoneOffset()). Day window computed against the user's local day (00:00-24:00 local converted to UTC unix-second bounds for the SQL query), basename check uses local-today, HH:MM formatted in local time inside the splice via new local_hhmm_for_with_offset / local_iso_date_for helpers; old UTC-only local_hhmm_for removed. Closes the 'only the Now event registers' and 'hours are wrong' reports — root cause was UTC midnight bounds meaning events after 5pm local in Arizona MST fell into the next UTC day and the splice rendered times in UTC. Includes prior v1.1 work: body content flows into ## Today's calendar daily-note section so wikilinks resolve as live links; Calendar.saveEdit/deleteEdit invoke regenerate_calendar_section on today's daily-note path; visible error banner on regen failure; recurrence engine (schema migration adds events.recurrence_rule; Repeat field in EventEditModal with Daily/Weekly+BYDAY/Biweekly/Monthly/Custom presets and Never/On date/After N end conditions; hand-rolled Rust RRULE expander supports FREQ=DAILY/WEEKLY/MONTHLY plus INTERVAL/BYDAY/BYMONTHDAY/COUNT/UNTIL; collect_events_in_window helper shared by list_events_in_range + regenerate_calendar_section; React keys composed from id+start_at to dedupe recurring occurrences). v1.2 ships whole-series edits only (per-instance modification still deferred); textarea body editor unchanged (TipTap mount deferred)."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-11-v1.2-complete" -ForegroundColor Cyan
git tag -f cluster-11-v1.0-complete   # keep the v1.0 checkpoint
git tag -f cluster-11-v1.1-complete   # keep the v1.1 checkpoint
git tag -f cluster-11-v1.2-complete

Write-Host ""
Write-Host "Done. Cluster 11 v1.2 (timezone fixes + recurrence) shipped:" -ForegroundColor Green
Write-Host "  v1.0 foundation:" -ForegroundColor Green
Write-Host "    - SQLite events + event_categories tables (5 seeded categories)" -ForegroundColor Green
Write-Host "    - Eight Tauri commands (CRUD + regen-daily-section)" -ForegroundColor Green
Write-Host "    - Hand-rolled Week + Month views, click-and-drag drafting" -ForegroundColor Green
Write-Host "    - 'Now' line on the week view, updates each minute" -ForegroundColor Green
Write-Host "    - Tentative-vs-confirmed visual distinction" -ForegroundColor Green
Write-Host "    - Side-by-side conflict layout for overlapping events" -ForegroundColor Green
Write-Host "    - Event modal with title/datetime/all-day/category/status/body" -ForegroundColor Green
Write-Host "    - Categories modal with edit/add/delete + soft 8-cat warning" -ForegroundColor Green
Write-Host "    - Daily-note ## Today's calendar auto-section" -ForegroundColor Green
Write-Host "    - Calendar 'Cal' sidebar button routes to active slot" -ForegroundColor Green
Write-Host "  v1.1 follow-ups:" -ForegroundColor Green
Write-Host "    - Event body flows into the daily-note splice (wikilinks resolve)" -ForegroundColor Green
Write-Host "    - regenerate_calendar_section invoked on every save/delete" -ForegroundColor Green
Write-Host "    - Recurrence: schema + Rust expander + Repeat modal field" -ForegroundColor Green
Write-Host "    - Daily / Weekly+BYDAY / Biweekly / Monthly / Custom RRULE" -ForegroundColor Green
Write-Host "    - End condition: Never / On date / After N occurrences" -ForegroundColor Green
Write-Host "  v1.2 follow-ups:" -ForegroundColor Green
Write-Host "    - Timezone: regen takes tz_offset_minutes; window + HH:MM are local" -ForegroundColor Green
Write-Host "    - Closes 'only Now event registers' and 'hours are wrong' reports" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "Deferred (v1.2+): per-instance modification, EXDATE/RDATE, drag-resize, TipTap body" -ForegroundColor DarkGray
Write-Host "Deferred clusters: Cluster 12 (Google sync), 13 (Outlook), 14 (planned-vs-actual)" -ForegroundColor DarkGray
