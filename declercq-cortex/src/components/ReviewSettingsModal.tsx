// ReviewSettingsModal — Cluster 24 v1.0.
//
// Two checkboxes: weekly review (every Sunday) and monthly review (first
// Sunday of each month). Save calls ensure_review_events on the backend,
// which UPSERTs the recurring all-day events with notify_mode='urgent'
// (Cluster 15) so the notification bell keeps them visible all day.
//
// Auto-init: the App.tsx mount path calls ensure_review_events with both
// flags TRUE on the first vault load that doesn't yet have the events.
// This modal is for editing the schedule afterwards (or re-creating the
// events if the user accidentally deleted them via right-click on the
// calendar).
//
// On disable, the corresponding event is DELETED (not just hidden) — the
// bell stops surfacing it instantly and the calendar stops drawing it.
// The user can always re-enable from this modal; the event re-appears on
// the next Sunday.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ReviewSettingsModalProps {
  vaultPath: string;
  onClose: () => void;
  /** Optional: called after a successful save so App.tsx can bump
   *  refresh keys (calendar needs to re-fetch). */
  onSaved?: () => void;
}

export function ReviewSettingsModal({
  vaultPath,
  onClose,
  onSaved,
}: ReviewSettingsModalProps) {
  const [weekly, setWeekly] = useState(true);
  const [monthly, setMonthly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<[boolean, boolean]>("get_review_settings", { vaultPath })
      .then(([w, m]) => {
        setWeekly(w);
        setMonthly(m);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [vaultPath]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await invoke("ensure_review_events", {
        vaultPath,
        weeklyEnabled: weekly,
        monthlyEnabled: monthly,
        // tz_offset_minutes uses the project's local-day convention
        // — Cluster 10 v1.2 / Cluster 14 v1.4 set the precedent.
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="cortex-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={styles.backdrop}
      data-cortex-scrim
    >
      <div
        className="cortex-modal"
        style={styles.modal}
        role="dialog"
        aria-modal
        data-cortex-modal
      >
        <h3 style={styles.title}>Review schedule</h3>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : (
          <>
            <p style={styles.intro}>
              Recurring all-day events on the calendar. The notification bell
              keeps them visible all day until you dismiss them.
            </p>

            <label style={styles.row}>
              <input
                type="checkbox"
                checked={weekly}
                onChange={(e) => setWeekly(e.target.checked)}
                disabled={saving}
              />
              <span style={styles.rowLabel}>
                <strong>Weekly review</strong>
                <span style={styles.muted}> — every Sunday</span>
              </span>
            </label>

            <label style={styles.row}>
              <input
                type="checkbox"
                checked={monthly}
                onChange={(e) => setMonthly(e.target.checked)}
                disabled={saving}
              />
              <span style={styles.rowLabel}>
                <strong>Monthly review</strong>
                <span style={styles.muted}> — first Sunday of each month</span>
              </span>
            </label>

            {error ? <p style={styles.error}>{error}</p> : null}
          </>
        )}

        <div style={styles.buttons}>
          <button
            type="button"
            onClick={onClose}
            style={styles.cancelBtn}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            style={styles.saveBtn}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modal: {
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "1rem 1.25rem",
    minWidth: "min(420px, 90vw)",
    maxWidth: "min(560px, 92vw)",
    boxShadow: "0 12px 36px rgba(0,0,0,0.32)",
  },
  title: {
    margin: "0 0 0.5rem 0",
    fontSize: "1rem",
    fontWeight: 600,
  },
  intro: {
    margin: "0 0 0.75rem 0",
    fontSize: "0.85rem",
    color: "var(--text-muted)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 0",
    cursor: "pointer",
  },
  rowLabel: {
    fontSize: "0.95rem",
  },
  muted: {
    color: "var(--text-muted)",
    fontSize: "0.85rem",
  },
  error: {
    color: "var(--danger)",
    fontSize: "0.85rem",
    margin: "0.5rem 0 0 0",
  },
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
    marginTop: "1rem",
  },
  cancelBtn: {
    padding: "6px 14px",
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  saveBtn: {
    padding: "6px 14px",
    background: "var(--accent)",
    color: "white",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    cursor: "pointer",
  },
};
