# verify-day-2.ps1
# Day 2 — file tree sidebar with read-only navigation
#
# Run from PowerShell 7 in the project root, AFTER you've manually verified
# the app launches and the file tree works correctly:
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # smoke test by hand first
#   .\verify-day-2.ps1      # then commit

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/2  cargo check (verifies Rust compiles)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 2/2  Stage and commit" -ForegroundColor Cyan
git add .
git commit -m "Day 2 — file tree sidebar with read-only navigation"

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "    git log --oneline" -ForegroundColor Green
