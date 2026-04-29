# verify-cluster-10.ps1
# Phase 3 Cluster 10 — Integrations: GitHub-only (v1.2)
# Also tags Cluster 6 v1.7 — PDF Ctrl+K single-slot fix.
#
# v1.2 / v1.7 fixups (this round):
#   - Cluster 10 v1.2: GitHub `?since=` now uses local-midnight-today
#     instead of a rolling 24h-from-now window. Three Tauri commands
#     (fetch_github_summary, fetch_github_summary_now,
#     regenerate_github_section) take tz_offset_minutes; cache
#     fingerprint includes the local date so a fresh fetch happens
#     after midnight rollover. Closes "GitHub activity from a day
#     ago appearing in today's daily note."
#   - Cluster 6 v1.7: PDF Ctrl+K works in single-slot layouts again.
#     Root cause was App.tsx passing isActive=false to the only pane
#     (the prop's old definition was `activeSlotIdx === i &&
#     slotCount > 1`) which my v1.6 PDFReader gate then blocked. Now
#     isActive is a pure semantic flag (true for the active pane in
#     either single- or multi-slot), with a separate `multiSlot`
#     prop driving the visual accent outline + slot badge.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install            # picks up nothing new on JS side; Rust has reqwest
#   pnpm tauri dev          # smoke-test (see checklists below)
#   .\verify-cluster-10.ps1 # commit + tag
#
# Cluster 10 v1.1 — GitHub-only. Calendar and Overleaf are left for
# separate clusters once their triggers fire in real use (per the
# cluster doc's explicit "build only what fires" rule).
#
# v1.1 follow-ups vs v1.0:
#   - Recent commits no longer filter by author. The cluster doc spec
#     is "Recent commits (last 24 hours, ACROSS selected repos)" — the
#     ?author= URL parameter was over-filtering, especially in repos
#     where commits are attributed to other identities (CI bots, the
#     web editor, an unverified email on the user's account).
#   - 404 / 401 / 403 responses now produce a user-friendly error
#     hint that calls out the most common cause (private repo + token
#     missing repo scope) instead of a bare "HTTP 404".
#
# Cluster 6 v1.6 follow-ups vs v1.5:
#   - PDFReader's window-level Ctrl+K listener now gates on an
#     `isActive` prop. Multiple PDFs in different slots no longer all
#     toggle their search bubbles when Ctrl+K is pressed; only the
#     active slot's reader reacts.
#   - PDFReader owns its own scroll container. Wrap is now a flex
#     column with overflow: hidden; the pages live in an inner
#     `scrollArea` (flex 1, overflow auto). The search bubble is a
#     sibling of the scrollArea so it pins to the visible viewport
#     instead of scrolling away with the pages.
#   - TabPane's paneRoot uses `overflow: hidden` for PDF view so
#     only the inner page scrollbar shows (no more "outer scrollbar
#     moves when clicking a search hit"). The padding + outline +
#     active-slot logic is unchanged.
#
# ---------------------------------------------------------------------------
# Pass 1 — backend (config + fetch + format)
# ---------------------------------------------------------------------------
#   1. Cargo.toml has reqwest = { version = "0.12", default-features = false,
#      features = ["rustls-tls", "json"] }. First `pnpm tauri dev` after
#      pulling will download reqwest + rustls — give it a minute.
#   2. VaultConfig has an optional `github` block. Existing config.json
#      files load fine (forward-compat via #[serde(default)] on the new
#      field).
#   3. Six new Tauri commands registered: get_github_config,
#      set_github_config, clear_github_config, fetch_github_summary,
#      fetch_github_summary_now, regenerate_github_section.
#
# ---------------------------------------------------------------------------
# Pass 2 — Integrations Settings modal
# ---------------------------------------------------------------------------
#   1. Press Ctrl+, (or click the "GH" sidebar button next to the Reviews
#      menu). Modal opens with a "GitHub" section (configured / not
#      configured status) and a greyed-out "Google Calendar / Overleaf
#      (later)" placeholder.
#   2. Paste a personal access token (classic or fine-grained, repo:read
#      scope is enough). Click "Show" / "Hide" to reveal the field.
#   3. Add one or more repos (owner/name format). "+ Add repo" appends a
#      row; the × button removes a row.
#   4. Click "Save" → "Saved." status appears under the form. Re-open the
#      modal: the token + repos round-trip from %APPDATA%\declercq-cortex
#      \config.json.
#   5. Click "Test connection" with a valid token → after a second or two
#      the result panel shows "OK · 2026-04-28T14:32:00Z" plus a markdown
#      preview of what would be inserted into a daily note.
#   6. Click "Test connection" with an invalid token → the panel shows
#      "Failed" and the error string from GitHub (e.g. "GitHub /user
#      returned HTTP 401 — check your token").
#   7. Click "Disconnect" → confirms, clears token + repos. The modal's
#      status flips to "Not configured."
#
# ---------------------------------------------------------------------------
# Pass 3 — Insert at cursor (Ctrl+Shift+G)
# ---------------------------------------------------------------------------
#   1. Open any note in the editor. Place the cursor where you want the
#      block. Press Ctrl+Shift+G.
#   2. Within ~1s the GitHub summary is inserted as plain-text paragraphs,
#      preceded by a "## Today's GitHub activity" heading. Raw markdown
#      syntax (`**repo**`, `- ` etc.) is visible in the editor.
#   3. Save (Ctrl+S) and reload (Ctrl+R) → the block now renders fully:
#      bold repo names, bullet lists, code-styled SHAs.
#   4. With no token configured: Ctrl+Shift+G inserts a one-line
#      placeholder ("_(no GitHub token configured — open Integrations
#      settings with Ctrl+, to connect)_") at the cursor.
#   5. Network down: the inserted block contains italicised "_(couldn't
#      fetch: ...)_" lines per repo instead of crashing.
#
# ---------------------------------------------------------------------------
# Pass 4 — Auto-populate today's daily note
# ---------------------------------------------------------------------------
#   1. With GitHub configured (token + at least one repo), open today's
#      daily note (Ctrl+D).
#   2. The file gains a "## Today's GitHub activity" section between
#      <!-- GITHUB-AUTO-START --> and <!-- GITHUB-AUTO-END --> markers.
#      Section content matches what the test-connection preview showed.
#   3. Type something else in the daily note, save (Ctrl+S), close, and
#      reopen → the auto-section regenerates. If the GitHub data hasn't
#      changed and you reopen within 10 minutes, the cache prevents a
#      fresh API hit; the file is not rewritten (no spurious git commit).
#   4. Open YESTERDAY'S daily note → the file is NOT modified. Past daily
#      notes stay frozen as the day's snapshot.
#   5. Open today's daily note with NO GitHub configured → the auto-
#      section is not injected (zero footprint until configured).
#
# ---------------------------------------------------------------------------
# Pass 5 — Offline behavior + caching
# ---------------------------------------------------------------------------
#   1. Open today's daily note 5x in a row → only the first call hits the
#      GitHub API. Subsequent opens use the in-process 10-min cache.
#   2. Click "Test connection" → bypasses the cache (calls
#      fetch_github_summary_now) so the user always gets a fresh probe.
#   3. Save the GitHub config with a different token → the user-login
#      cache and the summary cache are both invalidated.
#   4. Disable WiFi, open today's daily note → the file gains an italic
#      "(couldn't fetch: ...)" line. The note is still openable; nothing
#      blocks daily-log work.
#
# ---------------------------------------------------------------------------
# Pass 6 — Discoverability
# ---------------------------------------------------------------------------
#   1. Open ShortcutsHelp (Ctrl+/). Both Ctrl+Shift+G and Ctrl+, are
#      listed under "Always active." The "Settings (later)" placeholder
#      under "Coming later" is gone.
#   2. Sidebar shows the "GH" button next to the existing Reviews menu.
#
# ---------------------------------------------------------------------------
# Manual edge cases worth touching
# ---------------------------------------------------------------------------
#   a. A repo that doesn't exist (or you don't have access to) → that
#      repo's row in the section shows "_(couldn't fetch: ... HTTP 404)_"
#      while other repos still render. One bad repo doesn't kill the
#      section.
#   b. An empty repo → no commits in the last 24h, no error. (GitHub
#      returns 409 on /commits for empty repos; handled as "no commits".)
#   c. Hand-edit the GITHUB-AUTO-START/END markers in today's daily note
#      to swap their order → the regenerator falls through to the
#      heading-insertion path and rebuilds the section under the heading.
#
# ---------------------------------------------------------------------------

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
    git commit -m "Cluster 10 v1.2 + Cluster 6 v1.7 - Cluster 10 v1.2: GitHub `?since=` uses local-midnight-today (not rolling 24h-from-now). New since_local_midnight_today_iso helper. fetch_github_summary, fetch_github_summary_now, regenerate_github_section all accept tz_offset_minutes (signed minutes east of UTC, frontend passes -new Date().getTimezoneOffset()). Cache fingerprint extended with local-today date so cross-day rollover invalidates cache automatically. regenerate_github_section's basename check switched from today_iso_date (UTC) to local_iso_date_for (local). Closes 'GitHub activity from a day ago appearing in today's daily note' report. Cluster 6 v1.7: PDF Ctrl+K works in single-slot layouts again. App.tsx's isActive prop was previously `activeSlotIdx === i && slotCount > 1` (always false in single-slot), and my v1.6 PDFReader gate `if (!isActive) return` was therefore blocking every Ctrl+K press in single-slot mode. Fixed by making isActive a pure semantic flag (`activeSlotIdx === i || slotCount === 1`) and routing the multi-slot visual concerns (accent outline, slot number badge) through a new `multiSlot` prop. Includes prior v1.0/v1.1 work: settings modal, six Tauri commands, daily-note auto-section, Ctrl+Shift+G insert-at-cursor, 10-min cache, reqwest 0.12 rustls, GH sidebar button, drop ?author= over-filter, friendly 404/401/403 hints; PDFReader own-scroll-container restructure, search bubble pinned to wrap, paneRoot overflow:hidden in PDF view."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-10-v1.2-complete + cluster-6-v1.7-complete" -ForegroundColor Cyan
git tag -f cluster-10-v1.0-complete   # keep v1.0 marker as a checkpoint
git tag -f cluster-10-v1.1-complete   # keep v1.1 marker as a checkpoint
git tag -f cluster-10-v1.2-complete
git tag -f cluster-6-v1.6-complete    # keep v1.6 marker as a checkpoint
git tag -f cluster-6-v1.7-complete

Write-Host ""
Write-Host "Done. Cluster 10 v1.2 + Cluster 6 v1.7 shipped:" -ForegroundColor Green
Write-Host "  Cluster 10 v1.0 (foundation):" -ForegroundColor Green
Write-Host "    - VaultConfig.github { token, repos[] } stored in %APPDATA%" -ForegroundColor Green
Write-Host "    - reqwest 0.12 + rustls-tls (no OpenSSL)" -ForegroundColor Green
Write-Host "    - Six Tauri commands (get/set/clear, fetch, fetch-now, regenerate)" -ForegroundColor Green
Write-Host "    - In-process caches: user-login (process lifetime), summary (10 min)" -ForegroundColor Green
Write-Host "    - IntegrationsSettings modal (Ctrl+,)" -ForegroundColor Green
Write-Host "    - Ctrl+Shift+G inserts a fresh GitHub block at cursor" -ForegroundColor Green
Write-Host "    - Auto-section in today's daily note (gated to today only)" -ForegroundColor Green
Write-Host "    - Section-scoped <!-- GITHUB-AUTO-START --> ... <!-- END --> markers" -ForegroundColor Green
Write-Host "    - GH sidebar button + ShortcutsHelp updates" -ForegroundColor Green
Write-Host "    - Calendar / Overleaf deliberately deferred" -ForegroundColor Green
Write-Host "  Cluster 10 v1.1 fixups:" -ForegroundColor Green
Write-Host "    - Recent commits no longer filter by author (cluster doc spec)" -ForegroundColor Green
Write-Host "    - 404 / 401 / 403 produce user-friendly error hints" -ForegroundColor Green
Write-Host "  Cluster 6 v1.6 fixups (landed same session):" -ForegroundColor Green
Write-Host "    - Ctrl+K isActive gate so only the active slot's PDF reacts" -ForegroundColor Green
Write-Host "    - Search bubble pinned to visible viewport (own scrollArea)" -ForegroundColor Green
Write-Host "    - Single scrollbar in PDF view (paneRoot stops scrolling)" -ForegroundColor Green
