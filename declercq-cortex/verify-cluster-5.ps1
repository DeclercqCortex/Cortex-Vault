# verify-cluster-5.ps1
# Phase 2 Cluster 5 — Color legend overlay
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # smoke-test the legend
#   .\verify-cluster-5.ps1  # commit + tag

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
    git commit -m "Cluster 5 — colour legend overlay"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-5-complete" -ForegroundColor Cyan
git tag -f cluster-5-complete

Write-Host ""
Write-Host "Done. Cluster 5 shipped." -ForegroundColor Green
Write-Host ""
Write-Host "Next: Cluster 4 (::experiment routing) — auto-routes daily-note" -ForegroundColor Green
Write-Host "content into experiment iteration files." -ForegroundColor Green
