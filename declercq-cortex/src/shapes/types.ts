// Cluster 20 v1.0 — Shape Editor types.
//
// Mirrors the Rust serde shape (snake_case ↔ camelCase via Tauri's
// default conversion). Every field has a sensible default at parse
// time on the Rust side (`#[serde(default)]`), so a future schema
// bump can add new fields without breaking older clients.
//
// Coordinates are in DOCUMENT coordinates (not viewport). Shapes
// scroll naturally with the document content because the SVG
// overlay is positioned absolutely inside the same scroll container
// that hosts the ProseMirror editor.

export type ShapeKind = "rect" | "ellipse" | "line" | "freehand";

export interface Shape {
  id: string;
  kind: ShapeKind;

  // Bounding-box envelope (every shape kind has these).
  x: number;
  y: number;
  w: number;
  h: number;

  /** Rotation in degrees, around the bounding-box center. */
  rotation: number;

  /** Hex color. Defaulted to the active draw color when a shape is
   *  created. */
  stroke: string;

  /** Hex color (with optional alpha) when a fill is applied. Null
   *  for stroke-only. */
  fill: string | null;

  /** Stroke width in px. v1.0 fixes this at 2; v1.1 may add a
   *  selector. */
  strokeWidth: number;

  // ---- line-only (relative to the bounding box) ----
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;

  // ---- freehand-only (each point relative to the bounding box) ----
  points?: Array<[number, number]>;
}

export interface ShapesDoc {
  version: number;
  shapes: Shape[];
}

export interface ShapeTemplateInfo {
  name: string;
  shape_count: number;
  modified_at_unix: number;
}

/** Empty doc, used when a note has no sidecar yet. */
export const EMPTY_SHAPES_DOC: ShapesDoc = { version: 1, shapes: [] };

/** Tools the user can swap between via single-letter keyboard
 *  shortcuts inside shape editor mode. The four DRAW tools differ
 *  only in shape kind; the two MODE tools (transform / highlight)
 *  branch the pointer pipeline. */
export type ShapeTool =
  | { kind: "rect" }
  | { kind: "ellipse" }
  | { kind: "line" }
  | { kind: "freehand" }
  | { kind: "transform" }
  | { kind: "highlight" };

/** True when this tool is one of the four "draw a new shape" tools. */
export function isDrawTool(t: ShapeTool): boolean {
  return (
    t.kind === "rect" ||
    t.kind === "ellipse" ||
    t.kind === "line" ||
    t.kind === "freehand"
  );
}

/** Cluster 20 v1.0 — 9-slot color palette mapped to keys 1–9.
 *  Slots 1–7 reuse the Cluster 2 mark colors so the visual language
 *  is consistent across mark / shape colors. Slots 8–9 round out
 *  with black + white for monochrome diagrams. */
export const SHAPE_COLORS: Array<{ key: string; name: string; hex: string }> = [
  { key: "1", name: "Yellow", hex: "#ffd166" },
  { key: "2", name: "Green", hex: "#06d6a0" },
  { key: "3", name: "Blue", hex: "#3a86ff" },
  { key: "4", name: "Red", hex: "#ef476f" },
  { key: "5", name: "Purple", hex: "#9d4edd" },
  { key: "6", name: "Orange", hex: "#f78c6b" },
  { key: "7", name: "Pink", hex: "#ffafcc" },
  { key: "8", name: "Black", hex: "#222222" },
  { key: "9", name: "White", hex: "#ffffff" },
];

/** Default fill alpha when applying highlight. Keeps the document
 *  text underneath readable. Encoded as a hex pair appended to a
 *  6-digit hex color. */
export const HIGHLIGHT_FILL_ALPHA = "33"; // ~20% of 255

/** Generate a UUID-v4-ish identifier for new shapes. crypto.randomUUID
 *  is available in Tauri's WebView (Chromium) and avoids a runtime
 *  dependency. Falls back to a Math.random-based id for environments
 *  that don't have it. */
export function newShapeId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return (
    "s-" +
    Math.random().toString(36).slice(2, 10) +
    "-" +
    Date.now().toString(36)
  );
}
