# verify-day-1.ps1
# Day 1 — vault picker + persistent config
#
# Run this from PowerShell 7 in the project root:
#   cd "C:\Declercq Cortex\declercq-cortex"
#   .\verify-day-1.ps1
#
# What it does:
#   1. Removes any half-initialised .git directory (left over from Linux side).
#   2. Initialises a fresh git repo.
#   3. Installs the new pnpm dependency (@tauri-apps/plugin-dialog).
#   4. Runs `cargo check` to confirm Rust compiles.
#   5. Stages and commits "Day 1 — vault picker and persistent config".
#
# After it finishes, run `pnpm tauri dev` to actually launch the app.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/5  Cleaning any stale .git directory" -ForegroundColor Cyan
if (Test-Path ".git") {
    # The sandbox left a corrupted .git here. Wipe it.
    Remove-Item -Recurse -Force ".git"
    Write-Host "    removed stale .git/" -ForegroundColor DarkGray
}

Write-Host "==> 2/5  git init" -ForegroundColor Cyan
git init -b main
git config core.autocrlf true
git config user.name  "Gabriel Declercq"
git config user.email "gabrieldeclercq@arizona.edu"

Write-Host "==> 3/5  pnpm install (picks up @tauri-apps/plugin-dialog)" -ForegroundColor Cyan
pnpm install

Write-Host "==> 4/5  cargo check (verifies Rust compiles)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 5/5  Stage and commit" -ForegroundColor Cyan
git add .
git commit -m "Day 1 — vault picker and persistent config"

Write-Host ""
Write-Host "Done. Verify with:" -ForegroundColor Green
Write-Host "    git log --oneline" -ForegroundColor Green
Write-Host "    pnpm tauri dev" -ForegroundColor Green
