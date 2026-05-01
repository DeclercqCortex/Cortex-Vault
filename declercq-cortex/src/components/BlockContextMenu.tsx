// BlockContextMenu — Cluster 17 Pass 6.
//
// Right-click menu for typedBlock nodes. Mirrors TableContextMenu's
// structure (positioned float, click-outside to close, viewport
// clamping) but exposes block-specific actions:
//
//   - Edit name        → flips the title bar's input mode.
//   - Delete block     → calls deleteNode on the typedBlock.
//
// Edit-name is also reachable via the pencil button on the title bar
// itself; the right-click menu is the discoverability path users will
// reach for first.
//
// Why a separate menu component (instead of folding the actions into
// TableContextMenu): the two menus serve disjoint contexts. Inside a
// table inside a typedBlock, the user gets the table menu (insert
// row / delete column / etc.). Inside a typedBlock but not inside a
// table, the user gets THIS menu. Editor.tsx's handleContextMenu picks
// which one to show based on what the click landed inside.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TypedBlockType } from "../editor/TypedBlockNode";

export type BlockAction = "editName" | "deleteBlock";

interface BlockContextMenuProps {
  /** Absolute screen position (pixels). */
  x: number;
  y: number;
  /** Block type label for the header row (Experiment / Protocol / …). */
  blockType: TypedBlockType;
  /** Display name of the block. */
  blockName: string;
  /** Close the menu without taking an action. */
  onClose: () => void;
  /** Run a block action against the editor. */
  onAction: (kind: BlockAction) => void;
}

export function BlockContextMenu({
  x,
  y,
  blockType,
  blockName,
  onClose,
  onAction,
}: BlockContextMenuProps) {
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

  const menuWidth = 220;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  function fire(a: BlockAction) {
    onAction(a);
    onClose();
  }

  const kindLabel = blockType.charAt(0).toUpperCase() + blockType.slice(1);

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
      aria-label="Block options"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={styles.header}>
        {kindLabel}
        {blockName ? ` · ${blockName}` : ""}
      </div>
      <Divider />
      <MenuItem label="Edit name" onClick={() => fire("editName")} />
      <Divider />
      <MenuItem
        label="Delete block"
        onClick={() => fire("deleteBlock")}
        danger
      />
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
    zIndex: 5000,
    fontSize: "0.85rem",
    minWidth: "220px",
    maxHeight: "80vh",
    overflowY: "auto",
    overflowX: "hidden",
  },
  header: {
    padding: "6px 12px",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    userSelect: "none",
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
