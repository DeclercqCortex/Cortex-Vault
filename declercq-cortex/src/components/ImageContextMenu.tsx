// ImageContextMenu — Cluster 19 v1.0.
//
// Right-click menu for a CortexImage. Mirrors the BlockContextMenu /
// TableContextMenu pattern: a self-positioning floating panel with
// menu items that emit a discriminated-union action; the editor host
// applies the action via ProseMirror transactions.
//
// Mounted by Editor.tsx in response to the
// `cortex:image-context-menu` CustomEvent dispatched from the
// CortexImage NodeView.

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
  onAction: (action: ImageContextAction) => void;
  onClose: () => void;
}

const MENU_WIDTH = 200;

export function ImageContextMenu({
  x,
  y,
  attrs,
  onAction,
  onClose,
}: ImageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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
      <div style={sectionLabel}>Wrap</div>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "left" })}
        leading={dot(attrs.wrapMode === "left")}
      >
        Wrap left
      </Item>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "right" })}
        leading={dot(attrs.wrapMode === "right")}
      >
        Wrap right
      </Item>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "break" })}
        leading={dot(attrs.wrapMode === "break")}
      >
        Break (no wrap)
      </Item>
      <Item
        onClick={() => pick({ kind: "wrap", mode: "free" })}
        leading={dot(attrs.wrapMode === "free")}
      >
        Free position
      </Item>

      <div style={separator} />
      <div style={sectionLabel}>Adjust</div>
      <Item
        onClick={() => pick({ kind: "reset-rotation" })}
        disabled={Math.abs(attrs.rotation) < 0.01}
      >
        Reset rotation
        {attrs.rotation ? (
          <span style={hintStyle}>{attrs.rotation.toFixed(0)}°</span>
        ) : null}
      </Item>
      <Item
        onClick={() => pick({ kind: "reset-position" })}
        disabled={attrs.wrapMode !== "free"}
      >
        Reset position
      </Item>
      <Item onClick={() => pick({ kind: "set-width", width: null })}>
        Reset width
        {attrs.width != null ? (
          <span style={hintStyle}>{attrs.width}px</span>
        ) : null}
      </Item>

      <div style={separator} />
      <div style={sectionLabel}>Flip</div>
      <Item onClick={() => pick({ kind: "flip-h" })} leading={dot(attrs.flipH)}>
        Flip horizontal
      </Item>
      <Item onClick={() => pick({ kind: "flip-v" })} leading={dot(attrs.flipV)}>
        Flip vertical
      </Item>

      <div style={separator} />
      <Item onClick={() => pick({ kind: "crop" })}>Crop image…</Item>

      <div style={separator} />
      <Item onClick={() => pick({ kind: "edit-annotation" })}>
        {attrs.annotation ? "Edit annotation…" : "Add annotation…"}
      </Item>

      <div style={separator} />
      <Item
        onClick={() => pick({ kind: "delete" })}
        style={{ color: "var(--danger)" }}
      >
        Delete image
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
}
function Item({ onClick, children, leading, disabled, style }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
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
