# Cluster 20 — Shape Editor

_Build order: Phase 3, on demand. Standalone — no upstream dependencies beyond Phase 1's vault, the per-pane TabPane handle, and Cluster 6's sidecar-JSON pattern (which this reuses)._

---

## What this is

A "Microsoft Paint inside the document" mode. Press `Ctrl+Shift+D` while a markdown note is the active slot; the document body becomes a frozen, slightly-dimmed visual backdrop and an SVG overlay snaps over it. While the overlay is active you draw shapes on top of the note — rectangles, ellipses, lines, freehand strokes. You can switch into a transform mode to click-select a shape and resize / rotate it via a bounding box, or into a highlight (fill) mode that recolors a clicked shape's interior. You can save the current set of shapes as a named template stored at the vault level, and load that template into any other note's shape editor. When you exit (`Esc`), the shapes are written to a sidecar JSON next to the .md file and the document goes back to being editable text — but the shapes still render as a non-interactable SVG overlay so the user (and any future reader) sees the annotations on top of the note. The overlay scrolls with the document content because shape positions are stored in document coordinates, not viewport coordinates.

The shape primitives ship in v1.0:

- **Rectangle** — drag a bounding box.
- **Ellipse** — same (the bounding box is the ellipse's axis-aligned envelope).
- **Line** — drag from start to end.
- **Freehand path** — drag while the pointer is down to lay down a smoothed polyline.

The mode primitives:

- **Draw** (one of the four shapes above is the "active draw tool")
- **Transform** — click-select then drag bounding-box handles to resize, drag a top-anchored knob to rotate
- **Highlight** — click a shape, get its interior filled with the active color

## Why we want it

A research notebook frequently needs visual annotations that aren't expressible as text — circling a key sentence in a transcribed quote, drawing an arrow between two paragraphs that connect logically, sketching a quick diagram inline with a thought. Today the workaround is "screenshot, edit in Paint, paste back as an image." That breaks two-way editability: once it's a PNG, you can't tweak it without round-tripping out of Cortex. Putting the shapes in the same document, as their own layer, keeps everything inside the vault and editable indefinitely.

The "uneditable when not in shape editor" rule is the reason the overlay model works. You can read a note normally — the shapes are visible but don't intercept clicks, so wikilinks, marks, and the editor cursor all behave exactly as before. Re-entering shape editor unlocks the layer for editing.

## Why it's not deferred

Direct user request, with a fairly complete UX spec attached (entry shortcut, drawing semantics, transform mode, highlight mode, templates, overlay rule). The combination of a clear spec and a clear "I'd use this" signal is the strongest possible build trigger.

## Decisions already made

- **Sidecar JSON storage at `<note-stem>.shapes.json`**, mirroring the Cluster 6 PDF-annotation precedent. Schema-versioned, `#[serde(default)]` on every field for forward-compat. The .md content stays clean — no inline `<svg>` blob bloating the markdown source. Shapes are decoupled from text content (a paragraph delete doesn't nuke shapes; a shape moved doesn't touch text).
- **SVG overlay, not Canvas, not ProseMirror decorations.** SVG gives per-shape hit-testing for free (essential for transform-click and highlight-click) and stays crisp at any zoom level. Canvas would force a hand-rolled hit-test layer. Decorations would entangle shapes with editor state in a way that fights the "uneditable when not in shape editor" rule.
- **Document coordinates, not viewport coordinates.** Each shape's `(x, y)` is relative to the document's content origin, so when the user scrolls, the shapes scroll with the doc. Implementation: the SVG overlay is positioned `absolute; top: 0; left: 0; width: 100%; height: <docHeight>` inside the same scroll container that holds the ProseMirror, so it scrolls naturally as a sibling layer.
- **Per-pane mode flag, not a separate ActiveView.** TabPane grows a `shapeEditorActive: boolean` orthogonal to `activeView`. The document still renders underneath; the overlay is layered on top and switches its `pointer-events` based on the flag.
- **Ctrl+Shift+D enters shape editor mode for the active slot.** D for Draw. Esc exits. Inside the mode, single-letter keys swap tools: R rect, E ellipse, L line, F freehand, T transform, H highlight, D delete (the selected shape). 1–9 set the active color from a 9-slot palette (the 7 mark colors + black + white).
- **Frozen + slight dim doc backdrop.** While shape editor is active the document body renders at ~80% opacity with `pointer-events: none`. The dim signals "you're not editing text right now"; clicks pass straight to the SVG overlay above.
- **Templates are vault-level, not note-level.** Stored at `<vault>/.cortex/shape-templates/<name>.json`. A template is the same shape format as a note's sidecar — load = paste these shapes into the current note's set (additive, not replace). Saved by `Ctrl+T` while in shape editor (prompt for name); loaded by `Ctrl+Shift+L` (picker modal).
- **Idempotent save.** Sidecar writes only when the JSON content actually changes vs disk; same rule as the auto-section regen pattern from Cluster 8 / Cluster 14.
- **Save on Ctrl+S, save on pane blur, save on shape-editor exit.** Three triggers. The first two are how the rest of Cortex saves; the third catches "user clicks elsewhere without explicitly Ctrl+S".

## Decisions still open

### Shape z-order

For v1.0, shapes render in insertion order (last drawn = on top). v1.1 may add Bring-to-Front / Send-to-Back via `Ctrl+]` / `Ctrl+[` on a selected shape. Multi-shape z-order management is deferred.

### Stroke width

v1.0 uses a fixed 2-px stroke. v1.1 may add a stroke-width selector (1, 2, 4, 8 px) on the toolbar.

### Multi-select

v1.0 only ever has zero or one selected shape (transform mode). v1.1 may add multi-select via Shift+click for batch transform / batch fill / batch delete.

### Undo/redo within shape editor

v1.0 ships without an undo stack inside the shape editor — Delete to remove a mistake, redraw if needed. v1.1 adds a per-session ring buffer of shape-doc snapshots with `Ctrl+Z` / `Ctrl+Y`.

### Viewing on PDFs

For v1.0 the overlay only mounts on markdown notes. PDFs already have their own annotation layer (Cluster 6) that owns the page rectangle. Overlapping the two would be confusing. v1.1 may add shape-editor on PDFs as a separate sidecar (`<pdf-stem>.shapes.json`).

### Templates: which shapes

For v1.0, "save template" captures EVERY shape currently in the note's sidecar. v1.1 may add "save selected" once multi-select is in.

## Architecture sketch

### File paths

```
<note-dir>/<note-stem>.shapes.json     ← per-note shape set
<vault>/.cortex/shape-templates/<name>.json   ← vault-level templates
```

Both written only when content differs from disk.

### Sidecar schema (v1)

```json
{
  "version": 1,
  "shapes": [
    {
      "id": "uuid-v4",
      "kind": "rect",
      "x": 120,
      "y": 240,
      "w": 200,
      "h": 80,
      "rotation": 0,
      "stroke": "#3a86ff",
      "fill": null,
      "strokeWidth": 2
    },
    {
      "id": "uuid-v4",
      "kind": "ellipse",
      "x": 400,
      "y": 240,
      "w": 120,
      "h": 120,
      "rotation": 0,
      "stroke": "#ef476f",
      "fill": "#ef476f33",
      "strokeWidth": 2
    },
    {
      "id": "uuid-v4",
      "kind": "line",
      "x": 200,
      "y": 320,
      "w": 200,
      "h": 1,
      "rotation": 0,
      "stroke": "#222",
      "fill": null,
      "strokeWidth": 2,
      "x1": 0,
      "y1": 0,
      "x2": 200,
      "y2": 0
    },
    {
      "id": "uuid-v4",
      "kind": "freehand",
      "x": 100,
      "y": 500,
      "w": 200,
      "h": 100,
      "rotation": 0,
      "stroke": "#000",
      "fill": null,
      "strokeWidth": 2,
      "points": [
        [0, 0],
        [10, 5],
        [25, 8],
        [...]
      ]
    }
  ]
}
```

Every shape kind has the same `(x, y, w, h, rotation, stroke, fill, strokeWidth)` envelope so transform handles can manipulate any kind uniformly. Kind-specific extras (line endpoints, freehand points) are stored in coordinates RELATIVE to the bounding box — when the box scales, the inner geometry scales with it.

`#[serde(default)]` on every optional field. Unknown kinds fall through to a no-op render so a v1.0 client opening a future v1.1 note doesn't crash.

### Tauri command surface

```rust
// note shapes
read_shapes_sidecar(note_path: String) -> Option<ShapesDoc>;
write_shapes_sidecar(note_path: String, doc: ShapesDoc) -> ();

// templates
list_shape_templates(vault_path: String) -> Vec<TemplateInfo>;
read_shape_template(vault_path: String, name: String) -> ShapesDoc;
save_shape_template(vault_path: String, name: String, doc: ShapesDoc) -> ();
delete_shape_template(vault_path: String, name: String) -> ();
```

`TemplateInfo`: `{ name: String, shape_count: usize, modified_at_unix: i64 }`. Listed sorted by `modified_at_unix DESC` so recent templates surface first.

### Frontend components

- `src/shapes/types.ts` — TS types matching Rust serde.
- `src/components/ShapeEditor.tsx` — SVG overlay component. Owns: tool state, mode, active color, currently-selected shape, in-progress draft shape during a draw drag, transform-handle drag state. Renders all shapes via per-kind helpers; renders selection bounding-box + handles when transform mode and a shape is selected.
- `src/components/ShapeEditorToolbar.tsx` — floating toolbar (top-right of pane). Tool buttons, color swatches, template-save button, exit button.
- `src/components/ShapeTemplateModal.tsx` — modal for save / load / delete templates.

### Per-pane integration

`TabPane` grows:

- State: `shapeEditorActive: boolean`, `shapesDoc: ShapesDoc | null`, `shapesDirty: boolean`.
- Effect: load `read_shapes_sidecar` after the file body loads.
- Save flow: `saveShapesIfDirty()` — write the sidecar via Tauri, clear `shapesDirty`. Triggered by `Ctrl+S`, by pane blur, by the existing `saveIfDirty()` (which fans out to shape-save too), and by `toggleShapeEditor()` when leaving the mode.
- Render: when the open file is a markdown note, render the editor body inside a wrapper that also hosts a `<ShapeEditor>` overlay. Apply the `cortex-shape-editor-active` class to the wrapper when `shapeEditorActive` is true.

`TabPaneHandle` grows:

- `toggleShapeEditor(): Promise<void>` — flip the flag; save shapes when leaving.
- `getShapeEditorActive(): boolean`
- `saveShapesIfDirty(): Promise<boolean>`

### App.tsx integration

- New global `Ctrl+Shift+D` keydown handler (after the existing `Ctrl+Shift+T` table insert): dispatches to `paneRefs.current[activeSlotIdxRef.current]?.toggleShapeEditor()`.
- ShortcutsHelp gains a Shape editor section with all in-mode keys.

### Tool model

The active tool is a discriminated union:

```ts
type ShapeTool =
  | { kind: "rect" }
  | { kind: "ellipse" }
  | { kind: "line" }
  | { kind: "freehand" }
  | { kind: "transform" }
  | { kind: "highlight" };
```

Pointer events on the overlay branch on `tool.kind`:

- Draw kinds → start/extend/commit a new shape on pointerdown / pointermove / pointerup.
- Transform → pointerdown on a shape selects it; pointerdown on a handle starts a resize/rotate; pointerdown on empty deselects.
- Highlight → pointerdown on a shape sets `fill = activeColor`.

### Transform handle math

Bounding box rendered around the selected shape, with rotation applied as the SVG `transform` on a containing `<g>`. Eight handles + one rotation knob:

- `nw, n, ne, w, e, sw, s, se` — corner / edge handles. Drag updates `(x, y, w, h)` by anchoring on the OPPOSITE handle's pre-drag screen position. Holding Shift constrains aspect ratio (corners only).
- Rotation knob — a small circle 24 px above the box's top center. Drag to rotate around the shape's center. Holding Shift snaps to 15° increments (mirrors the Cluster 19 image-rotate pattern).

Handle drag math runs in screen coordinates (pointer deltas) and converts back to document coordinates before patching the shape. For a rotated shape, a corner-handle drag transforms the pointer delta through the inverse of the shape's rotation so dragging "in the direction the user expects" still resizes along the shape's local axes.

For lines and freehand strokes, the bounding box scales the inner geometry (x1/y1/x2/y2 for line; each point in `points` for freehand) proportionally so the shape stretches with the box.

### Color palette

Nine slots, mapped to keys `1–9`:

| Key | Color name      | Hex       |
| --- | --------------- | --------- |
| 1   | Mark Yellow     | `#ffd166` |
| 2   | Mark Green      | `#06d6a0` |
| 3   | Mark Blue       | `#3a86ff` |
| 4   | Mark Red        | `#ef476f` |
| 5   | Mark Purple     | `#9d4edd` |
| 6   | Mark Orange     | `#f78c6b` |
| 7   | Mark Pink       | `#ffafcc` |
| 8   | Black           | `#222`    |
| 9   | White           | `#fff`    |

Keys 1–7 reuse the Cluster 2 mark palette so the visual language is consistent across mark / shape colors. Black and white round out for monochrome diagrams.

In Highlight mode the active color becomes the shape's fill (with alpha applied — `<color>33` for fill, full opacity for stroke). In Draw mode the active color becomes the new shape's stroke; fill stays null until Highlight is applied.

### Key bindings (in shape editor mode only)

| Key            | Action                                  |
| -------------- | --------------------------------------- |
| `Esc`          | Exit shape editor (saves first)         |
| `R`            | Tool = rect                             |
| `E`            | Tool = ellipse                          |
| `L`            | Tool = line                             |
| `F`            | Tool = freehand                         |
| `T`            | Tool = transform                        |
| `H`            | Tool = highlight                        |
| `D`            | Delete selected shape (transform mode)  |
| `1`–`9`        | Set active color                        |
| `Ctrl+T`       | Save current shapes as template (modal) |
| `Ctrl+Shift+L` | Load template (picker)                  |
| `Ctrl+S`       | Save sidecar now                        |

`Ctrl+Shift+D` (the entry shortcut) and the tool keys are gated behind the editor not having focus when shape editor is inactive — same pattern as the existing hierarchy modal shortcuts.

## Verify pointer

`verify-cluster-20-v1.0.ps1` walks every passes A–N: enter/exit, each draw tool, transform handles, highlight, templates save/load, scroll anchoring, persistence round-trip.

## Sequenced follow-ups (v1.1+)

- **Stroke width selector** (1 / 2 / 4 / 8 px) on the toolbar.
- **Z-order shortcuts** — `Ctrl+]` Bring to Front / `Ctrl+[` Send to Back on the selected shape.
- **Multi-select** via Shift+click for batch transform / batch fill / batch delete.
- **Undo/redo** within the session via per-shape-doc snapshot ring buffer.
- **Arrow shape** (line + arrowhead).
- **Snap to grid** via `Alt` modifier during draw / transform.
- **Shape editor on PDFs** with a parallel `<pdf>.shapes.json` sidecar.
- **Save selected as template** (depends on multi-select).
- **Color picker** for arbitrary hex (beyond the 9-slot palette).
