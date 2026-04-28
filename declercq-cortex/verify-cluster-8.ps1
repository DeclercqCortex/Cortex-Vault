# verify-cluster-8.ps1
# Phase 3 Cluster 8 — Idea Log + Methods Arsenal v2 + Protocols subsystem
# (Roadmap deferred)
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install            # NEW: pulls in @tiptap/extension-table-* deps
#   pnpm tauri dev          # smoke-test (see checklists below)
#   .\verify-cluster-8.ps1  # commit + tag
#
# ---------------------------------------------------------------------------
# Smoke test — Idea Log
# ---------------------------------------------------------------------------
#   1. "+ Idea" -> file in 04-Ideas\<name>.md with type:idea, status:raw,
#      date_conceived, related_concepts:[].
#   2. "Ideas" -> Idea Log lists it; status dropdown round-trips to disk.
#   3. Filter by status, sort by status/conceived/title/modified.
#
# ---------------------------------------------------------------------------
# Smoke test — Protocols
# ---------------------------------------------------------------------------
#   1. "+ Protocol" -> modal with Name + Domain. Submit creates
#      06-Protocols\<name>.md with frontmatter:
#        type: protocol
#        domain: "<picked>"
#        duration: ""
#      Body has Purpose / Reagents/Parts List / Steps / Notes sections.
#      The Reagents/Parts List section already contains a markdown table
#      with a header row, separator row, and one empty row.
#   2. Open the file. The Reagents/Parts List section now renders as
#      an actual table (with cell borders, header tint, alternating row
#      shading). Click into the empty data row, type values, press Tab
#      to move to the next cell. Pressing Tab from the last cell of the
#      last row appends a fresh row. Drag the column borders to resize.
#      Add 2-3 rows of reagents, then Ctrl+S to save.
#   3. "Protocols" -> Protocols Log lists the protocol (Domain / Title /
#      Last modified columns).
#
# ---------------------------------------------------------------------------
# Smoke test — Methods (with Protocol auto-feed)
# ---------------------------------------------------------------------------
#   1. "+ Method" -> file in 05-Methods\<name>.md with new sections:
#      Protocols List / Objective / Reagents/Parts List / Steps / Outcome.
#      Frontmatter has type:method, domain, complexity (no last_used).
#   2. Inside the Method file, replace the placeholder under
#      "## Protocols List" with wikilinks to 1-2 protocols you created
#      above:  - [[Protocol A]]
#              - [[Protocol B]]
#      Save (Ctrl+S).
#   3. Close the Method file, then reopen it (click another file then
#      back, or click in the file tree). The Reagents/Parts List section
#      between <!-- REAGENTS-AUTO-START --> and <!-- REAGENTS-AUTO-END -->
#      should now contain a markdown table aggregating all the reagents
#      from the linked protocols, with a "Source protocol" column.
#   4. Edit a protocol's Reagents/Parts table (add a row). Reopen the
#      Method -> the Method's auto-table picks up the new row.
#   5. Wikilink to a protocol that doesn't exist -> the table shows an
#      "Unresolved wikilinks" line listing the unmatched target.
#   6. "Methods" -> Methods Arsenal lists the Method with "Last modified"
#      as a relative time (e.g., "2m ago").

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
    git commit -m "Cluster 8 v2.1.5 - Idea Log + Methods + Protocols + auto-fed reagents + tables (insert/right-click) + text alignment (focus-aware) + bold/italic/underline/strike + sidebar mode highlight"
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-8-v2.1.5-complete" -ForegroundColor Cyan
git tag -f cluster-8-v2.1.5-complete

Write-Host ""
Write-Host "Done. Cluster 8 v2 shipped:" -ForegroundColor Green
Write-Host "  - Idea Log" -ForegroundColor Green
Write-Host "  - Methods Arsenal v2 (mtime instead of last_used; new template)" -ForegroundColor Green
Write-Host "  - Protocols subsystem (atomic units that Methods aggregate from)" -ForegroundColor Green
Write-Host "  - Auto-fed Reagents/Parts tables on Method open" -ForegroundColor Green
Write-Host ""
Write-Host "Research Roadmap remains on the shelf until its trigger fires." -ForegroundColor Green
