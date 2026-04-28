# verify-cluster-1-fixes.ps1
# Cluster 1 patches: focus/visibility autosave + RelatedHierarchyPanel
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # smoke test
#   .\verify-cluster-1-fixes.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/3  Prettier + cargo fmt + cargo check" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"
Push-Location src-tauri
try {
    cargo fmt
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 2/3  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Cluster 1 patches — focus-save + RelatedHierarchyPanel"
} else {
    Write-Host "    (nothing to commit)" -ForegroundColor DarkGray
}

Write-Host "==> 3/3  Done." -ForegroundColor Green
Write-Host "    git log --oneline --decorate" -ForegroundColor Green
