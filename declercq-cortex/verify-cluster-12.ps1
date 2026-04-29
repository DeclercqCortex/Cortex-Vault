# verify-cluster-12.ps1
# Phase 3 Cluster 12 — Google Calendar Sync (read-only) v1.0
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # full restart needed (new Rust commands + schema)
#   .\verify-cluster-12.ps1 # commit + tag
#
# v1.0 scope (per cluster_12_google_calendar_sync.md):
#   - One-way sync from Google Calendar into Cortex's events table.
#   - User provides own Google Cloud OAuth client (no embedded creds).
#   - Hand-rolled loopback OAuth flow (no tauri-plugin-oauth dep).
#   - Background sync every 5 minutes + on startup + manual button.
#   - Read-only enforcement: Google events get a banner in the modal,
#     all inputs disabled, Save/Delete hidden, "Open in Google
#     Calendar" link to event.htmlLink.
#
# v1.0 deliberately defers (per cluster doc):
#   - Two-way sync (write-back). v2.0 candidate.
#   - Multi-calendar selection (single calendar in v1.0). v1.1.
#   - Incremental syncToken-based delta sync. v1.1.
#   - OS keychain for tokens (lives in config.json). Future security pass.
#
# ---------------------------------------------------------------------------
# Setup before smoke-testing
# ---------------------------------------------------------------------------
#
# 1. Open https://console.cloud.google.com/apis/credentials
# 2. Create or pick a project. Enable the Google Calendar API.
# 3. Configure OAuth consent screen → External, add yourself as test user.
# 4. Credentials → Create OAuth client ID → Application type: Desktop app.
# 5. Copy the Client ID + Client Secret.
#
# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------
#
# Pass 1 — Schema migration:
#   1. Open the app. Vault loads. The events table now has source,
#      external_id, external_etag, external_html_link columns. Existing
#      events have source=NULL (treated as 'local' by the readers; create
#      a new event to verify it reads back as source='local').
#
# Pass 2 — OAuth connect flow:
#   1. Ctrl+, → Integrations Settings → Google Calendar section.
#   2. Click "Show setup steps" — the 5-step instructions appear.
#   3. Paste your client_id + client_secret.
#   4. Click "Connect Google Calendar".
#   5. Browser opens to accounts.google.com/o/oauth2/v2/auth with the
#      correct redirect_uri (http://127.0.0.1:<random_port>/callback).
#   6. Authorise.
#   7. Browser shows "Authorisation complete — you can close this tab."
#   8. Cortex's settings panel switches to the connected state showing
#      "Connected · your-email@gmail.com" and the calendar dropdown.
#
# Pass 3 — Sync:
#   1. Click "Sync now". After a couple of seconds the summary line
#      reads "Synced N events: A added, U updated, D removed".
#   2. Open the calendar (sidebar Cal button). Google events appear in
#      the week view with a small "G" badge in the title row, alongside
#      any local events. Same "G" badge in the month view.
#   3. Click a Google event. The modal opens with a banner:
#      "Synced from Google Calendar — read-only. Edits happen in Google.
#       Open in Google Calendar →"
#   4. All inputs are disabled. The Save and Delete buttons are gone;
#      only Close remains.
#   5. Click "Open in Google Calendar". Browser navigates to the
#      event's htmlLink.
#
# Pass 4 — Background auto-sync:
#   1. Add an event in Google Calendar (in your browser).
#   2. Wait up to 5 min for the next auto-sync, OR click "Sync now".
#   3. New event appears in Cortex's calendar.
#   4. Edit the event in Google (move time, change title). Sync. The
#      Cortex copy reflects the change.
#   5. Delete the event in Google. Sync. The event disappears from
#      Cortex's calendar.
#
# Pass 5 — Token refresh:
#   1. Wait an hour OR fast-forward by editing the
#      `expires_at_unix` field in
#      %APPDATA%/declercq-cortex/config.json to a past timestamp.
#   2. Trigger a sync (manual or background). The token is refreshed
#      transparently; the sync still succeeds.
#
# Pass 6 — Disconnect:
#   1. Click "Disconnect" in the settings panel.
#   2. Confirm the prompt.
#   3. The Google Calendar section returns to the not-connected state.
#   4. config.json no longer has a google_calendar block.
#   5. After the next sync (which is a no-op now), the previously
#      Google-sourced events are still visible in the calendar from
#      the last sync — they're not auto-removed on disconnect (the
#      cluster doc accepts this; manual cleanup if desired).
#      [If you want them gone, run the calendar grid's manual
#      "select all + delete" or edit the SQLite directly.
#       Auto-cleanup-on-disconnect is a v1.1 candidate.]
#
# ---------------------------------------------------------------------------
# Edge cases worth touching
# ---------------------------------------------------------------------------
#   a. Cancel the OAuth flow mid-flight (close the browser tab before
#      Google redirects). The await_google_oauth_code call hangs until
#      Cortex restarts. Acceptable for v1; v1.1 candidate to add a
#      timeout. Ctrl+C and re-run pnpm tauri dev to clear.
#   b. Wrong client_secret. complete_google_oauth surfaces "Token
#      exchange returned non-200: ..." with the Google error body.
#   c. Recurring Google event. With singleEvents=true the sync receives
#      already-expanded instances — they appear as separate events in
#      the calendar grid, each with its own start_at.
#   d. All-day Google event. Renders with the all-day visual on the
#      event's date.
#   e. Tentative Google event. Renders with the diagonal-stripe pattern.
#   f. Connect, disconnect, reconnect with the same Google account.
#      The first connect's tokens are cleared on disconnect; reconnect
#      goes through the full OAuth flow again.

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
    git commit -m "Cluster 12 v1.0 - Google Calendar read-only sync. Schema migration: events gains source/external_id/external_etag/external_html_link columns + composite index on (source, external_id). VaultConfig.google_calendar (Option<GoogleCalendarConfig>) holds client_id, client_secret, refresh_token, access_token, expires_at_unix, calendar_id, user_email, last_sync_unix. Hand-rolled loopback OAuth flow (start_google_oauth + await_google_oauth_code + complete_google_oauth) using std::net::TcpListener; no tauri-plugin-oauth dep. Token refresh + ensure_fresh_access_token helper. list_google_calendars (CalendarList API). sync_google_calendar walks /events?singleEvents=true&timeMin=now-30d&timeMax=now+90d, paginates pageToken, upserts by (source='google', external_id) with etag-skip-when-unchanged optimisation, runs deletion sweep on returned_ids. Default 'external' category seeded on first sync. IntegrationsSettings extended with GoogleCalendarSection: client_id/secret inputs with show/hide, collapsible setup-steps help, calendar dropdown, sync-now + last-sync timestamp + sync-summary, disconnect. App.tsx auto-syncs on startup + every 5 min. EventEditModal renders read-only banner + disables all inputs + hides Save/Delete + adds 'Open in Google Calendar' link when event.source === 'google'. Calendar week/month views render a 'G' badge on Google-sourced events. RFC3339 datetime parser + (unix, all_day) mapper for Google's start.dateTime / start.date. Tokens stored in config.json (per-user %APPDATA% ACL); OS-keychain integration deferred to a future security pass."
} else {
    Write-Host "    (nothing to commit; tagging current HEAD)" -ForegroundColor DarkGray
}

Write-Host "==> 4/4  Tag cluster-12-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-12-v1.0-complete

Write-Host ""
Write-Host "Done. Cluster 12 v1.0 (Google Calendar read-only sync) shipped:" -ForegroundColor Green
Write-Host "  - Schema: events.{source, external_id, external_etag, external_html_link}" -ForegroundColor Green
Write-Host "  - Hand-rolled loopback OAuth (no plugin dep)" -ForegroundColor Green
Write-Host "  - Token refresh + 5-min auto-sync + manual Sync now" -ForegroundColor Green
Write-Host "  - Settings panel with Connect / Disconnect / setup steps" -ForegroundColor Green
Write-Host "  - Read-only modal banner + disabled inputs + Open-in-Google link" -ForegroundColor Green
Write-Host "  - 'G' badge on Google events in week + month views" -ForegroundColor Green
Write-Host "  - Cancelled events skipped; deletion sweep removes orphans" -ForegroundColor Green
Write-Host ""
Write-Host "Deferred (v1.1+): two-way sync, multi-calendar, syncToken delta, keychain" -ForegroundColor DarkGray
Write-Host "Cluster 13 (Outlook) will reuse this OAuth scaffold." -ForegroundColor DarkGray
