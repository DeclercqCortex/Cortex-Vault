# verify-cluster-3.ps1
# Phase 2 Cluster 3 — Mark System destinations
#
# Run after manual validation:
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # smoke test
#   .\verify-cluster-3.ps1  # commit + tag

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
    git commit -m "Cluster 3 — Mark System destinations (queues + persistent files + pink carryover)"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-3-complete" -ForegroundColor Cyan
git tag -f cluster-3-complete

Write-Host ""
Write-Host "Done. Cluster 3 shipped." -ForegroundColor Green
Write-Host ""
Write-Host "Next on the roadmap: Cluster 5 (color legend overlay) — small," -ForegroundColor Green
Write-Host "ships in half a day. Then Cluster 4 (::experiment routing)," -ForegroundColor Green
Write-Host "Cluster 9 (Strong Inference gate). Advisor mark + view will" -ForegroundColor Green
Write-Host "land as a follow-up to Cluster 3 when needed." -ForegroundColor Green
