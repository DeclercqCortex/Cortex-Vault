# verify-cluster-1.ps1
# Phase 2 Cluster 1 — Projects / Experiments / Iterations
#
# Run after manual validation of the new creation flow:
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # smoke test (see checklist)
#   .\verify-cluster-1.ps1  # commit + tag

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
    git commit -m "Cluster 1 — Projects / Experiments / Iterations"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-1-complete" -ForegroundColor Cyan
git tag -f cluster-1-complete

Write-Host ""
Write-Host "Done. Cluster 1 shipped." -ForegroundColor Green
Write-Host "    git log --oneline --decorate" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Cluster 2 — Mark System foundation." -ForegroundColor Green
