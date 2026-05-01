# Cluster 15 — Reminders

*Build order: Phase 3, on demand. Standalone — no upstream dependencies beyond Phase 1's vault + index.*

---

## What this is

A lightweight reminder system. One markdown file at `<vault>/Reminders.md` where every non-empty, non-header line is a reminder. The line's leading tokens auto-parse into a date and a time; the rest is the description.

The user-visible behavior:

- `Ctrl+Shift+M` opens a pop-up overlay (modal-style, like the command palette — NOT a slot view) that shows the contents of `Reminders.md` as an editable textarea, with a quick-add input at the top.
- A notification bell, immediately to the left of the LayoutPicker in App's top bar, shows the count of active reminders. The count badge is highlighted red if any reminder is past-due; otherwise it uses the accent colour.
- Clicking the bell opens a dropdown panel listing active reminders. Each has a "Resolve" button that removes the reminder's line from `Reminders.md`.
- A WebAudio-generated beep plays once when a reminder transitions to "approaching" (within 1 hour) or to "past-due". Already-alerted reminders are tracked in `localStorage` so the sound doesn't replay on every app reload.
- `Ctrl+Shift+C` opens the calendar in the active slot (small adjacent feature shipped in the same cluster).

Reminder line examples:

```
2026-04-29 14:30 Meeting with advisor
2026-04-29 Submit paper draft
14:30 Quick errand
Buy groceries
# Headings are ignored

## Quarterly goals    <-- ignored too
```

The parser produces:
- `2026-04-29 14:30 Meeting with advisor` → date=Apr 29, time=14:30, desc="Meeting with advisor"
- `2026-04-29 Submit paper draft` → date=Apr 29, time=null (all-day)
- `14:30 Quick errand` → date=null (interpreted as today), time=14:30
- `Buy groceries` → date=null, time=null (always pending)

## Why we want it

A research notebook needs lightweight time-anchored reminders for things that aren't full calendar events: "submit the form by Friday", "check on the experiment in 30 minutes", "ping advisor about Y by end of week". Cluster 11's calendar has the surface area for full events; reminders are the much-lighter-weight counterpart for things you'd otherwise jot in a sticky note or send yourself a text about.

A pop-up overlay (rather than a slot view) is the right shape because the typical interaction is "I just thought of something — capture it in 2 seconds and dismiss." Slot views are heavier; modal overlays match the command palette / search bubble model the rest of Cortex uses for transient capture.

## Why it's deferred

Not deferred — being built now, on user request. The trigger is direct: the user articulated a fairly complete UX spec (overlay capture, bell with sound, count badge, past-due red, parser semantics, resolve-removes-line) which is the strongest possible signal that this addresses an active friction.

## Decisions already made

- **Single file at `<vault>/Reminders.md`.** Visible in the file tree, hand-editable, indexed in FTS5 like any markdown note. No SQLite table needed.
- **Line-based, not YAML/JSON.** Keeps the file human-editable without UI mediation. The parser tolerates anything — a malformed line just becomes a "no date / no time" reminder with the line as its description.
- **Markdown headers (`#`, `##`, …) skipped by the parser.** Lets users organise the file with sections without those becoming bogus reminders.
- **Empty lines skipped.** Visual breathing room.
- **Resolve = delete the line from disk.** Per the user's spec. Simpler than a per-line "resolved" flag and matches the user's mental model of "if it's done, it's gone."
- **WebAudio beep, not an asset.** No bundled sound file; we generate a short tone in JS. Smaller binary, faster startup, one less file to git-track.
- **30-second polling cadence.** Cheap, and gives at most 30 seconds of latency between a reminder entering the 1-hour window and the bell reacting. Matches the calendar's "now" line cadence-wise.
- **No DB persistence of "alerted" state.** `localStorage` keyed on a hash of `(date, time, description)` tracks which reminders have already played a sound. Editing a reminder produces a new hash → re-arms the alert. Re-opening the app preserves alerted state (so re-launching at lunch doesn't re-play the morning's alerts).

## Decisions still open

### What counts as "active" for the bell badge

The user specified "approaching an hour" for the count. But also: "Reminders past their time/day should also be highlighted and marked as a notification." And: "If there is no date or time, automatically flag it as a notification at all times."

So three states contribute to the badge count:

- **Approaching**: scheduled within the next 1 hour.
- **Past-due**: scheduled time has passed (yesterday's all-day, or earlier-today's HH:MM).
- **Anytime**: no date, no time → always pending.

All three contribute to the count number. Past-due forces the bell to red regardless of mix.

### Sound trigger

Only on transition into approaching or past-due — not on every poll while in that state. Tracking is done in `localStorage` under `cortex:reminder-alerted:<hash>`. Two flags per hash: `approaching` and `past-due`. Setting both ensures we don't re-alert once the user has heard the sound.

### Past-due all-day reminders

`2026-04-28 Submit paper` opened on April 29 → past-due (yesterday). Fixed once midnight rolls over. We don't need a separate "almost-due" state for all-day reminders since they're a 24h "approaching" window already.

### Date formats

v1.0 only accepts `YYYY-MM-DD` (ISO). Adding `MM/DD/YYYY` or natural language ("tomorrow", "Friday") is a v1.1 nice-to-have if users want it. Cluster 11's NLP work will share the same parser eventually.

### Past dates with time

`2026-04-25 09:00 Long-overdue task` opened today → past-due, red, in the bell. Resolve to clear, or edit to reschedule.

## Architecture sketch

### File path

```
<vault>/Reminders.md
```

Created on demand — the first read returns "" if the file doesn't exist. Saving creates it.

### Tauri command surface

```rust
#[tauri::command]
fn read_reminders(vault_path: String) -> Result<String, String>;

#[tauri::command]
fn write_reminders(vault_path: String, content: String) -> Result<(), String>;

#[tauri::command]
fn delete_reminder_line(vault_path: String, line_content: String) -> Result<(), String>;
```

All three are synchronous file IO (no async needed). The file is small.

`delete_reminder_line` removes the FIRST line whose trimmed content matches the trimmed `line_content` argument. No-op if no match. This is more robust than passing a line index — survives the user editing the file between read and resolve.

### Frontend components

- `src/components/ReminderOverlay.tsx` — pop-up modal, textarea + quick-add. Reached via `Ctrl+Shift+M`.
- `src/components/NotificationBell.tsx` — bell button + dropdown panel listing active reminders with Resolve.
- `src/utils/reminders.ts` — `parseReminderLine`, `computeStatus`, `hashReminder`, `playBeep`.

### Notification panel UI

Click the bell → dropdown anchored to the bell. Each row:

- Status icon (red ⏱ for past-due, accent ⏰ for approaching, muted • for anytime/all-day-active).
- Date + time prefix (or "Today, all day" / "Anytime").
- Description.
- Resolve button on the right.

### Sound

WebAudio: create an `AudioContext` lazily, run a short oscillator (440Hz, ~120ms with a quick fade-out). Fire only on first-time transitions per reminder.

```js
function playBeep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.start();
  osc.stop(ctx.currentTime + 0.12);
}
```

## What this cluster doesn't include

- Snooze ("remind me again in 15 minutes"). v1.1.
- Recurring reminders. Use Cluster 11's RRULE if you need that — calendar events are the right surface for repeating commitments.
- Natural-language date input ("tomorrow", "next Friday"). v1.1, will piggyback on Cluster 11 v1.2's planned NLP work.
- Linking reminders to calendar events. Reasonable v2 idea but no current need.
- OS-level notifications outside the app window (toast popups when Cortex is minimised). Out of scope; the in-app bell is the v1.0 surface.

## Prerequisites

Phase 1 (vault + index). No dependency on Cluster 11.

## Triggers to build

The user articulated a fairly detailed UX spec in a single message — the strongest trigger evidence Phase 3 has seen.

## Effort estimate

~½ day, six small passes:

- Pass 1 (~½ hr): three Tauri commands.
- Pass 2 (~½ hr): parser + status helpers in TS.
- Pass 3 (~1 hr): `ReminderOverlay.tsx`.
- Pass 4 (~1.5 hr): `NotificationBell.tsx` + dropdown panel + WebAudio beep + alerted-localStorage tracking.
- Pass 5 (~10 min): Ctrl+Shift+C calendar shortcut + ShortcutsHelp updates.
- Pass 6 (~½ hr): verify script + NOTES.md + overview + tag.

## What this enables

- A future Cluster 16 could build a per-reminder "snooze" mechanic — adjusts the date/time and re-alerts.
- Cluster 11 v1.2 NLP work will share the parser; "tomorrow at 3pm" type input becomes available on both surfaces.

## Open questions to revisit during build

1. Should the file path be `Reminders.md` or `_Reminders.md` (underscore-prefixed to sort separately from regular notes)? v1 ships `Reminders.md`. Easy to rename later.
2. Should the bell show even when the count is 0? v1 hides at 0; otherwise it's just visual noise.
3. Should resolving a reminder also git-commit the change? Yes — the existing 30-second autosave / index pipeline already covers it. No separate logic needed.
4. Should the modal show ALL reminders, or just active ones? v1 shows the FILE — including past-due lines that haven't been resolved yet. Lets the user clean up.
