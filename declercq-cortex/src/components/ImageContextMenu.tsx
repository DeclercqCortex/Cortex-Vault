// ImageContextMenu — Cluster 19 v1.0; multi-mode added in v1.3.
//
// Right-click menu for a CortexImage. Mirrors the BlockContextMenu /
// TableContextMenu pattern: a self-positioning floating panel with
// menu items that emit a discriminated-union action; the editor host
// applies the action via ProseMirror transactions.
//
// Mounted by Editor.tsx in response to the
// `cortex:image-context-menu` CustomEvent dispatched from the
// CortexImage NodeView.
//
// Cluster 19 v1.3 — when the right-clicked image is part of an
// active multi-selection, the host passes a non-null `multi` prop.
// In that mode:
//   - the menu header shows "N images selected"
//   - leading-dot consensus is computed from the multi summary
//     (dot only when ALL match), with hint text (rotation degrees,
//     width pixels) suppressed since they're heterogeneous
//   - crop and edit-annotation entries are disabled (single-image
//     inherent)
//   - all other actions still emit the same kind; the host
//     iterates the multi-set and applies bulk

import { useEffect, useRef } from "react";
import type { CortexImageWrap } from "../editor/CortexImageNode";

export type ImageContextAction =
  | { kind: "wrap"; mode: CortexImageWrap }
  | { kind: "reset-rotation" }
  | { kind: "reset-position" }
  | { kind: "set-width"; width: number | null }
  | { kind: "edit-annotation" }
  // Cluster 19 v1.1 — flip toggles. The host applies via
  // editor.commands.updateAttributes({ flipH: !current.flipH }) etc.
  | { kind: "flip-h" }
  | { kind: "flip-v" }
  // Cluster 19 v1.2 — open the CropModal for this image. Editor.tsx
  // hosts the modal; on Apply it draws the cropped region to a
  // canvas, sends the bytes to save_cropped_image, and replaces the
  // node's src with the new attachment path.
  | { kind: "crop" }
  | { kind: "delete" };

/** Cluster 19 v1.3 — consensus snapshot of the multi-selection set,
 *  computed by the host at menu-open time. `null` indicates single-
 *  image mode (the v1.0–v1.2 path). */
export interface ImageContextMenuMulti {
  count: number;
  /** Common wrap mode if all selected images share one; null when
   *  the set is heterogeneous. */
  commonWrap: CortexImageWrap | null;
  /** True if EVERY selected image has flipH=true. */
  allFlipH: boolean;
  /** True if EVERY selected image has flipV=true. */
  allFlipV: boolean;
  /** True if AT LEAST ONE selected image has non-zero rotation. */
  anyRotated: boolean;
  /** True if AT LEAST ONE selected image is in free-position mode
   *  with non-null freeX/freeY. */
  anyFree: boolean;
  /** True if AT LEAST ONE selected image has a non-null width. */
  anyHasWidth: boolean;
}

export interface ImageContextMenuProps {
  /** Right-click coordinates in viewport pixels. */
  x: number;
  y: number;
  /** Snapshot of the image's current attrs, for menu state. */
  attrs: {
    wrapMode: CortexImageWrap;
    rotation: number;
    width: number | null;
    annotation: string;
    /** Cluster 19 v1.1 — flip state, used to render the active dot
     *  next to "Flip horizontal" / "Flip vertical" so the menu shows
     *  whether the toggle is currently on. */
    flipH: boolean;
    flipV: boolean;
  };
  /** Cluster 19 v1.3 — non-null when the right-clicked image is in an
   *  active multi-selection set; the menu acts on every selected
   *  image and shows a consensus header. */
  multi?: ImageContextMenuMulti | null;
  onAction: (action: ImageContextAction) => void;
  onClose: () => void;
}

const MENU_WIDTH = 200;

export function ImageContextMenu({
  x,
  y,
  attrs,
  multi,
  onAction,
  onClose,
}: ImageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isMulti = !!multi && multi.count > 1;

  // Outside click + Esc → close.
  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      const m = menuRef.current;
      if (!m) return;
      if (e.target instanceof Node && m.contains(e.target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp position to keep menu on screen.
  const clampedLeft = Math.min(
    Math.max(4, x),
    Math.max(4, window.innerWidth - MENU_WIDTH - 4),
  );
  const clampedTop = Math.min(
    Math.max(4, y),
    Math.max(4, window.innerHeight - 320),
  );

  function pick(action: ImageContextAction) {
    onAction(action);
    onClose();
  }

  function dot(active: boolean) {
    return (
      <span
        style={{
          width: "8px",
          display: "inline-block",
          color: active ? "var(--accent)" : "transparent",
          fontSize: "0.7rem",
        }}
      >
        {active ? "●" : ""}
      </span>
    );
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Image options"
      style={{
        position: "fixed",
        top: clampedTop,
        left: clampedLeft,
        width: `${MENU_WIDTH}px`,
        zIndex: 900,
        background: "var(--bg-card)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        padding: "4px",
        fontSize: "0.85rem",
      }}
    >
      {isMulti && (
        <div style={multiHeader} role="presentation">
          {multi!.count} images selected
        </div>
      )}
      <div style={sectionLabel}>Wrap</div>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "left" })}
        leading={dot(
          isMulti ? multi!.commonWrap === "left" : attrs.wrapMode === "left",
        )}
      >
        Wrap left
      </Item>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "right" })}
        leading={dot(
          isMulti ? multi!.commonWrap === "right" : attrs.wrapMode === "right",
        )}
      >
        Wrap right
      </Item>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "break" })}
        leading={dot(
          isMulti ? multi!.commonWrap === "break" : attrs.wrapMode === "break",
        )}
      >
        Break (no wrap)
      </Item>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "free" })}
        leading={dot(
          isMulti ? multi!.commonWrap === "free" : attrs.wrapMode === "free",
        )}
      >
        Free position
      </Item>

      <div style={separator} />
      <div style={sectionLabel}>Adjust</div>
      <Item
        onClick={() => pick({ kind: "reset-rotation" })}
        disabled={
          isMulti ? !multi!.anyRotated : Math.abs(attrs.rotation) < 0.01
        }
      >
        Reset rotation
        {!isMulti && attrs.rotation ? (
          <span style={hintStyle}>{attrs.rotation.toFixed(0)}°</span>
        ) : null}
      </Item>
      <Item
        onClick={() => pick({ kind: "reset-position" })}
        disabled={isMulti ? !multi!.anyFree : attrs.wrapMode !== "free"}
      >
        Reset position
      </Item>
      <Item
        onClick={() => pick({ kind: "set-width", width: null })}
        disabled={isMulti ? !multi!.anyHasWidth : attrs.width == null}
      >
        Reset width
        {!isMulti && attrs.width != null ? (
          <span style={hintStyle}>{attrs.width}px</span>
        ) : null}
      </Item>

      <div style={separator} />
      <div style={sectionLabel}>Flip</div>
      <Item
        onClick={() => pick({ kind: "flip-h" })}
        leading={dot(isMulti ? multi!.allFlipH : attrs.flipH)}
      >
        Flip horizontal
      </Item>
      <Item
        onClick={() => pick({ kind: "flip-v" })}
        leading={dot(isMulti ? multi!.allFlipV : attrs.flipV)}
      >
        Flip vertical
      </Item>

      <div style={separator} />
      {/* Cluster 19 v1.3 — Crop and Edit/Add annotation are inherently
          single-image actions; disabled when in multi-mode. */}
      <Item
        onClick={() => pick({ kind: "crop" })}
        disabled={isMulti}
        title={isMulti ? "Crop one image at a time" : undefined}
      >
        Crop image…
      </Item>

      <div style={separator} />
      <Item
        onClick={() => pick({ kind: "edit-annotation" })}
        disabled={isMulti}
        title={isMulti ? "Annotate one image at a time" : undefined}
      >
        {attrs.annotation ? "Edit annotation…" : "Add annotation…"}
      </Item>

      <div style={separator} />
      <Item
        onClick={() => pick({ kind: "delete" })}
        style={{ color: "var(--danger)" }}
      >
        {isMulti ? `Delete ${multi!.count} images` : "Delete image"}
      </Item>
    </div>
  );
}

interface ItemProps {
  onClick: () => void;
  children: React.ReactNode;
  leading?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Native tooltip for the item. Used in v1.3 for the
   *  multi-mode-disabled hover hint on Crop / Edit annotation. */
  title?: string;
}
function Item({
  onClick,
  children,
  leading,
  disabled,
  style,
  title,
}: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        width: "100%",
        padding: "5px 6px",
        background: "transparent",
        border: "none",
        textAlign: "left",
        color: disabled ? "var(--text-muted)" : "var(--text)",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "0.85rem",
        borderRadius: "3px",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--bg-elev)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {leading}
      <span style={{ flex: 1 }}>{children}</span>
    </button>
  );
}

const sectionLabel: React.CSSProperties = {
  padding: "4px 6px",
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
};
// Cluster 19 v1.3 — multi-mode header. Sits at the very top of the
// menu, above the existing section labels, so the user sees that
// every action is about to act on a multi-set, not just the
// right-clicked image.
const multiHeader: React.CSSProperties = {
  padding: "5px 6px 4px",
  margin: "0 0 2px",
  fontSize: "0.78rem",
  fontWeight: 600,
  color: "var(--accent)",
  borderBottom: "1px solid var(--border)",
};
const separator: React.CSSProperties = {
  height: "1px",
  background: "var(--border)",
  margin: "4px 0",
};
const hintStyle: React.CSSProperties = {
  marginLeft: "0.4rem",
  color: "var(--text-muted)",
  fontSize: "0.72rem",
};
