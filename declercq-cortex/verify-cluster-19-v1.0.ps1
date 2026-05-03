# verify-cluster-19-v1.0.ps1
# Phase 3 Cluster 19 v1.0 — Image embeds + ImageViewer.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new Tauri commands + asset protocol)
#   .\verify-cluster-19-v1.0.ps1
#
# What ships
# ----------
#
# Backend (Rust):
#   - tauri.conf.json: app.security.assetProtocol enabled with scope ["**"],
#     so the WebView can render image files via convertFileSrc(...).
#   - New helper note_attachments_dir_for(note_path) returning
#     <parent>/<note-basename>-attachments/.
#   - New Tauri command ensure_note_attachments_dir(vault_path, note_path)
#     idempotently creates the dir, returns its absolute path.
#   - New Tauri command import_image_to_note(vault_path, note_path,
#     source_path) that copies the source file into the attachments
#     dir, dedupes filenames (cat.jpg -> cat-2.jpg if a different file
#     with that name already exists; reuses the existing file when
#     bytes match), and returns the relative path used in <img src="">
#     (forward slashes for portability).
#   - Both commands registered in invoke_handler.
#
# Frontend custom node + NodeView:
#   - src/editor/CortexImageNode.ts: TipTap atom node `cortexImage`
#     with attrs src / wrapMode / freeX / freeY / rotation / width /
#     annotation. parseHTML matches img[data-cortex-image]; renderHTML
#     emits <img> with all data-* attrs so the on-disk markdown stays
#     portable (other editors render the <img>, Cortex re-parses the
#     rich state).
#   - src/components/CortexImageNodeView.tsx: React NodeView. Resolves
#     the relative src against the open note's path (read from
#     editor.storage.cortexImage.notePath) via Tauri's convertFileSrc.
#     Three corner handles on hover: drag (top-left → switches into
#     free wrap mode + tracks freeX/freeY), rotate (top-right → drag
#     around image center, Shift snaps to 5° steps), resize (bottom-
#     right → drag adjusts width, height auto-scales). Ctrl+click
#     dispatches cortex:edit-image-annotation; right-click dispatches
#     cortex:image-context-menu — both bubble up to Editor.tsx.
#   - src/components/ImageAnnotationPopover.tsx: Notion-style popover
#     anchored near the image. Auto-sizing textarea, commits on blur,
#     Esc discards, Ctrl+Enter saves. Annotation stored URL-encoded
#     in data-annotation so newlines / quotes / unicode round-trip.
#   - src/components/ImageContextMenu.tsx: right-click menu. Items:
#     Wrap left / right / break / free; Reset rotation / position /
#     width; Add or Edit annotation; Delete image.
#
# Frontend integration:
#   - src/components/Editor.tsx: registers CortexImage with
#     ReactNodeViewRenderer + addStorage({notePath}); publishes
#     notePath into storage on prop change; listens for the two
#     CustomEvents on view.dom; renders the popover and context
#     menu. New props vaultPath, notePath, onError.
#   - src/components/TabPane.tsx: ActiveView union grows
#     "image-viewer". IMAGE_EXTENSIONS + isImagePath() helper.
#     openPath routes image extensions to ImageViewer (mirrors the
#     PDF branch). New TabPaneHandle methods insertImageFromPath
#     (copies source via import_image_to_note + inserts cortexImage
#     at cursor or drop coords) and insertImageDialog (opens the
#     OS file picker via @tauri-apps/plugin-dialog and dispatches
#     to insertImageFromPath). Editor JSX gains vaultPath +
#     notePath props.
#   - src/components/ImageViewer.tsx: standalone view for opening
#     image files in a tab slot. Renders via convertFileSrc; pan
#     (drag), zoom (+/-/100%/Ctrl+wheel), Fit toggle. Checkerboard
#     background to make transparent PNGs visible.
#   - src/App.tsx: selectFileInSlot's regen-skip regex extended to
#     image extensions. PaneWrapper accepts a new onDropImage
#     callback; when an image cortex-path is dropped INSIDE a
#     .ProseMirror element it routes to the slot's
#     insertImageFromPath; otherwise falls back to the existing
#     onDropPath (which opens the image as a tab via ImageViewer).
#     New Ctrl+Shift+I keyboard shortcut → handle.insertImageDialog.
#   - src/index.css: .cortex-image* classes. Wrap modes via
#     float / display / position absolute. 1×2 px shadow + 1px
#     inset outline for the "glued in a notebook" feel. Three
#     corner handle styles. Annotation badge styling. Ensures
#     .ProseMirror { position: relative } so free-mode absolute
#     positioning works against the editor content area.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Schema + asset protocol:
#   1. With pnpm tauri dev running, open the dev tools console. No
#      errors about "asset:// not allowed" or similar.
#   2. Open a note. Confirm the editor mounts with the new CortexImage
#      extension registered (no console warnings about unknown nodes).
#
# Pass B — Insert via Ctrl+Shift+I:
#   1. Open a markdown note.
#   2. Press Ctrl+Shift+I. The OS file picker opens, filtered to image
#      extensions.
#   3. Pick a .png. The editor inserts the image at the cursor with the
#      "glued paper" shadow. A new <basename>-attachments/ folder
#      appears next to the note in the file tree, containing the
#      copied image.
#
# Pass C — Drag from the FileTree into a note:
#   1. Drag an image file from the sidebar into the body of an open
#      note. Drop it on a paragraph.
#   2. The image is imported (copied into <basename>-attachments/) and
#      inserted at the drop point. If a file with that name already
#      exists with different bytes, the importer dedupes (cat-2.jpg).
#
# Pass D — Wrap modes:
#   1. Right-click an inserted image. Pick "Wrap left". Text on the
#      same paragraph wraps to the right of the image.
#   2. Pick "Wrap right". Wrap flips.
#   3. Pick "Break". Image becomes block-level, text breaks above /
#      below.
#   4. Pick "Free position". Image detaches from the flow; you can
#      drag it (top-left handle) anywhere on the page.
#
# Pass E — Rotation handle:
#   1. Hover an image. The top-right ↻ handle appears.
#   2. Drag it around the image's centre. The image rotates live.
#   3. Hold Shift while dragging — rotation snaps to 5° steps.
#   4. Right-click → Reset rotation. Image returns to 0°.
#
# Pass F — Resize handle:
#   1. Hover an image. The bottom-right ⤡ handle appears.
#   2. Drag it horizontally. The image's width changes; height auto-
#      scales to preserve aspect.
#   3. Right-click → Reset width. Returns to natural max-width:100%.
#
# Pass G — Annotation popover (Ctrl+click):
#   1. Ctrl+click an image. The Image Annotation popover opens
#      below it.
#   2. Type a description. Press Esc — discards. Repeat, then either
#      blur (click outside) or press Ctrl+Enter — saves. A 📝 badge
#      appears at the image's bottom-left.
#   3. Ctrl+click again — popover reopens with the saved text.
#   4. Right-click → Edit annotation also opens the popover.
#
# Pass H — Open image as a tab:
#   1. Click a .jpg in the file tree (no Ctrl). The active slot
#      switches to ImageViewer (mirrors PDF behaviour).
#   2. Pan (drag), zoom (+/-/100%/Ctrl+wheel), Fit toggle work.
#   3. Drag an image into a NON-editor slot (e.g. an empty slot).
#      The slot opens it in ImageViewer.
#
# Pass I — Round-trip on save + reload:
#   1. Insert an image, set wrap=left, rotation=12, width=240,
#      annotation="hello world". Save (Ctrl+S).
#   2. Reload the note (Ctrl+R). All four state fields survive —
#      same wrap, rotation, width, badge present, popover shows
#      same text.
#   3. Inspect the on-disk markdown — the <img> has
#      data-cortex-image="1" plus the data-* attrs.
#
# Pass J — Free positioning persistence:
#   1. Drop an image, switch to Free wrap, drag it to (240, 120).
#      Save + reload. Image still at (240, 120).
#   2. Right-click → Reset position. Image returns to top-left.
#
# Pass K — Delete image:
#   1. Right-click an image → Delete. Image is removed from the
#      doc; if any image was the only thing pointing at the file in
#      attachments/, the file remains on disk (we don't garbage
#      collect attachments in v1.0 — that's a v1.1 follow-up).
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
    git commit -m "Cluster 19 v1.0 - Image support: insertion + manipulation + annotation + ImageViewer. Backend: tauri.conf.json enables app.security.assetProtocol with scope ['**'] so the WebView renders image files via convertFileSrc. New helper note_attachments_dir_for + two Tauri commands (ensure_note_attachments_dir, import_image_to_note) registered in invoke_handler. Imports copy source files into <note-basename>-attachments/ next to the note, dedupe by suffix when a different-content file with the same name exists (or reuse when bytes match), return forward-slash relative path for the <img src=''>. Frontend: new src/editor/CortexImageNode.ts (TipTap atom node 'cortexImage' with attrs src/wrapMode/freeX/freeY/rotation/width/annotation; parseHTML matches img[data-cortex-image]; renderHTML emits <img> with all data-* attrs, riding tiptap-markdown html:true plumbing for portable round-trip). src/components/CortexImageNodeView.tsx (React NodeView; resolves relative src via convertFileSrc + editor.storage.cortexImage.notePath; three corner handles on hover for drag-to-move (switches into free wrap + tracks freeX/freeY), rotate (drag around centre, Shift snaps to 5deg), resize (drag adjusts width, height auto-scales); Ctrl+click and right-click dispatch CustomEvents bubbling up to Editor.tsx). src/components/ImageAnnotationPopover.tsx (auto-sizing textarea, blur/Ctrl+Enter saves, Esc discards, URL-encoded storage). src/components/ImageContextMenu.tsx (Wrap left/right/break/free, Reset rotation/position/width, Add/Edit annotation, Delete). src/components/ImageViewer.tsx (standalone tab view with pan/zoom/fit; checkerboard background for transparency). Editor.tsx registers CortexImage with ReactNodeViewRenderer + addStorage({notePath}); listens for the two CustomEvents; renders popover + menu; new props vaultPath/notePath/onError. TabPane.tsx ActiveView grows 'image-viewer'; new IMAGE_EXTENSIONS + isImagePath helper; openPath routes image files to ImageViewer; new TabPaneHandle methods insertImageFromPath (copies source + inserts cortexImage at cursor or drop coords) and insertImageDialog (opens @tauri-apps/plugin-dialog file picker). App.tsx: selectFileInSlot regen-skip regex extended to image extensions; PaneWrapper accepts onDropImage and routes image cortex-path drops into .ProseMirror to insertImageFromPath, else falls back to opening as a tab; new Ctrl+Shift+I keyboard shortcut. CSS: .cortex-image* with float/block/absolute layout, 1x2 px shadow + 1px inset outline ('glued in a notebook' feel), three corner handle styles, annotation badge, .ProseMirror{position:relative} so free positioning works."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-19-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.0-complete

Write-Host ""
Write-Host "Done. Cluster 19 v1.0 (image embeds) shipped:" -ForegroundColor Green
Write-Host "  - assetProtocol enabled, two new Tauri commands" -ForegroundColor Green
Write-Host "  - cortexImage TipTap node + React NodeView with handles" -ForegroundColor Green
Write-Host "  - Wrap modes: left/right/break/free; rotation; resize" -ForegroundColor Green
Write-Host "  - Ctrl+click annotation popover with 📝 badge" -ForegroundColor Green
Write-Host "  - Right-click context menu" -ForegroundColor Green
Write-Host "  - ImageViewer tab + drag-from-tree-into-editor + Ctrl+Shift+I" -ForegroundColor Green
Write-Host ""
Write-Host "Sequenced follow-ups (v1.1+):" -ForegroundColor DarkGray
Write-Host "  - Garbage collect orphaned attachments" -ForegroundColor DarkGray
Write-Host "  - Crop / flip controls in the right-click menu" -ForegroundColor DarkGray
Write-Host "  - Multi-select images for bulk wrap/rotate" -ForegroundColor DarkGray
