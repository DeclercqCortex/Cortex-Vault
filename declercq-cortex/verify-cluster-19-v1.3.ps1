# verify-cluster-19-v1.3.ps1
# Phase 3 Cluster 19 v1.3 — multi-select-aware ops + bulk delete in
# orphan modal + crop preview thumbnail.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev      # frontend-only changes; hot-reload picks them up
#   .\verify-cluster-19-v1.3.ps1
#
# What ships
# ----------
#
# Closes three of the four v1.2 backlog items (the fourth — drag the
# crop region directly on the image / in-place crop — is deferred to
# v1.4 as a session of its own).
#
# 1) Multi-select-aware ops beyond delete
# ---------------------------------------
#
# In v1.2, multi-select (Alt+click) selected images, but only Delete /
# Backspace acted on the set. Right-click → context menu still acted
# on a SINGLE image — whichever the user right-clicked.
#
# v1.3: when right-clicking an image that is in the active multi-
# selection, the context menu acts on EVERY selected image. The menu
# header shows "N images selected"; per-action behaviour:
#
#   - Wrap left / right / break / free   → set wrap on all
#   - Reset rotation                       → rotation=0 on all
#   - Reset position                       → freeX/freeY=null on all
#   - Reset width                          → width=null on all
#   - Flip horizontal                      → toggle flipH per image
#   - Flip vertical                        → toggle flipV per image
#   - Delete image                         → delete all
#   - Crop image…                          → DISABLED (single-image)
#   - Edit/add annotation…                 → DISABLED (single-image)
#
# The active-dot consensus indicator (the leading "●" next to wrap /
# flip entries) is shown only when ALL images in the set share that
# state. So three images all in `wrap=free` show the dot next to
# "Free position"; a mix shows no dot.
#
# Right-clicking an image that is NOT in the multi-selection drops
# the multi-set and acts on just the right-clicked image — same as
# the v1.2 single-image path. (The user can re-Alt+click their way
# back into a multi-set if they want.)
#
# Implementation:
#
#   - Editor.tsx's `imageMenu` state grows fields to capture the
#     multi-set snapshot at menu-open time:
#
#         {
#           pos: number;           // the right-clicked image
#           multiPositions: number[]; // [pos] in single mode, the
#                                     // sorted multi-set in multi mode
#           x, y, attrs: ...,      // existing
#           multi: {               // null in single mode
#             count: number;
#             allFlipH: boolean;
#             allFlipV: boolean;
#             commonWrap: CortexImageWrap | null; // null when mixed
#             anyRotated: boolean;
#             anyFree: boolean;
#             anyHasWidth: boolean;
#             anyAnnotated: boolean;
#           } | null;
#         }
#
#   - New helper `patchImageAttrsBulk(positions, patchOrFn)`. When
#     called with a static patch, applies it to every position in a
#     single transaction. When called with a function, the function
#     receives each image's current attrs and returns the patch so
#     toggles (flip-h / flip-v) can read per-image state.
#
#   - New helper `deleteImagesBulk(positions)` — deletes in REVERSE
#     position order in a single transaction so offsets stay valid.
#
#   - `handleImageMenuAction` switch statement now uses
#     `imageMenu.multiPositions` instead of `imageMenu.pos` for the
#     bulk-applicable kinds; crop / edit-annotation still use
#     `imageMenu.pos` since they're disabled in multi-mode anyway.
#
#   - `ImageContextMenu.tsx` accepts a new optional `multi` prop.
#     When non-null, renders an "N images selected" section label at
#     the top, suppresses `attrs.rotation` / `attrs.width` hint text
#     (they don't make sense for a heterogeneous set), and disables
#     the crop / edit-annotation entries with a disabled-tooltip.
#
# 2) Bulk delete in OrphanAttachmentsModal
# ----------------------------------------
#
# v1.2 had per-row Delete + a "Delete all" sweep. v1.3 adds a checkbox
# column so the user can select a subset and delete just those.
#
#   - New leftmost column with a per-row checkbox.
#   - Header has a tri-state "Select all" checkbox: checked when all
#     orphans are selected, indeterminate when some, unchecked when
#     none.
#   - Toolbar gains a "Delete selected (N)" button between Refresh
#     and Delete all. Disabled when N === 0. Confirms before
#     deleting; sequences the deletes; surfaces failures.
#   - Per-row Delete button stays for the single-row case.
#
# 3) Crop preview thumbnail
# -------------------------
#
# CropModal grows a small live preview to the right of the main
# image. As the user drags the rect or its corners, the preview
# canvas updates to show what the cropped output will look like.
#
#   - Sized to fit within ~160 × 120 px while preserving the crop
#     rect's natural aspect.
#   - Drawn via `<canvas>.getContext('2d').drawImage(img, sx, sy, sw,
#     sh, 0, 0, dw, dh)` from the loaded `<img>` element.
#   - useEffect redraws on every rect / natural / scale change. No
#     redraw cost when the rect isn't moving.
#   - Header "Preview" label so the panel is self-documenting.
#
# Smoke tests
# -----------
#
# Pass A — Existing multi-select delete still works (regression):
#   1. Insert 3 images in one note.
#   2. Alt+click each — three rings appear.
#   3. Press Delete. All three nodes vanish in a single undo step.
#   4. Ctrl+Z restores all three.
#
# Pass B — Multi-select bulk wrap mode:
#   1. Insert 3 images. Alt+click each.
#   2. Right-click ANY of the three. Menu shows "3 images selected"
#      label at top.
#   3. Click "Wrap left". All three images now wrap-left.
#   4. Reopen the menu (right-click any of them); the dot is next to
#      "Wrap left".
#   5. Right-click → "Free position". All three switch to free; the
#      dot moves to "Free position".
#
# Pass C — Multi-select bulk reset rotation:
#   1. With 3 images in the doc, rotate two of them to 30° / 60°
#      respectively (drag the rotation handle).
#   2. Alt+click all three.
#   3. Right-click → "Reset rotation". All three are now at 0°.
#   4. Reload (Ctrl+R) and confirm the rotations stayed at 0°
#      (round-trip through markdown).
#
# Pass D — Multi-select bulk flip horizontal:
#   1. With 3 images, none flipped initially. Alt+click all three.
#   2. Right-click → "Flip horizontal". All three mirror.
#   3. Right-click again — the leading dot is next to "Flip
#      horizontal" (consensus = all flipped).
#   4. Click "Flip horizontal" again. All three return to identity.
#
# Pass E — Multi-select bulk reset position (free wraps only):
#   1. Insert 3 images, set them all to wrap=free, drag them around.
#   2. Alt+click all three.
#   3. Right-click → "Reset position". All three jump back to their
#      auto-flow positions (freeX / freeY cleared); they're still
#      wrap=free but the editor lays them out from scratch.
#
# Pass F — Consensus indicator hides for heterogeneous state:
#   1. Insert 2 images. Set image A to wrap=left, image B to
#      wrap=break.
#   2. Alt+click both.
#   3. Right-click. The Wrap section has NO leading dot anywhere —
#      the set has mixed wrap, no consensus.
#
# Pass G — Crop and Edit annotation disabled in multi-mode:
#   1. Multi-select 2 images. Right-click. The "Crop image…" entry is
#      disabled (gray, not clickable). "Edit annotation…" / "Add
#      annotation…" likewise disabled.
#   2. Hover the disabled entry — cursor is `not-allowed`. Click is a
#      no-op.
#
# Pass H — Right-click on non-selected image drops the multi-set:
#   1. Insert 3 images. Alt+click images A and B (set = {A, B}).
#   2. Right-click image C (NOT in the set). Menu opens in single
#      mode (no "N images selected" label). The active set has been
#      cleared (rings on A and B vanish).
#   3. Pick "Wrap left". Only image C is affected.
#
# Pass I — Multi-select bulk delete via context menu:
#   1. Insert 3 images. Alt+click all three.
#   2. Right-click → "Delete image". All three are gone.
#   3. Ctrl+Z restores all three.
#
# Pass J — Round-trip: bulk-edited attrs persist on save:
#   1. After Pass D (all three flipped horizontal), save (Ctrl+S).
#   2. Open the .md file in any text editor. All three <img> tags
#      have `data-flip-h="1"`.
#   3. Close + reopen the note in Cortex. All three render flipped.
#
# Pass K — Single-image right-click still works (regression):
#   1. With NO multi-selection active (Esc to clear), right-click an
#      image. Menu opens normally — no "N images selected" label,
#      crop and annotation entries are enabled. Picking any item
#      affects only the right-clicked image.
#
# Pass L — Bulk delete in orphan modal — checkbox column:
#   1. Create 3 orphan attachments (insert images, save, delete from
#      the editor, save again).
#   2. Press Ctrl+Shift+O. Modal lists 3 orphans, each with a
#      checkbox at the leftmost column. All unchecked initially.
#      "Delete selected (0)" button is disabled.
#
# Pass M — Select all → Delete selected:
#   1. With 3 orphans listed, click the header "select all"
#      checkbox. All three rows check; the button reads "Delete
#      selected (3)".
#   2. Click "Delete selected (3)". Confirm dialog: "Delete 3
#      selected orphan attachments?"; click OK.
#   3. All three rows vanish; modal shows "No orphans" empty state.
#
# Pass N — Indeterminate state on partial selection:
#   1. With 3 orphans, click the checkbox on rows 1 and 2 only.
#   2. Header checkbox renders in indeterminate state (visible dash
#      / partial check). Button reads "Delete selected (2)".
#   3. Click the indeterminate header checkbox once → all three
#      check (now full). Click again → all three uncheck. Click
#      again → still no selection (header is a true tri-toggle:
#      none / all / indeterminate is only a visual state).
#
# Pass O — Per-row Delete still works (regression):
#   1. With one orphan listed, click its row Delete. Row vanishes.
#   2. The (still-mounted) modal shows "No orphans".
#
# Pass P — "Delete all" still works (regression):
#   1. With multiple orphans listed and none checked, click "Delete
#      all". Confirm dialog. All orphans deleted.
#
# Pass Q — Crop preview thumbnail updates with rect:
#   1. Right-click an image → "Crop image…". CropModal opens. To the
#      right of the image (or below, depending on width), there's a
#      small "Preview" panel showing the current crop region.
#   2. Drag the rect or a corner. The preview updates in real time
#      to show the new crop region at the same pixel content as the
#      image's center crop area.
#   3. The preview's aspect matches the rect's aspect (e.g. a
#      portrait crop renders portrait in the panel).
#
# Pass R — Crop preview is disabled while image is loading:
#   1. Open Crop modal. Until natural dimensions arrive, the
#      preview shows an empty placeholder (matches the rest of the
#      modal which is "Loading image…").
#
# Pass S — No regressions on existing v1.0–v1.2 features:
#   - Single-image drag/move/rotate/resize handles still appear when
#     the image is selected and not in a multi-set.
#   - Plain click an image (no Alt) clears the multi-set if active
#     and falls through to ProseMirror's NodeSelection (drag/rotate
#     handles reappear on the single image).
#   - Ctrl+click on an image opens the annotation popover. Editing
#     and saving an annotation works.
#   - CropModal Apply / Reset / Cancel still write attrs / clear
#     attrs / no-op respectively.
#   - Orphan modal "Reload" still works.
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

Write-Host "==> 3/4  git commit (cluster 19 v1.3)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 19 v1.3 — multi-select-aware context-menu ops + checkbox-driven bulk delete in orphan modal + live crop preview thumbnail"

Write-Host "==> 4/4  tag cluster-19-v1.3-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.3-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-19-v1.3-complete --force'
