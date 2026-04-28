# verify-week-3.ps1
# Week 3 — daily log, FTS5 search, wikilinks, backlinks, command palette
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # manual smoke test against the checklist
#   .\verify-week-3.ps1     # commit + tag

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/5  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/5  cargo fmt on src-tauri/" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
} finally {
    Pop-Location
}

Write-Host "==> 3/5  cargo check (rusqlite + walkdir compile may take a minute)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 4/5  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Week 3 complete — daily log, FTS5 search, wikilinks, backlinks, command palette"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 5/5  Tag week-3-complete" -ForegroundColor Cyan
git tag -f week-3-complete

Write-Host ""
Write-Host "Done. Week 3 shipped." -ForegroundColor Green
Write-Host "    git log --oneline --decorate" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Week 4 — polish (dark mode, shortcuts overlay, .msi build)," -ForegroundColor Green
Write-Host "      then a 7-day daily-driver trial." -ForegroundColor Green
