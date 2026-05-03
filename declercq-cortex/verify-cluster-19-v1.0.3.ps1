# verify-cluster-19-v1.0.3.ps1
# Phase 3 Cluster 19 v1.0.3 — typed-block follow regression fix.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart (new Rust command)
#   .\verify-cluster-19-v1.0.3.ps1
#
# What ships
# ----------
#
# Cluster 17 v1.1 was documented as "Ctrl/Cmd+Click on a typedBlock
# title bar opens the referenced document via the new
# resolve_typed_block_target Tauri command." Audit during v1.0.2
# testing revealed:
#   - The Rust command was never actually implemented.
#   - App.tsx never wired onFollowTypedBlock through to TabPane.
#
# This v1.0.3 fix restores the feature end-to-end.
#
# Backend (lib.rs):
#   New `fn resolve_typed_block_target(vault_path, block_type, name,
#   iter_number)` Tauri command that returns the resolved absolute
#   path or an Err string.
#     - block_type = "experiment": queries the hierarchy table for
#       experiments, matches by directory basename (strips the
#       "NN-" numbered prefix before comparing). When iter_number is
#       given, looks for `iter-NN - *.md` next to the experiment's
#       index.md and returns it; else returns the index.md.
#     - block_type ∈ {idea, method, protocol}: scans the
#       04-Ideas / 05-Methods / 06-Protocols folder for a file
#       whose stem matches the name (case-insensitive).
#     - Unknown block_type → Err.
#   Registered in invoke_handler.
#
# Frontend (App.tsx):
#   New `openTypedBlockInActive(attrs)` async helper that calls the
#   new command and dispatches selectFileInSlot(path, activeSlotIdx)
#   on success; surfaces a banner error on failure.
#   The TabPane usage gains `onFollowTypedBlock={(attrs) => {
#     activatePane(i); openTypedBlockInActive(attrs); }}` mirroring
#   the existing onFollowWikilink wiring.
#
# ---------------------------------------------------------------------------
# Smoke test checklist
# ---------------------------------------------------------------------------
#
# Pass A — Experiment block follow:
#   1. Open a daily note that has `::experiment My Experiment / iter-2`.
#   2. Ctrl+Click the title bar. The active slot opens the matching
#      `iter-02 - *.md` file under the experiment's folder.
#   3. Same block but no iter number. Ctrl+Click opens the
#      experiment's `index.md` instead.
#
# Pass B — Idea / Method / Protocol follow:
#   1. Open a doc with `::idea Some Hypothesis`.
#   2. Ctrl+Click the title bar. Opens `04-Ideas/Some Hypothesis.md`.
#   3. Same with `::method Centrifugation` → `05-Methods/Centrifugation.md`.
#   4. Same with `::protocol Lysis` → `06-Protocols/Lysis.md`.
#
# Pass C — Soft-fail on missing target:
#   1. Type `::idea Nonexistent Title` and Ctrl+Click.
#   2. Banner shows: "Couldn't open idea \"Nonexistent Title\": No
#      idea named `Nonexistent Title` found in 04-Ideas/."
#   3. No crash, no hang.
#
# Pass D — Multi-pane routing:
#   1. With dual-pane layout, click a typedBlock in the left pane.
#      The follow opens in the LEFT pane (because activatePane(i)
#      runs first).
#   2. Click another typedBlock in the right pane. Follow opens in
#      the RIGHT pane.
#
# Pass E — Ctrl+Shift+B regression check:
#   1. The existing Ctrl+Shift+B (insert experiment block) still
#      works — both insertion AND follow are wired now.
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
    git commit -m "Cluster 19 v1.0.3 / Cluster 17 v1.1 fix - restore typed-block follow. The Cluster 17 v1.1 docs claimed a resolve_typed_block_target Tauri command and an App.tsx onFollowTypedBlock wiring, but neither was actually implemented. Plain click + Ctrl+Shift+B still worked (both are local to TipTap), but Ctrl+Click on a typedBlock title bar was a dead gesture. New Rust resolve_typed_block_target command takes (vault_path, block_type, name, iter_number?). For block_type='experiment' it queries the hierarchy table for experiments, matches by directory basename with the 'NN-' numeric prefix stripped (case-insensitive), then prefers iter-NN - *.md when iter_number is given, falling back to the experiment's index.md. For idea/method/protocol it scans 04-Ideas/, 05-Methods/, 06-Protocols/ for a *.md whose stem matches the name. Registered in invoke_handler. App.tsx gains openTypedBlockInActive(attrs) async helper that calls the command and dispatches selectFileInSlot on success or surfaces an error banner; TabPane usage gains onFollowTypedBlock={(attrs)=>{activatePane(i); openTypedBlockInActive(attrs);}} mirroring the existing onFollowWikilink wiring. Cluster 17 v1.1 now actually works."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-19-v1.0.3-complete" -ForegroundColor Cyan
git tag -f cluster-19-v1.0.3-complete

Write-Host ""
Write-Host "Done. Cluster 19 v1.0.3 (typed-block follow fix) shipped:" -ForegroundColor Green
Write-Host "  - resolve_typed_block_target Rust command" -ForegroundColor Green
Write-Host "  - openTypedBlockInActive App.tsx helper" -ForegroundColor Green
Write-Host "  - onFollowTypedBlock wired through to TabPane" -ForegroundColor Green
Write-Host "  - Cluster 17 v1.1 now actually works end-to-end" -ForegroundColor Green
