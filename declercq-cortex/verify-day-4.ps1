# verify-day-4.ps1
# Day 4 — filesystem watcher with auto-refresh
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev            # manually smoke-test the watcher
#   .\verify-day-4.ps1        # commit
#
# Note: `cargo check` will recompile notify and friends on first run — expect
# ~30-60s the first time after pulling new imports; subsequent runs are fast.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/2  cargo check" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 2/2  Stage and commit" -ForegroundColor Cyan
git add .
git commit -m "Day 4 — filesystem watcher with auto-refresh"

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "    git log --oneline" -ForegroundColor Green
