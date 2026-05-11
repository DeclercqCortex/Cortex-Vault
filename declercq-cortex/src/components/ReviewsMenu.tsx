import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  // Cluster 26 — the dropdown is portaled to document.body so it
  // escapes the sidebar's clipping (the sidebar has backdrop-filter,
  // which creates a containing block for fixed-position descendants;
  // any position: absolute/fixed dropdown inside the sidebar would
  // otherwise get clipped at its 300 px boundary). We compute the
  // dropdown's screen-space position from the button's
  // getBoundingClientRect() each time the dropdown opens.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Click-outside dismissal — must check BOTH the trigger ref (in the
  // sidebar) and the portaled menu ref (in document.body) because the
  // two are no longer DOM-connected.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Recompute the dropdown position whenever it opens or the window
  // resizes / scrolls. Anchors to the button's bottom-left.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const select = (choice: DestinationChoice) => {
    setOpen(false);
    onPick(choice);
  };

  const menu =
    open && pos ? (
      <div
        ref={menuRef}
        style={{
          ...styles.menu,
          position: "fixed",
          top: pos.top,
          left: pos.left,
        }}
        role="menu"
      >
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
    ) : null;

  return (
    <div ref={ref} style={styles.wrap}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={styles.btn}
        title="Mark System destinations"
      >
        Reviews ▾
      </button>
      {/* Portal the dropdown to document.body so it escapes the
       *  sidebar's clipping (sidebar has backdrop-filter, which makes
       *  it a containing block for fixed-position descendants). */}
      {createPortal(menu, document.body)}
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
