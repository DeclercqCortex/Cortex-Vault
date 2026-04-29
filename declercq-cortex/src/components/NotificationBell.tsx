import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  computeStatus,
  isActiveReminder,
  localIsoDate,
  parseReminderFile,
  playBeep,
  reminderHash,
  sortByUrgency,
  type ReminderStatus,
  type ReminderWithStatus,
} from "../utils/reminders";
import type { CalendarEvent } from "./Calendar";

interface NotificationBellProps {
  vaultPath: string;
  /** Bumped by the host (App) when external code (the overlay's
   *  Save) writes the reminders file, so the bell refreshes
   *  immediately rather than waiting for the next poll. */
  refreshTick: number;
}

const POLL_MS = 30_000;
const ALERTED_LS_PREFIX = "cortex:reminder-alerted:";
const EVENT_DISMISSED_LS_PREFIX = "cortex:event-notif-dismissed:";

/** Window for fetching events that might produce notifications.
 *  Past 1 day so urgent / past-due events stay visible in the bell;
 *  +14 days so a 1-week-ahead lead surfaces the reminder when its
 *  trigger time is reached. */
const EVENT_LOOKBACK_DAYS = 1;
const EVENT_LOOKAHEAD_DAYS = 14;

/**
 * Cluster 15 — notification bell.
 *
 * Sits next to the LayoutPicker in App's top bar. Polls
 * `<vault>/Reminders.md` every 30s, parses each line, computes
 * each reminder's status relative to "now", and:
 *   - Shows a count badge of all "active" reminders (anything not
 *     in the `future` bucket).
 *   - Switches the bell colour to red if any past-due reminder
 *     exists; otherwise uses the accent.
 *   - Plays a one-time WebAudio beep when a reminder transitions
 *     into `approaching` or `past-due` (alerted-state tracked in
 *     localStorage so re-launching Cortex doesn't replay the
 *     morning's alerts in the afternoon).
 *   - Click to expand a dropdown panel listing each active
 *     reminder with a Resolve button.
 */
export function NotificationBell({
  vaultPath,
  refreshTick,
}: NotificationBellProps) {
  const [content, setContent] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [dismissTick, setDismissTick] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      const dayS = 86_400;
      const [c, evs] = await Promise.all([
        invoke<string>("read_reminders", { vaultPath }),
        invoke<CalendarEvent[]>("list_events_in_range", {
          vaultPath,
          startUnix: nowSecs - EVENT_LOOKBACK_DAYS * dayS,
          endUnix: nowSecs + EVENT_LOOKAHEAD_DAYS * dayS,
        }),
      ]);
      setContent(c);
      setEvents(evs);
      setError(null);
    } catch (e) {
      // Most likely cause: stale Tauri binary that doesn't yet have
      // the read_reminders command. Surface for visibility.
      setError(`Couldn't read reminders: ${e}`);
    }
  }, [vaultPath]);

  // Initial load + on refreshTick bump from the host (after a save
  // in the overlay).
  useEffect(() => {
    reload();
  }, [reload, refreshTick]);

  // 30-second poll: re-read the file AND tick `now` so status
  // recomputes. Cheap.
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(new Date());
      reload();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [reload]);

  // Close the dropdown when the user clicks outside it.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Parse + classify each Reminders.md line. These are "file-source"
  // reminders — resolve removes the line from disk.
  const fileReminders: BellReminder[] = useMemo(
    () =>
      parseReminderFile(content).map((r) => ({
        ...r,
        status: computeStatus(r, now),
        source: "file",
      })),
    [content, now],
  );

  // Synthesise reminders from events with notify_mode set. These are
  // "event-source" reminders — resolve marks them dismissed in
  // localStorage but doesn't touch the event itself.
  const eventReminders: BellReminder[] = useMemo(
    () => synthesizeEventReminders(events, now),
    // The dismissTick dep forces a re-derive after Resolve so the
    // dismissed entries vanish on the next render without waiting
    // for the 30s poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, now, dismissTick],
  );

  const active = useMemo(
    () =>
      sortByUrgency([
        ...fileReminders.filter(isActiveReminder),
        ...eventReminders.filter(isActiveReminder),
      ]),
    [fileReminders, eventReminders],
  );

  // Sound + alerted-state bookkeeping. Each time `active` changes,
  // walk it and beep on any reminder that just became approaching
  // or past-due AND hasn't been alerted for that bucket yet.
  useEffect(() => {
    let anyNewAlert = false;
    for (const r of active) {
      if (r.status !== "approaching" && r.status !== "past-due") continue;
      const key = `${ALERTED_LS_PREFIX}${reminderHash(r)}`;
      let stored = "";
      try {
        stored = localStorage.getItem(key) ?? "";
      } catch {
        // localStorage may throw under certain WebView2 configs.
        // Treat as "not alerted" so we beep, but avoid
        // try-write-fail loops.
      }
      const alreadyApproaching = stored.includes("approaching");
      const alreadyPastDue = stored.includes("past-due");
      const need =
        (r.status === "approaching" && !alreadyApproaching) ||
        (r.status === "past-due" && !alreadyPastDue);
      if (!need) continue;
      anyNewAlert = true;
      const next = (() => {
        const flags = new Set(stored.split("|").filter(Boolean));
        if (r.status === "approaching") flags.add("approaching");
        if (r.status === "past-due") {
          flags.add("approaching"); // past-due implies we'd also have hit approaching
          flags.add("past-due");
        }
        return Array.from(flags).join("|");
      })();
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
    }
    if (anyNewAlert) {
      playBeep();
    }
  }, [active]);

  // Resolve dispatches by source:
  //   file:  delete_reminder_line removes the line from disk.
  //   event: set a localStorage flag so this instance is filtered
  //          out of the bell. Doesn't touch the event itself.
  async function resolve(r: BellReminder) {
    try {
      if (r.source === "event") {
        try {
          localStorage.setItem(eventDismissKey(r), "1");
        } catch {
          /* ignore */
        }
        // Bump the local tick so the eventReminders memo re-runs and
        // the dismissed entry disappears immediately (no 30s wait).
        setDismissTick((t) => t + 1);
        return;
      }
      await invoke("delete_reminder_line", {
        vaultPath,
        lineContent: r.raw,
      });
      // Clear any alerted state for this file reminder so a future
      // re-creation with the same content re-arms the alert cleanly.
      try {
        localStorage.removeItem(`${ALERTED_LS_PREFIX}${reminderHash(r)}`);
      } catch {
        /* ignore */
      }
      await reload();
    } catch (e) {
      setError(`Resolve failed: ${e}`);
    }
  }

  const count = active.length;
  const anyPastDue = active.some((r) => r.status === "past-due");
  const bellColor = anyPastDue
    ? "var(--danger)"
    : count > 0
      ? "var(--accent)"
      : "var(--text-muted)";
  const badgeBg = anyPastDue ? "var(--danger)" : "var(--accent)";

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...styles.bellBtn,
          color: bellColor,
          borderColor: count > 0 ? bellColor : "var(--border-2)",
        }}
        title={
          count === 0
            ? "Reminders — none active"
            : `Reminders — ${count} active${anyPastDue ? " (some past-due)" : ""}`
        }
        aria-label="Reminders"
      >
        <span style={styles.bellGlyph}>🔔</span>
        {count > 0 && (
          <span style={{ ...styles.badge, background: badgeBg }}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          style={styles.dropdown}
          role="dialog"
          aria-label="Active reminders"
        >
          <header style={styles.dropdownHeader}>
            <strong>
              {count} active reminder{count === 1 ? "" : "s"}
            </strong>
            <span style={styles.muted}>
              <kbd style={styles.kbd}>Ctrl+Shift+M</kbd> to edit all
            </span>
          </header>

          {error && <p style={styles.error}>{error}</p>}

          {count === 0 ? (
            <p style={styles.empty}>
              Nothing pending. Press <kbd style={styles.kbd}>Ctrl+Shift+M</kbd>{" "}
              to add a reminder.
            </p>
          ) : (
            <ul style={styles.list}>
              {active.map((r) => (
                <li
                  key={
                    r.source === "event"
                      ? `evt:${r.eventId}@${r.instanceStart}`
                      : `file:${reminderHash(r)}-${r.lineIndex}`
                  }
                  style={styles.row}
                >
                  <ReminderRow r={r} onResolve={() => resolve(r)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ReminderRow({
  r,
  onResolve,
}: {
  r: BellReminder;
  onResolve: () => void;
}) {
  const meta = formatMeta(r.status, r.date, r.time);
  const accent = colorForStatus(r.status);
  const icon = iconForStatus(r.status);
  return (
    <>
      <div
        style={{
          ...styles.statusDot,
          color: accent,
          background: r.status === "past-due" ? "var(--danger)" : "transparent",
          borderColor: accent,
        }}
        aria-hidden="true"
        title={r.status}
      >
        {icon}
      </div>
      <div style={styles.body}>
        <div
          style={{
            ...styles.metaLine,
            color: accent,
            fontWeight: r.status === "past-due" ? 700 : 600,
          }}
        >
          {meta}
        </div>
        <div style={styles.descLine}>
          {r.description || <em style={styles.muted}>(no description)</em>}
        </div>
      </div>
      <button onClick={onResolve} style={styles.resolveBtn}>
        Resolve
      </button>
    </>
  );
}

function formatMeta(
  status: ReminderStatus,
  date: string | null,
  time: string | null,
): string {
  if (status === "anytime") return "Anytime";
  if (status === "all-day-active") return "Today, all day";
  if (date && time) return `${date} ${time}`;
  if (date) return date;
  if (time) return `Today ${time}`;
  return "—";
}

function colorForStatus(status: ReminderStatus): string {
  switch (status) {
    case "past-due":
      return "var(--danger)";
    case "approaching":
      return "var(--accent)";
    case "all-day-active":
      return "var(--text)";
    case "anytime":
      return "var(--text-muted)";
    default:
      return "var(--text-muted)";
  }
}

function iconForStatus(status: ReminderStatus): string {
  switch (status) {
    case "past-due":
      return "⏱";
    case "approaching":
      return "⏰";
    case "all-day-active":
      return "📅";
    case "anytime":
      return "•";
    default:
      return "•";
  }
}

// -----------------------------------------------------------------------------
// Event-derived reminders (Cluster 11 v1.4)
// -----------------------------------------------------------------------------

/** A bell-displayable reminder. Either a file-source line (from
 *  Reminders.md) or an event-source synthetic (from the calendar). */
interface BellReminder extends ReminderWithStatus {
  source: "file" | "event";
  /** For source === 'event': the master event id (ties dismissal
   *  state to the event regardless of its current schedule). */
  eventId?: string;
  /** For source === 'event': this instance's start_at unix-secs.
   *  Combined with eventId this disambiguates between recurring
   *  instances so dismissing one doesn't silence the rest. */
  instanceStart?: number;
}

function eventDismissKey(r: BellReminder): string {
  return `${EVENT_DISMISSED_LS_PREFIX}${r.eventId}@${r.instanceStart}`;
}

function isEventDismissed(eventId: string, instanceStart: number): boolean {
  try {
    return (
      localStorage.getItem(
        `${EVENT_DISMISSED_LS_PREFIX}${eventId}@${instanceStart}`,
      ) === "1"
    );
  } catch {
    return false;
  }
}

/** Build synthetic BellReminders for events whose notify_mode is
 *  set. Three modes:
 *    all_day → reminder.date = event's local date, no time. Status
 *              follows from `computeStatus`-style logic relative to
 *              today.
 *    urgent  → reminder is forced to past-due (red treatment),
 *              visible immediately and persists until dismissed.
 *    ahead   → trigger time = event_start - lead. status is
 *              `future` before trigger (filtered out of the bell),
 *              `approaching` from trigger to event_start, `past-due`
 *              afterwards. */
function synthesizeEventReminders(
  events: CalendarEvent[],
  now: Date,
): BellReminder[] {
  const out: BellReminder[] = [];
  const nowSecs = Math.floor(now.getTime() / 1000);
  const todayLocal = localIsoDate(now);

  for (const ev of events) {
    const mode = (ev.notify_mode ?? "").trim();
    if (!mode || mode === "none") continue;
    if (isEventDismissed(ev.id, ev.start_at)) continue;

    if (mode === "all_day") {
      const evDateLocal = localIsoDate(new Date(ev.start_at * 1000));
      let status: ReminderStatus;
      if (evDateLocal < todayLocal) status = "past-due";
      else if (evDateLocal === todayLocal) status = "all-day-active";
      else status = "future";

      out.push({
        raw: `<event:${ev.id}@${ev.start_at}:all_day>`,
        lineIndex: -1,
        date: evDateLocal,
        time: null,
        description: ev.title,
        status,
        source: "event",
        eventId: ev.id,
        instanceStart: ev.start_at,
      });
    } else if (mode === "urgent") {
      // Urgent = always shown red until dismissed. We force the
      // status to past-due so it gets the urgent visual without
      // needing a new ReminderStatus variant. The synthetic carries
      // the event's date for the meta line so the user sees what
      // it's tied to.
      const evDateLocal = localIsoDate(new Date(ev.start_at * 1000));
      out.push({
        raw: `<event:${ev.id}@${ev.start_at}:urgent>`,
        lineIndex: -1,
        date: evDateLocal,
        time: null,
        description: ev.title,
        status: "past-due",
        source: "event",
        eventId: ev.id,
        instanceStart: ev.start_at,
      });
    } else if (mode === "ahead") {
      const lead = ev.notify_lead_minutes ?? 15;
      const triggerSecs = ev.start_at - lead * 60;
      const triggerDate = new Date(triggerSecs * 1000);
      const triggerDateLocal = localIsoDate(triggerDate);
      const triggerTimeStr = `${String(triggerDate.getHours()).padStart(2, "0")}:${String(triggerDate.getMinutes()).padStart(2, "0")}`;

      let status: ReminderStatus;
      if (nowSecs < triggerSecs) status = "future";
      else if (nowSecs < ev.start_at) status = "approaching";
      else status = "past-due";

      out.push({
        raw: `<event:${ev.id}@${ev.start_at}:ahead:${lead}>`,
        lineIndex: -1,
        date: triggerDateLocal,
        time: triggerTimeStr,
        description: ev.title,
        status,
        source: "event",
        eventId: ev.id,
        instanceStart: ev.start_at,
      });
    }
  }
  return out;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", display: "inline-flex" },
  bellBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
    background: "transparent",
    border: "1px solid",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "0.85rem",
    minHeight: "28px",
  },
  bellGlyph: { fontSize: "0.95rem", lineHeight: 1 },
  badge: {
    color: "white",
    fontSize: "0.7rem",
    fontWeight: 700,
    padding: "0 5px",
    borderRadius: "8px",
    minWidth: "16px",
    textAlign: "center",
    lineHeight: "16px",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: "6px",
    width: "min(420px, 88vw)",
    maxHeight: "60vh",
    overflowY: "auto",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow)",
    padding: "0.7rem 0.85rem",
    zIndex: 1100,
  },
  dropdownHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: "0.6rem",
    paddingBottom: "0.4rem",
    borderBottom: "1px solid var(--border)",
  },
  empty: {
    margin: "0.4rem 0 0",
    color: "var(--text-muted)",
    fontSize: "0.85rem",
    lineHeight: 1.5,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.45rem 0.5rem",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    background: "var(--bg-elev)",
  },
  statusDot: {
    width: "26px",
    height: "26px",
    border: "1.5px solid",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.85rem",
    flexShrink: 0,
  },
  body: {
    minWidth: 0, // lets the description ellipsis correctly
  },
  metaLine: {
    fontSize: "0.74rem",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    lineHeight: 1.3,
  },
  descLine: {
    fontSize: "0.88rem",
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: 1.35,
  },
  resolveBtn: {
    padding: "4px 10px",
    fontSize: "0.78rem",
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  error: {
    margin: "0.4rem 0",
    color: "var(--danger)",
    fontSize: "0.78rem",
  },
  muted: { color: "var(--text-muted)", fontSize: "0.74rem" },
  kbd: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.7rem",
    color: "var(--accent)",
    background: "var(--code-bg)",
    border: "1px solid var(--border-2)",
    borderRadius: "3px",
    padding: "0 5px",
  },
};
