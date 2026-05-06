// Cluster 20 v1.0 — Shape Editor overlay.
//
// SVG layer that sits on top of the document content. When `active`
// is true it captures pointer events and the user can draw, transform,
// or fill shapes. When false it only renders existing shapes for
// reading; pointer-events: none lets clicks fall through to the
// ProseMirror editor underneath, so shapes are visible-but-not-
// interactive while editing text.
//
// Coordinates are in DOCUMENT coordinates: shapes scroll with the
// document content because the SVG is `position: absolute; top: 0;
// left: 0` inside the same scroll container that holds the editor.
// Width follows the container; height follows the document content
// height (so even shapes drawn near the bottom stay visible).
//
// Tools (one active at a time):
//   - rect / ellipse / line / freehand : DRAW — pointerdown starts
//     a draft, pointermove extends it, pointerup commits to the doc.
//   - transform : SELECT — click a shape to select; drag handles to
//     resize; drag the rotation knob to rotate; click empty to
//     deselect.
//   - highlight : FILL — click a shape to set its fill to the active
//     color (toggle off if already that color).
//
// Key bindings (handled when the host's editor isn't focused — the
// host enforces this via shapeEditorActive in TabPane):
//   R E L F → tool = rect / ellipse / line / freehand
//   T H     → tool = transform / highlight
//   D       → delete the selected shape (transform mode)
//   1–9     → set active color
//   Esc     → onExit()
//   Ctrl+T  → onSaveTemplate()
//   Ctrl+Shift+L → onLoadTemplate()

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  HIGHLIGHT_FILL_ALPHA,
  SHAPE_COLORS,
  isDrawTool,
  newShapeId,
  type Shape,
  type ShapeTool,
  type ShapesDoc,
} from "../shapes/types";
import { ShapeEditorToolbar } from "./ShapeEditorToolbar";

export interface ShapeEditorProps {
  active: boolean;
  doc: ShapesDoc;
  onDocChange: (next: ShapesDoc) => void;
  /** Width of the SVG canvas in document coordinates. Should match
   *  the host scroll container's clientWidth so shapes drawn at the
   *  right edge don't get clipped. */
  width: number;
  /** Height of the SVG canvas. Should match the document content's
   *  scrollHeight so shapes below the fold still render. */
  height: number;
  /** Called when the user presses Esc inside shape editor. The host
   *  flips its `shapeEditorActive` flag and triggers a save. */
  onExit: () => void;
  /** Called when the user presses Ctrl+T. Host opens the template
   *  save modal seeded with the current doc. */
  onSaveTemplate: () => void;
  /** Called when the user presses Ctrl+Shift+L. Host opens the
   *  template load picker. */
  onLoadTemplate: () => void;
  /** Cluster 20 v1.0.6 — called by ShapeEditor BEFORE every atomic
   *  operation that mutates shapes (draw commit, transform drag
   *  start, highlight click, paste, align, distribute, delete). The
   *  host snapshots the current shapesDoc onto its undo stack and
   *  clears its redo stack. Capped at 100 entries by the host. */
  onPushUndo: () => void;
  /** Cluster 20 v1.0.6 — Ctrl+Z handler. Host pops the latest
   *  undo snapshot, pushes the current state to redo, applies the
   *  popped snapshot. No-op when canUndo is false. */
  onUndo: () => void;
  /** Cluster 20 v1.0.6 — Ctrl+Y / Ctrl+Shift+Z handler. */
  onRedo: () => void;
  /** Cluster 20 v1.0.6 — surfaces stack non-empty so we can ignore
   *  Ctrl+Z when there's nothing to undo (avoids an unnecessary
   *  setDrag cancel for no reason). */
  canUndo: boolean;
  canRedo: boolean;
}

// ---------------------------------------------------------------------------
// drag state (captures the in-flight pointer drag's intent + origin)
// ---------------------------------------------------------------------------

type DragKind =
  | { kind: "none" }
  | {
      kind: "draw";
      tool: ShapeTool;
      origin: { x: number; y: number };
      shapeId: string;
    }
  | {
      kind: "move";
      shapeId: string;
      origin: { x: number; y: number };
      shapeStart: Shape;
    }
  | {
      kind: "resize";
      shapeId: string;
      handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
      origin: { x: number; y: number };
      shapeStart: Shape;
      shiftLock: boolean;
    }
  | {
      kind: "rotate";
      shapeId: string;
      origin: { x: number; y: number };
      shapeStart: Shape;
    }
  // Cluster 20 v1.0.4 — group-transform drag kinds. Snapshot each
  // selected shape at drag start; apply transformations to those
  // snapshots (NOT the live doc shapes) so dx/dy/scale/angle deltas
  // accumulate correctly across many pointer-move events.
  | {
      kind: "group-move";
      origin: { x: number; y: number };
      snapshots: Shape[];
    }
  | {
      kind: "group-resize";
      handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
      origin: { x: number; y: number };
      snapshots: Shape[];
      /** Group bbox at drag start. */
      bboxStart: { x: number; y: number; w: number; h: number };
    }
  | {
      kind: "group-rotate";
      origin: { x: number; y: number };
      snapshots: Shape[];
      /** Group center at drag start (pivot for the rotation). */
      pivot: { x: number; y: number };
      /** Cluster 20 v1.0.5 — bounding box of the snapshot shapes
       *  at drag start. The selection overlay renders this rect
       *  rotated by `currentDelta` around the pivot, so the bbox /
       *  handles / rotation knob form a rigid frame that follows
       *  the rotation rather than wobbling with the live AABB. */
      bboxStart: { x: number; y: number; w: number; h: number };
      /** Live rotation angle in degrees, updated on pointermove. */
      currentDelta: number;
    }
  // Cluster 20 v1.0.5 — lasso drag (transform-mode rectangular
  // multi-select). Empty-canvas pointerdown starts it; pointermove
  // grows the rect; pointerup commits the selection.
  | {
      kind: "lasso";
      origin: { x: number; y: number };
      current: { x: number; y: number };
      /** True when Ctrl/Cmd was held at drag start — the lasso
       *  result is added to the existing selection rather than
       *  replacing it. */
      additive: boolean;
    };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Convert a pointer event's clientX/Y into the SVG's own coordinate
 *  space (document coordinates). The SVG's screen CTM accounts for
 *  scroll position, so we don't have to track scroll separately. */
function toSvgPoint(
  svg: SVGSVGElement | null,
  evt: { clientX: number; clientY: number },
): { x: number; y: number } {
  if (!svg) return { x: 0, y: 0 };
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const mapped = pt.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
}

/** Clamp a numeric value into a closed interval. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Resize a shape's bounding box anchored on the handle's opposite
 *  corner / edge. Pure function — returns a new Shape. */
function applyResize(
  start: Shape,
  handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
  dx: number,
  dy: number,
  shiftLock: boolean,
): Shape {
  const MIN = 4;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  switch (handle) {
    case "nw": {
      x = start.x + dx;
      y = start.y + dy;
      w = start.w - dx;
      h = start.h - dy;
      break;
    }
    case "n": {
      y = start.y + dy;
      h = start.h - dy;
      break;
    }
    case "ne": {
      y = start.y + dy;
      w = start.w + dx;
      h = start.h - dy;
      break;
    }
    case "e": {
      w = start.w + dx;
      break;
    }
    case "se": {
      w = start.w + dx;
      h = start.h + dy;
      break;
    }
    case "s": {
      h = start.h + dy;
      break;
    }
    case "sw": {
      x = start.x + dx;
      w = start.w - dx;
      h = start.h + dy;
      break;
    }
    case "w": {
      x = start.x + dx;
      w = start.w - dx;
      break;
    }
  }
  // Floor at MIN px on each axis so we can't invert dimensions.
  if (w < MIN) {
    if (handle === "nw" || handle === "sw" || handle === "w") {
      x -= MIN - w;
    }
    w = MIN;
  }
  if (h < MIN) {
    if (handle === "nw" || handle === "ne" || handle === "n") {
      y -= MIN - h;
    }
    h = MIN;
  }
  // Aspect-ratio lock for corner handles when Shift is held. Use the
  // larger relative scale so the shape grows uniformly.
  if (
    shiftLock &&
    (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se")
  ) {
    const sx = w / start.w;
    const sy = h / start.h;
    const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    const newW = Math.max(MIN, start.w * s);
    const newH = Math.max(MIN, start.h * s);
    // Re-anchor on the opposite corner.
    if (handle === "nw") {
      x = start.x + start.w - newW;
      y = start.y + start.h - newH;
    } else if (handle === "ne") {
      x = start.x;
      y = start.y + start.h - newH;
    } else if (handle === "sw") {
      x = start.x + start.w - newW;
      y = start.y;
    } else if (handle === "se") {
      x = start.x;
      y = start.y;
    }
    w = newW;
    h = newH;
  }
  return { ...start, x, y, w, h };
}

/** Compute the screen-pixel center of a shape's bounding box,
 *  accounting for SVG scroll/scale (we use document coords directly
 *  since the SVG is in document space). */
function shapeCenter(s: Shape): { cx: number; cy: number } {
  return { cx: s.x + s.w / 2, cy: s.y + s.h / 2 };
}

/** Cluster 20 v1.0.2 — hit-test a point against a shape's
 *  axis-aligned bounding box, accounting for the shape's rotation.
 *  We transform the point INTO the shape's local frame (un-rotate
 *  around its center) and then check the unrotated AABB. Used by
 *  the highlight click resolver to pick the smallest containing
 *  shape when several overlap. */
function shapeContainsPoint(s: Shape, pt: { x: number; y: number }): boolean {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  let lx = pt.x;
  let ly = pt.y;
  if (s.rotation && Math.abs(s.rotation) > 0.01) {
    // Inverse rotation: subtract the shape's rotation so the point
    // lands in the shape's local axis-aligned coordinate frame.
    const rad = (-s.rotation * Math.PI) / 180;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    lx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    ly = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  return lx >= s.x && lx <= s.x + s.w && ly >= s.y && ly <= s.y + s.h;
}

/** Cluster 20 v1.0.2 — when several shapes contain the same point,
 *  return the one with the smallest bounding-box area. Lets the
 *  user highlight a small shape that lives inside a bigger one
 *  (the bigger one is on top in render order, but the smaller one
 *  is what the user is aiming at). Returns null when no shape
 *  contains the point. */
function findSmallestShapeContainingPoint(
  shapes: Shape[],
  pt: { x: number; y: number },
): Shape | null {
  let best: Shape | null = null;
  let bestArea = Infinity;
  for (const s of shapes) {
    if (!shapeContainsPoint(s, pt)) continue;
    const area = Math.max(0, s.w) * Math.max(0, s.h);
    if (area < bestArea) {
      bestArea = area;
      best = s;
    }
  }
  return best;
}

/** Cluster 20 v1.0.4 — axis-aligned union bounding box of a set of
 *  shapes, in DOCUMENT coordinates. Uses each shape's logical
 *  (un-rotated) bbox as the input — rotated shapes have a larger
 *  rendered footprint, but the logical bbox is what the per-shape
 *  resize handles already manipulate, so the group bbox is
 *  consistent with single-shape behaviour. Returns a zero-width
 *  bbox at (0,0) when given no shapes (defensive). */
function computeGroupBbox(shapes: Shape[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (shapes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Cluster 20 v1.0.4 — apply a 2D rotation in degrees around a
 *  pivot point, returning the rotated point. Used by group-rotate
 *  to move each shape's center around the group's centroid. */
function rotateAround(
  pt: { x: number; y: number },
  pivot: { x: number; y: number },
  deg: number,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  const dx = pt.x - pivot.x;
  const dy = pt.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Cluster 20 v1.0.4 — given a resize handle and pointer delta,
 *  compute the new group bbox, anchored on the OPPOSITE handle.
 *  Same shape as the single-shape applyResize math but applied to
 *  the group bbox; per-shape coordinates derive from the resulting
 *  scale + translation. Floors at 4 px on each axis so the group
 *  can't invert. */
function applyGroupResize(
  bboxStart: { x: number; y: number; w: number; h: number },
  handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
  dx: number,
  dy: number,
): {
  bboxNext: { x: number; y: number; w: number; h: number };
  anchor: { x: number; y: number };
} {
  const MIN = 4;
  let x = bboxStart.x;
  let y = bboxStart.y;
  let w = bboxStart.w;
  let h = bboxStart.h;
  let anchorX = bboxStart.x;
  let anchorY = bboxStart.y;
  switch (handle) {
    case "nw":
      x = bboxStart.x + dx;
      y = bboxStart.y + dy;
      w = bboxStart.w - dx;
      h = bboxStart.h - dy;
      anchorX = bboxStart.x + bboxStart.w;
      anchorY = bboxStart.y + bboxStart.h;
      break;
    case "n":
      y = bboxStart.y + dy;
      h = bboxStart.h - dy;
      anchorY = bboxStart.y + bboxStart.h;
      anchorX = bboxStart.x;
      break;
    case "ne":
      y = bboxStart.y + dy;
      w = bboxStart.w + dx;
      h = bboxStart.h - dy;
      anchorX = bboxStart.x;
      anchorY = bboxStart.y + bboxStart.h;
      break;
    case "e":
      w = bboxStart.w + dx;
      anchorX = bboxStart.x;
      anchorY = bboxStart.y;
      break;
    case "se":
      w = bboxStart.w + dx;
      h = bboxStart.h + dy;
      anchorX = bboxStart.x;
      anchorY = bboxStart.y;
      break;
    case "s":
      h = bboxStart.h + dy;
      anchorX = bboxStart.x;
      anchorY = bboxStart.y;
      break;
    case "sw":
      x = bboxStart.x + dx;
      w = bboxStart.w - dx;
      h = bboxStart.h + dy;
      anchorX = bboxStart.x + bboxStart.w;
      anchorY = bboxStart.y;
      break;
    case "w":
      x = bboxStart.x + dx;
      w = bboxStart.w - dx;
      anchorX = bboxStart.x + bboxStart.w;
      anchorY = bboxStart.y;
      break;
  }
  if (w < MIN) {
    if (handle === "nw" || handle === "sw" || handle === "w") {
      x -= MIN - w;
    }
    w = MIN;
  }
  if (h < MIN) {
    if (handle === "nw" || handle === "ne" || handle === "n") {
      y -= MIN - h;
    }
    h = MIN;
  }
  return {
    bboxNext: { x, y, w, h },
    anchor: { x: anchorX, y: anchorY },
  };
}

// ---------------------------------------------------------------------------
// shape rendering
// ---------------------------------------------------------------------------

interface ShapeViewProps {
  shape: Shape;
  selected: boolean;
  active: boolean;
  /** When in highlight mode, hovering shows a "fill bucket" cursor
   *  so the user knows the click will recolor. */
  highlightHover: boolean;
  /** Cluster 20 v1.0.3 — true only when the active tool is one that
   *  acts on EXISTING shapes (transform / highlight). False for
   *  draw modes, where clicks must pass through this shape's
   *  bounding box to the SVG canvas underneath so the user can
   *  start a new draft on top of an existing shape (Microsoft Paint
   *  semantics: drawing over things is normal). False also when
   *  shape editor is inactive (the parent layer's pointer-events:
   *  none blocks events anyway, but we mirror that here for
   *  belt-and-suspenders). */
  interactive: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

function ShapeView({
  shape,
  selected,
  active,
  highlightHover,
  interactive,
  onPointerDown,
}: ShapeViewProps) {
  const transform =
    shape.rotation && Math.abs(shape.rotation) > 0.01
      ? `rotate(${shape.rotation} ${shape.x + shape.w / 2} ${shape.y + shape.h / 2})`
      : undefined;
  const cursor =
    active && interactive
      ? highlightHover
        ? "alias" // paint-bucket-ish; CSS doesn't have a true bucket
        : "pointer"
      : "inherit";
  // Cluster 20 v1.0.3 — pointer-events 'all' ONLY for tools that
  // act on existing shapes (transform / highlight). For draw modes,
  // shapes pass clicks through to the SVG canvas so the user can
  // draw a new shape that lands on top of (or starts inside the
  // bounds of) an existing one. Without this, a click anywhere
  // inside an existing shape's bounding box would intercept the
  // pointerdown and the user couldn't draw "into" anything. When
  // interactive is false the bounding box ignores events entirely.
  const pointerEvents: CSSProperties["pointerEvents"] = interactive
    ? "all"
    : "none";
  const commonStrokeProps = {
    stroke: shape.stroke || "#222",
    strokeWidth: shape.strokeWidth || 2,
    fill: shape.fill ?? "none",
    onPointerDown,
    style: { cursor, pointerEvents } as CSSProperties,
    "data-shape-id": shape.id,
    "data-selected": selected ? "1" : undefined,
  };
  const svgFilter = selected ? "drop-shadow(0 0 2px var(--accent))" : undefined;
  switch (shape.kind) {
    case "rect": {
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={Math.max(0, shape.w)}
          height={Math.max(0, shape.h)}
          transform={transform}
          style={{ ...commonStrokeProps.style, filter: svgFilter }}
          stroke={commonStrokeProps.stroke}
          strokeWidth={commonStrokeProps.strokeWidth}
          fill={commonStrokeProps.fill}
          onPointerDown={commonStrokeProps.onPointerDown}
          data-shape-id={shape.id}
        />
      );
    }
    case "ellipse": {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={Math.max(0, shape.w / 2)}
          ry={Math.max(0, shape.h / 2)}
          transform={transform}
          style={{ ...commonStrokeProps.style, filter: svgFilter }}
          stroke={commonStrokeProps.stroke}
          strokeWidth={commonStrokeProps.strokeWidth}
          fill={commonStrokeProps.fill}
          onPointerDown={commonStrokeProps.onPointerDown}
          data-shape-id={shape.id}
        />
      );
    }
    case "line": {
      const x1 = shape.x + (shape.x1 ?? 0);
      const y1 = shape.y + (shape.y1 ?? 0);
      const x2 = shape.x + (shape.x2 ?? shape.w);
      const y2 = shape.y + (shape.y2 ?? shape.h);
      return (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          transform={transform}
          style={{ ...commonStrokeProps.style, filter: svgFilter }}
          stroke={commonStrokeProps.stroke}
          strokeWidth={commonStrokeProps.strokeWidth}
          strokeLinecap="round"
          onPointerDown={commonStrokeProps.onPointerDown}
          data-shape-id={shape.id}
        />
      );
    }
    case "freehand": {
      const pts = (shape.points ?? [])
        .map(([px, py]) => `${shape.x + px},${shape.y + py}`)
        .join(" ");
      return (
        <polyline
          points={pts}
          transform={transform}
          style={{ ...commonStrokeProps.style, filter: svgFilter }}
          stroke={commonStrokeProps.stroke}
          strokeWidth={commonStrokeProps.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          onPointerDown={commonStrokeProps.onPointerDown}
          data-shape-id={shape.id}
        />
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// SelectionOverlay — bounding box + 8 handles + rotation knob
// ---------------------------------------------------------------------------

const HANDLE_SIZE = 8;
const HANDLE_HALF = HANDLE_SIZE / 2;
const ROTATE_KNOB_OFFSET = 24;

interface SelectionOverlayProps {
  shape: Shape;
  onHandlePointerDown: (
    handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
    e: React.PointerEvent,
  ) => void;
  onRotatePointerDown: (e: React.PointerEvent) => void;
  onMovePointerDown: (e: React.PointerEvent) => void;
}

function SelectionOverlay({
  shape,
  onHandlePointerDown,
  onRotatePointerDown,
  onMovePointerDown,
}: SelectionOverlayProps) {
  const transform =
    shape.rotation && Math.abs(shape.rotation) > 0.01
      ? `rotate(${shape.rotation} ${shape.x + shape.w / 2} ${shape.y + shape.h / 2})`
      : undefined;
  const handles: Array<{
    h: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    x: number;
    y: number;
    cursor: string;
  }> = [
    { h: "nw", x: shape.x, y: shape.y, cursor: "nwse-resize" },
    { h: "n", x: shape.x + shape.w / 2, y: shape.y, cursor: "ns-resize" },
    { h: "ne", x: shape.x + shape.w, y: shape.y, cursor: "nesw-resize" },
    {
      h: "e",
      x: shape.x + shape.w,
      y: shape.y + shape.h / 2,
      cursor: "ew-resize",
    },
    {
      h: "se",
      x: shape.x + shape.w,
      y: shape.y + shape.h,
      cursor: "nwse-resize",
    },
    {
      h: "s",
      x: shape.x + shape.w / 2,
      y: shape.y + shape.h,
      cursor: "ns-resize",
    },
    { h: "sw", x: shape.x, y: shape.y + shape.h, cursor: "nesw-resize" },
    { h: "w", x: shape.x, y: shape.y + shape.h / 2, cursor: "ew-resize" },
  ];
  return (
    <g transform={transform} className="cortex-shape-selection">
      <rect
        x={shape.x}
        y={shape.y}
        width={Math.max(0, shape.w)}
        height={Math.max(0, shape.h)}
        fill="transparent"
        stroke="var(--accent)"
        strokeDasharray="4 3"
        strokeWidth={1}
        style={{ cursor: "move" }}
        onPointerDown={onMovePointerDown}
      />
      {handles.map((hd) => (
        <rect
          key={hd.h}
          x={hd.x - HANDLE_HALF}
          y={hd.y - HANDLE_HALF}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill="var(--accent)"
          stroke="var(--bg)"
          strokeWidth={1}
          style={{ cursor: hd.cursor }}
          onPointerDown={(e) => onHandlePointerDown(hd.h, e)}
        />
      ))}
      {/* Rotation knob: a circle 24 px above the top center of the
          (un-rotated) bounding box. The parent <g rotate=...>
          rotates it around the shape center, so dragging it
          naturally maps to angular delta around that center. */}
      <line
        x1={shape.x + shape.w / 2}
        y1={shape.y}
        x2={shape.x + shape.w / 2}
        y2={shape.y - ROTATE_KNOB_OFFSET}
        stroke="var(--accent)"
        strokeWidth={1}
      />
      <circle
        cx={shape.x + shape.w / 2}
        cy={shape.y - ROTATE_KNOB_OFFSET}
        r={5}
        fill="var(--bg)"
        stroke="var(--accent)"
        strokeWidth={1.5}
        style={{ cursor: "grab" }}
        onPointerDown={onRotatePointerDown}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// GroupSelectionOverlay — axis-aligned union bbox + 8 handles + rotate knob
// for multi-shape selections (Cluster 20 v1.0.4).
// ---------------------------------------------------------------------------

interface GroupSelectionOverlayProps {
  shapes: Shape[];
  /** Cluster 20 v1.0.5 — when a group rotation is in progress, the
   *  outer frame (bbox + handles + knob) renders the snapshot bbox
   *  inside a rotate(delta pivot.x pivot.y) transform so it forms
   *  a rigid frame rotating around the pivot. The inner per-shape
   *  thin rings still track the live shape positions (so the user
   *  sees each shape's actual transformed position). When this
   *  prop is null the frame uses the live AABB and no transform. */
  rotationFrame?: {
    bboxStart: { x: number; y: number; w: number; h: number };
    pivot: { x: number; y: number };
    delta: number;
  } | null;
  onMovePointerDown: (e: React.PointerEvent) => void;
  onHandlePointerDown: (
    handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
    e: React.PointerEvent,
  ) => void;
  onRotatePointerDown: (e: React.PointerEvent) => void;
}

function GroupSelectionOverlay({
  shapes,
  rotationFrame,
  onMovePointerDown,
  onHandlePointerDown,
  onRotatePointerDown,
}: GroupSelectionOverlayProps) {
  if (shapes.length === 0) return null;
  // The OUTER frame uses the snapshot bbox + a rotation transform
  // when a rotation is in progress; otherwise it tracks the live
  // AABB. The inner per-shape rings always use live shape data.
  const liveBbox = computeGroupBbox(shapes);
  const bbox = rotationFrame ? rotationFrame.bboxStart : liveBbox;
  const frameTransform = rotationFrame
    ? `rotate(${rotationFrame.delta} ${rotationFrame.pivot.x} ${rotationFrame.pivot.y})`
    : undefined;
  const handles: Array<{
    h: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    x: number;
    y: number;
    cursor: string;
  }> = [
    { h: "nw", x: bbox.x, y: bbox.y, cursor: "nwse-resize" },
    { h: "n", x: bbox.x + bbox.w / 2, y: bbox.y, cursor: "ns-resize" },
    { h: "ne", x: bbox.x + bbox.w, y: bbox.y, cursor: "nesw-resize" },
    {
      h: "e",
      x: bbox.x + bbox.w,
      y: bbox.y + bbox.h / 2,
      cursor: "ew-resize",
    },
    {
      h: "se",
      x: bbox.x + bbox.w,
      y: bbox.y + bbox.h,
      cursor: "nwse-resize",
    },
    {
      h: "s",
      x: bbox.x + bbox.w / 2,
      y: bbox.y + bbox.h,
      cursor: "ns-resize",
    },
    { h: "sw", x: bbox.x, y: bbox.y + bbox.h, cursor: "nesw-resize" },
    { h: "w", x: bbox.x, y: bbox.y + bbox.h / 2, cursor: "ew-resize" },
  ];
  return (
    <g className="cortex-shape-group-selection">
      {/* Per-shape thin rings track LIVE shape positions so the user
          sees each member's actual transformed location even mid-
          rotation. Not affected by the rotation frame transform. */}
      {shapes.map((s) => (
        <rect
          key={s.id}
          x={s.x}
          y={s.y}
          width={Math.max(0, s.w)}
          height={Math.max(0, s.h)}
          fill="transparent"
          stroke="var(--accent)"
          strokeOpacity={0.55}
          strokeDasharray="2 2"
          strokeWidth={1}
          pointerEvents="none"
          transform={
            s.rotation && Math.abs(s.rotation) > 0.01
              ? `rotate(${s.rotation} ${s.x + s.w / 2} ${s.y + s.h / 2})`
              : undefined
          }
        />
      ))}
      {/* Outer frame (bbox + handles + rotation knob). Renders the
          snapshot bbox inside a rotation transform during a
          group-rotate drag, so it forms a rigid frame around the
          pivot — knob stays in a stable position. */}
      <g transform={frameTransform}>
        {/* Union bbox — clickable to drag-move the whole group. */}
        <rect
          x={bbox.x}
          y={bbox.y}
          width={Math.max(0, bbox.w)}
          height={Math.max(0, bbox.h)}
          fill="transparent"
          stroke="var(--accent)"
          strokeDasharray="6 4"
          strokeWidth={1.5}
          style={{ cursor: "move" }}
          onPointerDown={onMovePointerDown}
        />
        {handles.map((hd) => (
          <rect
            key={hd.h}
            x={hd.x - HANDLE_HALF}
            y={hd.y - HANDLE_HALF}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill="var(--accent)"
            stroke="var(--bg)"
            strokeWidth={1}
            style={{ cursor: hd.cursor }}
            onPointerDown={(e) => onHandlePointerDown(hd.h, e)}
          />
        ))}
        <line
          x1={bbox.x + bbox.w / 2}
          y1={bbox.y}
          x2={bbox.x + bbox.w / 2}
          y2={bbox.y - ROTATE_KNOB_OFFSET}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <circle
          cx={bbox.x + bbox.w / 2}
          cy={bbox.y - ROTATE_KNOB_OFFSET}
          r={5}
          fill="var(--bg)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          style={{ cursor: "grab" }}
          onPointerDown={onRotatePointerDown}
        />
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// ShapeEditor
// ---------------------------------------------------------------------------

export function ShapeEditor({
  active,
  doc,
  onDocChange,
  width,
  height,
  onExit,
  onSaveTemplate,
  onLoadTemplate,
  onPushUndo,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ShapeEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<ShapeTool>({ kind: "rect" });
  const [activeColor, setActiveColor] = useState<string>(SHAPE_COLORS[2].hex);
  /** Cluster 20 v1.0.4 — selection is a Set so the user can build up
   *  a multi-selection in transform mode via Ctrl+Click. Size===1 is
   *  the legacy single-select case (uses the per-shape rotated
   *  selection overlay); size>1 switches to the GroupSelectionOverlay
   *  with an axis-aligned union bbox. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Cluster 20 v1.0.4 — in-memory clipboard for Ctrl+C / Ctrl+V.
   *  Session-only (not persisted; the user can paste across notes
   *  while shape editor is active anywhere, which matches the
   *  text-clipboard mental model). */
  const [clipboard, setClipboard] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [drag, setDrag] = useState<DragKind>({ kind: "none" });
  /** Cluster 20 v1.0.5 — toolbar position in viewport coordinates.
   *  null means "default top-right" (the legacy position). On first
   *  drag the user pins it; the position persists across sessions
   *  via localStorage. */
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(
    () => {
      try {
        const stored = localStorage.getItem("cortex:shape-toolbar-position");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (
            parsed &&
            typeof parsed.x === "number" &&
            typeof parsed.y === "number"
          ) {
            return parsed;
          }
        }
      } catch {
        /* ignore — corrupt or unavailable storage */
      }
      return null;
    },
  );
  const handleToolbarPosChange = useCallback(
    (next: { x: number; y: number } | null) => {
      setToolbarPos(next);
      try {
        if (next) {
          localStorage.setItem(
            "cortex:shape-toolbar-position",
            JSON.stringify(next),
          );
        } else {
          localStorage.removeItem("cortex:shape-toolbar-position");
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // ---- update helpers ----

  const replaceShape = useCallback(
    (id: string, mut: (s: Shape) => Shape) => {
      onDocChange({
        ...doc,
        shapes: doc.shapes.map((s) => (s.id === id ? mut(s) : s)),
      });
    },
    [doc, onDocChange],
  );
  /** Cluster 20 v1.0.4 — bulk delete by id list, in a single
   *  onDocChange call so the consumer sees one update rather than N.
   *  (The single-shape removeShape helper that lived here pre-1.0.4
   *  was dropped — every callsite went through selectedIds: Set, so
   *  removeShapes is now the only path.) */
  const removeShapes = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      onDocChange({
        ...doc,
        shapes: doc.shapes.filter((s) => !idSet.has(s.id)),
      });
    },
    [doc, onDocChange],
  );
  /** Cluster 20 v1.0.4 — apply a per-shape transformation to every
   *  shape whose id is in `ids`, in a single onDocChange. Used by
   *  group-move / group-resize / group-rotate drag handlers and by
   *  the align/distribute toolbar actions. The transform receives
   *  the shape's CURRENT attrs (post-doc) — group drags pass
   *  snapshots through closure. */
  const replaceShapes = useCallback(
    (ids: string[], mut: (s: Shape) => Shape) => {
      const idSet = new Set(ids);
      onDocChange({
        ...doc,
        shapes: doc.shapes.map((s) => (idSet.has(s.id) ? mut(s) : s)),
      });
    },
    [doc, onDocChange],
  );
  /** Cluster 20 v1.0.4 — replace specific shapes in bulk. The map
   *  keys are ids, values are full replacement Shapes. Used by the
   *  group-resize / group-rotate handlers to write all transformed
   *  shapes in one transaction. */
  const writeShapes = useCallback(
    (replacements: Map<string, Shape>) => {
      onDocChange({
        ...doc,
        shapes: doc.shapes.map((s) => replacements.get(s.id) ?? s),
      });
    },
    [doc, onDocChange],
  );
  const appendShape = useCallback(
    (s: Shape) => {
      onDocChange({ ...doc, shapes: [...doc.shapes, s] });
    },
    [doc, onDocChange],
  );

  // ---- pointer handlers (overlay-relative) ----

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!active) return;
      // Skip when the click landed on a shape (its own handler runs
      // first and may select / fill / start a transform drag).
      const targetId =
        (e.target as SVGElement)?.getAttribute?.("data-shape-id") ?? null;
      if (targetId) return;
      // Empty-canvas pointerdown semantics:
      //   - Draw tool   → start a draft shape
      //   - Transform   → deselect
      //   - Highlight   → no-op
      if (isDrawTool(tool)) {
        const p = toSvgPoint(svgRef.current, e);
        const id = newShapeId();
        const base: Shape = {
          id,
          kind: tool.kind as Shape["kind"],
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          rotation: 0,
          stroke: activeColor,
          strokeWidth: 2,
          fill: null,
        };
        if (tool.kind === "line") {
          base.x1 = 0;
          base.y1 = 0;
          base.x2 = 0;
          base.y2 = 0;
        }
        if (tool.kind === "freehand") {
          base.points = [[0, 0]];
        }
        setDraft(base);
        setDrag({ kind: "draw", tool, origin: p, shapeId: id });
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (tool.kind === "transform") {
        // Cluster 20 v1.0.5 — empty-canvas drag starts a lasso /
        // drag-rectangle multi-select. A drag of <4 px (i.e. just a
        // click) at pointerup falls back to the legacy "clear
        // selection" behaviour. Ctrl-drag adds the lassoed shapes
        // to the existing selection; plain drag replaces.
        const p = toSvgPoint(svgRef.current, e);
        setDrag({
          kind: "lasso",
          origin: p,
          current: p,
          additive: e.ctrlKey || e.metaKey,
        });
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    [active, tool, activeColor],
  );

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!active || drag.kind === "none") return;
      const p = toSvgPoint(svgRef.current, e);
      if (drag.kind === "draw" && draft) {
        // Update the draft's geometry per shape kind.
        const ox = drag.origin.x;
        const oy = drag.origin.y;
        // Cluster 20 v1.0.2 — Alt + Shift modifiers (rect / ellipse /
        // line). Read live from the pointer event so they take
        // effect mid-drag without lifting the pointer.
        //   Shift   → rect/ellipse: square / circle (max(|dx|,|dy|))
        //             line: snap end-angle to nearest 45°
        //   Alt     → center the shape on the click origin instead
        //             of using origin as one corner / endpoint
        // Freehand opts out of both — its geometry is the cursor
        // path itself.
        if (draft.kind === "rect" || draft.kind === "ellipse") {
          let dx = p.x - ox;
          let dy = p.y - oy;
          if (e.shiftKey) {
            // Square / circle — pick the larger axis and mirror its
            // signed magnitude onto the other so the shape stays
            // anchored on the same corner / center as the user
            // would expect.
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            dx = (dx === 0 ? 1 : Math.sign(dx)) * m;
            dy = (dy === 0 ? 1 : Math.sign(dy)) * m;
          }
          let minX: number;
          let minY: number;
          let w: number;
          let h: number;
          if (e.altKey) {
            // Center on (ox, oy): expand to (ox±|dx|, oy±|dy|).
            w = Math.abs(dx) * 2;
            h = Math.abs(dy) * 2;
            minX = ox - Math.abs(dx);
            minY = oy - Math.abs(dy);
          } else {
            // Anchor at (ox, oy): grow toward (ox+dx, oy+dy).
            w = Math.abs(dx);
            h = Math.abs(dy);
            minX = Math.min(ox, ox + dx);
            minY = Math.min(oy, oy + dy);
          }
          setDraft({ ...draft, x: minX, y: minY, w, h });
        } else if (draft.kind === "line") {
          // Resolve the (potentially Shift-snapped) endpoint, then
          // (optionally Alt-centered) the line on the click origin.
          let endX = p.x;
          let endY = p.y;
          if (e.shiftKey) {
            // Snap angle from origin to current to nearest 45°.
            // Distance preserved so the line keeps the user's
            // current "reach" — just rotated to the nearest
            // multiple of 45°.
            const dx = p.x - ox;
            const dy = p.y - oy;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
              const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
              const snappedDeg = Math.round(angleDeg / 45) * 45;
              const snappedRad = (snappedDeg * Math.PI) / 180;
              endX = ox + Math.cos(snappedRad) * dist;
              endY = oy + Math.sin(snappedRad) * dist;
            }
          }
          let startX = ox;
          let startY = oy;
          if (e.altKey) {
            // Center on origin: start mirrors end across (ox, oy).
            const ddx = endX - ox;
            const ddy = endY - oy;
            startX = ox - ddx;
            startY = oy - ddy;
          }
          const minX = Math.min(startX, endX);
          const minY = Math.min(startY, endY);
          const maxX = Math.max(startX, endX);
          const maxY = Math.max(startY, endY);
          const w = Math.max(1, maxX - minX);
          const h = Math.max(1, maxY - minY);
          setDraft({
            ...draft,
            x: minX,
            y: minY,
            w,
            h,
            x1: startX - minX,
            y1: startY - minY,
            x2: endX - minX,
            y2: endY - minY,
          });
        } else if (draft.kind === "freehand") {
          // Decimate: only push a new point if it's at least 4 px
          // from the last one. Keeps the points array small for
          // long, fast strokes without losing fidelity.
          const lastAbs = (draft.points ?? [[0, 0]])[
            (draft.points?.length ?? 1) - 1
          ];
          const lastX = draft.x + lastAbs[0];
          const lastY = draft.y + lastAbs[1];
          if (Math.hypot(p.x - lastX, p.y - lastY) < 4) return;
          // Recompute bounding box and re-base each point.
          const points = (draft.points ?? []).map(([rx, ry]) => ({
            x: draft.x + rx,
            y: draft.y + ry,
          }));
          points.push({ x: p.x, y: p.y });
          const minX = Math.min(...points.map((q) => q.x));
          const minY = Math.min(...points.map((q) => q.y));
          const maxX = Math.max(...points.map((q) => q.x));
          const maxY = Math.max(...points.map((q) => q.y));
          setDraft({
            ...draft,
            x: minX,
            y: minY,
            w: Math.max(1, maxX - minX),
            h: Math.max(1, maxY - minY),
            points: points.map((q) => [q.x - minX, q.y - minY]),
          });
        }
      } else if (drag.kind === "move") {
        const dx = p.x - drag.origin.x;
        const dy = p.y - drag.origin.y;
        replaceShape(drag.shapeId, (s) => ({
          ...s,
          x: drag.shapeStart.x + dx,
          y: drag.shapeStart.y + dy,
        }));
      } else if (drag.kind === "resize") {
        const dx = p.x - drag.origin.x;
        const dy = p.y - drag.origin.y;
        replaceShape(drag.shapeId, () =>
          applyResize(drag.shapeStart, drag.handle, dx, dy, e.shiftKey),
        );
      } else if (drag.kind === "rotate") {
        const c = shapeCenter(drag.shapeStart);
        const a0 = Math.atan2(drag.origin.y - c.cy, drag.origin.x - c.cx);
        const a1 = Math.atan2(p.y - c.cy, p.x - c.cx);
        let deg = drag.shapeStart.rotation + ((a1 - a0) * 180) / Math.PI;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }
        replaceShape(drag.shapeId, (s) => ({ ...s, rotation: deg }));
      } else if (drag.kind === "group-move") {
        // Cluster 20 v1.0.4 — translate every snapshot by the same
        // delta from the click origin.
        const dx = p.x - drag.origin.x;
        const dy = p.y - drag.origin.y;
        const replacements = new Map<string, Shape>();
        for (const snap of drag.snapshots) {
          replacements.set(snap.id, {
            ...snap,
            x: snap.x + dx,
            y: snap.y + dy,
          });
        }
        writeShapes(replacements);
      } else if (drag.kind === "group-resize") {
        // Cluster 20 v1.0.4 — resize the group bbox; rescale every
        // snapshot's position + dimensions relative to the anchor
        // (opposite handle). Each shape's individual rotation
        // survives unchanged — non-uniform group scaling of a
        // rotated shape produces a slight visual approximation,
        // which is acceptable for v1.0; v1.1 may add a
        // preserve-aspect default for groups containing rotated
        // shapes.
        const dx = p.x - drag.origin.x;
        const dy = p.y - drag.origin.y;
        const { bboxNext, anchor } = applyGroupResize(
          drag.bboxStart,
          drag.handle,
          dx,
          dy,
        );
        const sx = drag.bboxStart.w > 0 ? bboxNext.w / drag.bboxStart.w : 1;
        const sy = drag.bboxStart.h > 0 ? bboxNext.h / drag.bboxStart.h : 1;
        const replacements = new Map<string, Shape>();
        for (const snap of drag.snapshots) {
          replacements.set(snap.id, {
            ...snap,
            x: anchor.x + sx * (snap.x - anchor.x),
            y: anchor.y + sy * (snap.y - anchor.y),
            w: Math.max(1, sx * snap.w),
            h: Math.max(1, sy * snap.h),
          });
        }
        writeShapes(replacements);
      } else if (drag.kind === "group-rotate") {
        // Cluster 20 v1.0.4 — rotate the whole group around the
        // pivot (group centroid at drag start). Each shape's
        // center transforms via rotateAround; each shape's own
        // rotation increments by the same delta. Shift snaps the
        // delta to 15° increments — the same convention as
        // single-shape rotate.
        const a0 = Math.atan2(
          drag.origin.y - drag.pivot.y,
          drag.origin.x - drag.pivot.x,
        );
        const a1 = Math.atan2(p.y - drag.pivot.y, p.x - drag.pivot.x);
        let delta = ((a1 - a0) * 180) / Math.PI;
        if (e.shiftKey) {
          delta = Math.round(delta / 15) * 15;
        }
        const replacements = new Map<string, Shape>();
        for (const snap of drag.snapshots) {
          const center = { x: snap.x + snap.w / 2, y: snap.y + snap.h / 2 };
          const rotated = rotateAround(center, drag.pivot, delta);
          replacements.set(snap.id, {
            ...snap,
            x: rotated.x - snap.w / 2,
            y: rotated.y - snap.h / 2,
            rotation: snap.rotation + delta,
          });
        }
        writeShapes(replacements);
        // Cluster 20 v1.0.5 — track the live delta so the selection
        // overlay can render the bbox / handles / rotation knob as
        // a rigid frame rotated around the pivot. Without this the
        // overlay tracks the live AABB of the rotated shapes,
        // which grows + shifts each frame and makes the knob jump.
        setDrag({ ...drag, currentDelta: delta });
      } else if (drag.kind === "lasso") {
        // Cluster 20 v1.0.5 — extend the lasso rectangle. The render
        // path reads drag.current to draw the dashed selection rect.
        setDrag({ ...drag, current: p });
      }
    },
    [active, drag, draft, replaceShape, writeShapes],
  );

  const onCanvasPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!active) return;
      try {
        (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (drag.kind === "draw" && draft) {
        // Commit if the shape has any meaningful extent. Tiny clicks
        // (no movement) become a 1×1 dot for freehand or are dropped
        // for the other kinds.
        const minDim = draft.kind === "freehand" ? 1 : 4;
        if (draft.w >= minDim || draft.h >= minDim) {
          // Cluster 20 v1.0.6 — capture the pre-commit state so
          // Ctrl+Z reverts the new shape's appearance.
          onPushUndo();
          appendShape(draft);
        }
      } else if (drag.kind === "lasso") {
        // Cluster 20 v1.0.5 — commit lasso. <4 px movement falls
        // back to the legacy "click empty canvas → clear selection"
        // behaviour so accidental clicks don't strand the user with
        // a stale empty selection.
        const minX = Math.min(drag.origin.x, drag.current.x);
        const minY = Math.min(drag.origin.y, drag.current.y);
        const maxX = Math.max(drag.origin.x, drag.current.x);
        const maxY = Math.max(drag.origin.y, drag.current.y);
        const w = maxX - minX;
        const h = maxY - minY;
        if (w < 4 && h < 4) {
          if (!drag.additive) setSelectedIds(new Set());
        } else {
          // Fully-contained semantics: a shape is lassoed only when
          // its entire (un-rotated) bbox sits inside the lasso rect.
          // Adobe / Figma convention; predictable when many shapes
          // overlap the lasso edge.
          const containedIds: string[] = [];
          for (const s of doc.shapes) {
            if (
              s.x >= minX &&
              s.y >= minY &&
              s.x + s.w <= maxX &&
              s.y + s.h <= maxY
            ) {
              containedIds.push(s.id);
            }
          }
          if (drag.additive) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              containedIds.forEach((id) => next.add(id));
              return next;
            });
          } else {
            setSelectedIds(new Set(containedIds));
          }
        }
      }
      setDraft(null);
      setDrag({ kind: "none" });
    },
    [active, drag, draft, appendShape, doc.shapes],
  );

  // ---- per-shape pointer handlers ----

  const onShapePointerDown = useCallback(
    (shape: Shape, e: React.PointerEvent) => {
      if (!active) return;
      e.stopPropagation();
      if (tool.kind === "highlight") {
        // Cluster 20 v1.0.2 — pick the SMALLEST shape whose
        // bounding box contains the click point, not the topmost
        // one in render order. This lets the user highlight a
        // small shape that's nested inside a bigger one (the
        // bigger one is on top in z-order but the user is aiming
        // at the inner one). Falls back to the shape that fired
        // the click when no AABB-containment matches (defensive —
        // shouldn't happen with pointer-events: 'all', but keeps
        // the fill action robust if the math ever drifts).
        const p = toSvgPoint(svgRef.current, e);
        const target = findSmallestShapeContainingPoint(doc.shapes, p) ?? shape;
        // Re-clicking a shape that already has the same fill
        // toggles it back to null (lets the user undo a fill
        // without bouncing through Delete).
        const fillTarget = activeColor + HIGHLIGHT_FILL_ALPHA; // ~20% alpha so doc text stays readable
        const equivalent =
          target.fill && target.fill.toLowerCase() === fillTarget.toLowerCase();
        // Cluster 20 v1.0.6 — capture pre-fill state for undo.
        onPushUndo();
        replaceShape(target.id, (s) => ({
          ...s,
          fill: equivalent ? null : fillTarget,
        }));
        return;
      }
      if (tool.kind === "transform") {
        // Cluster 20 v1.0.5 — pick the SMALLEST shape whose bounding
        // box contains the click point, not the topmost in z-order.
        // Lets the user click into a small shape nested inside a
        // bigger one (which may itself be selected as part of a
        // multi-set). Falls back to the shape that fired the click
        // if no AABB-contains match (defensive — shouldn't happen
        // with pointer-events: 'all').
        //
        // Cluster 20 v1.0.7 — when the user plain-clicks while a
        // multi-selection is active, prefer a MEMBER of the set as
        // the click target. Without this preference a non-member
        // smaller shape that sits under the cursor (often via a
        // rotated-shape overhang outside the group's logical bbox)
        // would steal the click and collapse the multi-set, which
        // is the "sometimes dragging doesn't work" bug. Ctrl+click
        // still uses the global pick — the user is explicitly
        // modifying the selection there.
        const p = toSvgPoint(svgRef.current, e);
        const isCtrlClick = e.ctrlKey || e.metaKey;
        let target: Shape | null = null;
        if (!isCtrlClick && selectedIds.size > 1) {
          const memberShapes = doc.shapes.filter((s) => selectedIds.has(s.id));
          target = findSmallestShapeContainingPoint(memberShapes, p);
        }
        if (!target) {
          target = findSmallestShapeContainingPoint(doc.shapes, p) ?? shape;
        }
        // Cluster 20 v1.0.4 — selection rules:
        //   - Ctrl/Cmd+Click toggles membership in the multi-set,
        //     does NOT start a drag (so you can keep building up
        //     a selection without accidentally moving things).
        //   - Plain click on a shape that's already in a multi-set
        //     preserves the set and starts a group-move drag from
        //     this shape.
        //   - Plain click on a shape NOT in the current selection
        //     collapses to a single-shape selection and starts a
        //     single-shape move drag.
        let nextSelection: Set<string>;
        if (isCtrlClick) {
          nextSelection = new Set(selectedIds);
          if (nextSelection.has(target.id)) nextSelection.delete(target.id);
          else nextSelection.add(target.id);
        } else if (selectedIds.has(target.id) && selectedIds.size > 1) {
          nextSelection = selectedIds;
        } else {
          nextSelection = new Set([target.id]);
        }
        setSelectedIds(nextSelection);
        if (!isCtrlClick && nextSelection.size > 0) {
          // Cluster 20 v1.0.6 — capture pre-drag state for undo.
          // One push per drag; intermediate pointermove updates
          // share the same undo step.
          onPushUndo();
          const snaps = doc.shapes.filter((s) => nextSelection.has(s.id));
          if (nextSelection.size === 1) {
            setDrag({
              kind: "move",
              shapeId: snaps[0].id,
              origin: p,
              shapeStart: snaps[0],
            });
          } else {
            setDrag({
              kind: "group-move",
              origin: p,
              snapshots: snaps,
            });
          }
          try {
            (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
          } catch {
            /* ignore */
          }
        }
        return;
      }
      // Cluster 20 v1.0.3 — Draw modes never reach this handler:
      // shapes are rendered with `pointer-events: none` while a
      // draw tool is active, so clicks on existing shapes pass
      // straight through to the SVG canvas, where
      // `onCanvasPointerDown` starts a new draft on top of the
      // existing shape. This is the "draw inside / draw over"
      // behaviour you'd expect from Microsoft Paint.
    },
    // doc is in deps because the highlight branch reads doc.shapes
    // to compute the smallest-containing-shape pick.
    [active, tool, replaceShape, doc, activeColor, selectedIds],
  );

  const onSelectionMovePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active || tool.kind !== "transform" || selectedIds.size !== 1)
        return;
      const id = Array.from(selectedIds)[0];
      const shape = doc.shapes.find((s) => s.id === id);
      if (!shape) return;
      e.stopPropagation();
      const p = toSvgPoint(svgRef.current, e);
      onPushUndo();
      setDrag({
        kind: "move",
        shapeId: id,
        origin: p,
        shapeStart: shape,
      });
      try {
        (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [active, tool, selectedIds, doc, onPushUndo],
  );

  const onSelectionHandlePointerDown = useCallback(
    (
      handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
      e: React.PointerEvent,
    ) => {
      if (!active || tool.kind !== "transform" || selectedIds.size !== 1)
        return;
      const id = Array.from(selectedIds)[0];
      const shape = doc.shapes.find((s) => s.id === id);
      if (!shape) return;
      e.stopPropagation();
      const p = toSvgPoint(svgRef.current, e);
      onPushUndo();
      setDrag({
        kind: "resize",
        shapeId: id,
        handle,
        origin: p,
        shapeStart: shape,
        shiftLock: e.shiftKey,
      });
      try {
        (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [active, tool, selectedIds, doc, onPushUndo],
  );

  const onSelectionRotatePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active || tool.kind !== "transform" || selectedIds.size !== 1)
        return;
      const id = Array.from(selectedIds)[0];
      const shape = doc.shapes.find((s) => s.id === id);
      if (!shape) return;
      e.stopPropagation();
      const p = toSvgPoint(svgRef.current, e);
      onPushUndo();
      setDrag({
        kind: "rotate",
        shapeId: id,
        origin: p,
        shapeStart: shape,
      });
      try {
        (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [active, tool, selectedIds, doc, onPushUndo],
  );

  // ---- group drag handlers (Cluster 20 v1.0.4) ----

  /** Snapshot the currently-selected shapes for a group drag. Used
   *  by all three group drag-start handlers below. */
  const snapshotSelected = useCallback((): Shape[] => {
    return doc.shapes.filter((s) => selectedIds.has(s.id));
  }, [doc.shapes, selectedIds]);

  const onGroupMovePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active || tool.kind !== "transform" || selectedIds.size < 2) return;
      e.stopPropagation();
      const p = toSvgPoint(svgRef.current, e);
      // Cluster 20 v1.0.7 — Ctrl/Cmd+click on the group bbox area
      // toggles the smallest-containing shape in/out of the multi-
      // set instead of starting a group-move drag. Without this
      // branch the bbox rect (which renders on top of the shapes)
      // intercepts every click within its area, so Ctrl+click on a
      // member would silently start a group drag and ignore the
      // user's modifier intent. With this branch the user can
      // refine the multi-set freely even when the bbox is large.
      if (e.ctrlKey || e.metaKey) {
        const target = findSmallestShapeContainingPoint(doc.shapes, p);
        if (target) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(target.id)) next.delete(target.id);
            else next.add(target.id);
            return next;
          });
        }
        return;
      }
      onPushUndo();
      setDrag({
        kind: "group-move",
        origin: p,
        snapshots: snapshotSelected(),
      });
      try {
        (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [active, tool, selectedIds, snapshotSelected, onPushUndo, doc.shapes],
  );

  const onGroupHandlePointerDown = useCallback(
    (
      handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
      e: React.PointerEvent,
    ) => {
      if (!active || tool.kind !== "transform" || selectedIds.size < 2) return;
      e.stopPropagation();
      const p = toSvgPoint(svgRef.current, e);
      const snaps = snapshotSelected();
      onPushUndo();
      setDrag({
        kind: "group-resize",
        handle,
        origin: p,
        snapshots: snaps,
        bboxStart: computeGroupBbox(snaps),
      });
      try {
        (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [active, tool, selectedIds, snapshotSelected, onPushUndo],
  );

  const onGroupRotatePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active || tool.kind !== "transform" || selectedIds.size < 2) return;
      e.stopPropagation();
      const p = toSvgPoint(svgRef.current, e);
      const snaps = snapshotSelected();
      const bbox = computeGroupBbox(snaps);
      onPushUndo();
      setDrag({
        kind: "group-rotate",
        origin: p,
        snapshots: snaps,
        pivot: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 },
        bboxStart: bbox,
        currentDelta: 0,
      });
      try {
        (svgRef.current as any)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [active, tool, selectedIds, snapshotSelected, onPushUndo],
  );

  // ---- key handlers ----

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      // Don't intercept if a modal / form input has focus.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        // Cluster 20 v1.0.4 — Escape clears multi-selection first;
        // a second Escape exits shape editor. Mirrors the typical
        // Adobe / Figma convention of progressive de-selection.
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onExit();
        return;
      }
      // Tool keys (lowercase only — Shift+T is reserved for tables, etc.)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "r") {
          setTool({ kind: "rect" });
          e.preventDefault();
          return;
        }
        if (e.key === "e") {
          setTool({ kind: "ellipse" });
          e.preventDefault();
          return;
        }
        if (e.key === "l") {
          setTool({ kind: "line" });
          e.preventDefault();
          return;
        }
        if (e.key === "f") {
          setTool({ kind: "freehand" });
          e.preventDefault();
          return;
        }
        if (e.key === "t") {
          setTool({ kind: "transform" });
          e.preventDefault();
          return;
        }
        if (e.key === "h") {
          setTool({ kind: "highlight" });
          e.preventDefault();
          return;
        }
        // Delete every selected shape. Cluster 20 v1.0.4 generalizes
        // from singleton to selectedIds Set so multi-select Delete
        // works in one keystroke.
        if (e.key === "d" || e.key === "Delete" || e.key === "Backspace") {
          if (selectedIds.size > 0) {
            // Cluster 20 v1.0.6 — capture pre-delete state for undo.
            onPushUndo();
            removeShapes(Array.from(selectedIds));
            setSelectedIds(new Set());
            e.preventDefault();
          }
          return;
        }
        // Color palette
        const slot = SHAPE_COLORS.find((c) => c.key === e.key);
        if (slot) {
          setActiveColor(slot.hex);
          e.preventDefault();
          return;
        }
      }
      // Cluster 20 v1.0.4 — Copy / Paste. Ctrl+C snapshots the
      // current selection into the in-memory clipboard. Ctrl+V
      // appends fresh-id duplicates of every clipboard shape with a
      // 16-px offset so the copy is visible, and selects the
      // duplicates so the user can immediately drag / align them.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "c"
      ) {
        if (selectedIds.size > 0) {
          const snaps = doc.shapes.filter((s) => selectedIds.has(s.id));
          // Deep copy so future edits to the doc don't mutate the
          // clipboard contents (Shapes are JSON-shaped so a JSON
          // round-trip is the simplest safe clone).
          setClipboard(JSON.parse(JSON.stringify(snaps)) as Shape[]);
          e.preventDefault();
          return;
        }
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "v"
      ) {
        if (clipboard.length > 0) {
          const PASTE_OFFSET = 16;
          const dupes: Shape[] = clipboard.map((s) => ({
            ...s,
            id: newShapeId(),
            x: s.x + PASTE_OFFSET,
            y: s.y + PASTE_OFFSET,
          }));
          // Cluster 20 v1.0.6 — capture pre-paste state for undo.
          onPushUndo();
          onDocChange({ ...doc, shapes: [...doc.shapes, ...dupes] });
          setSelectedIds(new Set(dupes.map((d) => d.id)));
          e.preventDefault();
          return;
        }
      }
      // Cluster 20 v1.0.6 — Ctrl+Z undo / Ctrl+Y / Ctrl+Shift+Z redo.
      // Mid-drag undo cancels the in-flight drag first so the next
      // pointermove doesn't immediately overwrite the just-undone
      // state by re-applying its snapshot deltas.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        if (canUndo) {
          if (drag.kind !== "none") setDrag({ kind: "none" });
          onUndo();
          e.preventDefault();
        }
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ((e.shiftKey && e.key.toLowerCase() === "z") ||
          (!e.shiftKey && e.key.toLowerCase() === "y"))
      ) {
        if (canRedo) {
          if (drag.kind !== "none") setDrag({ kind: "none" });
          onRedo();
          e.preventDefault();
        }
        return;
      }
      // Templates
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "t"
      ) {
        e.preventDefault();
        onSaveTemplate();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        e.preventDefault();
        onLoadTemplate();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    active,
    selectedIds,
    clipboard,
    doc,
    onDocChange,
    onExit,
    onSaveTemplate,
    onLoadTemplate,
    removeShapes,
    onPushUndo,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    drag,
  ]);

  // ---- align / distribute (Cluster 20 v1.0.4) ----

  type AlignDirection =
    | "top"
    | "middle"
    | "bottom"
    | "left"
    | "center"
    | "right";

  const alignSelected = useCallback(
    (direction: AlignDirection) => {
      const ids = Array.from(selectedIds);
      if (ids.length < 2) return;
      const sel = doc.shapes.filter((s) => selectedIds.has(s.id));
      const bbox = computeGroupBbox(sel);
      // Cluster 20 v1.0.6 — capture pre-align state for undo.
      onPushUndo();
      replaceShapes(ids, (s) => {
        switch (direction) {
          case "top":
            return { ...s, y: bbox.y };
          case "middle":
            return { ...s, y: bbox.y + bbox.h / 2 - s.h / 2 };
          case "bottom":
            return { ...s, y: bbox.y + bbox.h - s.h };
          case "left":
            return { ...s, x: bbox.x };
          case "center":
            return { ...s, x: bbox.x + bbox.w / 2 - s.w / 2 };
          case "right":
            return { ...s, x: bbox.x + bbox.w - s.w };
        }
      });
    },
    [doc.shapes, selectedIds, replaceShapes, onPushUndo],
  );

  const distributeSelected = useCallback(
    (axis: "h" | "v") => {
      const ids = Array.from(selectedIds);
      if (ids.length < 3) return; // 2 shapes are trivially "distributed"
      const sel = doc.shapes.filter((s) => selectedIds.has(s.id));
      // Sort by leading edge along the chosen axis.
      const sorted = [...sel].sort((a, b) =>
        axis === "h" ? a.x - b.x : a.y - b.y,
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const sizeKey = axis === "h" ? "w" : "h";
      const posKey = axis === "h" ? "x" : "y";
      const totalSize = sorted.reduce((sum, s) => sum + s[sizeKey], 0);
      const span = last[posKey] + last[sizeKey] - first[posKey];
      const gap = (span - totalSize) / (sorted.length - 1);
      // Place each shape at first.posKey + cumulative-size-before-it
      // + (its sorted index) * gap. The first and last stay anchored.
      const targetByid = new Map<string, number>();
      let cursor = first[posKey];
      for (let i = 0; i < sorted.length; i++) {
        targetByid.set(sorted[i].id, cursor);
        cursor += sorted[i][sizeKey] + gap;
      }
      // Cluster 20 v1.0.6 — capture pre-distribute state for undo.
      onPushUndo();
      replaceShapes(ids, (s) => {
        const target = targetByid.get(s.id);
        if (target == null) return s;
        return axis === "h" ? { ...s, x: target } : { ...s, y: target };
      });
    },
    [doc.shapes, selectedIds, replaceShapes, onPushUndo],
  );

  // ---- render ----

  // Cluster 20 v1.0.4 — list of currently-selected shapes, derived
  // from `selectedIds` against the live doc. Used for the selection
  // overlay (single vs group) and by the toolbar align/distribute /
  // delete / copy actions.
  const selectedShapes = useMemo(
    () => doc.shapes.filter((s) => selectedIds.has(s.id)),
    [selectedIds, doc.shapes],
  );
  const singleSelectedShape =
    selectedShapes.length === 1 ? selectedShapes[0] : null;

  return (
    <div
      className={
        "cortex-shape-editor-layer" +
        (active ? " cortex-shape-editor-layer-active" : "")
      }
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: active ? "auto" : "none",
        zIndex: 50,
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
        style={{
          display: "block",
          cursor: active && isDrawTool(tool) ? "crosshair" : "default",
        }}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
      >
        {doc.shapes.map((s) => (
          <ShapeView
            key={s.id}
            shape={s}
            selected={selectedIds.has(s.id) && tool.kind === "transform"}
            active={active}
            highlightHover={active && tool.kind === "highlight"}
            interactive={
              active && (tool.kind === "transform" || tool.kind === "highlight")
            }
            onPointerDown={(e) => onShapePointerDown(s, e)}
          />
        ))}
        {draft && (
          <ShapeView
            shape={draft}
            selected={false}
            active={active}
            highlightHover={false}
            interactive={false}
            onPointerDown={() => {
              /* drafts ignore further presses */
            }}
          />
        )}
        {/* Cluster 20 v1.0.4 — single-shape selection uses the
            per-shape rotated overlay (so rotation pivots around the
            shape's own center); 2+ shapes use the axis-aligned
            group overlay. */}
        {active && tool.kind === "transform" && singleSelectedShape && (
          <SelectionOverlay
            shape={singleSelectedShape}
            onMovePointerDown={onSelectionMovePointerDown}
            onHandlePointerDown={onSelectionHandlePointerDown}
            onRotatePointerDown={onSelectionRotatePointerDown}
          />
        )}
        {active && tool.kind === "transform" && selectedShapes.length > 1 && (
          <GroupSelectionOverlay
            shapes={selectedShapes}
            rotationFrame={
              drag.kind === "group-rotate"
                ? {
                    bboxStart: drag.bboxStart,
                    pivot: drag.pivot,
                    delta: drag.currentDelta,
                  }
                : null
            }
            onMovePointerDown={onGroupMovePointerDown}
            onHandlePointerDown={onGroupHandlePointerDown}
            onRotatePointerDown={onGroupRotatePointerDown}
          />
        )}
        {/* Cluster 20 v1.0.5 — lasso rectangle while the user drag-
            selects on the empty canvas in transform mode. Pointer-
            events: none on the rect itself so it doesn't intercept
            the in-flight pointer events feeding the drag. */}
        {drag.kind === "lasso" &&
          (() => {
            const minX = Math.min(drag.origin.x, drag.current.x);
            const minY = Math.min(drag.origin.y, drag.current.y);
            const w = Math.abs(drag.current.x - drag.origin.x);
            const h = Math.abs(drag.current.y - drag.origin.y);
            return (
              <rect
                x={minX}
                y={minY}
                width={w}
                height={h}
                fill="var(--accent)"
                fillOpacity={0.08}
                stroke="var(--accent)"
                strokeDasharray="4 3"
                strokeWidth={1}
                pointerEvents="none"
              />
            );
          })()}
      </svg>
      {active && (
        <ShapeEditorToolbar
          tool={tool}
          activeColor={activeColor}
          selectedShapes={selectedShapes}
          clipboardSize={clipboard.length}
          position={toolbarPos}
          onPositionChange={handleToolbarPosChange}
          onToolChange={setTool}
          onColorChange={setActiveColor}
          onDeleteSelected={() => {
            if (selectedIds.size > 0) {
              onPushUndo();
              removeShapes(Array.from(selectedIds));
              setSelectedIds(new Set());
            }
          }}
          onCopySelected={() => {
            if (selectedIds.size > 0) {
              const snaps = doc.shapes.filter((s) => selectedIds.has(s.id));
              setClipboard(JSON.parse(JSON.stringify(snaps)) as Shape[]);
            }
          }}
          onPaste={() => {
            if (clipboard.length === 0) return;
            const PASTE_OFFSET = 16;
            const dupes: Shape[] = clipboard.map((s) => ({
              ...s,
              id: newShapeId(),
              x: s.x + PASTE_OFFSET,
              y: s.y + PASTE_OFFSET,
            }));
            onPushUndo();
            onDocChange({ ...doc, shapes: [...doc.shapes, ...dupes] });
            setSelectedIds(new Set(dupes.map((d) => d.id)));
          }}
          onAlign={alignSelected}
          onDistribute={distributeSelected}
          onExit={onExit}
          onSaveTemplate={onSaveTemplate}
          onLoadTemplate={onLoadTemplate}
        />
      )}
    </div>
  );
}
