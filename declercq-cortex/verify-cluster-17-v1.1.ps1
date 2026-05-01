# verify-cluster-17-v1.1.ps1
# Phase 3 Cluster 17 v1.1 — Ctrl/Cmd+Click on a typedBlock title navigates
# to the referenced document.
#
# Iterative ship on top of v1.0 (block widget rewrite). v1.0 made the
# block a real custom node with a non-editable title bar but didn't add
# a navigation chord — to find an experiment's iteration, the user had
# to leave the block. v1.1 closes that gap with a single chord on the
# title bar.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart needed (new Rust command)
#   .\verify-cluster-17-v1.1.ps1   # commit + tag
#
# v1.1 ships:
#
#   1. resolve_typed_block_target Tauri command (src-tauri/src/lib.rs).
#      Takes (vaultPath, blockType, name, iterNumber). For experiment
#      blocks, prefers the matching iteration's path (via the
#      hierarchy table) and falls back to the experiment's index file.
#      For protocol/idea/method, delegates to find_typed_target_path.
#      Read-only — no auto-creation of missing files.
#
#   2. Title-bar onClick handler in TypedBlockNodeView. When Ctrl/Cmd
#      is held (and the rename input isn't open), dispatches a
#      `cortex:follow-typed-block` CustomEvent on editor.view.dom
#      with { blockType, name, iterNumber } in detail.
#
#   3. Editor-side listener forwards the event detail to a new
#      onFollowTypedBlock prop. Editor stays free of vault-path
#      knowledge.
#
#   4. App handler invokes the Rust resolver per pane and routes the
#      resolved path through selectFileInSlot. Pane is activated
#      first so the open lands in the right slot.
#
#   5. Hover affordance: title bar gets cursor: pointer and an
#      accent-coloured underline on the title text on hover. Native
#      title attribute reads "Ctrl/Cmd+Click to open the referenced
#      document".
#
#   6. ShortcutsHelp updated with the new chord plus the v1.0
#      right-click block menu (which v1.0 forgot to document).
#
# ---------------------------------------------------------------------------
# Smoke test checklist (in addition to v1.0's checklist)
# ---------------------------------------------------------------------------
#
# Pass A — Ctrl+Click an experiment block with an existing iteration:
#   1. Open a daily note that contains
#      `::experiment SomeExperiment / iter-3 … ::end`, where iter-3.md
#      already exists in the experiment's folder.
#   2. Hover the title bar. Cursor changes to a pointer and the title
#      text gets an underline.
#   3. Hold Ctrl, click anywhere on the title bar (excluding the
#      pencil / trash buttons). The active pane navigates to
#      iter-NN - <date>.md inside the experiment's folder.
#   4. The Reviews / file-tree / palette ALL stay where they were —
#      the navigation lands in the same slot the click originated
#      from.
#
# Pass B — Ctrl+Click an experiment block with NO iteration file yet:
#   1. Insert a fresh `::experiment NewExp / iter-99` block in a daily
#      note. Don't save → no routing has run, no iteration file
#      exists.
#   2. Ctrl+Click the title bar.
#   3. The active pane navigates to the experiment's index file (the
#      `NewExp.md` inside the experiment's folder), NOT iter-99.
#      Verify in the file path bar.
#
# Pass C — Ctrl+Click a protocol / idea / method block:
#   1. Insert `::method MyMethod` and confirm `MyMethod.md` exists
#      under 05-Methods/.
#   2. Ctrl+Click the title.
#   3. Active pane navigates to 05-Methods/MyMethod.md. Same flow
#      for `::idea` and `::protocol`.
#
# Pass D — Ctrl+Click a block whose target doesn't exist anywhere:
#   1. Type `::method "Brand New Method That Doesn't Exist"` in a
#      daily note (no matching file in 05-Methods/).
#   2. Ctrl+Click the title.
#   3. No navigation. The pane stays on the daily note. The browser
#      console logs `[cortex] typedBlock follow: no target found for
#      …`. No toast / no error banner — silent miss is acceptable
#      v1.1 behaviour (the route_typed_blocks save flow already
#      surfaces a "<kind> not found" warning when applicable).
#
# Pass E — Ctrl+Click does NOT fire while Edit name is open:
#   1. Right-click → Edit name on a typed block. Title bar swaps to
#      input(s).
#   2. Hold Ctrl and click inside the input or on the surrounding
#      title bar. Nothing navigates; the input keeps focus. (Verify
#      the click also doesn't disrupt the rename in progress.)
#   3. Press Escape to close the rename. Now Ctrl+Click works again.
#
# Pass F — Plain (no-Ctrl) click on the title is a no-op:
#   1. Click the title bar without Ctrl/Cmd held. Nothing happens —
#      no navigation, no rename open.
#   2. Click the pencil button. Rename opens (existing v1.0 behaviour).
#   3. Click the trash button. Block deletes (existing v1.0 behaviour).
#
# Pass G — Ctrl+Click in a multi-slot layout lands in the SAME slot:
#   1. Open a 2-column layout. Both panes show a daily note that
#      contains an `::experiment Foo / iter-1` block.
#   2. Ctrl+Click the title in the LEFT pane. The left pane navigates
#      to iter-1.md. The right pane is unchanged.
#   3. Repeat in the right pane. Right pane navigates; left is
#      unchanged.
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
    git commit -m "Cluster 17 v1.1 - Ctrl/Cmd+Click on a typedBlock title navigates to the referenced document. NodeView title-bar onClick handler dispatches `cortex:follow-typed-block` CustomEvent on editor.view.dom with { blockType, name, iterNumber } in detail when Ctrl/Cmd is held (and the rename input isn't open). Editor.tsx listens, forwards detail through new onFollowTypedBlock prop. TabPane.tsx pass-through. App.tsx handler activates the originating pane, invokes new resolve_typed_block_target Tauri command (src-tauri/src/lib.rs), routes resolved path through selectFileInSlot. Resolver: for experiment blocks, walks hierarchy table to find experiment's index file then prefers matching iteration path when iterNumber is set, falls back to experiment index when iteration doesn't exist; for protocol/idea/method delegates to find_typed_target_path. Read-only — never auto-creates files (route_experiment_blocks's find_or_create_iteration is the right home for that; clicks shouldn't have side effects). CSS hover affordance: pointer cursor + accent-coloured underline on title text. Native title attribute documents the chord. ShortcutsHelp updated with new Ctrl+Click row plus right-click block menu row that v1.0 forgot to document. Same DOM-event-on-view-dom pattern as v1.0's edit-name signal — pane-local scope, no global emitter."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-17-v1.1-complete" -ForegroundColor Cyan
git tag -f cluster-17-v1.1-complete

Write-Host ""
Write-Host "Done. Cluster 17 v1.1 (Ctrl+Click follow) shipped on top of v1.0:" -ForegroundColor Green
Write-Host "  - Ctrl/Cmd+Click on a typedBlock title bar opens the referenced doc" -ForegroundColor Green
Write-Host "  - Experiments land on the matching iteration when present, else the experiment index" -ForegroundColor Green
Write-Host "  - Protocols/ideas/methods land on the corresponding document" -ForegroundColor Green
Write-Host "  - Hover affordance + native tooltip" -ForegroundColor Green
Write-Host "  - ShortcutsHelp documents the chord + the v1.0 block right-click menu" -ForegroundColor Green
Write-Host ""
Write-Host "🟡 Carried forward from Cluster 16 v1.1.4 (still open):" -ForegroundColor Yellow
Write-Host "  - Cell-height growth on hover for tables without explicit colwidths." -ForegroundColor Yellow
Write-Host "    Workaround: Equalize once. Proper fix → Cluster 18." -ForegroundColor Yellow
Write-Host "  - CORTEX-BLOCK comment markers visible in raw markdown." -ForegroundColor Yellow
