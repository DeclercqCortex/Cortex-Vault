# verify-day-5.ps1
# Week 1 acceptance — format, check, commit, tag week-1-complete.
#
# Run this from PowerShell 7 AFTER the Day 5 acceptance checklist (in
# week-1.md) fully passes. Do not skip the checklist — the trial in Week 4
# exists for a reason and the bar starts here.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   .\verify-day-5.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/5  Prettier on src/" -ForegroundColor Cyan
# --write modifies files in place. Safe on tracked files since we commit
# after. If prettier isn't installed, this step is optional — uncomment
# the install line below if you want it as a devDependency.
# pnpm add -D prettier
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/5  cargo fmt on src-tauri/" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
} finally {
    Pop-Location
}

Write-Host "==> 3/5  cargo check" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 4/5  Stage and commit" -ForegroundColor Cyan
git add .
# If nothing changed (e.g., prettier/cargo fmt were no-ops and you've
# already committed the day's work), `git commit` would fail. Guard it.
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Week 1 complete — foundation: vault, file tree, watcher"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 5/5  Tag week-1-complete" -ForegroundColor Cyan
# -f lets you re-tag if you need to re-run this script. Remove -f if you
# prefer to fail on an existing tag.
git tag -f week-1-complete

Write-Host ""
Write-Host "Done. Week 1 shipped." -ForegroundColor Green
Write-Host "    git log --oneline --decorate" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Week 2 — editor core (TipTap, save, git auto-commit)." -ForegroundColor Green
