import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EventEditModal } from "./EventEditModal";
import { CategoriesSettings } from "./CategoriesSettings";

export interface CalendarEvent {
  id: string;
  title: string;
  start_at: number;
  end_at: number;
  all_day: boolean;
  category: string;
  status: string; // 'confirmed' | 'tentative'
  body: string;
  created_at: number;
  updated_at: number;
  /** v1.1: RFC 5545 RRULE string when this event is part of a
   *  recurring series. null on standalone events. Expanded
   *  occurrences carry the master's rule through. */
  recurrence_rule?: string | null;
  /** v1.4: notification mode ('all_day' | 'urgent' | 'ahead') or null. */
  notify_mode?: string | null;
  /** v1.4: lead time in minutes when notify_mode === 'ahead'. */
  notify_lead_minutes?: number | null;
}

export interface EventCategory {
  id: string;
  label: string;
  color: string;
  sort_order: number;
}

interface CalendarProps {
  vaultPath: string;
  onClose: () => void;
}

type ViewMode = "week" | "month";

const DAY_SECS = 86_400;
const HOUR_SECS = 3600;
const MIN_SECS = 60;

// Snapping granularity for click-and-drag — 15 min mirrors the
// industry default. Events created via the modal can still hit any
// minute manually.
const DRAG_SNAP_MIN = 15;

/**
 * Cluster 11 v1.0 — Personal Calendar.
 *
 * Hand-rolled grid (CSS-Grid) so we keep the dependency surface
 * small and the styling consistent with the rest of Cortex. Handles
 * week + month views; click-and-drag in week view drafts a new
 * event; click an existing event to open the edit modal.
 *
 * Times in storage are unix seconds in UTC. Rendering converts to
 * the user's local time via standard Date methods. The "now" line
 * is recomputed each minute.
 */
export function Calendar({ vaultPath, onClose }: CalendarProps) {
  const [view, setView] = useState<ViewMode>("week");
  // Anchor date — start of the visible window. Stored as unix seconds.
  // For week view, this is the Monday 00:00 local of the visible week.
  const [anchor, setAnchor] = useState<number>(() =>
    mondayStartLocal(nowSecs()),
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    event: CalendarEvent | null;
    defaultStart?: number;
    defaultEnd?: number;
  } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // Compute the visible date range (local-time bounds → unix-seconds for the API).
  const dateRange = useMemo(() => {
    if (view === "week") {
      return { start: anchor, end: anchor + 7 * DAY_SECS };
    }
    // Month view: from the Monday of the week containing the 1st of
    // the anchor's month, plus 6 weeks. That gives a stable 6×7 grid.
    const d = new Date(anchor * 1000);
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const start = mondayStartLocal(Math.floor(firstOfMonth.getTime() / 1000));
    return { start, end: start + 42 * DAY_SECS };
  }, [view, anchor]);

  const reload = useCallback(async () => {
    if (!vaultPath) return;
    setLoading(true);
    setError(null);
    try {
      const [evs, cats] = await Promise.all([
        invoke<CalendarEvent[]>("list_events_in_range", {
          vaultPath,
          startUnix: dateRange.start,
          endUnix: dateRange.end,
        }),
        invoke<EventCategory[]>("list_event_categories", { vaultPath }),
      ]);
      setEvents(evs);
      setCategories(cats);
    } catch (e) {
      setError(`Couldn't load calendar: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [vaultPath, dateRange.start, dateRange.end]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Re-tick once a minute so the "now" line updates and any future
  // bound checks stay current. Not on the load path.
  const [nowTick, setNowTick] = useState(nowSecs());
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(nowSecs()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  function navigatePrev() {
    if (view === "week") {
      setAnchor((a) => a - 7 * DAY_SECS);
    } else {
      const d = new Date(anchor * 1000);
      d.setMonth(d.getMonth() - 1);
      setAnchor(Math.floor(d.getTime() / 1000));
    }
  }
  function navigateNext() {
    if (view === "week") {
      setAnchor((a) => a + 7 * DAY_SECS);
    } else {
      const d = new Date(anchor * 1000);
      d.setMonth(d.getMonth() + 1);
      setAnchor(Math.floor(d.getTime() / 1000));
    }
  }
  function navigateToday() {
    if (view === "week") {
      setAnchor(mondayStartLocal(nowSecs()));
    } else {
      const d = new Date();
      const firstOfMonth = new Date(
        d.getFullYear(),
        d.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      setAnchor(Math.floor(firstOfMonth.getTime() / 1000));
    }
  }

  function openNewEvent(start: number, end: number) {
    setEditing({ event: null, defaultStart: start, defaultEnd: end });
  }
  function openExistingEvent(ev: CalendarEvent) {
    setEditing({ event: ev });
  }
  function closeEdit() {
    setEditing(null);
  }
  async function saveEdit(
    payload: Omit<CalendarEvent, "id" | "created_at" | "updated_at"> & {
      id?: string;
      recurrence_rule?: string | null;
      notify_mode?: string | null;
      notify_lead_minutes?: number | null;
    },
  ) {
    try {
      if (payload.id) {
        await invoke("update_event", {
          vaultPath,
          id: payload.id,
          title: payload.title,
          startAt: payload.start_at,
          endAt: payload.end_at,
          allDay: payload.all_day,
          category: payload.category,
          status: payload.status,
          body: payload.body,
          recurrenceRule: payload.recurrence_rule ?? null,
          notifyMode: payload.notify_mode ?? null,
          notifyLeadMinutes: payload.notify_lead_minutes ?? null,
        });
      } else {
        await invoke("create_event", {
          vaultPath,
          title: payload.title,
          startAt: payload.start_at,
          endAt: payload.end_at,
          allDay: payload.all_day,
          category: payload.category,
          status: payload.status,
          body: payload.body,
          recurrenceRule: payload.recurrence_rule ?? null,
          notifyMode: payload.notify_mode ?? null,
          notifyLeadMinutes: payload.notify_lead_minutes ?? null,
        });
      }
      closeEdit();
      reload();
      regenerateTodaysDailyNote();
    } catch (e) {
      setError(`Save failed: ${e}`);
    }
  }
  async function deleteEdit(id: string) {
    if (!window.confirm("Delete this event? This cannot be undone.")) return;
    try {
      await invoke("delete_event", { vaultPath, id });
      closeEdit();
      reload();
      regenerateTodaysDailyNote();
    } catch (e) {
      setError(`Delete failed: ${e}`);
    }
  }

  /**
   * Re-splice today's daily note `## Today's calendar` section after
   * any event mutation. Idempotent — no-op if today's daily note
   * doesn't exist yet (e.g., the user hasn't opened it). Invoked from
   * saveEdit / deleteEdit so the daily note stays current even when
   * it's open in another slot or hasn't been re-clicked.
   *
   * v1.2: passes the user's tz offset so the Rust side can resolve
   * "today" against the user's local day rather than UTC. Without
   * this, events created outside the UTC window for the basename's
   * date were silently excluded.
   */
  async function regenerateTodaysDailyNote() {
    if (!vaultPath) return;
    try {
      const today = todayLocalIso();
      // Path-separator detection mirrors selectFileInSlot's heuristic.
      const sep = vaultPath.includes("\\") ? "\\" : "/";
      const filePath = `${vaultPath}${sep}02-Daily Log${sep}${today}.md`;
      await invoke("regenerate_calendar_section", {
        vaultPath,
        filePath,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
    } catch (e) {
      // Surface the error in the calendar's banner — most likely
      // cause is "command not found" from a stale Tauri binary.
      console.warn("[calendar] regenerate_calendar_section failed:", e);
      setError(
        `Daily-note refresh failed: ${e}. If this is the first run after a Rust change, restart pnpm tauri dev.`,
      );
    }
  }

  const titleLabel = useMemo(() => {
    const startD = new Date(anchor * 1000);
    if (view === "week") {
      const endD = new Date((anchor + 6 * DAY_SECS) * 1000);
      return `${formatMonthDay(startD)} – ${formatMonthDay(endD)}, ${endD.getFullYear()}`;
    }
    const d = new Date(anchor * 1000);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }, [anchor, view]);

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button
            onClick={onClose}
            style={styles.btnGhost}
            title="Close calendar"
          >
            ← Back
          </button>
          <button onClick={navigateToday} style={styles.btnGhost}>
            Today
          </button>
          <button
            onClick={navigatePrev}
            style={styles.iconBtn}
            aria-label="Previous"
          >
            ◀
          </button>
          <button
            onClick={navigateNext}
            style={styles.iconBtn}
            aria-label="Next"
          >
            ▶
          </button>
          <strong style={styles.titleLabel}>{titleLabel}</strong>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.viewToggle}>
            <button
              onClick={() => setView("week")}
              style={view === "week" ? styles.toggleOn : styles.toggleOff}
            >
              Week
            </button>
            <button
              onClick={() => setView("month")}
              style={view === "month" ? styles.toggleOn : styles.toggleOff}
            >
              Month
            </button>
          </div>
          <button
            onClick={() =>
              openNewEvent(
                roundedNextHour(nowSecs()),
                roundedNextHour(nowSecs()) + HOUR_SECS,
              )
            }
            style={styles.btnPrimary}
          >
            + New event
          </button>
          <button
            onClick={() => setCategoriesOpen(true)}
            style={styles.btnGhost}
            title="Manage categories"
          >
            Categories
          </button>
        </div>
      </header>

      {error && (
        <div style={styles.error}>
          {error}
          <button onClick={() => setError(null)} style={styles.btnGhost}>
            dismiss
          </button>
        </div>
      )}

      <div style={styles.body}>
        {loading && events.length === 0 ? (
          <p style={styles.muted}>Loading…</p>
        ) : view === "week" ? (
          <WeekView
            anchor={anchor}
            now={nowTick}
            events={events}
            categories={categories}
            onSlotDraft={openNewEvent}
            onEventClick={openExistingEvent}
          />
        ) : (
          <MonthView
            anchor={anchor}
            events={events}
            categories={categories}
            onDayClick={(dayStart) => {
              const start = dayStart + 9 * HOUR_SECS;
              openNewEvent(start, start + HOUR_SECS);
            }}
            onEventClick={openExistingEvent}
          />
        )}
      </div>

      {editing && (
        <EventEditModal
          isOpen={true}
          existingEvent={editing.event}
          defaultStart={editing.defaultStart ?? nowSecs()}
          defaultEnd={editing.defaultEnd ?? nowSecs() + HOUR_SECS}
          categories={categories}
          onClose={closeEdit}
          onSave={saveEdit}
          onDelete={deleteEdit}
        />
      )}

      {categoriesOpen && (
        <CategoriesSettings
          vaultPath={vaultPath}
          isOpen={categoriesOpen}
          onClose={() => {
            setCategoriesOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Week view
// -----------------------------------------------------------------------------

interface WeekViewProps {
  anchor: number; // Monday 00:00 local of this week, unix seconds
  now: number;
  events: CalendarEvent[];
  categories: EventCategory[];
  onSlotDraft: (start: number, end: number) => void;
  onEventClick: (ev: CalendarEvent) => void;
}

function WeekView({
  anchor,
  now,
  events,
  categories,
  onSlotDraft,
  onEventClick,
}: WeekViewProps) {
  // Hour rows: 0..24. Each row is HOUR_HEIGHT px tall.
  const HOUR_HEIGHT = 48;
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const dayStarts = Array.from({ length: 7 }, (_, i) => anchor + i * DAY_SECS);
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.color));
    return m;
  }, [categories]);

  // Click-and-drag draft state. Stored per-day so the user dragging
  // in column A doesn't paint a phantom block in column B.
  const [draft, setDraft] = useState<{
    dayIdx: number;
    fromMin: number;
    toMin: number;
  } | null>(null);
  const dragColRef = useRef<HTMLDivElement | null>(null);

  function handlePointerDown(
    dayIdx: number,
    e: React.PointerEvent<HTMLDivElement>,
  ) {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragColRef.current = target;
    const min = pointerToMinuteOfDay(e, target, HOUR_HEIGHT);
    const snapped = snapMinutes(min, DRAG_SNAP_MIN);
    setDraft({ dayIdx, fromMin: snapped, toMin: snapped + DRAG_SNAP_MIN });
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const target = dragColRef.current;
    if (!target) return;
    const min = pointerToMinuteOfDay(e, target, HOUR_HEIGHT);
    const snapped = snapMinutes(min, DRAG_SNAP_MIN);
    setDraft((d) => (d ? { ...d, toMin: snapped } : null));
  }
  function handlePointerUp() {
    if (!draft) return;
    const dayStart = dayStarts[draft.dayIdx];
    const fromMin = Math.min(draft.fromMin, draft.toMin);
    const toMin = Math.max(draft.fromMin, draft.toMin);
    const start = dayStart + fromMin * MIN_SECS;
    // If the user clicked without dragging (zero range), default to a
    // 1-hour event ending at the next hour boundary.
    const end =
      toMin === fromMin ? start + HOUR_SECS : dayStart + toMin * MIN_SECS;
    setDraft(null);
    dragColRef.current = null;
    onSlotDraft(start, end);
  }

  // Now-line: only render if "now" is within the visible window.
  const inWindow = now >= anchor && now < anchor + 7 * DAY_SECS;
  const nowDayIdx = inWindow ? Math.floor((now - anchor) / DAY_SECS) : -1;
  const nowMinOfDay = inWindow
    ? Math.floor((now - dayStarts[nowDayIdx]) / 60)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={styles.weekHeader}>
        <div style={styles.timeColHeader} />
        {dayStarts.map((s, i) => {
          const d = new Date(s * 1000);
          const isToday = sameLocalDay(s, now);
          return (
            <div
              key={i}
              style={{
                ...styles.dayHeader,
                color: isToday ? "var(--accent)" : "var(--text-2)",
                fontWeight: isToday ? 600 : 500,
              }}
            >
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>
                {DAYS_SHORT[d.getDay()]}
              </div>
              <div style={{ fontSize: "1rem" }}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div style={styles.weekBody}>
        <div style={styles.timeCol}>
          {HOURS.map((h) => (
            <div key={h} style={{ ...styles.timeLabel, height: HOUR_HEIGHT }}>
              {h.toString().padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {dayStarts.map((dayStart, dayIdx) => {
          const dayEnd = dayStart + DAY_SECS;
          const dayEvents = events.filter(
            (e) => e.start_at < dayEnd && e.end_at > dayStart && !e.all_day,
          );
          // Conflict layout — group overlapping events into columns
          // for side-by-side rendering at half/third width.
          const laidOut = layoutEventsForDay(dayEvents);

          return (
            <div
              key={dayIdx}
              style={{ ...styles.dayCol, height: HOUR_HEIGHT * 24 }}
              onPointerDown={(e) => handlePointerDown(dayIdx, e)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                setDraft(null);
                dragColRef.current = null;
              }}
            >
              {/* Hour grid lines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{
                    ...styles.hourLine,
                    top: h * HOUR_HEIGHT,
                  }}
                />
              ))}

              {/* Events */}
              {laidOut.map((ev) => {
                const startMin = Math.max(
                  0,
                  (ev.event.start_at - dayStart) / 60,
                );
                const endMin = Math.min(
                  24 * 60,
                  (ev.event.end_at - dayStart) / 60,
                );
                const top = (startMin / 60) * HOUR_HEIGHT;
                const height = Math.max(
                  16,
                  ((endMin - startMin) / 60) * HOUR_HEIGHT,
                );
                const color = colorById.get(ev.event.category) ?? "#888";
                const tentative = ev.event.status === "tentative";
                // Recurring events surface multiple occurrences with
                // the same `id` (the master id); compose a unique
                // React key from id + start so the keys stay stable.
                const renderKey = `${ev.event.id}@${ev.event.start_at}`;
                return (
                  <button
                    key={renderKey}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(ev.event);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      ...styles.eventBlock,
                      top,
                      height,
                      left: `${(ev.col / ev.cols) * 100}%`,
                      width: `calc(${100 / ev.cols}% - 4px)`,
                      background: tentative
                        ? `repeating-linear-gradient(135deg, ${color}33 0 8px, ${color}1a 8px 16px)`
                        : `${color}33`,
                      borderLeft: `3px solid ${color}`,
                      ...(tentative
                        ? {
                            borderStyle: "dashed",
                            borderWidth: "1px 1px 1px 3px",
                            borderColor: color,
                          }
                        : {}),
                    }}
                    title={`${ev.event.title}${tentative ? " (tentative)" : ""}`}
                  >
                    <div style={styles.eventTitle}>{ev.event.title}</div>
                    <div style={styles.eventTime}>
                      {formatHHMM(ev.event.start_at)}–
                      {formatHHMM(ev.event.end_at)}
                    </div>
                  </button>
                );
              })}

              {/* Click-drag draft */}
              {draft && draft.dayIdx === dayIdx && (
                <div
                  style={{
                    ...styles.draftBlock,
                    top:
                      (Math.min(draft.fromMin, draft.toMin) / 60) * HOUR_HEIGHT,
                    height:
                      (Math.abs(draft.toMin - draft.fromMin) / 60) *
                        HOUR_HEIGHT || 16,
                  }}
                />
              )}

              {/* "Now" line */}
              {dayIdx === nowDayIdx && (
                <div
                  style={{
                    ...styles.nowLine,
                    top: (nowMinOfDay / 60) * HOUR_HEIGHT,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Month view
// -----------------------------------------------------------------------------

interface MonthViewProps {
  anchor: number; // first visible Monday (start of the 6×7 grid)
  events: CalendarEvent[];
  categories: EventCategory[];
  onDayClick: (dayStart: number) => void;
  onEventClick: (ev: CalendarEvent) => void;
}

function MonthView({
  anchor,
  events,
  categories,
  onDayClick,
  onEventClick,
}: MonthViewProps) {
  const days = Array.from({ length: 42 }, (_, i) => anchor + i * DAY_SECS);
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.color));
    return m;
  }, [categories]);
  const focusMonth = new Date(anchor * 1000);
  // The focus month is the month of the day in the middle row to
  // disambiguate which month's grid we're showing.
  const focusMonthIdx = new Date((anchor + 14 * DAY_SECS) * 1000).getMonth();

  return (
    <div style={styles.monthGrid}>
      <div style={styles.monthHeader}>
        {DAYS_SHORT.slice(1)
          .concat(DAYS_SHORT[0])
          .map((label) => (
            <div key={label} style={styles.monthDayLabel}>
              {label}
            </div>
          ))}
      </div>
      <div style={styles.monthBody}>
        {days.map((s) => {
          const d = new Date(s * 1000);
          const dayEnd = s + DAY_SECS;
          const dayEvents = events.filter(
            (ev) => ev.start_at < dayEnd && ev.end_at > s,
          );
          const isFocusMonth = d.getMonth() === focusMonthIdx;
          const isToday = sameLocalDay(s, nowSecs());
          return (
            <div
              key={s}
              style={{
                ...styles.monthCell,
                opacity: isFocusMonth ? 1 : 0.45,
                background: isToday ? "var(--bg-elev)" : "transparent",
              }}
              onClick={() => onDayClick(s)}
            >
              <div
                style={{
                  ...styles.monthDayNum,
                  color: isToday ? "var(--accent)" : "var(--text-2)",
                  fontWeight: isToday ? 700 : 500,
                }}
              >
                {d.getDate()}
              </div>
              <div style={styles.monthDayEvents}>
                {dayEvents.slice(0, 3).map((ev) => {
                  const color = colorById.get(ev.category) ?? "#888";
                  // Same key composition as WeekView so recurring
                  // occurrences don't collide on `id` alone.
                  const renderKey = `${ev.id}@${ev.start_at}`;
                  return (
                    <div
                      key={renderKey}
                      style={{
                        ...styles.monthEventChip,
                        background: `${color}33`,
                        borderLeft: `3px solid ${color}`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      title={ev.title}
                    >
                      {ev.all_day ? "" : `${formatHHMM(ev.start_at)} `}
                      {ev.title}
                    </div>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div style={styles.monthMore}>
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "none" }}>{focusMonth.getMonth()}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helpers (date math + layout)
// -----------------------------------------------------------------------------

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Local YYYY-MM-DD for today — matches Rust's today_iso_date / the
 *  daily-note basename convention. */
function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Monday 00:00 local of the week containing the given unix-seconds
 * timestamp. Day-of-week start is Monday (ISO) per the cluster doc
 * decision; flip to Sunday by changing `(d.getDay() + 6) % 7` to
 * `d.getDay()`.
 */
function mondayStartLocal(secs: number): number {
  const d = new Date(secs * 1000);
  const day = (d.getDay() + 6) % 7; // Mon=0, Sun=6
  const monday = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() - day,
    0,
    0,
    0,
    0,
  );
  return Math.floor(monday.getTime() / 1000);
}

function sameLocalDay(secs: number, refSecs: number): boolean {
  const a = new Date(secs * 1000);
  const b = new Date(refSecs * 1000);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHHMM(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatMonthDay(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function roundedNextHour(secs: number): number {
  const d = new Date(secs * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return Math.floor(d.getTime() / 1000);
}

function pointerToMinuteOfDay(
  e: React.PointerEvent,
  target: HTMLDivElement,
  hourHeight: number,
): number {
  const rect = target.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const minutes = Math.max(
    0,
    Math.min(24 * 60 - 1, Math.round((y / hourHeight) * 60)),
  );
  return minutes;
}

function snapMinutes(min: number, snap: number): number {
  return Math.round(min / snap) * snap;
}

interface LaidOut {
  event: CalendarEvent;
  col: number;
  cols: number;
}

/**
 * Lay out overlapping events into columns. Greedy: assign each event
 * to the first column whose existing events don't overlap. Then for
 * each event, set `cols` = the maximum number of columns used by any
 * event in its overlap-cluster.
 */
function layoutEventsForDay(events: CalendarEvent[]): LaidOut[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.start_at - b.start_at);
  const cols: CalendarEvent[][] = [];
  const placement = new Map<string, number>();
  for (const ev of sorted) {
    let placed = false;
    for (let i = 0; i < cols.length; i++) {
      const last = cols[i][cols[i].length - 1];
      if (last.end_at <= ev.start_at) {
        cols[i].push(ev);
        placement.set(ev.id, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      cols.push([ev]);
      placement.set(ev.id, cols.length - 1);
    }
  }
  // For each event, find the max column count among events it
  // overlaps with — that's the divisor for its width.
  const totalCols = Math.max(1, cols.length);
  return sorted.map((ev) => ({
    event: ev,
    col: placement.get(ev.id) ?? 0,
    // Use the global cluster column count; not perfect for sparse
    // overlaps but visually consistent.
    cols: totalCols,
  }));
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    boxSizing: "border-box",
    padding: "0.75rem 1rem 1rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: "0.6rem",
    marginBottom: "0.6rem",
    borderBottom: "1px solid var(--border)",
    gap: "0.5rem",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  titleLabel: {
    marginLeft: "0.4rem",
    fontSize: "0.95rem",
    color: "var(--text)",
  },
  viewToggle: {
    display: "flex",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    overflow: "hidden",
  },
  toggleOn: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    background: "var(--accent)",
    color: "white",
    border: "none",
    cursor: "pointer",
  },
  toggleOff: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    background: "transparent",
    color: "var(--text-2)",
    border: "none",
    cursor: "pointer",
  },
  iconBtn: {
    width: "26px",
    height: "26px",
    background: "transparent",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    cursor: "pointer",
    color: "var(--text-2)",
  },
  btnGhost: {
    padding: "4px 10px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  body: { flex: 1, overflow: "auto", position: "relative" },
  error: {
    padding: "0.5rem 0.75rem",
    margin: "0 0 0.6rem",
    background: "var(--bg-elev)",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.85rem",
  },
  muted: { color: "var(--text-muted)", fontSize: "0.85rem" },

  // ---- week view ----
  weekHeader: {
    display: "grid",
    gridTemplateColumns: "60px repeat(7, 1fr)",
    borderBottom: "1px solid var(--border)",
    position: "sticky",
    top: 0,
    background: "var(--bg)",
    zIndex: 2,
  },
  timeColHeader: { borderRight: "1px solid var(--border)" },
  dayHeader: {
    padding: "8px 4px",
    textAlign: "center",
    borderRight: "1px solid var(--border)",
    color: "var(--text-2)",
  },
  weekBody: {
    display: "grid",
    gridTemplateColumns: "60px repeat(7, 1fr)",
    flex: 1,
  },
  timeCol: {
    borderRight: "1px solid var(--border)",
    fontSize: "0.7rem",
    color: "var(--text-muted)",
  },
  timeLabel: {
    paddingTop: "2px",
    paddingRight: "6px",
    textAlign: "right",
    boxSizing: "border-box",
  },
  dayCol: {
    position: "relative",
    borderRight: "1px solid var(--border)",
    cursor: "crosshair",
  },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTop: "1px solid var(--border-2)",
    pointerEvents: "none",
    opacity: 0.5,
  },
  eventBlock: {
    position: "absolute",
    padding: "2px 6px",
    borderRadius: "4px",
    fontSize: "0.75rem",
    color: "var(--text)",
    cursor: "pointer",
    overflow: "hidden",
    textAlign: "left",
    border: "none",
    boxSizing: "border-box",
  },
  eventTitle: {
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  eventTime: {
    fontSize: "0.68rem",
    color: "var(--text-2)",
    whiteSpace: "nowrap",
  },
  draftBlock: {
    position: "absolute",
    left: "2px",
    right: "2px",
    background: "var(--accent)",
    opacity: 0.35,
    borderRadius: "4px",
    pointerEvents: "none",
  },
  nowLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "2px",
    background: "var(--danger, #e53935)",
    pointerEvents: "none",
    zIndex: 3,
  },

  // ---- month view ----
  monthGrid: { display: "flex", flexDirection: "column", height: "100%" },
  monthHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    borderBottom: "1px solid var(--border)",
    paddingBottom: "0.3rem",
  },
  monthDayLabel: {
    textAlign: "center",
    fontSize: "0.72rem",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    fontWeight: 600,
  },
  monthBody: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gridTemplateRows: "repeat(6, 1fr)",
    borderTop: "1px solid var(--border)",
    borderLeft: "1px solid var(--border)",
  },
  monthCell: {
    borderRight: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
    padding: "4px 6px",
    cursor: "pointer",
    overflow: "hidden",
    minHeight: 0,
  },
  monthDayNum: { fontSize: "0.78rem", marginBottom: "2px" },
  monthDayEvents: { display: "flex", flexDirection: "column", gap: "2px" },
  monthEventChip: {
    fontSize: "0.7rem",
    padding: "1px 4px",
    borderRadius: "3px",
    cursor: "pointer",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  monthMore: {
    fontSize: "0.66rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
};
