# verify-cluster-19-v1.2.ps1
# Phase 3 Cluster 19 v1.2 — image polish: crop + orphan-attachments GC + multi-select.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev      # full restart (3 new Tauri commands)
#   .\verify-cluster-19-v1.2.ps1
#
# What ships
# ----------
#
# Closes the v1.0.3 backlog ("orphan-attachments GC, crop/flip controls,
# multi-select"). Flip already shipped in v1.1; v1.2 adds the
# remaining three.
#
# 1) Crop image — NON-DESTRUCTIVE
# -------------------------------
#
# Crop is now stored as four attrs on the cortexImage node — cropX,
# cropY, cropW, cropH (in NATURAL pixels) — and round-trips via
# data-crop-x/y/w/h. The image's `src` never changes; the original
# bytes stay on disk; re-cropping always opens the modal on the
# original. All four must be non-null for the crop to apply
# (defensive partial-set fallback).
#
# Render: when crop is active and the image's natural dimensions
# have loaded, the NodeView wraps `<img>` in a crop-wrapper with
# overflow:hidden and dimensions = (cropW, cropH) at scale; inner img
# is positioned at (-cropX, -cropY) with displayed size = naturalW
# at scale, so only the crop region is visible. Rotation + flip
# transforms move from the <img> to the crop-wrapper so the rotation
# rotates the CROPPED result (matches user mental model "rotate this
# photo I just cropped"), not the full natural image inside the clip
# window.
#
# Modal: CropModal seeds its rect from any existing cropX/Y/W/H attrs
# the host passes via the new `initialCrop` prop. The displayed
# image is always the ORIGINAL, so re-cropping shows where the
# current crop sits and the user can drag to expand outward as well
# as shrink inward. Apply → modal calls back with the new
# {x, y, w, h} rect; the host writes the four attrs. Reset → modal
# calls back with `null`; the host clears the four attrs (image
# reverts to un-cropped). Cancel → close, no change.
#
# The previous `save_cropped_image` Tauri command and the canvas →
# toBlob → bytes path are gone from the frontend (the command is
# still registered in invoke_handler for backwards-compat with any
# notes that reference cropped files written under the destructive
# scheme; those files render normally as plain images). No new files
# are written when a user crops in v1.2.
#
# Composition with other attrs: rotation / flip / wrap / annotation
# carry through unchanged. `width` resets to null on Apply so the
# user-set pixel width (which referenced the previous cropW's
# natural aspect) doesn't carry over confusingly; the new cropped
# image then displays at its natural cropW × cropH until the user
# resizes again.
#
# 2) Orphan-attachments GC
# ------------------------
#
# Backend: `find_orphan_attachments(vault_path)` walks the vault via
# `walkdir::WalkDir`, for each `*.md` file checks its companion
# `<note-stem>-attachments/` directory, and lists files whose
# `<dir-basename>/<file>` relative path doesn't appear as a substring
# in the note's text. Returns `Vec<OrphanAttachment>` with
# note_path / note_relative / attachment_path / attachment_relative /
# file_size. Sort is stable (note_relative ASC, then attachment ASC).
#
# Backend: `delete_orphan_attachment(vault_path, attachment_path)` —
# vault-prefix safety check, then `fs::remove_file`.
#
# Frontend: `OrphanAttachmentsModal` lists the orphans. Each row has
# the note path, the attachment relative path, the file size, and a
# Delete button. After delete, the row is removed from the in-memory
# list. Reload button re-runs the scan.
#
# Triggered: `Ctrl+Shift+O` opens the modal globally (handled in
# App.tsx's keyboard handler, gated behind no-modifier-key conflicts).
# The new shortcut is documented in `ShortcutsHelp`.
#
# Caveat (documented in the modal copy): a freshly-dropped image
# that hasn't been saved yet is technically orphaned (the .md on
# disk doesn't reference it). Save the note before running the GC.
#
# 3) Multi-select on images
# -------------------------
#
# Frontend: `imageMultiSelect` ProseMirror plugin (in
# `src/editor/imageMultiSelect.ts`). State is a `Set<number>` of
# cortexImage positions in the doc. Updated via three meta kinds:
# `toggle`, `clear`, `set`. On every doc change the plugin remaps
# the stored positions through the transaction's mapping and drops
# any that no longer point at a cortexImage node.
#
# Decorations: `Decoration.node` with class
# `cortex-image-multi-selected` on each selected position. The
# NodeView's wrapper picks up the class; CSS in `src/index.css`
# renders the visible ring.
#
# Click handler:
#   - `Alt+click` on a cortexImage toggles its position in the set.
#     Ctrl/Cmd is deliberately NOT bound here — that modifier is the
#     annotation-edit popover trigger from Cluster 19 v1.0.2 and
#     binding multi-select to it would silently steal annotation
#     edits whenever the set was non-empty.
#     IMPLEMENTATION NOTE: the on-image Alt+click toggle is dispatched
#     from CortexImageNodeView's React onClick, NOT from the PM
#     plugin's handleClickOn. Reason: in left/right/break wrap modes
#     the NodeView wrapper carries data-drag-handle (TipTap drag
#     protocol). HTML5 drag-prep on mousedown with Alt held intercepts
#     the click before PM's click pipeline runs, so handleClickOn was
#     silently dropped. The React onClick is a plain DOM click and
#     fires reliably regardless of drag-handle wiring.
#   - plain click on any image (no modifier) clears the set if non-
#     empty and falls through so the default ProseMirror
#     NodeSelection still takes effect
#
# Key handlers:
#   - `Esc` → clear the set (if non-empty), consume
#   - `Delete` / `Backspace` → delete every selected node in reverse
#     position order so position offsets stay valid through the
#     successive transactions, then clear, consume
#
# Sequenced follow-ups (carried for v1.3+):
#   - multi-select-aware operations beyond delete (move / resize /
#     wrap / rotate apply only to the topmost single-selected image
#     in v1.2; drag/resize/rotate handles still hide for multi-select)
#
# Smoke tests
# -----------
#
# Pass A — Crop a JPEG image (non-destructive):
#   1. Insert a JPEG via drag from FileTree or Ctrl+Shift+I.
#   2. Right-click → "Crop image…". The CropModal opens with the
#      ORIGINAL image and a default 10%-inset crop rect.
#   3. Drag a corner handle inward to crop to ~50% of the area. Drag
#      the rect interior to reposition.
#   4. Click Apply. The image in the editor renders only the cropped
#      region. NO new file is written under `<note>-attachments/`;
#      the node's `src` points to the same original file as before.
#      Inspect the saved markdown — `data-crop-x`, `-y`, `-w`, `-h`
#      attributes are now present on the <img> tag.
#
# Pass B — Re-cropping shows the original with the saved rect:
#   1. After Pass A, right-click the cropped image → "Crop image…".
#      The modal opens with the ORIGINAL image (full uncropped) and
#      the crop rect overlay positioned where the current crop is.
#   2. Drag a corner handle OUTWARD past the previous crop edge.
#      The rect can expand back into territory that was previously
#      cropped away — this is the win of non-destructive crop.
#   3. Apply. The image now shows the larger crop region.
#
# Pass C — Reset crop returns to the un-cropped original:
#   1. After any crop is in place, right-click → "Crop image…".
#   2. Click "Reset crop". The modal closes and the image reverts to
#      its original full natural dimensions. The four data-crop-*
#      attrs are gone from the saved markdown.
#
# Pass D — Crop composes with rotate + flip:
#   1. Insert an image. Rotate to 30°. Flip horizontally.
#   2. Right-click → "Crop image…". The modal shows the image
#      un-rotated and un-flipped (the crop is computed in natural
#      image coordinates; rotation/flip apply at render time on the
#      crop-wrapper).
#   3. Crop. The image displays the cropped region rotated 30° and
#      flipped — rotation is around the cropped result's centre.
#
# Pass E — Cancel is a no-op:
#   1. Open CropModal. Drag the crop rect. Click Cancel.
#   2. The image is unchanged.
#
# Pass F — Find orphan attachments after delete-from-note:
#   1. Insert an image. Save. Delete the image node from the editor.
#      Save again.
#   2. Press `Ctrl+Shift+O`. The modal opens, lists the now-orphan
#      attachment with its note path and file size.
#   3. Click Delete on that row. The file is removed from disk; the
#      row disappears from the modal.
#
# Pass G — Find orphan attachments across many notes:
#   1. Create orphans in 2–3 different notes. Run `Ctrl+Shift+O`.
#   2. The modal lists all of them, sorted by note path then
#      attachment relative.
#
# Pass H — Reload re-scans:
#   1. Open the modal. Outside the app, drop a file into a
#      `<note>-attachments/` directory. Click Reload.
#   2. The new file appears in the orphan list (it's not referenced
#      anywhere yet).
#
# Pass I — Vault safety on delete:
#   1. Inspect the modal's network calls. Confirm Delete sends an
#      absolute path under the vault.
#   2. Delete-attachment refuses to act outside the vault prefix
#      (this is a backend check; the modal's UI never lets you point
#      outside the vault, but the safety net is there).
#
# Pass J — Multi-select toggle + delete:
#   1. Insert two images in the same note. Save.
#   2. Alt+click image A. The cortex-image-multi-selected ring
#      appears around it.
#   3. Alt+click image B. Both images now show the ring.
#   4. Press Delete. Both images are removed. The set clears.
#
# Pass K — Multi-select Esc clears:
#   1. Multi-select 1 or more images. Press Esc.
#   2. The rings disappear; the set is cleared. The doc is
#      unchanged.
#
# Pass L — Plain click on an image clears the set:
#   1. Multi-select 2 images. Plain-click (no modifier) on a third
#      image.
#   2. The multi-selection clears; the plain click selects the
#      third image as a normal NodeSelection.
#
# Pass M — Doc-mapping survives undo/insert:
#   1. Multi-select an image. Type some text above it (the image's
#      position shifts).
#   2. The selection ring stays on the same image (positions remap
#      through the transaction).
#   3. Undo. The image is at its earlier position; the ring follows.
#
# Pass N — Multi-select doesn't break single-image affordances:
#   1. With no multi-selection, a normal click on an image still
#      shows the corner handles (rotate / resize / move).
#   2. After Alt-clicking once, the corner handles still work for
#      that single image (multi-select decoration is just a class
#      on the wrapper; doesn't suppress the handles).
#
# Pass O — Crop on a multi-selected image works (single-image path):
#   1. Multi-select two images. Right-click one → "Crop image…".
#   2. The CropModal opens for the right-clicked image only. (Crop
#      is a per-image operation; multi-select doesn't apply here.)
#   3. After Apply, the multi-select set survives — the unchanged
#      image is still in the set; the cropped image was replaced by
#      a new src so it dropped out of the set (the new node has a
#      new pos in the doc-change mapping).
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
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 3/4  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Cluster 19 v1.2 - image polish: non-destructive crop + orphan-attachments GC + multi-select. CROP: stored as four cortexImage node attrs cropX/Y/W/H in NATURAL pixels, round-tripping via data-crop-x/y/w/h (only emitted when set). The image's src never changes; the original bytes stay on disk; re-cropping always opens the modal on the original. NodeView wraps <img> in a crop-wrapper with overflow:hidden + dimensions = (cropW, cropH) at scale; inner img positioned at (-cropX, -cropY) at scale, so only the crop region is visible. Rotation + flip transforms move from <img> to crop-wrapper when cropped, so rotation rotates the cropped result (matches user mental model 'rotate this photo I just cropped'). naturalSize state populated by onLoad on the <img>; until naturalSize is known we render uncropped (no flash of mis-sized box). CropModal repurposed: takes initialCrop seed, displays the ORIGINAL image with the saved rect overlaid as the starting state, calls back with {x,y,w,h} on Apply or null on Reset. Modal Apply does NOT encode bytes — the canvas → toBlob → save_cropped_image path was removed (the v1.2 first draft hit canvas-tainting and was destructive; the rewrite is purely attr-based). On Reset the four crop attrs are cleared. width attr also resets on both Apply and Reset since user-set pixel width referenced a different aspect's natural cropW. The save_cropped_image Tauri command stays registered for backwards-compat with any existing files written under the destructive scheme. ORPHAN GC: new find_orphan_attachments(vault_path) walks the vault via walkdir, for each .md checks its companion <stem>-attachments/ dir, lists files whose <dir-basename>/<file> relative path doesn't appear as a substring in the note's text. New delete_orphan_attachment with vault-prefix safety + fs::remove_file. New OrphanAttachmentsModal lists orphans with note path / attachment relative / file size / per-row Delete + Reload button. Triggered by Ctrl+Shift+O. MULTI-SELECT: new src/editor/imageMultiSelect.ts ProseMirror plugin holds Set<number> of cortexImage positions; meta kinds toggle/clear/set; positions remap through every doc change. Decoration.node with cortex-image-multi-selected class. Alt+click toggles (Ctrl/Cmd is reserved for the annotation-edit popover from v1.0.2; multi-select uses a different modifier so it doesn't steal annotation edits), plain click clears (then falls through to default NodeSelection); Esc clears; Delete/Backspace deletes every selected node in reverse-position order. 15 smoke passes covering crop non-destructive, re-crop shows original with saved rect (can expand outward), reset crop, crop composes with rotate+flip, cancel is no-op, find orphans after delete, find orphans across notes, reload re-scans, vault safety on delete, multi-select toggle+delete, Esc clears, plain click clears, doc-mapping survives undo/insert, multi-select doesn't break single-image affordances, crop on multi-selected works as single-image."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-19-v1.2-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.2-complete

Write-Host ""
Write-Host "Done. Cluster 19 v1.2 shipped:" -ForegroundColor Green
Write-Host "  - Non-destructive crop (cropX/Y/W/H attrs + crop-wrapper render)" -ForegroundColor Green
Write-Host "    Re-cropping shows original; Reset crop clears attrs; no files written" -ForegroundColor Green
Write-Host "  - Orphan-attachments GC (find/delete + Ctrl+Shift+O modal)" -ForegroundColor Green
Write-Host "  - Multi-select (Alt+click toggle, Esc clears, Delete deletes all)" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.3+):" -ForegroundColor DarkGray
Write-Host "  - Multi-select-aware ops beyond delete (move / resize / wrap / rotate)" -ForegroundColor DarkGray
Write-Host "  - Bulk delete in OrphanAttachmentsModal (checkboxes + Delete selected)" -ForegroundColor DarkGray
Write-Host "  - Crop preview thumbnails / aspect-ratio lock" -ForegroundColor DarkGray
