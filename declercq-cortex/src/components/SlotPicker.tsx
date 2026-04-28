// SlotPicker — modal that asks "open this file in which slot?".
//
// Used when the user clicks a result in the command palette while a
// multi-slot layout is active. The slots are previewed with the same
// numbering as the layout grid (top-to-bottom, left-to-right).

import { useEffect } from "react";
import type { LayoutMode } from "./LayoutPicker";
import { LayoutIcon } from "./LayoutPicker";

export type SlotPickerProps = {
  isOpen: boolean;
  layout: LayoutMode;
  /** The path that's currently open in each slot (for preview). */
  slotPaths: (string | null)[];
  pendingPath: string | null;
  onPick: (slotIndex: number) => void;
  onClose: () => void;
};

export function SlotPicker(props: SlotPickerProps) {
  const { isOpen, layout, slotPaths, pendingPath, onPick, onClose } = props;

  // Number-key shortcut: 1..4 picks the slot.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= slotPaths.length) {
        e.preventDefault();
        onPick(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, slotPaths.length, onPick, onClose]);

  if (!isOpen) return null;

  const fileName = pendingPath
    ? pendingPath.replace(/^.*[\\/]/, "")
    : "(no file)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "1.2rem 1.5rem",
          minWidth: "440px",
          maxWidth: "560px",
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ marginBottom: "0.5rem", fontWeight: 600 }}>
          Open in which slot?
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            marginBottom: "1rem",
          }}
          title={pendingPath ?? ""}
        >
          <span style={{ opacity: 0.8 }}>File:</span>{" "}
          <code
            style={{
              fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
            }}
          >
            {fileName}
          </code>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(slotPaths.length, 4)}, 1fr)`,
            gap: "0.5rem",
          }}
        >
          {slotPaths.map((p, i) => (
            <button
              key={i}
              onClick={() => onPick(i)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.7rem 0.5rem",
                border: "1px solid var(--border-2)",
                borderRadius: "6px",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text)",
              }}
            >
              <LayoutIcon mode={layout} size={36} />
              <strong style={{ fontSize: "0.95rem" }}>Slot {i + 1}</strong>
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  maxWidth: "10rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={p ?? ""}
              >
                {p ? p.replace(/^.*[\\/]/, "") : "empty"}
              </span>
            </button>
          ))}
        </div>

        <div
          style={{
            marginTop: "0.9rem",
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Tip: press 1–{slotPaths.length} to pick a slot.</span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border-2)",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "0.7rem",
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            Cancel (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
