/**
 * Cluster 15 — Reminders parser and status helpers.
 *
 * One markdown file at <vault>/Reminders.md. Every non-empty, non-
 * header line is a reminder. Lines starting with `#` are markdown
 * headings and skipped (so users can organise the file with
 * sections without those becoming bogus reminders).
 *
 * Per-line parser:
 *   <line> := [DATE] [TIME] [-] description
 *   DATE   := YYYY-MM-DD
 *   TIME   := HH:MM (24h)
 * Both date and time are optional; whatever's left becomes the
 * description. Unrecognised leading content just becomes part of
 * the description.
 */

export interface ParsedReminder {
  /** The exact original line, untrimmed, for resolve-by-content. */
  raw: string;
  /** 0-indexed line position in the file (best-effort; may shift
   *  if the file is hand-edited between read and resolve). */
  lineIndex: number;
  /** YYYY-MM-DD or null. */
  date: string | null;
  /** HH:MM (zero-padded, 24h) or null. */
  time: string | null;
  /** Whatever's left after stripping the date and time prefixes. */
  description: string;
}

export type ReminderStatus =
  /** No date and no time — always pending until resolved. */
  | "anytime"
  /** Date is today, no time — flagged for the whole day. */
  | "all-day-active"
  /** Date+time scheduled within the next 1 hour from now. */
  | "approaching"
  /** Date+time scheduled later than 1 hour from now. */
  | "future"
  /** Scheduled time has passed (yesterday's all-day, or earlier today). */
  | "past-due";

export interface ReminderWithStatus extends ParsedReminder {
  status: ReminderStatus;
}

/**
 * Split the content of Reminders.md into one parsed entry per
 * non-empty non-header line. Lines that fail to parse still get
 * an entry — they just have null date/time and the line as their
 * description.
 */
export function parseReminderFile(content: string): ParsedReminder[] {
  const out: ParsedReminder[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const r = parseReminderLine(lines[i], i);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Parse a single line. Returns null for empty / whitespace-only /
 * markdown-header lines.
 */
export function parseReminderLine(
  raw: string,
  lineIndex: number,
): ParsedReminder | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Markdown headers (one or more #'s followed by space) are
  // organisational, not reminders.
  if (/^#{1,6}\s/.test(trimmed)) return null;

  let rest = trimmed;
  let date: string | null = null;
  let time: string | null = null;

  // Markdown list-item prefixes are common in vault files; strip
  // them so "- 14:30 Task" parses the same as "14:30 Task".
  rest = rest.replace(/^[-*+]\s+/, "");
  // Ditto for checkbox prefixes — `- [ ]` and `- [x]`.
  rest = rest.replace(/^\[[ xX]\]\s+/, "");

  // Leading YYYY-MM-DD.
  const dateMatch = rest.match(/^(\d{4}-\d{2}-\d{2})(?=\s|$)/);
  if (dateMatch) {
    date = dateMatch[1];
    rest = rest.slice(dateMatch[0].length).trimStart();
  }

  // Leading H:MM or HH:MM. Only accepted as a leading token —
  // mid-sentence "let's meet at 14:30" stays in the description.
  const timeMatch = rest.match(/^(\d{1,2}:\d{2})(?=\s|$)/);
  if (timeMatch) {
    const [h, m] = timeMatch[1].split(":");
    const hh = h.padStart(2, "0");
    const hour = Number(hh);
    const minute = Number(m);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      time = `${hh}:${m}`;
      rest = rest.slice(timeMatch[0].length).trimStart();
    }
  }

  // Optional separator dash between metadata and description.
  rest = rest.replace(/^[-–—:]\s*/, "");

  return {
    raw,
    lineIndex,
    date,
    time,
    description: rest.trim(),
  };
}

/**
 * Compute a reminder's bucket relative to `now`.
 *
 * Time-only entries (no date, just HH:MM) are interpreted as today.
 * Date-only entries are interpreted as all-day.
 */
export function computeStatus(r: ParsedReminder, now: Date): ReminderStatus {
  // No date, no time — perpetual.
  if (!r.date && !r.time) return "anytime";

  if (r.date && !r.time) {
    // All-day. Compare against local YYYY-MM-DD.
    const today = localIsoDate(now);
    if (r.date < today) return "past-due";
    if (r.date === today) return "all-day-active";
    return "future";
  }

  // Has a time (and possibly a date). Build a Date for the target.
  const target = buildTargetDate(r, now);
  if (!target) return "anytime"; // unparseable; degrade gracefully
  const diffMs = target.getTime() - now.getTime();
  const oneHourMs = 60 * 60 * 1000;
  if (diffMs < 0) return "past-due";
  if (diffMs <= oneHourMs) return "approaching";
  return "future";
}

function buildTargetDate(r: ParsedReminder, now: Date): Date | null {
  if (!r.time) return null;
  const [hStr, mStr] = r.time.split(":");
  const hour = Number(hStr);
  const minute = Number(mStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (r.date) {
    const [y, mo, d] = r.date.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
      return null;
    }
    return new Date(y, mo - 1, d, hour, minute, 0, 0);
  }
  // Time-only — interpret as today.
  const t = new Date(now);
  t.setHours(hour, minute, 0, 0);
  return t;
}

/** Local YYYY-MM-DD for the given Date. */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Active = visible in the bell badge: anything that's not "future".
 * `future` reminders are scheduled but not yet within the alert
 * horizon; they live in the file but not in the notification
 * panel.
 */
export function isActiveReminder(r: ReminderWithStatus): boolean {
  return r.status !== "future";
}

/**
 * Reminders sorted by urgency for the notification panel:
 *   past-due (red) → approaching → all-day-active → anytime.
 * Ties broken by date+time ascending (older first within past-due,
 * sooner first within approaching).
 */
export function sortByUrgency(rs: ReminderWithStatus[]): ReminderWithStatus[] {
  const order: Record<ReminderStatus, number> = {
    "past-due": 0,
    approaching: 1,
    "all-day-active": 2,
    anytime: 3,
    future: 4,
  };
  return [...rs].sort((a, b) => {
    const oa = order[a.status];
    const ob = order[b.status];
    if (oa !== ob) return oa - ob;
    const ka = `${a.date ?? "9999-99-99"}T${a.time ?? "99:99"}`;
    const kb = `${b.date ?? "9999-99-99"}T${b.time ?? "99:99"}`;
    return ka.localeCompare(kb);
  });
}

/**
 * Stable-ish hash for marking a reminder as alerted-for-X in
 * localStorage. Hashes (date, time, normalised description) — so
 * editing any of these arms a fresh alert.
 */
export function reminderHash(r: ParsedReminder): string {
  const key = `${r.date ?? ""}|${r.time ?? ""}|${r.description.trim().toLowerCase()}`;
  // Tiny FNV-1a 32-bit so we don't need a crypto dep.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * WebAudio notification beep. Two short tones (660Hz then 880Hz),
 * ~90ms each with a small gap, plus quick attack/release envelopes
 * so it doesn't click. Total duration ~220ms.
 *
 * Lazily instantiates an AudioContext per call — cheap, and avoids
 * the "AudioContext was not allowed to start" issue on first load
 * (the first beep won't play before the user has interacted, which
 * is fine for a notification system since Cortex requires inter-
 * action to be open in the first place).
 *
 * v1.1: peak gain raised from 0.18 → 0.6, single tone replaced with
 * a two-note "ding-ding" pattern. The original was easy to miss in
 * background noise; the rising two-tone is the standard
 * notification shape (matches the system bell on most desktop OSes).
 */
export function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(ctx.destination);

    const peak = 0.6;
    const tone = (freq: number, startOffset: number, durSec: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(master);
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
      osc.start(t0);
      osc.stop(t0 + durSec + 0.02);
      return osc;
    };

    const first = tone(660, 0.0, 0.09);
    const second = tone(880, 0.11, 0.11);

    // Close the AudioContext after the second tone has finished.
    second.onended = () => {
      try {
        ctx.close();
      } catch {
        /* ignore */
      }
    };
    void first; // keep reference alive until GC
  } catch {
    // Audio APIs unavailable / blocked — silent fallback. Visual
    // bell badge still works.
  }
}
