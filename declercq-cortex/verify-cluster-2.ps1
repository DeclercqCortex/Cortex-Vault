# verify-cluster-2.ps1
# Phase 2 Cluster 2 — Mark System foundation (color marks)
#
# Run after manual round-trip validation:
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # smoke test (see checklist)
#   .\verify-cluster-2.ps1  # commit + tag

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
    git commit -m "Cluster 2 — Mark System foundation (7 colour marks)"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-2-complete" -ForegroundColor Cyan
git tag -f cluster-2-complete

Write-Host ""
Write-Host "Done. Cluster 2 shipped." -ForegroundColor Green
Write-Host "    git log --oneline --decorate" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Cluster 3 — Mark System destinations (review queues, etc.)" -ForegroundColor Green
Write-Host "      will also bring the advisor ==text== mark." -ForegroundColor Green
