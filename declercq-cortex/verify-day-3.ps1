# verify-day-3.ps1
# Day 3 — persist expansion state, add refresh button
#
# Day 3 is frontend-only (no Rust changes), so no cargo check is strictly
# needed — but running it catches any incidental damage from file-moves.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # manual smoke test
#   .\verify-day-3.ps1      # commit

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/2  cargo check (should be a no-op since Day 3 is FE-only)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 2/2  Stage and commit" -ForegroundColor Cyan
git add .
git commit -m "Day 3 — persist expansion state, add refresh button"

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "    git log --oneline" -ForegroundColor Green
