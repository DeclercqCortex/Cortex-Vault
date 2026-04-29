import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, EventCategory } from "./Calendar";

interface EventEditModalProps {
  isOpen: boolean;
  /** Existing event to edit, or null to create a new one. */
  existingEvent: CalendarEvent | null;
  /** When creating new, the start/end the click-and-drag (or the
   *  "+ New event" button) suggested. */
  defaultStart: number;
  defaultEnd: number;
  categories: EventCategory[];
  onClose: () => void;
  onSave: (
    payload: Omit<CalendarEvent, "id" | "created_at" | "updated_at"> & {
      id?: string;
      recurrence_rule?: string | null;
      notify_mode?: string | null;
      notify_lead_minutes?: number | null;
    },
  ) => void;
  onDelete: (id: string) => void;
}

type NotifyMode = "none" | "all_day" | "urgent" | "ahead";
const LEAD_PRESETS = [5, 10, 15, 30, 60, 120, 1440] as const;

type RepeatPreset =
  | "none"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "custom";

const WEEKDAY_SHORTS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const WEEKDAY_LABELS: Record<(typeof WEEKDAY_SHORTS)[number], string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

type EndCondition =
  | { kind: "never" }
  | { kind: "until"; date: string } // YYYY-MM-DD
  | { kind: "count"; n: number };

/**
 * Cluster 11 v1.0 — event create / edit modal.
 *
 * Body is a plain textarea for v1.0. The text is stored verbatim in
 * the events table; when the daily-note auto-section renders, the
 * body's wikilinks (`[[Foo]]`) participate in the regular Cortex
 * graph automatically. A TipTap mount inside the modal is reserved
 * for v1.1 polish.
 */
export function EventEditModal({
  isOpen,
  existingEvent,
  defaultStart,
  defaultEnd,
  categories,
  onClose,
  onSave,
  onDelete,
}: EventEditModalProps) {
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState(""); // datetime-local string
  const [endLocal, setEndLocal] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"confirmed" | "tentative">("confirmed");
  const [body, setBody] = useState("");
  // Recurrence UI state.
  const [repeat, setRepeat] = useState<RepeatPreset>("none");
  const [repeatDays, setRepeatDays] = useState<Set<string>>(new Set());
  const [endCondition, setEndCondition] = useState<EndCondition>({
    kind: "never",
  });
  const [customRRule, setCustomRRule] = useState("");
  // v1.4 notification UI state.
  const [notifyMode, setNotifyMode] = useState<NotifyMode>("none");
  const [notifyLead, setNotifyLead] = useState<number>(15);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Reset state when the modal opens for a different event / new event.
  useEffect(() => {
    if (!isOpen) return;
    if (existingEvent) {
      setTitle(existingEvent.title);
      setStartLocal(
        unixToLocalInputValue(existingEvent.start_at, existingEvent.all_day),
      );
      setEndLocal(
        unixToLocalInputValue(existingEvent.end_at, existingEvent.all_day),
      );
      setAllDay(existingEvent.all_day);
      setCategory(existingEvent.category);
      setStatus(
        existingEvent.status === "tentative" ? "tentative" : "confirmed",
      );
      setBody(existingEvent.body);
      // Parse the existing rule into UI state.
      const parsed = parseRRuleToUi(existingEvent.recurrence_rule ?? null);
      setRepeat(parsed.preset);
      setRepeatDays(new Set(parsed.days));
      setEndCondition(parsed.endCondition);
      setCustomRRule(parsed.customRRule);
      // v1.4: load saved notification config.
      const savedMode = (existingEvent.notify_mode ?? "none") as string;
      if (
        savedMode === "all_day" ||
        savedMode === "urgent" ||
        savedMode === "ahead"
      ) {
        setNotifyMode(savedMode);
      } else {
        setNotifyMode("none");
      }
      setNotifyLead(
        existingEvent.notify_lead_minutes != null &&
          existingEvent.notify_lead_minutes >= 0
          ? existingEvent.notify_lead_minutes
          : 15,
      );
    } else {
      setTitle("");
      setStartLocal(unixToLocalInputValue(defaultStart, false));
      setEndLocal(unixToLocalInputValue(defaultEnd, false));
      setAllDay(false);
      setCategory(categories[0]?.id ?? "");
      setStatus("confirmed");
      setBody("");
      setRepeat("none");
      setRepeatDays(new Set());
      setEndCondition({ kind: "never" });
      setCustomRRule("");
      setNotifyMode("none");
      setNotifyLead(15);
    }
    setError(null);
    setTimeout(() => titleRef.current?.focus(), 0);
  }, [isOpen, existingEvent, defaultStart, defaultEnd, categories]);

  if (!isOpen) return null;

  function handleAllDayToggle(next: boolean) {
    setAllDay(next);
    // When switching modes, re-coerce the input values so the
    // datetime / date inputs round-trip cleanly.
    const startUnix = parseLocalInputValue(startLocal, allDay);
    const endUnix = parseLocalInputValue(endLocal, allDay);
    setStartLocal(unixToLocalInputValue(startUnix, next));
    setEndLocal(unixToLocalInputValue(endUnix, next));
  }

  function submit() {
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!category) {
      setError("Pick a category.");
      return;
    }
    const startUnix = parseLocalInputValue(startLocal, allDay);
    const endUnix = parseLocalInputValue(endLocal, allDay);
    if (!Number.isFinite(startUnix) || !Number.isFinite(endUnix)) {
      setError("Start and end times are required.");
      return;
    }
    if (endUnix < startUnix) {
      setError("End must be after start.");
      return;
    }
    // Build the RRULE string from the UI state. Returns null when
    // repeat === "none" so the backend stores NULL (standalone event).
    let recurrence_rule: string | null = null;
    try {
      recurrence_rule = buildRRuleFromUi({
        preset: repeat,
        days: repeatDays,
        endCondition,
        customRRule,
        startUnix,
      });
    } catch (e) {
      setError(`Couldn't build recurrence rule: ${(e as Error).message}`);
      return;
    }

    // v1.4: serialise notification config. None → null on disk.
    const notify_mode_value = notifyMode === "none" ? null : notifyMode;
    const notify_lead_value =
      notifyMode === "ahead" ? Math.max(0, Math.round(notifyLead) || 0) : null;

    onSave({
      id: existingEvent?.id,
      title: trimmedTitle,
      start_at: startUnix,
      end_at: endUnix,
      all_day: allDay,
      category,
      status,
      body,
      recurrence_rule,
      notify_mode: notify_mode_value,
      notify_lead_minutes: notify_lead_value,
    });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label={existingEvent ? "Edit event" : "New event"}
      >
        <h2 style={styles.heading}>
          {existingEvent ? "Edit event" : "New event"}
        </h2>

        <label style={styles.label}>
          <span style={styles.labelText}>Title</span>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's happening?"
            style={styles.input}
          />
        </label>

        <div style={styles.row}>
          <label style={styles.labelHalf}>
            <span style={styles.labelText}>Start</span>
            <input
              type={allDay ? "date" : "datetime-local"}
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.labelHalf}>
            <span style={styles.labelText}>End</span>
            <input
              type={allDay ? "date" : "datetime-local"}
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              style={styles.input}
            />
          </label>
        </div>

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => handleAllDayToggle(e.target.checked)}
          />
          <span style={styles.labelText}>
            All-day event (use for deadlines, special days)
          </span>
        </label>

        <div style={styles.row}>
          <label style={styles.labelHalf}>
            <span style={styles.labelText}>Category</span>
            <div style={styles.categoryRow}>
              <span
                aria-hidden="true"
                style={{
                  ...styles.swatch,
                  background:
                    categories.find((c) => c.id === category)?.color ?? "#888",
                }}
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={styles.input}
              >
                {categories.length === 0 ? (
                  <option value="">
                    (no categories — add some in Categories)
                  </option>
                ) : (
                  categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          </label>
          <label style={styles.labelHalf}>
            <span style={styles.labelText}>Status</span>
            <div style={styles.statusRow}>
              <button
                type="button"
                onClick={() => setStatus("confirmed")}
                style={
                  status === "confirmed" ? styles.statusOn : styles.statusOff
                }
              >
                Confirmed
              </button>
              <button
                type="button"
                onClick={() => setStatus("tentative")}
                style={
                  status === "tentative" ? styles.statusOn : styles.statusOff
                }
              >
                Tentative
              </button>
            </div>
          </label>
        </div>

        <div style={styles.recurrenceBlock}>
          <span style={styles.labelText}>Repeat</span>
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as RepeatPreset)}
            style={styles.input}
          >
            <option value="none">Doesn&apos;t repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week on…</option>
            <option value="biweekly">Every 2 weeks on…</option>
            <option value="monthly">Every month (same date)</option>
            <option value="custom">Custom (RRULE)</option>
          </select>

          {(repeat === "weekly" || repeat === "biweekly") && (
            <div style={styles.weekdayRow}>
              {WEEKDAY_SHORTS.map((d) => {
                const checked = repeatDays.has(d);
                return (
                  <button
                    type="button"
                    key={d}
                    onClick={() => {
                      setRepeatDays((prev) => {
                        const next = new Set(prev);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        return next;
                      });
                    }}
                    style={checked ? styles.weekdayOn : styles.weekdayOff}
                    title={WEEKDAY_LABELS[d]}
                  >
                    {WEEKDAY_LABELS[d].slice(0, 1)}
                  </button>
                );
              })}
              <span style={styles.fieldHint}>
                {repeatDays.size === 0
                  ? "(uses the start day's weekday if none picked)"
                  : ""}
              </span>
            </div>
          )}

          {repeat === "custom" && (
            <input
              type="text"
              value={customRRule}
              onChange={(e) => setCustomRRule(e.target.value)}
              placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10"
              style={styles.input}
              spellCheck={false}
            />
          )}

          {repeat !== "none" && (
            <div style={styles.endRow}>
              <span style={styles.fieldLabelInline}>Ends</span>
              <select
                value={endCondition.kind}
                onChange={(e) => {
                  const k = e.target.value as EndCondition["kind"];
                  if (k === "never") setEndCondition({ kind: "never" });
                  else if (k === "until")
                    setEndCondition({
                      kind: "until",
                      date:
                        endCondition.kind === "until" ? endCondition.date : "",
                    });
                  else
                    setEndCondition({
                      kind: "count",
                      n: endCondition.kind === "count" ? endCondition.n : 10,
                    });
                }}
                style={styles.endSelect}
              >
                <option value="never">Never</option>
                <option value="until">On date…</option>
                <option value="count">After N occurrences…</option>
              </select>
              {endCondition.kind === "until" && (
                <input
                  type="date"
                  value={endCondition.date}
                  onChange={(e) =>
                    setEndCondition({ kind: "until", date: e.target.value })
                  }
                  style={styles.endInput}
                />
              )}
              {endCondition.kind === "count" && (
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={endCondition.n}
                  onChange={(e) =>
                    setEndCondition({
                      kind: "count",
                      n: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  style={styles.endInput}
                />
              )}
            </div>
          )}

          {repeat !== "none" && (
            <p style={styles.recurrenceHint}>
              v1.1 ships whole-series edits — changing this event affects every
              occurrence. Per-instance edits and exceptions are reserved for
              v1.2.
            </p>
          )}
        </div>

        {/* v1.4 — notification config. */}
        <div style={styles.recurrenceBlock}>
          <span style={styles.labelText}>Notification</span>
          <select
            value={notifyMode}
            onChange={(e) => setNotifyMode(e.target.value as NotifyMode)}
            style={styles.input}
          >
            <option value="none">None</option>
            <option value="all_day">All day on the event date</option>
            <option value="urgent">Urgent (always red, until resolved)</option>
            <option value="ahead">Ahead of time…</option>
          </select>

          {notifyMode === "ahead" && (
            <div style={styles.endRow}>
              <span style={styles.fieldLabelInline}>Notify</span>
              <select
                value={
                  LEAD_PRESETS.includes(
                    notifyLead as (typeof LEAD_PRESETS)[number],
                  )
                    ? String(notifyLead)
                    : "custom"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") {
                    // Keep current value; user will edit the number
                    // input below.
                    return;
                  }
                  setNotifyLead(Number(v));
                }}
                style={styles.endSelect}
              >
                {LEAD_PRESETS.map((m) => (
                  <option key={m} value={String(m)}>
                    {formatLeadLabel(m)} before
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <input
                type="number"
                min={0}
                max={10080}
                value={notifyLead}
                onChange={(e) =>
                  setNotifyLead(Math.max(0, Number(e.target.value) || 0))
                }
                style={{ ...styles.endInput, maxWidth: "90px" }}
                title="Minutes before the event"
              />
              <span style={styles.fieldHint}>min</span>
            </div>
          )}

          {notifyMode !== "none" && (
            <p style={styles.recurrenceHint}>
              {notifyMode === "all_day" &&
                "Shows in the bell all day on the event's date; turns red the day after if not resolved."}
              {notifyMode === "urgent" &&
                "Shows in the bell as past-due (red) immediately and stays until resolved."}
              {notifyMode === "ahead" &&
                `Notification fires ${formatLeadLabel(notifyLead)} before the event start. Stays in the bell until you dismiss it or the event passes.`}
            </p>
          )}
        </div>

        <label style={styles.label}>
          <span style={styles.labelText}>
            Notes — supports <code>[[wikilinks]]</code> to vault notes
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Agenda, prep, links to relevant notes…"
            style={styles.textarea}
            rows={6}
          />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          {existingEvent && (
            <button
              onClick={() => onDelete(existingEvent.id)}
              style={styles.btnDanger}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={styles.btnGhost}>
            Cancel
          </button>
          <button onClick={submit} style={styles.btnPrimary}>
            {existingEvent ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Date input <-> unix helpers
// -----------------------------------------------------------------------------

/**
 * Convert a unix-seconds timestamp into the string format an HTML
 * `<input type="datetime-local">` expects (YYYY-MM-DDTHH:MM, in
 * local time). For all-day events, returns just YYYY-MM-DD.
 */
function unixToLocalInputValue(unix: number, allDay: boolean): string {
  if (!Number.isFinite(unix)) return "";
  const d = new Date(unix * 1000);
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  if (allDay) return `${yyyy}-${mm}-${dd}`;
  const hh = d.getHours().toString().padStart(2, "0");
  const mn = d.getMinutes().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mn}`;
}

/**
 * Parse a `<input type="datetime-local">` value (in the user's local
 * timezone) into unix seconds.
 */
function parseLocalInputValue(value: string, allDay: boolean): number {
  if (!value) return NaN;
  // For all-day, append T00:00 so Date parses correctly.
  const v = allDay ? `${value}T00:00` : value;
  const d = new Date(v);
  return Math.floor(d.getTime() / 1000);
}

// -----------------------------------------------------------------------------
// RRULE <-> UI state
// -----------------------------------------------------------------------------

interface ParsedRule {
  preset: RepeatPreset;
  days: string[];
  endCondition: EndCondition;
  customRRule: string;
}

/**
 * Best-effort parser that maps an existing RRULE string back into the
 * UI's preset state. v1.1 only round-trips rules it could itself
 * have produced; anything more exotic falls into "custom" so the
 * user can still edit it as a raw string.
 */
function parseRRuleToUi(rule: string | null): ParsedRule {
  const empty: ParsedRule = {
    preset: "none",
    days: [],
    endCondition: { kind: "never" },
    customRRule: "",
  };
  if (!rule || !rule.trim()) return empty;
  const parts = new Map<string, string>();
  for (const kv of rule.split(";")) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    parts.set(kv.slice(0, eq).trim().toUpperCase(), kv.slice(eq + 1).trim());
  }
  const freq = parts.get("FREQ")?.toUpperCase();
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const byDay = (parts.get("BYDAY") ?? "")
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter((d) => d.length === 2);
  const byMonthDay = parts.get("BYMONTHDAY");
  const count = parts.get("COUNT");
  const until = parts.get("UNTIL");
  const knownExtras = [
    "FREQ",
    "INTERVAL",
    "BYDAY",
    "BYMONTHDAY",
    "COUNT",
    "UNTIL",
  ];
  const hasExotic = Array.from(parts.keys()).some(
    (k) => !knownExtras.includes(k),
  );
  if (hasExotic || (byMonthDay && freq !== "MONTHLY")) {
    return { ...empty, preset: "custom", customRRule: rule };
  }
  let preset: RepeatPreset = "custom";
  if (freq === "DAILY" && interval === 1) preset = "daily";
  else if (freq === "WEEKLY" && interval === 1) preset = "weekly";
  else if (freq === "WEEKLY" && interval === 2) preset = "biweekly";
  else if (freq === "MONTHLY" && interval === 1 && !byDay.length)
    preset = "monthly";
  else preset = "custom";
  const endCondition: EndCondition = until
    ? {
        kind: "until",
        date:
          until.length >= 8
            ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
            : "",
      }
    : count
      ? { kind: "count", n: Math.max(1, Number(count) || 1) }
      : { kind: "never" };
  return {
    preset,
    days: byDay,
    endCondition,
    customRRule: preset === "custom" ? rule : "",
  };
}

/**
 * Serialise the UI state into an RRULE string, or return null when
 * the user picked "Doesn't repeat". `startUnix` is used to derive a
 * default BYDAY for weekly/biweekly when the user didn't pick any
 * days explicitly.
 */
function buildRRuleFromUi(args: {
  preset: RepeatPreset;
  days: Set<string>;
  endCondition: EndCondition;
  customRRule: string;
  startUnix: number;
}): string | null {
  const { preset, days, endCondition, customRRule, startUnix } = args;
  if (preset === "none") return null;
  if (preset === "custom") {
    const trimmed = customRRule.trim();
    if (!trimmed) {
      throw new Error("Custom RRULE is empty.");
    }
    return trimmed;
  }
  const tail: string[] = [];
  switch (preset) {
    case "daily":
      tail.push("FREQ=DAILY");
      break;
    case "weekly":
      tail.push("FREQ=WEEKLY");
      break;
    case "biweekly":
      tail.push("FREQ=WEEKLY", "INTERVAL=2");
      break;
    case "monthly":
      tail.push("FREQ=MONTHLY");
      break;
  }
  if (preset === "weekly" || preset === "biweekly") {
    let weekdayList = Array.from(days);
    if (weekdayList.length === 0) {
      // Fall back to the start day's weekday so we always have a
      // BYDAY anchor.
      const wd = isoWeekdayShortFromUnix(startUnix);
      weekdayList = [wd];
    }
    weekdayList.sort((a, b) => weekdayOrder(a) - weekdayOrder(b));
    tail.push(`BYDAY=${weekdayList.join(",")}`);
  }
  if (endCondition.kind === "until" && endCondition.date) {
    const compact = endCondition.date.replace(/-/g, "");
    tail.push(`UNTIL=${compact}T235959Z`);
  } else if (endCondition.kind === "count" && endCondition.n > 0) {
    tail.push(`COUNT=${endCondition.n}`);
  }
  return tail.join(";");
}

const WEEKDAY_ORDER: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

function weekdayOrder(s: string): number {
  return WEEKDAY_ORDER[s.toUpperCase()] ?? 99;
}

function formatLeadLabel(minutes: number): string {
  if (minutes <= 0) return "at start";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const h = Math.round((minutes / 60) * 10) / 10;
    return `${h} h`;
  }
  const d = Math.round((minutes / (60 * 24)) * 10) / 10;
  return `${d} day${d === 1 ? "" : "s"}`;
}

function isoWeekdayShortFromUnix(unix: number): string {
  const d = new Date(unix * 1000);
  // JS getDay: Sun=0..Sat=6. Convert to ISO-like strings.
  const map = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return map[d.getDay()];
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1300,
  },
  panel: {
    minWidth: "520px",
    maxWidth: "640px",
    maxHeight: "calc(100vh - 4rem)",
    overflowY: "auto",
    padding: "1.25rem 1.5rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow)",
  },
  heading: { margin: "0 0 0.85rem", fontSize: "1.05rem", fontWeight: 600 },
  label: { display: "block", marginBottom: "0.7rem" },
  labelHalf: { display: "block", flex: 1 },
  labelText: {
    display: "block",
    fontSize: "0.78rem",
    color: "var(--text-2)",
    marginBottom: "0.25rem",
  },
  input: {
    width: "100%",
    padding: "0.42rem 0.6rem",
    fontSize: "0.9rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "0.42rem 0.6rem",
    fontSize: "0.9rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "5px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    resize: "vertical",
  },
  row: { display: "flex", gap: "0.6rem", marginBottom: "0.7rem" },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.85rem",
  },
  categoryRow: { display: "flex", alignItems: "center", gap: "0.4rem" },
  swatch: {
    width: "16px",
    height: "16px",
    borderRadius: "3px",
    flexShrink: 0,
  },
  statusRow: { display: "flex", gap: "0.3rem" },
  statusOn: {
    flex: 1,
    padding: "0.4rem",
    fontSize: "0.85rem",
    background: "var(--accent)",
    color: "white",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  statusOff: {
    flex: 1,
    padding: "0.4rem",
    fontSize: "0.85rem",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  error: {
    margin: "0.6rem 0",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  footer: {
    marginTop: "0.85rem",
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  btnGhost: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "5px 16px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "var(--primary, var(--accent))",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  btnDanger: {
    padding: "5px 12px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  recurrenceBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
    padding: "0.7rem 0.85rem",
    marginBottom: "0.85rem",
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  weekdayRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
    alignItems: "center",
  },
  weekdayOn: {
    width: "32px",
    height: "32px",
    background: "var(--accent)",
    color: "white",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  weekdayOff: {
    width: "32px",
    height: "32px",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.8rem",
  },
  endRow: {
    display: "flex",
    gap: "0.4rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  fieldLabelInline: {
    fontSize: "0.78rem",
    color: "var(--text-2)",
  },
  endSelect: {
    padding: "0.35rem 0.5rem",
    fontSize: "0.85rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  endInput: {
    flex: 1,
    minWidth: "120px",
    padding: "0.35rem 0.5rem",
    fontSize: "0.85rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    outline: "none",
    boxSizing: "border-box",
  },
  recurrenceHint: {
    margin: 0,
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
    lineHeight: 1.4,
  },
  fieldHint: {
    fontSize: "0.74rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
};
