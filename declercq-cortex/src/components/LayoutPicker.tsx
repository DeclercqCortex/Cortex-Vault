// LayoutPicker — top-right widget for choosing the main-pane layout.
//
// Five options:
//   single      → 1 pane (default)
//   dual        → 2 side-by-side
//   tri-bottom  → 2 side-by-side on top, 1 large pane on the bottom
//   tri-top     → 1 large pane on top, 2 side-by-side on the bottom
//   quad        → 2×2 grid
//
// Click the toggle button to open the dropdown. Each option shows a
// tiny preview of the layout. Slots are numbered top-to-bottom,
// left-to-right (per the cluster spec).

import { useEffect, useRef, useState } from "react";

export type LayoutMode = "single" | "dual" | "tri-bottom" | "tri-top" | "quad";

export function slotCountForLayout(mode: LayoutMode): number {
  switch (mode) {
    case "single":
      return 1;
    case "dual":
      return 2;
    case "tri-bottom":
    case "tri-top":
      return 3;
    case "quad":
      return 4;
  }
}

export function LayoutPicker({
  mode,
  onChange,
}: {
  mode: LayoutMode;
  onChange: (next: LayoutMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const options: { mode: LayoutMode; label: string }[] = [
    { mode: "single", label: "Single" },
    { mode: "dual", label: "Two side-by-side" },
    { mode: "tri-bottom", label: "Two top, one bottom" },
    { mode: "tri-top", label: "One top, two bottom" },
    { mode: "quad", label: "Quad (2×2)" },
  ];

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={styles.toggle}
        title="Change layout"
        aria-label="Change layout"
      >
        <LayoutIcon mode={mode} size={14} />
        <span style={{ marginLeft: "5px", fontSize: "0.7rem" }}>Layout</span>
        <span style={{ marginLeft: "4px", opacity: 0.6, fontSize: "0.65rem" }}>
          ▾
        </span>
      </button>
      {open && (
        <div style={styles.menu}>
          {options.map((opt) => {
            const active = opt.mode === mode;
            return (
              <button
                key={opt.mode}
                onClick={() => {
                  onChange(opt.mode);
                  setOpen(false);
                }}
                style={{
                  ...styles.item,
                  background: active ? "var(--bg-active)" : "transparent",
                  borderColor: active ? "var(--accent)" : "transparent",
                }}
                title={opt.label}
              >
                <LayoutIcon mode={opt.mode} size={28} />
                <span style={{ marginLeft: "10px" }}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Tiny preview icon for each layout. */
export function LayoutIcon({
  mode,
  size = 14,
}: {
  mode: LayoutMode;
  size?: number;
}) {
  // We draw with thin borders and subtle gaps so the layout reads at a glance.
  const cell: React.CSSProperties = {
    background: "var(--text-muted)",
    opacity: 0.55,
    borderRadius: "1px",
  };
  const wrap: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    display: "grid",
    gap: "1px",
    flex: "0 0 auto",
  };
  switch (mode) {
    case "single":
      return (
        <div style={{ ...wrap, gridTemplate: "1fr / 1fr" }}>
          <div style={cell} />
        </div>
      );
    case "dual":
      return (
        <div style={{ ...wrap, gridTemplate: "1fr / 1fr 1fr" }}>
          <div style={cell} />
          <div style={cell} />
        </div>
      );
    case "tri-bottom":
      return (
        <div
          style={{
            ...wrap,
            gridTemplate: `"a b" 1fr "c c" 1fr / 1fr 1fr`,
          }}
        >
          <div style={{ ...cell, gridArea: "a" }} />
          <div style={{ ...cell, gridArea: "b" }} />
          <div style={{ ...cell, gridArea: "c" }} />
        </div>
      );
    case "tri-top":
      return (
        <div
          style={{
            ...wrap,
            gridTemplate: `"a a" 1fr "b c" 1fr / 1fr 1fr`,
          }}
        >
          <div style={{ ...cell, gridArea: "a" }} />
          <div style={{ ...cell, gridArea: "b" }} />
          <div style={{ ...cell, gridArea: "c" }} />
        </div>
      );
    case "quad":
      return (
        <div style={{ ...wrap, gridTemplate: "1fr 1fr / 1fr 1fr" }}>
          <div style={cell} />
          <div style={cell} />
          <div style={cell} />
          <div style={cell} />
        </div>
      );
  }
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
  },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px 3px 6px",
    fontSize: "0.7rem",
    cursor: "pointer",
    background: "var(--bg-card)",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    lineHeight: 1.2,
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: 0,
    minWidth: "240px",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "var(--shadow)",
    padding: "4px",
    zIndex: 100,
  },
  item: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "6px 8px",
    border: "1px solid transparent",
    borderRadius: "4px",
    cursor: "pointer",
    color: "var(--text)",
    fontSize: "0.8rem",
    textAlign: "left",
  },
};
