# verify-week-4.ps1
# Week 4 — polish + .msi build, ready for the seven-day trial
#
# This script:
#   1. Installs new deps (just in case).
#   2. Formats the codebase.
#   3. Compiles the Rust side cleanly.
#   4. (Optional) builds the .msi installer if -Build is passed.
#   5. Commits and tags week-4-complete.
#
# Note: it does NOT tag phase-1-complete. That tag is reserved for AFTER
# the seven-day trial passes (or you've fixed any issues it surfaced).
#
# Usage:
#   cd "C:\Declercq Cortex\declercq-cortex"
#   .\verify-week-4.ps1            # commit + tag, no installer
#   .\verify-week-4.ps1 -Build     # also runs `pnpm tauri build`

param(
    [switch]$Build
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/5  pnpm install" -ForegroundColor Cyan
pnpm install

Write-Host "==> 2/5  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 3/5  cargo fmt + cargo check" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check
} finally {
    Pop-Location
}

if ($Build) {
    Write-Host "==> 4/5  pnpm tauri build (this can take 5-15 minutes the first time)" -ForegroundColor Cyan
    pnpm tauri build
    Write-Host ""
    Write-Host "Installer outputs:" -ForegroundColor Green
    Write-Host "    src-tauri/target/release/bundle/msi/*.msi" -ForegroundColor Green
    Write-Host "    src-tauri/target/release/bundle/nsis/*.exe" -ForegroundColor Green
} else {
    Write-Host "==> 4/5  Skipping `pnpm tauri build` (pass -Build to include it)" -ForegroundColor DarkGray
}

Write-Host "==> 5/5  Stage, commit, tag" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Week 4 complete — polish, build config, ready for trial"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}
git tag -f week-4-complete

Write-Host ""
Write-Host "Done. Week 4 complete." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT — the seven-day trial. This is the gate the doc writes" -ForegroundColor Yellow
Write-Host "about explicitly. Don't skip it." -ForegroundColor Yellow
Write-Host ""
Write-Host "    1. Copy trial-notes.template.md into your vault as 'trial-notes.md'" -ForegroundColor Green
Write-Host "    2. Use Cortex for ALL research notes for 7 consecutive days." -ForegroundColor Green
Write-Host "    3. Fill in trial-notes.md each evening." -ForegroundColor Green
Write-Host "    4. On day 7, do the retrospective at the bottom." -ForegroundColor Green
Write-Host "    5. Only then tag 'phase-1-complete'." -ForegroundColor Green
