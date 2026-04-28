import { useEffect, useRef, useState } from "react";

export type DestinationChoice =
  | { kind: "queue"; queueKind: "yellow" | "green" }
  | {
      kind: "persistent";
      persistentKind: "bottlenecks" | "antihype" | "citations" | "concepts";
    };

interface ReviewsMenuProps {
  onPick: (choice: DestinationChoice) => void;
}

/**
 * Small sidebar dropdown listing all of Cluster 3's destinations:
 *
 *   - Virtual queues (Weekly, Monthly) → MarkQueueView in main pane
 *   - Persistent files (Bottlenecks, Anti-Hype, citations-to-use,
 *     Concept Inbox) → regenerate + open as a normal file
 *
 * The button looks like the other compact sidebar buttons. Click toggles
 * the dropdown; the dropdown closes when the user picks an item or
 * clicks outside.
 */
export function ReviewsMenu({ onPick }: ReviewsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside dismissal.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const select = (choice: DestinationChoice) => {
    setOpen(false);
    onPick(choice);
  };

  return (
    <div ref={ref} style={styles.wrap}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={styles.btn}
        title="Mark System destinations"
      >
        Reviews ▾
      </button>
      {open && (
        <div style={styles.menu} role="menu">
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Queues</div>
            <button
              style={styles.item}
              onClick={() => select({ kind: "queue", queueKind: "yellow" })}
            >
              <span
                style={{
                  ...styles.swatch,
                  background: "rgba(220, 180, 60, 0.6)",
                }}
              />
              Weekly review
            </button>
            <button
              style={styles.item}
              onClick={() => select({ kind: "queue", queueKind: "green" })}
            >
              <span
                style={{
                  ...styles.swatch,
                  background: "rgba(90, 180, 110, 0.6)",
                }}
              />
              Monthly review
            </button>
          </div>
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Persistent files</div>
            <button
              style={styles.item}
              onClick={() =>
                select({ kind: "persistent", persistentKind: "bottlenecks" })
              }
            >
              <span
                style={{
                  ...styles.swatch,
                  background: "rgba(220, 90, 90, 0.6)",
                }}
              />
              Bottlenecks
            </button>
            <button
              style={styles.item}
              onClick={() =>
                select({ kind: "persistent", persistentKind: "antihype" })
              }
            >
              <span
                style={{
                  ...styles.swatch,
                  background: "rgba(230, 140, 60, 0.6)",
                }}
              />
              Anti-Hype
            </button>
            <button
              style={styles.item}
              onClick={() =>
                select({ kind: "persistent", persistentKind: "citations" })
              }
            >
              <span
                style={{
                  ...styles.swatch,
                  background: "rgba(150, 110, 220, 0.6)",
                }}
              />
              Citations to use
            </button>
            <button
              style={styles.item}
              onClick={() =>
                select({ kind: "persistent", persistentKind: "concepts" })
              }
            >
              <span
                style={{
                  ...styles.swatch,
                  background: "rgba(90, 150, 230, 0.6)",
                }}
              />
              Concept Inbox
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: "relative",
    display: "inline-block",
  },
  btn: {
    fontSize: "0.7rem",
    padding: "2px 8px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: "200px",
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "var(--shadow)",
    zIndex: 500,
    padding: "0.4rem 0",
  },
  section: {
    padding: "0.25rem 0",
  },
  sectionLabel: {
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    padding: "0.3rem 0.75rem 0.2rem",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.4rem 0.75rem",
    background: "transparent",
    color: "var(--text)",
    border: "none",
    cursor: "pointer",
    fontSize: "0.85rem",
    textAlign: "left",
  },
  swatch: {
    display: "inline-block",
    width: "10px",
    height: "10px",
    borderRadius: "2px",
    flexShrink: 0,
  },
};
