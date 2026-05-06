# verify-cluster-20-v1.1.ps1
# Phase 3 Cluster 20 v1.1 — Shape Editor polish + multi-select + undo.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # frontend-only changes; hot-reload picks them up
#   .\verify-cluster-20-v1.1.ps1
#
# What ships
# ----------
#
# Consolidated post-v1.0 work for the Shape Editor cluster. Every item
# below was iterated under the v1.0 tag during dogfooding; v1.1 is the
# clean ship that bundles them into a single tag.
#
# 1. POINTER-EVENTS POLICY for shapes — pointer-events: 'all' on a
#    shape's bounding box only when the active tool is one that acts
#    on existing shapes (transform / highlight). Draw modes set
#    pointer-events: 'none' on every shape, so clicks on top of
#    existing shapes pass straight through to the SVG canvas and the
#    user can draw a new shape inside / on top of any existing one
#    (Microsoft-Paint draw-over semantics). Inactive mode keeps
#    pointer-events: 'none' too.
#
# 2. SMALLEST-SHAPE PICK in highlight + transform — when several
#    shapes' bounding boxes contain the click point,
#    findSmallestShapeContainingPoint(shapes, pt) returns the smallest
#    by `w*h`. Hit-test is in each shape's local frame (un-rotates
#    around its center) so rotated bboxes are tested correctly. Lets
#    the user reach a small shape nested inside a bigger one even
#    when the bigger one is on top in z-order.
#
#    v1.0.7 refinement — in transform mode, when there's an active
#    multi-selection AND the user plain-clicks (not Ctrl+click), the
#    smallest pick prefers a MEMBER of the set first. Without this
#    preference a non-member smaller shape sitting under the cursor
#    (often via a rotated-shape overhang outside the group's logical
#    bbox) would steal the click and collapse the multi-set, which
#    was the "sometimes dragging multi-selected shapes doesn't work"
#    bug. Ctrl+click still uses the global pick (the user is
#    explicitly modifying the selection there).
#
# 3. Alt + Shift DRAW MODIFIERS for rect / ellipse / line — read live
#    from the pointer event so they take effect mid-drag without
#    lifting the pointer:
#       Shift  → rect/ellipse: square/circle (max(|dx|,|dy|))
#                line: snap end-angle to nearest 45°
#       Alt    → center the shape on the click origin instead of
#                using origin as one corner / endpoint
#       Combo  → centered + constrained
#    Freehand opts out — its geometry IS the cursor path.
#
# 4. MULTI-SELECT in transform mode — `selectedIds: Set<string>`
#    replaces the v1.0 singleton. Three selection rules:
#      - Ctrl/Cmd+Click toggles a shape in/out of the set (no drag
#        starts; the user can keep building up a selection without
#        accidentally moving things).
#      - Plain click on a shape that's already in a multi-set
#        preserves the set and starts a group-move drag from this
#        shape.
#      - Plain click on a shape NOT in the current selection
#        collapses to a single-shape selection and starts a single-
#        shape move drag.
#    Ctrl+click on the group bbox area (v1.0.7) toggles the
#    smallest-containing shape in the multi-set rather than starting
#    a group drag — fixes the case where the bbox rect intercepts
#    Ctrl+clicks intended to refine the selection.
#
# 5. GROUP TRANSFORM (move / resize / rotate) — three new DragKind
#    variants `group-move`, `group-resize`, `group-rotate`. Each
#    snapshots every selected shape at drag start and applies the
#    transform delta to the snapshots:
#      - group-move : every shape's (x, y) translates by (dx, dy).
#      - group-resize : per-shape (x, y, w, h) scale relative to the
#        opposite-corner anchor; per-shape rotation preserved.
#      - group-rotate : each shape's center rotates around the
#        group centroid (computed once at drag start; invariant
#        during rotation), and each shape's individual rotation
#        increments by the same delta. Shift snaps the delta to 15°.
#    GroupSelectionOverlay renders the union bbox + 8 handles +
#    rotation knob. Per-shape thin rings track live shape positions
#    so the user sees each member's transformed location during a
#    drag.
#
# 6. STABLE GROUP-ROTATE FRAME — group-rotate drag state grows
#    `bboxStart` and `currentDelta`. Pointermove updates currentDelta
#    in addition to writing shapes. GroupSelectionOverlay accepts a
#    rotationFrame prop; when set, the outer frame (bbox + handles +
#    knob) renders the snapshot bbox inside a `rotate(delta px py)`
#    transform around the pivot — rigid rotating frame, knob stays
#    at a stable position. Per-shape thin rings still follow live
#    shape positions.
#
# 7. LASSO MULTI-SELECT — empty-canvas drag in transform mode starts
#    a `lasso` DragKind with origin / current / additive. Live
#    dashed rect during drag (pointer-events: none on the rect so
#    SVG keeps receiving pointermove via capture). On pointerup,
#    every shape whose entire bbox is inside the lasso rect is
#    selected. Ctrl+drag is additive; plain drag replaces. <4 px
#    movement falls back to the legacy "click empty → clear" path.
#
# 8. COPY / PASTE — `Ctrl+C` snapshots the current selection into an
#    in-memory clipboard (deep JSON clone so subsequent edits don't
#    mutate it). `Ctrl+V` appends fresh-id duplicates with a 16-px
#    offset and selects them. Toolbar Copy / Paste(N) buttons mirror.
#
# 9. ALIGN + DISTRIBUTE — toolbar buttons visible only when 2+
#    shapes are selected:
#      - 6 alignments: top / middle / bottom / left / center / right
#        (aligning each shape's edge or center to the union bbox).
#      - Distribute H/V: sort by leading edge along the axis,
#        anchor extremes, equal gaps in between. Disabled at <3.
#
# 10. MOVABLE TOOLBAR — header row "Shape editor ⠿" is the drag
#     handle. position: fixed (so the toolbar stays in viewport
#     space regardless of document scroll). Position persisted in
#     localStorage at `cortex:shape-toolbar-position`. Double-click
#     the header to reset to the default top-right pinning.
#     clampToViewport keeps at least a 20-px sliver on screen.
#
# 11. UNDO / REDO — TabPane owns `shapesUndoStack`, `shapesRedoStack`
#     (capped at 100 each, deep-cloned snapshots). pushShapesUndo
#     dedupes back-to-back identical pushes. ShapeEditor calls
#     onPushUndo() at every atomic operation start (draw commit,
#     transform drag start, highlight click, paste, align,
#     distribute, delete). One push per operation — never per
#     intermediate pointermove. Mid-drag Ctrl+Z cancels the in-
#     flight drag first so the next pointermove doesn't re-apply
#     snapshot deltas. Ctrl+Z = undo; Ctrl+Y or Ctrl+Shift+Z = redo.
#     Stacks reset on file change so history is per-file. Template-
#     load also pushes undo (via TabPane directly).
#
# 12. PROGRESSIVE ESC — Esc clears the multi-selection if non-empty;
#     a second Esc exits shape editor. Mirrors Adobe / Figma.
#
# Smoke tests
# -----------
#
# Pass A — Multi-select via Ctrl+Click:
#   1. Open a markdown note, Ctrl+Shift+D, draw 4 rectangles.
#   2. Press T (transform). Ctrl+click rect 1 → ring appears. Ctrl+
#      click rect 2 → both have rings. Ctrl+click rect 1 again →
#      rect 1 deselects. Ctrl+click rects 2, 3, 4 → set = {2,3,4}.
#   3. The group bbox + 8 handles + rotation knob appear around the
#      union of {2,3,4}. Each member also has a thin per-shape
#      dashed ring.
#
# Pass B — Lasso multi-select:
#   1. With 5 shapes scattered, press T, click empty canvas and drag
#      a rectangle that fully encloses 3 of them.
#   2. On release, those 3 shapes are selected. The other 2 are not.
#   3. Plain drag again over a different shape → previous selection
#      is replaced.
#   4. Ctrl+drag a small lasso over a 4th shape → it's added to the
#      existing selection (additive).
#   5. Click empty canvas without dragging — selection clears
#      (legacy behaviour preserved).
#
# Pass C — Group move via plain-click on a member:
#   1. Select 3 shapes (any way). Plain click + drag on any member
#      shape → all 3 shapes translate by the same (dx, dy).
#   2. Release. Each shape's (x, y) reflects the new position.
#
# Pass D — Group resize via handles:
#   1. With 3 shapes selected, drag the SE corner handle outward.
#   2. All 3 shapes scale relative to the NW anchor; (x, y, w, h)
#      change proportionally. Per-shape rotations are preserved.
#   3. Drag the E edge inward — only width scales. Heights unchanged.
#
# Pass E — Group rotation with stable knob:
#   1. With 3 shapes selected, drag the rotation knob ~60° clockwise.
#   2. The bbox + 8 handles + knob form a rigid frame that rotates
#      around the centroid. Knob NEVER jumps to a new bbox edge.
#   3. Per-shape thin rings track each shape's transformed position
#      during the rotation.
#   4. On release, each shape's rotation incremented by ~60° and
#      its center moved correctly around the centroid.
#   5. Hold Shift while rotating — angle snaps to 15° increments.
#
# Pass F — Smallest-pick prefers multi-set members:
#   1. Draw a big rectangle (R). Inside it, draw a small circle (E).
#   2. Press T. Click the big rectangle → it selects. Ctrl+click a
#      separate shape elsewhere to add it to the set (now {rect,
#      other}).
#   3. Plain click anywhere INSIDE the big rectangle that's not on
#      the small circle — the existing multi-set is preserved and
#      a group-move drag starts.
#   4. Plain click DIRECTLY on the small circle (which is NOT a
#      member) — single-shape selection collapses to {circle}, but
#      ONLY because the circle is not in the set; the smallest-pick
#      preference for in-set members chose the rectangle first.
#
# Pass G — Ctrl+click on the group bbox toggles:
#   1. With {rect, other} selected, Ctrl+click the small circle
#      (which is inside the rect's region — the bbox rect intercepts).
#   2. The circle is added to the set: {rect, circle, other}. The
#      group bbox redraws to span the new union.
#   3. Ctrl+click the rect → rect deselects, set = {circle, other}.
#
# Pass H — Copy / Paste:
#   1. Select 3 shapes. Press Ctrl+C.
#   2. Press Ctrl+V — 3 duplicates appear offset 16 px down/right
#      with fresh ids. The duplicates are the new selection.
#   3. Drag the duplicates somewhere. Press Ctrl+V again — another
#      3 duplicates appear with the same offset relative to the
#      ORIGINAL clipboard contents (clipboard is unchanged).
#
# Pass I — Align:
#   1. Select 4 shapes at varying y positions. In the toolbar Align
#      section, click the "⤒" button (Align top). Every shape's
#      top edge snaps to the union bbox's top.
#   2. Click "⇕" (Align horizontal centers). Every shape's center-x
#      lines up at the union bbox's center-x.
#
# Pass J — Distribute H/V:
#   1. Select 4 shapes spread horizontally. Click "Distribute H".
#   2. Leftmost and rightmost stay anchored. Middle shapes
#      reposition to equal gaps.
#   3. With only 2 shapes selected, the Distribute buttons are
#      disabled (no-op).
#
# Pass K — Alt + Shift draw modifiers:
#   1. Press R, hold Shift, drag — the rect stays a square.
#   2. Press E, hold Shift, drag — circle.
#   3. Press L, hold Shift, drag in a slow circle — line snaps to
#      0/45/90/135/180/225/270/315°.
#   4. Press R, hold Alt, drag — rectangle expands symmetrically
#      out from the click origin.
#   5. Press R, hold Alt+Shift, drag — centered square.
#   6. Press F (freehand). Drag with Alt or Shift — neither
#      modifier alters the path.
#
# Pass L — Pass-through in draw modes:
#   1. Draw a big rect. Press R again, drag inside the existing
#      rect — a new rect appears INSIDE the old one. Existing
#      shapes don't intercept clicks in draw mode.
#   2. Press E, drag across the new rect — ellipse straddles it.
#
# Pass M — Undo / Redo:
#   1. Draw 3 shapes. Press Ctrl+Z three times — each disappears
#      in reverse order.
#   2. Press Ctrl+Y three times — they all come back.
#   3. Drag a shape 200 px. Press Ctrl+Z — single-step revert to
#      the pre-drag position (not 200 micro-steps).
#   4. Multi-select 3 shapes, Align top, Ctrl+Z — they revert to
#      their pre-align positions.
#   5. Save template, switch to a different note, load the template,
#      Ctrl+Z — the loaded shapes are removed.
#   6. Mid-drag Ctrl+Z — drag stops and the shape reverts to its
#      pre-drag state.
#   7. Switch files — undo stack resets; the new file has its own
#      history.
#
# Pass N — Movable toolbar:
#   1. Drag the "Shape editor ⠿" header to the bottom-left of the
#      screen. Toolbar follows the cursor.
#   2. Scroll the document down — toolbar stays at its fixed
#      viewport position.
#   3. Esc out of shape editor and back in — toolbar remembers
#      its position.
#   4. Restart the app — position persisted via localStorage.
#   5. Double-click the header — toolbar resets to the default
#      top-right pinning.
#
# Pass O — Smallest-pick in highlight (regression):
#   1. Big rect with small circle inside. Press H, press 4 (Mark
#      Red), click inside the small circle.
#   2. The circle gets the red fill, NOT the rect.
#
# Pass P — Drawing on top of shapes (regression):
#   1. With 5 shapes drawn, press R and drag across the top of
#      multiple existing shapes. A new rect appears spanning them.
#   2. Existing shapes are unaffected.
#
# Pass Q — Sidecar persistence round-trip (regression):
#   1. Draw shapes, transform, highlight, multi-select, align, etc.
#   2. Esc out (saves sidecar). Inspect <note>.shapes.json — every
#      shape's attrs round-trip including rotation, fill, line
#      endpoints, freehand points.
#   3. Reload the note (Ctrl+R) — shapes render in identical
#      positions / colors / rotations.
#
# Pass R — Progressive Esc:
#   1. Multi-select 3 shapes. Press Esc — selection clears, shape
#      editor stays active.
#   2. Press Esc again — shape editor exits and saves.
#
# Pass S — In-flight drag undo:
#   1. Start a group-rotate drag (don't release). While dragging,
#      press Ctrl+Z.
#   2. Drag stops; shapes revert to their pre-drag rotation; further
#      pointermove no longer affects them.
#   3. Pointerup is a no-op.
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

Write-Host "==> 3/4  git commit (cluster 20 v1.1)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 20 v1.1 — Shape Editor polish + multi-select + undo (pointer-events policy, smallest-pick in highlight + transform with multi-set member preference, Alt+Shift draw modifiers, multi-select via Ctrl+Click + lasso, group transform with stable rotation frame, copy/paste, align/distribute, movable toolbar with localStorage, undo/redo, progressive Esc)"

Write-Host "==> 4/4  tag cluster-20-v1.1-complete" -ForegroundColor Cyan
git tag -f cluster-20-v1.1-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-20-v1.1-complete --force'
