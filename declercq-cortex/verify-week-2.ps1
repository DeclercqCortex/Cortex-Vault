# verify-week-2.ps1
# Week 2 — editor core: TipTap, save, frontmatter, git auto-commit, last-open
#
# Run from PowerShell 7 AFTER manual acceptance (see Week 2 checklist):
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install              # pick up @tailwindcss/typography + buffer
#   pnpm tauri dev            # manual smoke test
#   .\verify-week-2.ps1       # format, compile-check, commit, tag

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/6  pnpm install (new deps: @tailwindcss/typography, buffer)" -ForegroundColor Cyan
pnpm install

Write-Host "==> 2/6  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 3/6  cargo fmt on src-tauri/" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
} finally {
    Pop-Location
}

Write-Host "==> 4/6  cargo check (compiles the git2 + new command set)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

Write-Host "==> 5/6  Stage and commit" -ForegroundColor Cyan
git add .
if ((git diff --cached --name-only).Length -gt 0) {
    git commit -m "Week 2 complete — editor core (TipTap, save, frontmatter, git auto-commit)"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 6/6  Tag week-2-complete" -ForegroundColor Cyan
git tag -f week-2-complete

Write-Host ""
Write-Host "Done. Week 2 shipped." -ForegroundColor Green
Write-Host "    git log --oneline --decorate" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Week 3 — daily log, wikilinks, SQLite FTS5 search." -ForegroundColor Green
Write-Host ""
Write-Host "Tip: if you'd rather have per-day commits instead of one Week 2" -ForegroundColor DarkGray
Write-Host "commit, you can stage selectively:" -ForegroundColor DarkGray
Write-Host "    git reset HEAD~1                  # undo the single commit" -ForegroundColor DarkGray
Write-Host "    git add src/components/Editor.tsx" -ForegroundColor DarkGray
Write-Host "    git commit -m 'Day 1 — TipTap read-only editor'" -ForegroundColor DarkGray
Write-Host "    ...etc" -ForegroundColor DarkGray
