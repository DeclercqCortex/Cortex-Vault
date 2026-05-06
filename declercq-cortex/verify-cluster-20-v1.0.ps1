# verify-cluster-20-v1.0.ps1
# Phase 3 Cluster 20 v1.0 — Shape Editor.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev      # FULL RESTART (new Tauri commands + schema)
#   .\verify-cluster-20-v1.0.ps1
#
# What ships
# ----------
#
# A "Microsoft Paint inside the document" mode. Press Ctrl+Shift+D
# while a markdown note is the active slot. The document body becomes
# a frozen, slightly-dimmed visual backdrop and an SVG overlay snaps
# over it. While the overlay is active the user draws shapes on top
# of the note (rect, ellipse, line, freehand), can switch into
# transform mode to click-select a shape and resize / rotate via a
# bounding box, or into highlight mode to fill a shape's interior
# with the active color. Templates can be saved at the vault level
# and loaded into any other note's shape editor. Esc exits — shapes
# persist as a non-interactable SVG overlay on top of the document
# (visible to the user / future readers, but pointer-events: none so
# the editor underneath behaves normally). Re-entering shape editor
# unlocks the layer for editing.
#
# Storage
# -------
#
# Per-note: `<note-stem>.shapes.json` next to the .md file. Schema
# below.
#
# Per-vault: templates live at `<vault>/.cortex/shape-templates/<name>.json`
# in the same shape format.
#
# Schema (v1):
# ```json
# {
#   "version": 1,
#   "shapes": [
#     {
#       "id": "uuid-v4",
#       "kind": "rect" | "ellipse" | "line" | "freehand",
#       "x": number, "y": number, "w": number, "h": number,
#       "rotation": number,
#       "stroke": "#hex",
#       "fill": "#hex" | null,
#       "strokeWidth": number,
#       // line-only
#       "x1": number, "y1": number, "x2": number, "y2": number,
#       // freehand-only
#       "points": [[x_rel, y_rel], ...]
#     }
#   ]
# }
# ```
#
# Every shape kind has the same (x, y, w, h, rotation) envelope so
# transform handles can manipulate any kind uniformly. Kind-specific
# extras (line endpoints, freehand points) are stored RELATIVE to
# the bounding box — when the box scales, the inner geometry scales
# with it.
#
# Tauri commands (Rust)
# ---------------------
#
#   read_shapes_sidecar(note_path) -> Option<ShapesDoc>
#   write_shapes_sidecar(note_path, doc) -> ()
#   list_shape_templates(vault_path) -> Vec<TemplateInfo>
#   read_shape_template(vault_path, name) -> ShapesDoc
#   save_shape_template(vault_path, name, doc) -> ()
#   delete_shape_template(vault_path, name) -> ()
#
# Sidecar writes are idempotent — they only touch disk when the JSON
# content actually differs from what's there.
#
# Frontend
# --------
#
# - `src/shapes/types.ts` — TS types matching Rust serde.
# - `src/components/ShapeEditor.tsx` — SVG overlay component. Owns:
#   tool, mode, active color, selected shape, in-progress draft
#   shape during a draw drag, transform-handle drag state. Renders
#   all shapes via per-kind helpers; renders selection bounding-box
#   + handles when transform mode and a shape is selected.
# - `src/components/ShapeEditorToolbar.tsx` — floating toolbar
#   (top-right of pane). Tool buttons, color swatches, template
#   save / load buttons, exit button.
# - `src/components/ShapeTemplateModal.tsx` — modal for save / load /
#   delete templates.
# - `src/components/TabPane.tsx` — grows shapeEditorActive /
#   shapesDoc / shapesDirty state, three new handle methods, sidecar
#   load on file open, sidecar save on Ctrl+S / blur / mode-exit.
# - `src/App.tsx` — Ctrl+Shift+D global shortcut routes to active
#   pane's toggleShapeEditor; Ctrl+T / Ctrl+Shift+L gated to in-mode.
# - `src/components/ShortcutsHelp.tsx` — new "Shape editor" section.
# - `src/index.css` — `.cortex-shape-editor-active` dim + frozen
#   layer; SVG overlay layer styles.
#
# Tool model
# ----------
#
# In-mode key bindings:
#
#   R → rect   E → ellipse   L → line   F → freehand
#   T → transform   H → highlight   D → delete selected
#   1–9 → active color (mark colors 1–7 + black + white)
#   Ctrl+T → save template (modal)
#   Ctrl+Shift+L → load template (picker)
#   Ctrl+S → save sidecar now
#   Esc → exit shape editor (saves first)
#
# Pointer event branches on `tool.kind`:
#   Draw kinds  → start / extend / commit a new shape across
#                 pointerdown / pointermove / pointerup
#   Transform   → click-select; drag handles to resize; drag rotation
#                 knob; click empty to deselect
#   Highlight   → click a shape to set its fill to the active color
#
# Smoke tests
# -----------
#
# Pass A — Enter and exit shape editor:
#   1. Open any markdown note in the active slot.
#   2. Press Ctrl+Shift+D. The document dims to ~80% opacity, the
#      cursor changes to a crosshair, and a floating toolbar appears
#      at the top-right of the pane.
#   3. Press Esc. The document returns to full opacity, the toolbar
#      disappears, and the cursor returns to text.
#   4. The .md file is unchanged on disk; no `<note>.shapes.json` is
#      written when the user only entered/exited without drawing.
#
# Pass B — Draw a rectangle:
#   1. Enter shape editor. Press R (rect tool).
#   2. Drag from (200, 200) to (400, 300) on the document. A blue
#      rectangle appears with the drag's bounding box.
#   3. Release. The rect commits. Drag again elsewhere; a second rect
#      appears. Both stay rendered.
#   4. Press Esc to exit. Inspect `<note>.shapes.json` — two rect
#      entries, each with x/y/w/h/rotation/stroke/strokeWidth, fill
#      null. Reopen the note in the editor; the rects render in the
#      same positions as a non-interactable overlay.
#
# Pass C — Draw an ellipse, line, freehand:
#   1. Enter shape editor.
#   2. Press E. Drag — an ellipse fills the dragged bounding box.
#   3. Press L. Drag — a straight line goes from pointerdown to
#      pointerup.
#   4. Press F. Drag a curvy path — the line follows the cursor as a
#      polyline of points (decimated to ~1 point per 4 px to keep
#      file size reasonable).
#   5. Esc. Inspect the sidecar — entries for ellipse, line (with
#      x1/y1/x2/y2 in box-relative coords), and freehand (with a
#      `points: [[x_rel, y_rel], ...]` array).
#
# Pass D — Active color via 1–9 keys:
#   1. Enter shape editor. Press 4 (Mark Red).
#   2. Press R. Draw a rect — its stroke is red.
#   3. Press 3 (Mark Blue). Draw another rect — its stroke is blue.
#   4. Press 8 (Black). Draw a line — its stroke is black.
#   5. The toolbar's color swatches reflect the active color via a
#      ring around the current pick.
#
# Pass E — Transform mode: click-select + corner-resize:
#   1. With existing shapes from Pass B, press T (transform tool).
#   2. Click a rect. The rect gets a dashed bounding box overlay,
#      8 handles (4 corners + 4 edges), and a rotation knob 24 px
#      above the top-center.
#   3. Drag the SE corner handle outward. The rect grows to follow
#      the pointer; the NW corner stays anchored. Live preview.
#   4. Release. The new (x, y, w, h) is the rect's persistent
#      geometry. Reopening transform → the rect renders at the new
#      size with the same anchored NW.
#
# Pass F — Transform mode: edge-resize:
#   1. Pick the same rect. Drag the E (right-edge) handle right by
#      40 px. Width grows by 40, height unchanged. The W edge stays
#      anchored.
#   2. Drag the N edge up by 30 px. Height grows by 30, width
#      unchanged. The S edge stays anchored.
#
# Pass G — Transform mode: rotate via the knob, with Shift snap:
#   1. Pick a rect. Drag the rotation knob ~30° clockwise. The rect
#      rotates around its center; bounding-box dashes follow. Live.
#   2. Hold Shift while dragging — angle snaps to 15° increments (0,
#      15, 30, 45 …).
#   3. Release at 30°. The shape's `rotation` is 30 (or the closest
#      snap when Shift is held).
#
# Pass H — Transform composes with line / freehand:
#   1. Draw a line. Switch to T. Click the line. The bounding box
#      hugs the line's axis-aligned envelope.
#   2. Drag the SE corner. The line scales — both endpoints stretch
#      proportionally to the new bounding box.
#   3. Same for a freehand stroke — every point in `points` scales
#      with the box. Visual: a curve drawn at 200×100 px becomes a
#      proportionally larger curve at 400×200 px without losing its
#      shape.
#
# Pass I — Highlight (fill) mode:
#   1. With shapes drawn, press H (highlight tool). Cursor shows a
#      paint-bucket hint.
#   2. Press 5 (Mark Purple). Click a rect. Its fill goes to purple
#      with ~20% alpha (so the document text underneath stays
#      readable). Stroke stays the original color.
#   3. Click the same rect again with the same color — toggles fill
#      back off (null).
#   4. Click an ellipse with another color — its fill applies. Other
#      shapes' fills unchanged.
#
# Pass J — Delete selected:
#   1. Press T. Click a shape. Press D.
#   2. The shape is removed; the bounding box vanishes; nothing
#      else changes.
#   3. Press Esc → save → reopen the note. The deleted shape is
#      gone from `<note>.shapes.json`.
#
# Pass K — Save and load a template:
#   1. With several shapes drawn on note A, press Ctrl+T. A modal
#      opens prompting for a template name. Type "diagram-1" → Save.
#   2. Modal closes. Inspect `<vault>/.cortex/shape-templates/
#      diagram-1.json` — same shape format as the sidecar, holding
#      every shape currently on note A.
#   3. Switch to note B in the same slot. Enter shape editor (Ctrl+
#      Shift+D). Press Ctrl+Shift+L. A picker shows "diagram-1"
#      with shape count and modified date.
#   4. Click "Load". Every shape from the template appears on note B
#      (additive — existing shapes on B are preserved). The loaded
#      shapes have new ids so they don't collide with future loads.
#   5. Esc to save. `<note-B>.shapes.json` now contains the loaded
#      shapes plus any pre-existing ones on B.
#
# Pass L — Templates: list, delete:
#   1. Save two more templates: "arrow-callout" and "circle-set".
#   2. Open the load picker. The list shows three templates, sorted
#      most-recent first. Each row has a Delete button.
#   3. Delete "arrow-callout". The row vanishes; the file is removed
#      from `.cortex/shape-templates/`. Reopen the picker → only
#      "diagram-1" and "circle-set" remain.
#
# Pass M — Scroll anchoring:
#   1. With several shapes drawn near the top of a long note, scroll
#      the document down so they would be off-screen.
#   2. The shapes scroll out of view with the rest of the content —
#      they're anchored in document coordinates, not viewport.
#   3. Scroll back up — they reappear at their original positions
#      relative to the document text.
#
# Pass N — Non-interactable when not in shape editor:
#   1. Esc out of shape editor. The shapes are still visible.
#   2. Click on a shape — nothing happens; the click falls through
#      to the document. If the click landed on text under a shape,
#      the editor cursor lands at that text position.
#   3. Try to click-and-drag a shape — nothing happens. The shapes
#      are pure visual overlay.
#   4. Re-enter shape editor (Ctrl+Shift+D). The shapes are now
#      interactive again — you can click-select with T, fill with H,
#      etc.
#
# Pass O — Round-trip persistence:
#   1. Draw a shape, Esc, Ctrl+R (reload the note).
#   2. The shape comes back from `<note>.shapes.json` and renders in
#      the same position. Enter shape editor; the shape is editable.
#
# Pass P — Save on Ctrl+S without exiting:
#   1. Enter shape editor. Draw a rect. Without Esc'ing, press Ctrl+
#      S. The sidecar is written (mtime updates on disk).
#   2. Without further edits, Ctrl+S again. The sidecar mtime does
#      NOT bump (idempotent — the JSON content matches disk).
#
# Pass Q — Save on pane blur:
#   1. Open two slots (Ctrl+drag from FileTree to slot 2). Note A in
#      slot 1, note B in slot 2.
#   2. Active = slot 1. Enter shape editor on A. Draw a shape.
#   3. Click on slot 2 to switch active to B. Slot 1's shape editor
#      stays active visually but the active slot is now B. The
#      sidecar for A has been written (slot-1 blur fans the save).
#
# Pass R — No regressions on text editing:
#   1. With shapes visible on a note (not in shape editor), the
#      cursor moves through text normally. Wikilinks / typedBlocks /
#      tables all behave as before.
#   2. Ctrl+S saves the .md file as before — the sidecar is NOT
#      touched if shapes haven't changed (independent dirty flags).
#   3. Editor selection / cursor position is unaffected by the SVG
#      overlay.
#
# Pass S — Multiple shapes, mixed kinds, save round-trip:
#   1. Draw 1 rect, 1 ellipse, 1 line, 1 freehand on a note.
#   2. Color them differently (use 3, 4, 5, 6).
#   3. Highlight-fill the rect with color 2.
#   4. Transform: rotate the ellipse 45°.
#   5. Esc to save. Inspect the sidecar — four entries, each with
#      its kind-appropriate fields. Reload the app entirely. Open
#      the note. All four shapes render in the same positions, with
#      the same colors, with the rect's purple fill, with the
#      ellipse rotated 45°.
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check --quiet
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cluster 20 v1.0)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 20 v1.0 — Shape Editor (Microsoft-Paint mode over markdown notes; rect/ellipse/line/freehand; transform mode with 8 handles + rotation knob; highlight (fill) mode; vault-level templates; sidecar JSON persistence at <note>.shapes.json; non-interactable overlay when not in shape editor)"

Write-Host "==> 4/4  tag cluster-20-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-20-v1.0-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-20-v1.0-complete --force'
