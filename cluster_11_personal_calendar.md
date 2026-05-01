# Cluster 11 — Personal Calendar

*Build order: Phase 3, on demand. Standalone, then sync clusters layer on top.*

---

## What this is

A local-first personal calendar built into Cortex: storage, week/month
views, click-and-drag event creation, categories with colors, an edit
modal with body notes that play nicely with the rest of the vault's
wikilink graph, and a daily-note auto-section that surfaces today's
events.

The user-visible behavior:

- New `Cal` sidebar button (or `Ctrl+Alt+C` — picked to dodge the
  large existing shortcut surface) opens the calendar in the active
  slot, exactly the way `Ideas`/`Methods`/`Protocols` already do.
- Default view is the week. A small toggle in the calendar header
  flips to Month.
- Click-and-drag inside an empty area of the week grid drafts a new
  event with start/end pre-filled; releasing the mouse opens the edit
  modal.
- Click an existing event to open the same modal.
- Categories live in their own settings panel (5 starter categories
  shipped: Work / Personal / Health / Learning / Social, each with a
  pre-assigned colour from the existing CSS palette).
- A horizontal "now" line marks the current time on day/week views.
- Each event has a body field rendered with the existing TipTap
  editor, so `[[wikilink]]` resolution Just Works for linking
  events to research notes.
- Today's daily note gains a `## Today's calendar` auto-section that
  lists today's events between `<!-- CALENDAR-AUTO-START -->` and
  `<!-- CALENDAR-AUTO-END -->` markers — same shape Cluster 8 v2
  introduced for Methods reagents and Cluster 10 reused for GitHub.

## Why we want it

Calendars are research-relevant: advisor meetings, conference
deadlines, paper submission dates, lab access windows, recurring
reading groups. Currently those live in your Google or Outlook
account, which means alt-tabbing to remember what's happening today.

Building a local-first calendar inside Cortex (rather than just
syncing) is the right move because:

- The body field can hold an agenda + links to relevant Cortex notes
  (`[[Idea — XYZ]]`, `[[Experiment — ABC / iter-3]]`). Cluster 11
  events become first-class citizens of the wikilink graph — that's
  the killer feature Notion Calendar users cite, and it's
  unimplementable on top of a sync-only backend.
- Cortex must work offline. A sync-first approach would require
  read-write authentication tokens to be valid for the calendar UI
  to render. A local-first approach degrades gracefully: sync layers
  add bidirectional flow, but the calendar itself never depends on
  network.
- Pacing: Cluster 12 (Google sync) and Cluster 13 (Outlook sync) are
  each multi-day OAuth + refresh-token efforts. Building Cluster 11
  first decouples the value (a usable calendar) from the integration
  pain.

## Why it's deferred

Cluster 11 doesn't have prior triggers from the trial journal —
unlike Cluster 6 (PDF reader), where the trigger evidence was real,
Cluster 11 is being built on the user's stated long-term vision. That
means the strongest signal that v1.0 is right is whether the user
actually opens it daily after a week of use. The deferred features
(recurrence, NLP, heat map, pie, multi-tz, density toggle, day view)
are the ones most likely to be reshuffled by real use; building all
of them speculatively would violate the overview's pacing rule.

## Decisions already made

- **Local-first.** Storage is in the project's existing SQLite index.
  No external sync in this cluster.
- **5 starter categories.** Work / Personal / Health / Learning /
  Social. Editable in a settings panel; the user can add more, but
  the UI gently warns past 8 (the visual-noise threshold called out
  in the user's spec).
- **Hand-rolled grid.** No `react-big-calendar`, no `@fullcalendar`.
  CSS Grid + plain React. Day-by-day, hour-by-hour. The Cluster 6
  PDF reader's iterative ship pattern is the precedent.
- **Body rendered with TipTap.** Reuses the editor instance pattern
  TabPane already exposes. Wikilinks resolve via the same path the
  main editor uses.
- **Daily-note auto-section.** Mirrors GitHub's `## Today's GitHub
  activity` exactly — section-scoped HTML markers, idempotent splice,
  gated to today's basename only.
- **Storage in SQLite, not as one-file-per-event.** The sidecar /
  one-file-per-event pattern works for PDFs (where the asset is the
  PDF and the sidecar is small) but events are small and there will
  be hundreds — a SQLite table is the right shape, with FTS5 indexing
  on title+body so events are command-palette-searchable from day 1.

## Decisions still open

### Schema details

The `events` table:

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,           -- "evt-YYYY-MM-DD-N"
  title         TEXT NOT NULL,
  start_at      INTEGER NOT NULL,           -- unix seconds, UTC
  end_at        INTEGER NOT NULL,           -- unix seconds, UTC
  all_day       INTEGER NOT NULL DEFAULT 0, -- 0/1
  category      TEXT NOT NULL,              -- foreign-key-ish to event_categories.id
  status        TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'tentative'
  body          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_events_start ON events(start_at);
CREATE INDEX idx_events_end   ON events(end_at);

CREATE TABLE event_categories (
  id            TEXT PRIMARY KEY,           -- 'work', 'personal', etc.
  label         TEXT NOT NULL,
  color         TEXT NOT NULL,              -- CSS hex or var name
  sort_order    INTEGER NOT NULL DEFAULT 0
);
```

Open: do we add a `tags` column or a separate `event_tags` table for
v1.1 once tag-filtering matters? Defer.

### Recurrence (v1.1, not v1.0)

When v1.1 lands, recurrence will use **iCal RRULE strings** stored on
a separate `event_recurrences` table that points at a "master" event;
generated instances are computed on read (using the `rrule` npm
package on the frontend) rather than materialised in the database.
This is the standard pattern; the `rrule` package handles "every other
Tuesday", "last Friday of the month", etc.

The hard problem in v1.1 is **single-instance modification** — when
the user drags an instance of "Standup" 30 min later, do we (a) break
the chain (turn that one into a non-recurring event), (b) keep it as
an exception (RRULE EXDATE), or (c) add it as an override (RRULE
EXDATE + a new event)? Outlook and Google both do (c); we'll match.

### Natural language input (v1.2, not v1.0)

`chrono-node` (~10KB) parses dates. The flow: a single text input at
the top of the calendar, type "Lunch with Sara at Joe's tomorrow at
1pm for 90 min", press Enter → modal opens with everything
pre-filled, user reviews and saves. Defer to v1.2.

### Heat map (v1.3, not v1.0)

A small calendar-shaped grid where each day's cell darkens with hours
committed. Implementation: aggregate `SUM(end_at - start_at)` grouped
by day-of-the-current-window. Use the existing CSS palette's
`--accent` with progressive opacity stops (5 levels: 0–10%, 10–25%,
25–50%, 50–80%, 80%+). Defer.

### Pie / time analytics (v1.4, not v1.0)

Recharts is already used elsewhere in the artifact pattern; not yet
in the main app, but adding it for one cluster is acceptable. The
real work is the aggregation queries (per-category time breakdown
within a user-chosen window) and the window picker UI (week / month
/ all time / custom range). Defer.

### Multi-timezone strip (v1.5, not v1.0)

Always-visible strip on the calendar's left or right showing 2–4
configurable cities' current times, plus their corresponding hour
labels next to the day-view hour grid. Storage is just a JSON array
in user preferences. Defer.

### Tentative-vs-confirmed visual

Solid background for confirmed; diagonal-stripe (`background-image:
repeating-linear-gradient(...)`) for tentative. v1.0 will ship this
since it's ~5 lines of CSS and the user's spec calls it out
explicitly.

### Density toggle (30/15/60 min)

A control in the calendar header. Affects the hour-slot height
(rendered as `--slot-height: 48px` for 60-min, 24px for 30-min, 12px
for 15-min). Affects only day/week views, not month. Defer to v1.6
because the v1.0 grid needs to be solid before being reshaped.

### Day view

A separate ActiveView with one column instead of seven. Cheap
(maybe half a day) but not in v1.0. Add as v1.6 with the density
toggle.

## Architecture sketch

### Component layout

```
src/components/Calendar.tsx          ← main view, hosted in TabPane
src/components/CalendarWeekGrid.tsx  ← week grid (7 columns × 24 hours)
src/components/CalendarMonthGrid.tsx ← month grid (5–6 rows × 7 days)
src/components/EventEditModal.tsx    ← create/edit modal
src/components/CategoriesSettings.tsx ← edit categories panel
```

`Calendar` owns: current view (week | month), current window (anchor
date), event-list state for the visible window, event being edited.

### Tauri command surface

```rust
// CRUD
list_events_in_range(vault_path, start_unix, end_unix) -> Vec<Event>
create_event(vault_path, title, start_at, end_at, all_day, category, status, body) -> EventId
update_event(vault_path, id, ... fields ...) -> ()
delete_event(vault_path, id) -> ()

// Categories
list_event_categories(vault_path) -> Vec<EventCategory>
upsert_event_category(vault_path, id, label, color, sort_order) -> ()
delete_event_category(vault_path, id) -> () // cascade fails if any events reference it; v1 forces the user to reassign first

// Daily-note section
regenerate_calendar_section(app, vault_path, file_path) -> () // mirrors regenerate_github_section
```

### Storage initialization

The vault index database (`<vault>/.research-hub/index.sqlite`) gets
two new tables. Migration is the existing
`CREATE TABLE IF NOT EXISTS …` pattern (no version tracking yet) — if
the user has the schema, the CREATE is a no-op.

The 5 default categories are seeded the first time
`list_event_categories` is called and the table is empty.

### Click-and-drag implementation

CSS-Grid week view with `position: relative` columns. A pointer-down
handler on a column starts capturing pointer-move events; the draft
event is rendered as an absolute-positioned div whose top/height
update with the pointer's Y position rounded to 15-min increments. On
pointer-up, the modal opens with the start/end pre-filled.

### "Now" line

A horizontal `position: absolute` div at the column's `top: now-y`
where `now-y = (current-minutes-since-midnight / total-minutes) *
column-height`. Updated on a 1-minute `setInterval`.

### Daily-note auto-section

Same shape as `regenerate_github_section`:

```
## Today's calendar

<!-- CALENDAR-AUTO-START -->
- 09:00–10:00 — **Morning standup** _(Work)_
- 11:00–12:00 — **Advisor meeting** _(Work)_
  - [[Meeting prep — Advisor 2026-04-28]]
- 14:00–15:00 — _(tentative)_ Reading group: Smith 2024
<!-- CALENDAR-AUTO-END -->
```

Wikilinks in event bodies are surfaced under each event as a sublist.
Tentative events get the `_(tentative)_` qualifier so the markdown
renders the visual distinction even outside the calendar UI.

### What this cluster doesn't include

- External sync (Google → Cluster 12; Outlook → Cluster 13)
- Recurring events (deferred to v1.1)
- Natural language input (v1.2)
- Heat map (v1.3)
- Pie / time analytics (v1.4)
- Multi-timezone strip (v1.5)
- Density toggle (v1.6)
- Day view (v1.6, alongside density)
- Reminders / notifications (would require a notification system —
  out of scope for any v1.x of this cluster)
- Calendar export (.ics download) — useful but defer
- Drag-resize / drag-move existing events on the grid — deferred to
  v1.1 alongside recurrence; v1.0 supports edit-via-modal only

## Prerequisites

Phase 1 complete (vault, SQLite index, TipTap editor). The existing
`vault_index_path` helper and the `index_single_file` reindex pattern
are reused.

## Triggers to build

The user explicitly chose to build this without a trial-journal
trigger — the trigger evidence is the long-term-vision document the
user provided in this session. The strongest signal that v1.0 is
right is whether the user opens the calendar daily after a week of
use. If after a week the calendar isn't being opened, the cluster
should be revisited and v1.1+ work paused.

## Effort estimate

v1.0: 3–4 days, six passes:

- Pass 1 (~½ day): events table + categories table + CRUD Tauri
  commands + 5-default seeding.
- Pass 2 (~1.5 days): `Calendar.tsx` shell, `CalendarWeekGrid.tsx`,
  `CalendarMonthGrid.tsx`, "now" line, basic event rendering, navigation
  (prev/next week/month, today).
- Pass 3 (~½ day): `EventEditModal.tsx` with all fields + body via
  TipTap.
- Pass 4 (~½ day): sidebar wiring, ActiveView, tentative-vs-confirmed
  styling.
- Pass 5 (~½ day): daily-note auto-section.
- Pass 6 (~½ day): verify script + NOTES.md + overview update + tag.

## What this enables

- Cluster 12 — Google Calendar sync. Cluster 11 provides the local
  schema; Cluster 12 is two-way sync over OAuth.
- Cluster 13 — Outlook Calendar sync. Reuses Cluster 12's OAuth
  scaffold.
- Cluster 14 — Time tracking analytics. Compares planned (events) vs
  actual (logged) time.
- Linking events to research notes via wikilinks. Already enabled in
  v1.0 by reusing TipTap; the explicit deliverable is the daily-note
  surfacing.

## Open questions to revisit during build

1. **Where does the events table live?** The SQLite index is
   currently rebuilt from the filesystem on demand (`rebuild_index`).
   If `events` lives in the same DB and `rebuild_index` doesn't
   touch it, that's fine. Worth confirming `rebuild_index` doesn't
   `DROP TABLE IF EXISTS events` somewhere (it shouldn't).
2. **Day-of-week start.** Sunday-first vs Monday-first vs ISO-week
   start. v1.0 will ship Monday-first (ISO). Add a preference if it
   bites.
3. **Time zone for storage.** All-UTC in the DB, all-local for
   render. Standard. The hand-rolled `today_iso_date` and friends
   already accept the UTC-vs-local drift around midnight; mirror.
4. **Long events that span midnight.** Render as two segments (one
   in each day's column) with a tiny "↘ continues" indicator, or
   render the full block straddling? v1.0: render in the start day
   only with an "ends X:YY tomorrow" qualifier; revisit if users
   actually have many overnight events.
5. **Conflict highlighting.** When two events overlap, render them
   side by side at half-width. v1.0 will ship this — it's expected
   behavior; absence would confuse.
6. **Keyboard shortcuts inside the calendar.** Defer all but a small
   set: arrow keys to navigate the week, `T` to jump to today,
   `1`/`2` to switch view (week/month). v1.0 ships these only if
   they don't collide with the main keyboard map.
7. **Editing an event's category.** Dropdown in the modal. If the
   user adds a new category mid-edit, the dropdown should update. v1
   will reload the category list each time the modal opens.
