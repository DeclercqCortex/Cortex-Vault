import { useEffect, useRef } from "react";

interface TableContextMenuProps {
  /** Absolute screen position (pixels). */
  x: number;
  y: number;
  /** True when the cursor is inside a table at right-click time. */
  inTable: boolean;
  /** True when the current selection spans multiple cells (mergeable). */
  canMerge: boolean;
  /** True when the current cell can be split. */
  canSplit: boolean;
  /** Close the menu without taking any action. */
  onClose: () => void;
  /** Open the InsertTableModal. */
  onInsertTable: () => void;
  /** Run a TipTap chain command on the editor. */
  onAction: (kind: TableAction) => void;
}

export type TableAction =
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable"
  | "toggleHeaderRow"
  | "mergeCells"
  | "splitCell";

/**
 * Right-click menu that the editor opens when the user right-clicks. The
 * editor decides what's possible (`inTable`, `canMerge`, `canSplit`) and
 * passes the booleans in; this component is just a positioned list.
 *
 * Click outside or Esc closes. Keyboard navigation (arrow keys, Enter)
 * is intentionally *not* implemented for v1 — the menu is mouse-driven
 * to match Excel/Word's right-click pattern.
 */
export function TableContextMenu({
  x,
  y,
  inTable,
  canMerge,
  canSplit,
  onClose,
  onInsertTable,
  onAction,
}: TableContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp into the viewport so a click near the bottom-right doesn't
  // open a menu that's half off-screen.
  const menuWidth = 220;
  const menuHeightEstimate = inTable ? 360 : 60;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeightEstimate - 8);

  function fire(a: TableAction) {
    onAction(a);
    onClose();
  }

  return (
    <div
      ref={ref}
      style={{ ...styles.menu, left, top, width: menuWidth }}
      role="menu"
      aria-label="Table options"
      // The mousedown-outside listener above closes us; clicks inside
      // bubble to our own buttons normally.
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      {!inTable && (
        <MenuItem
          label="Insert table…"
          onClick={() => {
            onInsertTable();
            onClose();
          }}
        />
      )}

      {inTable && (
        <>
          <MenuItem
            label="Insert row above"
            onClick={() => fire("addRowBefore")}
          />
          <MenuItem
            label="Insert row below"
            onClick={() => fire("addRowAfter")}
          />
          <MenuItem
            label="Insert column left"
            onClick={() => fire("addColumnBefore")}
          />
          <MenuItem
            label="Insert column right"
            onClick={() => fire("addColumnAfter")}
          />
          <Divider />
          <MenuItem
            label="Delete row"
            onClick={() => fire("deleteRow")}
            danger
          />
          <MenuItem
            label="Delete column"
            onClick={() => fire("deleteColumn")}
            danger
          />
          <MenuItem
            label="Delete table"
            onClick={() => fire("deleteTable")}
            danger
          />
          <Divider />
          <MenuItem
            label="Toggle header row"
            onClick={() => fire("toggleHeaderRow")}
          />
          {canMerge && (
            <MenuItem label="Merge cells" onClick={() => fire("mergeCells")} />
          )}
          {canSplit && (
            <MenuItem label="Split cell" onClick={() => fire("splitCell")} />
          )}
          <Divider />
          <MenuItem
            label="Insert another table…"
            onClick={() => {
              onInsertTable();
              onClose();
            }}
          />
        </>
      )}
    </div>
  );
}

interface MenuItemProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
}
function MenuItem({ label, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      style={{
        ...styles.item,
        color: danger ? "var(--danger)" : "var(--text)",
      }}
      onClick={onClick}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-deep)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div style={styles.divider} />;
}

const styles: Record<string, React.CSSProperties> = {
  menu: {
    position: "fixed",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "var(--shadow)",
    padding: "4px 0",
    zIndex: 1100,
    fontSize: "0.85rem",
    minWidth: "220px",
  },
  item: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 12px",
    fontSize: "0.85rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text)",
  },
  divider: {
    height: "1px",
    background: "var(--border)",
    margin: "4px 0",
  },
};
