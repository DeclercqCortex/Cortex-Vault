// Cluster 20 v1.0 — Shape Editor toolbar.
//
// Floating toolbar pinned to the top-right of the active pane while
// shape editor mode is on. Tool buttons (R E L F T H), color
// swatches mapped to keys 1–9, template save / load, exit. Click
// any tool / color to swap; the keyboard equivalents (R/E/L/F/T/H,
// digits 1–9, Ctrl+T, Ctrl+Shift+L, Esc) are handled in
// ShapeEditor.tsx.
//
// v1.0.4 — multi-select extensions: Copy / Paste, six Align buttons
// (top / middle / bottom / left / center / right), two Distribute
// buttons (H / V). The align/distribute section only appears when
// 2+ shapes are selected; distribute additionally needs 3+ to do
// anything visible, but we show the buttons at 2+ and they no-op
// for size === 2 (which is already trivially distributed).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { SHAPE_COLORS, type Shape, type ShapeTool } from "../shapes/types";

/** Cluster 20 v1.0.5 — keep at least a small handle of the toolbar
 *  on-screen so the user can always grab it again. Clamps the
 *  proposed (x, y) so the toolbar's box stays within ±MARGIN of the
 *  viewport edges. */
function clampToViewport(
  x: number,
  y: number,
  el: HTMLDivElement | null,
): { x: number; y: number } {
  const MARGIN = 20;
  const rect = el?.getBoundingClientRect();
  const w = rect?.width ?? 220;
  const h = rect?.height ?? 80;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(MARGIN - w, Math.min(vw - MARGIN, x)),
    y: Math.max(0, Math.min(vh - MARGIN, y)),
  };
}

export type ShapeAlignDirection =
  | "top"
  | "middle"
  | "bottom"
  | "left"
  | "center"
  | "right";

export interface ShapeEditorToolbarProps {
  tool: ShapeTool;
  activeColor: string;
  /** Cluster 20 v1.0.4 — full list of selected shapes. Empty array
   *  when nothing is selected; size 1 enables Delete / Copy; size
   *  2+ also enables Align and Distribute. */
  selectedShapes: Shape[];
  /** Cluster 20 v1.0.4 — number of shapes currently in the
   *  in-memory clipboard (for the Paste button's enabled state and
   *  the count badge). */
  clipboardSize: number;
  onToolChange: (next: ShapeTool) => void;
  onColorChange: (hex: string) => void;
  onDeleteSelected: () => void;
  onCopySelected: () => void;
  onPaste: () => void;
  onAlign: (direction: ShapeAlignDirection) => void;
  onDistribute: (axis: "h" | "v") => void;
  /** Cluster 20 v1.0.5 — viewport-coordinate position. null = use
   *  the default top-right pinning. */
  position: { x: number; y: number } | null;
  /** Called on every successful drag-end with the new position
   *  (or null if the user has reset it via double-click on the
   *  drag handle — handled later via a "reset position" affordance). */
  onPositionChange: (next: { x: number; y: number } | null) => void;
  onExit: () => void;
  onSaveTemplate: () => void;
  onLoadTemplate: () => void;
}

interface ToolEntry {
  key: string; // keyboard key, lower-case
  kind: ShapeTool["kind"];
  label: string;
  hint: string;
}

const TOOLS: ToolEntry[] = [
  { key: "r", kind: "rect", label: "▭", hint: "Rectangle (R)" },
  { key: "e", kind: "ellipse", label: "◯", hint: "Ellipse (E)" },
  { key: "l", kind: "line", label: "／", hint: "Line (L)" },
  { key: "f", kind: "freehand", label: "✎", hint: "Freehand (F)" },
  { key: "t", kind: "transform", label: "⇲", hint: "Transform (T)" },
  { key: "h", kind: "highlight", label: "▣", hint: "Highlight / Fill (H)" },
];

export function ShapeEditorToolbar({
  tool,
  activeColor,
  selectedShapes,
  clipboardSize,
  onToolChange,
  onColorChange,
  onDeleteSelected,
  onCopySelected,
  onPaste,
  onAlign,
  onDistribute,
  position,
  onPositionChange,
  onExit,
  onSaveTemplate,
  onLoadTemplate,
}: ShapeEditorToolbarProps) {
  const selectionSize = selectedShapes.length;
  const hasSelection = selectionSize > 0;
  const hasMultiSelection = selectionSize > 1;

  // ---- Cluster 20 v1.0.5 — drag the toolbar around the viewport ----
  //
  // The "Shape editor" header is the drag handle. pointerdown on the
  // header records the offset of the click within the toolbar; window-
  // level pointermove updates the toolbar position; pointerup commits
  // the new position via onPositionChange (and triggers the host's
  // localStorage persistence). The toolbar itself uses
  // `position: fixed` so it stays visible no matter how the user
  // scrolls the document.

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  /** Drag-in-progress state. Null when not dragging. */
  const [drag, setDrag] = useState<{
    offsetX: number;
    offsetY: number;
    /** Live position during drag, committed to host on pointerup. */
    pos: { x: number; y: number };
  } | null>(null);

  // Window-level pointermove / pointerup so the user can drag past
  // the toolbar's own bounds without losing the pointer.
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const next = clampToViewport(
        e.clientX - drag!.offsetX,
        e.clientY - drag!.offsetY,
        toolbarRef.current,
      );
      setDrag((cur) => (cur ? { ...cur, pos: next } : cur));
    }
    function onUp() {
      // Commit on release. If the user simply clicked without
      // moving, drag.pos === initial drag.pos (no-op commit, which
      // host can short-circuit if it likes).
      setDrag((cur) => {
        if (cur) onPositionChange(cur.pos);
        return null;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, onPositionChange]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only respond to primary button. Right-click / middle-click
    // shouldn't start a drag.
    if (e.button !== 0) return;
    const rect = toolbarRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    setDrag({
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pos: { x: rect.left, y: rect.top },
    });
  }, []);

  /** Cluster 20 v1.0.5 — double-click the header to reset the
   *  toolbar to the default top-right pinning (passes null to the
   *  host so the saved position is cleared from localStorage too). */
  const onHandleDoubleClick = useCallback(() => {
    onPositionChange(null);
  }, [onPositionChange]);

  // Compute the actual position style. During drag we use the live
  // drag.pos; otherwise we use the host-supplied position (or fall
  // back to top: 12, right: 12 when null).
  const positionStyle: CSSProperties = drag
    ? {
        position: "fixed",
        top: drag.pos.y,
        left: drag.pos.x,
        right: "auto",
      }
    : position
      ? {
          position: "fixed",
          top: position.y,
          left: position.x,
          right: "auto",
        }
      : { position: "fixed", top: 12, right: 12 };

  return (
    <div
      ref={toolbarRef}
      className="cortex-shape-editor-toolbar"
      style={{ ...styles.bar, ...positionStyle }}
      // Stop pointerdown bubbling so clicks on toolbar buttons don't
      // start a draw or deselect.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          ...styles.label,
          cursor: drag ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onPointerDown={onHandlePointerDown}
        onDoubleClick={onHandleDoubleClick}
        title="Drag to move the toolbar; double-click to reset to the default position"
      >
        Shape editor ⠿
      </div>

      <div style={styles.row}>
        {TOOLS.map((t) => (
          <button
            key={t.kind}
            type="button"
            title={t.hint}
            style={{
              ...styles.toolBtn,
              ...(tool.kind === t.kind ? styles.toolBtnActive : null),
            }}
            onClick={() => onToolChange({ kind: t.kind } as ShapeTool)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.label}>Color</div>
      <div style={styles.row}>
        {SHAPE_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={`${c.name} (${c.key})`}
            onClick={() => onColorChange(c.hex)}
            style={{
              ...styles.swatch,
              background: c.hex,
              outline:
                activeColor.toLowerCase() === c.hex.toLowerCase()
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
              outlineOffset:
                activeColor.toLowerCase() === c.hex.toLowerCase() ? "2px" : "0",
            }}
          />
        ))}
      </div>

      <div style={styles.row}>
        <button
          type="button"
          title="Save current shapes as a template (Ctrl+T)"
          style={styles.actionBtn}
          onClick={onSaveTemplate}
        >
          Save template
        </button>
        <button
          type="button"
          title="Load a template (Ctrl+Shift+L)"
          style={styles.actionBtn}
          onClick={onLoadTemplate}
        >
          Load…
        </button>
      </div>

      {/* Cluster 20 v1.0.4 — Selection actions. Always visible
          (Copy / Paste / Delete) so the user has a discoverable
          alternative to the keyboard shortcuts. Disabled when the
          underlying action wouldn't apply. */}
      <div style={styles.row}>
        <button
          type="button"
          title={
            hasSelection
              ? `Copy ${selectionSize} shape${selectionSize === 1 ? "" : "s"} (Ctrl+C)`
              : "Select shapes first (Ctrl+C)"
          }
          style={{
            ...styles.actionBtn,
            opacity: hasSelection ? 1 : 0.5,
            cursor: hasSelection ? "pointer" : "not-allowed",
          }}
          disabled={!hasSelection}
          onClick={onCopySelected}
        >
          Copy
        </button>
        <button
          type="button"
          title={
            clipboardSize > 0
              ? `Paste ${clipboardSize} shape${clipboardSize === 1 ? "" : "s"} (Ctrl+V)`
              : "Clipboard empty (Ctrl+C to copy first)"
          }
          style={{
            ...styles.actionBtn,
            opacity: clipboardSize > 0 ? 1 : 0.5,
            cursor: clipboardSize > 0 ? "pointer" : "not-allowed",
          }}
          disabled={clipboardSize === 0}
          onClick={onPaste}
        >
          Paste{clipboardSize > 0 ? ` (${clipboardSize})` : ""}
        </button>
        <button
          type="button"
          title={
            hasSelection
              ? `Delete ${selectionSize} shape${selectionSize === 1 ? "" : "s"} (D / Delete)`
              : "Select shapes first (D / Delete)"
          }
          style={{
            ...styles.actionBtn,
            color: "var(--danger)",
            opacity: hasSelection ? 1 : 0.5,
            cursor: hasSelection ? "pointer" : "not-allowed",
          }}
          disabled={!hasSelection}
          onClick={onDeleteSelected}
        >
          Delete
        </button>
      </div>

      {/* Cluster 20 v1.0.4 — Align / Distribute. Only visible
          when 2+ shapes are selected so the chrome stays small in
          the common single-select case. Distribute requires 3+ to
          have a visible effect; the buttons no-op for exactly 2. */}
      {hasMultiSelection && (
        <>
          <div style={styles.label}>Align ({selectionSize} selected)</div>
          <div style={styles.row}>
            <button
              type="button"
              title="Align top edges"
              style={styles.alignBtn}
              onClick={() => onAlign("top")}
            >
              ⤒
            </button>
            <button
              type="button"
              title="Align vertical centers"
              style={styles.alignBtn}
              onClick={() => onAlign("middle")}
            >
              ⇔
            </button>
            <button
              type="button"
              title="Align bottom edges"
              style={styles.alignBtn}
              onClick={() => onAlign("bottom")}
            >
              ⤓
            </button>
            <button
              type="button"
              title="Align left edges"
              style={styles.alignBtn}
              onClick={() => onAlign("left")}
            >
              ⇤
            </button>
            <button
              type="button"
              title="Align horizontal centers"
              style={styles.alignBtn}
              onClick={() => onAlign("center")}
            >
              ⇕
            </button>
            <button
              type="button"
              title="Align right edges"
              style={styles.alignBtn}
              onClick={() => onAlign("right")}
            >
              ⇥
            </button>
          </div>

          <div style={styles.label}>Distribute</div>
          <div style={styles.row}>
            <button
              type="button"
              title="Distribute horizontally (equal gaps; needs 3+ shapes)"
              style={{
                ...styles.actionBtn,
                opacity: selectionSize >= 3 ? 1 : 0.5,
                cursor: selectionSize >= 3 ? "pointer" : "not-allowed",
              }}
              disabled={selectionSize < 3}
              onClick={() => onDistribute("h")}
            >
              Distribute H
            </button>
            <button
              type="button"
              title="Distribute vertically (equal gaps; needs 3+ shapes)"
              style={{
                ...styles.actionBtn,
                opacity: selectionSize >= 3 ? 1 : 0.5,
                cursor: selectionSize >= 3 ? "pointer" : "not-allowed",
              }}
              disabled={selectionSize < 3}
              onClick={() => onDistribute("v")}
            >
              Distribute V
            </button>
          </div>
        </>
      )}

      <div style={styles.row}>
        <button
          type="button"
          title="Exit shape editor (Esc)"
          style={{ ...styles.actionBtn, fontWeight: 600 }}
          onClick={onExit}
        >
          Done
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  bar: {
    // Cluster 20 v1.0.5 — position is now set inline (computed from
    // either the live drag, the persisted host position, or the
    // default top-right pinning). Position is `fixed` so the
    // toolbar stays in the viewport regardless of document scroll.
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    minWidth: "210px",
    zIndex: 80,
    fontSize: "0.85rem",
  },
  label: {
    fontSize: "0.66rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-2)",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
  },
  toolBtn: {
    width: "30px",
    height: "30px",
    fontSize: "1rem",
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: "pointer",
    color: "var(--text)",
  },
  toolBtnActive: {
    background: "var(--accent)",
    color: "white",
    borderColor: "var(--accent)",
  },
  swatch: {
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    cursor: "pointer",
    padding: 0,
  },
  actionBtn: {
    background: "var(--bg-elev)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "4px 10px",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  // Cluster 20 v1.0.4 — square align icon-buttons. The labels are
  // arrow glyphs that hint at direction; full descriptions live in
  // the title tooltip.
  alignBtn: {
    width: "30px",
    height: "30px",
    background: "var(--bg-elev)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    fontSize: "1rem",
    cursor: "pointer",
    padding: 0,
  },
};
