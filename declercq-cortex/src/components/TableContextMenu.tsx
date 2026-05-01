import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  | "splitCell"
  | "equalizeColumns"
  | "valignTop"
  | "valignMiddle"
  | "valignBottom"
  // Cluster 18 v1.1
  | "cellTypeText"
  | "cellTypeNumber"
  | "cellTypeMoney"
  | "cellTypePercent"
  | "cellTypeDate"
  | "freezeRows0"
  | "freezeRows1"
  | "freezeRows2"
  | "freezeRows3"
  | "freezeCols0"
  | "freezeCols1"
  | "freezeCols2"
  | "freezeCols3"
  // Cluster 18 v1.2
  | "sortAsc"
  | "sortDesc"
  | "filterMatch"
  | "filterClear";

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
  //
  // Cluster 16 v1.1: v1.0 used a static `menuHeightEstimate = 360`
  // which (a) was wrong for the new "Cell alignment" subgroup and
  // bigger menus, and (b) didn't account for the menu rendering past
  // the viewport when the user right-clicked near the bottom of the
  // app. The new approach: render at the requested coords first, then
  // in a layout effect measure the actual rendered rect and clamp,
  // also capping max-height to 80% of the viewport so the menu can
  // scroll if the content is genuinely taller than the screen.
  const menuWidth = 240;
  const initialLeft = Math.min(x, window.innerWidth - menuWidth - 8);
  const initialTop = Math.min(y, window.innerHeight - 80);
  const [pos, setPos] = useState({ left: initialLeft, top: initialTop });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = pos.left;
    let top = pos.top;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (left !== pos.left || top !== pos.top) {
      setPos({ left, top });
    }
    // Intentional: this runs once on mount and whenever pos is updated;
    // we early-out if the clamp produced no change to avoid the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, inTable, canMerge, canSplit]);

  function fire(a: TableAction) {
    onAction(a);
    onClose();
  }

  return (
    <div
      ref={ref}
      style={{
        ...styles.menu,
        left: pos.left,
        top: pos.top,
        width: menuWidth,
      }}
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
            label="Equalize column widths"
            onClick={() => fire("equalizeColumns")}
          />
          <Divider />
          <MenuItemHeader label="Cell alignment" />
          <MenuItem label="Top" onClick={() => fire("valignTop")} indented />
          <MenuItem
            label="Middle"
            onClick={() => fire("valignMiddle")}
            indented
          />
          <MenuItem
            label="Bottom"
            onClick={() => fire("valignBottom")}
            indented
          />
          <Divider />
          <MenuItemHeader label="Cell type" />
          <MenuItem
            label="Text"
            onClick={() => fire("cellTypeText")}
            indented
          />
          <MenuItem
            label="Number"
            onClick={() => fire("cellTypeNumber")}
            indented
          />
          <MenuItem
            label="Money"
            onClick={() => fire("cellTypeMoney")}
            indented
          />
          <MenuItem
            label="Percent"
            onClick={() => fire("cellTypePercent")}
            indented
          />
          <MenuItem
            label="Date"
            onClick={() => fire("cellTypeDate")}
            indented
          />
          <Divider />
          <MenuItemHeader label="Freeze rows" />
          <MenuItem label="Off" onClick={() => fire("freezeRows0")} indented />
          <MenuItem
            label="1 row"
            onClick={() => fire("freezeRows1")}
            indented
          />
          <MenuItem
            label="2 rows"
            onClick={() => fire("freezeRows2")}
            indented
          />
          <MenuItem
            label="3 rows"
            onClick={() => fire("freezeRows3")}
            indented
          />
          <MenuItemHeader label="Freeze columns" />
          <MenuItem label="Off" onClick={() => fire("freezeCols0")} indented />
          <MenuItem
            label="1 column"
            onClick={() => fire("freezeCols1")}
            indented
          />
          <MenuItem
            label="2 columns"
            onClick={() => fire("freezeCols2")}
            indented
          />
          <MenuItem
            label="3 columns"
            onClick={() => fire("freezeCols3")}
            indented
          />
          <Divider />
          <MenuItemHeader label="Sort column" />
          <MenuItem
            label="Ascending"
            onClick={() => fire("sortAsc")}
            indented
          />
          <MenuItem
            label="Descending"
            onClick={() => fire("sortDesc")}
            indented
          />
          <Divider />
          <MenuItemHeader label="Filter rows" />
          <MenuItem
            label="Match this cell"
            onClick={() => fire("filterMatch")}
            indented
          />
          <MenuItem
            label="Clear filter"
            onClick={() => fire("filterClear")}
            indented
          />
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
  /** Cluster 16 — slight left padding so a "submenu" reads visually
   *  grouped under its header (Cell alignment ▸ Top / Middle / Bottom).
   *  Lighter than building a real cascading submenu, which v1 doesn't
   *  need. */
  indented?: boolean;
}
function MenuItem({ label, onClick, danger, indented }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      style={{
        ...styles.item,
        color: danger ? "var(--danger)" : "var(--text)",
        // styles.item uses padding shorthand (6px 12px); override the
        // left edge for indented sub-items without disturbing the
        // top/right/bottom values.
        ...(indented ? { paddingLeft: "1.6rem" } : null),
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

/** Non-clickable label that visually groups a set of related items
 *  underneath. v1 — no real submenu cascade. */
function MenuItemHeader({ label }: { label: string }) {
  return <div style={styles.itemHeader}>{label}</div>;
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
    // Cluster 16 v1.1: bump z-index above the bell dropdown / palette /
    // any other floating UI. v1.0 used 1100 which lost to the
    // notification-bell panel (~1500). Lift to 5000 so the table menu
    // is unambiguously the top-most float.
    zIndex: 5000,
    fontSize: "0.85rem",
    minWidth: "240px",
    // Cluster 16 v1.1: cap height at 80% of viewport and let the menu
    // scroll. Right-clicking near the bottom of the app no longer
    // produces a menu that visually bleeds off the screen — it gets
    // clamped (in the layout effect above) and scrollable.
    maxHeight: "80vh",
    overflowY: "auto",
    overflowX: "hidden",
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
  itemHeader: {
    padding: "4px 12px 2px",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    userSelect: "none",
  },
  divider: {
    height: "1px",
    background: "var(--border)",
    margin: "4px 0",
  },
};
