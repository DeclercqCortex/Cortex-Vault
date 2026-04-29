# verify-cluster-15.ps1
# Phase 3 Cluster 15 — Reminders (v1.0)
# Also folds in: Cluster 11 v1.3 — Calendar Ctrl+Shift+C shortcut.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart needed (Rust signature changes)
#   .\verify-cluster-15.ps1 # commit + tag
#
# v1.0 scope:
#   - <vault>/Reminders.md is the single source of truth. Every
#     non-empty, non-header line is a reminder.
#   - Three new Tauri commands (read_reminders, write_reminders,
#     delete_reminder_line). delete_reminder_line matches by
#     trimmed-content equality so it survives hand-edits between
#     read and resolve.
#   - Frontend parser in src/utils/reminders.ts: extracts leading
#     YYYY-MM-DD and HH:MM tokens, treats the rest as description.
#     Markdown headers and list-item / checkbox prefixes are
#     skipped or stripped.
#   - ReminderOverlay (Ctrl+Shift+M) — modal-style overlay with
#     scrim + centered panel. Quick-add input at top prepends a new
#     line on Enter; textarea below shows the verbatim file. Save &
#     close / Cancel / Open in pane (routes through selectFileInSlot
#     so the user can do heavier editing in TipTap if needed).
#   - NotificationBell next to the LayoutPicker. Polls every 30s,
#     re-parses, computes status per line, shows a count badge of
#     active reminders (anything not "future"). Bell colour: red
#     when any past-due present, accent otherwise. Click opens a
#     dropdown panel with each active reminder + Resolve button.
#     Resolve = remove the line from the file.
#   - WebAudio beep plays once when a reminder transitions to
#     "approaching" (within 1 hour) or "past-due". Alerted state
#     tracked in localStorage so re-launching Cortex doesn't replay
#     the same alerts.
#   - Status semantics:
#       * No date, no time → "anytime", always pending.
#       * Date only → "all-day-active" today, "past-due" if before today.
#       * Date+time, future > 1h → "future" (not in panel).
#       * Date+time, within 1h → "approaching".
#       * Date+time, in the past → "past-due".
#       * Time only → interpreted as today.
#
# Cluster 11 v1.3:
#   - Ctrl+Shift+C switches the active slot to the Calendar view
#     (handle.setActiveView('calendar')).
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# 1. Open the Reminders overlay (Ctrl+Shift+M). Empty state — no file
#    on disk yet. Quick-add input is focused.
#
# 2. Type "2026-04-29 14:30 Meeting with advisor" + Enter. Line
#    appears at the top of the textarea. Quick-add input clears,
#    re-focuses for rapid entry.
#
# 3. Add a few more lines:
#       2026-04-30 Submit form
#       Buy groceries
#       08:00 Standup
#    Click "Save & close". The overlay disappears.
#
# 4. Bell badge appears next to the LayoutPicker. Number = total
#    active reminders. (The 2026-04-29 14:30 entry might or might
#    not be "approaching" depending on what time you're testing —
#    the future ones aren't counted.) Bell colour is the accent
#    unless any of the lines parses as past-due.
#
# 5. Add a past line via the overlay:
#       2026-04-25 12:00 Long-overdue test
#    Bell switches to red. Number bumps.
#
# 6. Click the bell. Dropdown panel shows each active reminder
#    (anytime, all-day today, approaching, past-due) sorted by
#    urgency: past-due first (red ⏱), approaching (accent ⏰),
#    today's all-day (📅), anytime (•). Each row has a Resolve
#    button.
#
# 7. Resolve the past-due line. The line disappears from
#    Reminders.md (open it in a slot and confirm). The bell badge
#    decrements. If no past-due remain, bell goes back to accent.
#
# 8. Wait until a reminder is within 1 hour of "now". WebAudio
#    beep plays once. Check that re-opening the bell shows the
#    reminder as "approaching" (accent ⏰). Reload Cortex — beep
#    does NOT replay (alerted state in localStorage).
#
# 9. Hand-edit Reminders.md from the file tree (open it as a
#    regular markdown note). Add another past-due line. Wait up
#    to 30s for the bell to refresh. Or close and reopen the
#    overlay to see the latest content.
#
# 10. Press Ctrl+Shift+C while a slot is active. The active slot
#     flips to the Calendar view. (No-op if no slot is active.)
#
# 11. Press Ctrl+/ to open ShortcutsHelp. Three new rows visible
#     under "Always active":
#       Ctrl+Shift+C  Switch active slot to the Calendar view
#       Ctrl+Shift+M  Open Reminders overlay
#       Ctrl+Shift+G  (was already there)
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
    git commit -m "Cluster 15 v1.0 - Reminders + Cluster 11 v1.3 Calendar Ctrl+Shift+C - Cluster 15: <vault>/Reminders.md as single source of truth (one line per reminder, headers + checkboxes skipped, list-item prefixes stripped). Three Tauri commands (read_reminders, write_reminders, delete_reminder_line — last one matches by trimmed-content equality so resolve works after hand-edits). Frontend parseReminderLine extracts YYYY-MM-DD and HH:MM prefixes; computeStatus buckets each line into anytime / all-day-active / approaching (within 1h) / future / past-due. ReminderOverlay (Ctrl+Shift+M) is a scrim-modal with quick-add input + textarea + Save/Cancel/Open-in-pane. NotificationBell sits next to LayoutPicker; 30s poll; count badge of all active (non-future) reminders; red when any past-due; click opens dropdown with Resolve button per row. WebAudio short beep plays once per reminder when it transitions to approaching or past-due, alerted-state tracked in localStorage by reminder hash. Cluster 11 v1.3: Ctrl+Shift+C handler routes paneRefs.current[activeSlotIdx]?.setActiveView('calendar'). ShortcutsHelp updated with both rows."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-15-v1.0-complete + cluster-11-v1.3-complete" -ForegroundColor Cyan
git tag -f cluster-15-v1.0-complete
git tag -f cluster-11-v1.3-complete

Write-Host ""
Write-Host "Done. Cluster 15 v1.0 (Reminders) shipped:" -ForegroundColor Green
Write-Host "  - <vault>/Reminders.md (one line per reminder, parser tolerant)" -ForegroundColor Green
Write-Host "  - Three Tauri commands: read / write / delete-by-content" -ForegroundColor Green
Write-Host "  - ReminderOverlay (Ctrl+Shift+M) — scrim modal, quick-add + textarea" -ForegroundColor Green
Write-Host "  - NotificationBell next to LayoutPicker (count badge + red past-due)" -ForegroundColor Green
Write-Host "  - WebAudio beep on approaching / past-due transitions" -ForegroundColor Green
Write-Host "  - Resolve removes the line from disk" -ForegroundColor Green
Write-Host ""
Write-Host "Cluster 11 v1.3 (Calendar shortcut):" -ForegroundColor Green
Write-Host "  - Ctrl+Shift+C switches the active slot to Calendar" -ForegroundColor Green
Write-Host ""
Write-Host "Deferred (v1.1+): snooze, recurring reminders, NLP date parsing" -ForegroundColor DarkGray
