# Cluster 12 — Google Calendar Sync (read-only)

*Build order: Phase 3, in flight. Depends on Cluster 11's events schema. Cluster 13 (Outlook) will reuse this OAuth scaffold.*

---

## What this is

One-way sync from Google Calendar into Cortex's local events store. After connecting, Google events appear in Cortex's calendar UI (week + month views), participate in the daily-note splice, and feed the notification bell when their notification mode is set. No write-back: edits in Cortex don't push to Google. New Cortex events stay local.

The user-visible flow:

- Open Integrations Settings (Ctrl+,) → new "Google Calendar" section.
- Paste a `client_id` and `client_secret` from a Google Cloud OAuth client the user creates in their own Google Cloud Console.
- Click "Connect Google Calendar" → browser opens to Google's auth page → user authorises → redirect back to Cortex's local loopback listener → tokens exchanged + stored.
- Picks which calendar (default: primary).
- Initial sync runs immediately. Background re-sync runs every 5 minutes. A "Sync now" button forces a fresh fetch.
- Google-sourced events render with a small "G" badge in the calendar grid and a "Synced from Google — read-only" banner in the edit modal. Save / Delete are disabled; an "Open in Google Calendar" link opens the event in the browser.

## Why we want it

Cluster 11 v1.4 ships a complete local calendar with notifications, but real research workflows have meetings already on a Google calendar — advisor meetings, reading groups, conference deadlines, lab schedules. Forcing the user to mirror those manually defeats the purpose of having a calendar inside Cortex.

The cluster doc 10's original Google Calendar scope was "fetch today's events, dump them as a markdown list into the daily note." That's much narrower than what Cluster 11's surface deserves. With the calendar UI + bell + recurrence engine + per-event notifications all in place, the natural extension is sync, not just summary.

## Why it's deferred

Not deferred — the user picked it now after Cluster 11 v1.4 shipped. The trigger evidence is direct: meetings on Google that should be visible in the bell.

## Decisions already made

- **Read-only Google → Cortex.** Two-way sync (write-back) is a v2.0 candidate. The cluster doc explicitly endorsed read-only as a v1.0 simplification: no conflict resolution, no PATCH calls, no "what if both sides edited the same event" problem. Two-way sync requires a non-trivial conflict-resolution policy (last-write-wins, surface-conflict, or per-field merge); shipping read-only first lets us validate the OAuth + sync engine without that complexity.
- **Hand-rolled OAuth loopback flow.** No `tauri-plugin-oauth` dep. The project's "minimum dependencies" ethos (see Cluster 6's "PDF.js, not PDFium" precedent and Cluster 11's "no calendar library, hand-rolled grid") applies. The loopback flow is ~80 lines of `std::net::TcpListener` + a tiny single-request HTTP parser. We already have `reqwest` for the token exchange.
- **Per-user OAuth credentials.** The user creates their own Google Cloud OAuth client (Cortex doesn't ship a baked-in `client_id`/`client_secret`). This matches the open-source desktop-app convention and avoids:
  - Distributing a single secret that gets revoked for everyone if it leaks.
  - Cortex needing to maintain a Google Cloud project at scale.
  - Privacy concerns about Cortex routing requests through "our" client.
  Setup is ~5 minutes of clicking through Google Cloud Console; the settings UI links to the docs.
- **`source` column on events.** Add `source TEXT DEFAULT 'local'` (NULL → 'local' for backwards-compat) plus `external_id TEXT` and `external_etag TEXT`. Composite index on `(source, external_id)` for upsert speed. Google events get `source = 'google'`, `external_id = google_event_id`. Local events stay `source = 'local'`.
- **Full-fetch with deletion sweep, not incremental sync.** v1.0 fetches all events in a window every poll and DELETEs Google-sourced events not in the response. Google's `syncToken` API enables incremental sync — meaningfully cheaper at scale — but the bookkeeping (storing the token, handling 410-Gone responses, falling back to full sync) is complexity v1.0 doesn't need. v1.1 candidate.
- **`singleEvents=true` for recurrence expansion.** Tell Google to expand recurring instances server-side rather than fetching the master + RRULE and expanding ourselves. Saves us writing a Google-RRULE-to-Cortex-RRULE translator. The downside: per-instance editing (skipping one occurrence in Google) appears as one less expanded instance, which is the right behaviour anyway.
- **Sync window: [now − 30 days, now + 90 days].** Past 30 days for past-due notifications and a small history; +90 days for forward-looking. Configurable in v1.1 if it bites.
- **Sync cadence: startup + every 5 minutes.** Plus a manual "Sync now" button. Google's API limits are generous (1,000,000 queries/day on the default project quota); 5-minute polling is well below that for any single user.
- **Tokens stored in `config.json`.** Same trade-off Cluster 10 made for the GitHub PAT: per-user `%APPDATA%` ACLs, plaintext-on-disk, OS-keychain integration deferred to a future security pass that covers GitHub + Google + Outlook together.
- **Fixed default category `external` for Google events.** Created on first sync if not present. Neutral colour (slate). User can edit colour / label or pick a different category from the modal (read-only enforcement only blocks writes to the field via the calendar UI; the database isn't gated).

## Decisions still open

### What "read-only" means in the UI

v1 enforces read-only at the modal level: when `event.source === 'google'`, all inputs are disabled, Save is replaced by "Open in Google Calendar", Delete is hidden. The calendar week/month grid still allows clicking Google events to open the modal in this read-only mode (so the user can see the description, body, etc.).

### Token refresh

Access tokens expire after 1 hour. On every API call, check `now >= expires_at - 60s`; if so, POST to `oauth2.googleapis.com/token` with `grant_type=refresh_token` to get a fresh access token. Refresh tokens don't expire under normal use; if Google revokes one (user changed password, security event, 6 months of inactivity), the next call returns 401 and we surface a "Re-connect Google Calendar" banner in IntegrationsSettings.

### Multi-calendar selection

v1.0 ships a single-calendar selector defaulting to `primary`. Multi-calendar (sync events from N calendars at once) is a v1.1 candidate. Schema-wise it's just allowing `google_calendar.calendar_ids: Vec<String>` — but the UI has to handle it, and the deletion-sweep logic gets per-calendar.

### Cancelled events

Google flags cancelled events as `status: 'cancelled'`. v1 skips them on insert AND treats existing-but-now-cancelled events as deletions (sweep removes them). This matches user mental model — a cancelled meeting shouldn't haunt the calendar.

### Tentative events

Google's `status: 'tentative'` maps directly to Cortex's `status: 'tentative'`. Visual: existing diagonal-stripe background renders as expected.

### All-day events

Google all-day events have `start.date` (YYYY-MM-DD) instead of `start.dateTime`. Map to `all_day: true`, `start_at` = midnight UTC of that date, `end_at` = midnight UTC of `end.date`. Note: Google's `end.date` is exclusive (a one-day event has `end.date = start.date + 1`); Cortex's `end_at` is conventionally also exclusive, so the mapping is direct.

## Architecture sketch

### Tauri command surface

```rust
// OAuth flow
#[tauri::command]
async fn start_google_oauth(
    client_id: String,
    client_secret: String,
) -> Result<GoogleAuthHandshake, String>;
// Returns { auth_url, port, state } — frontend opens auth_url in browser

#[tauri::command]
async fn await_google_oauth_code(
    port: u16,
    expected_state: String,
) -> Result<String, String>;
// Blocks on the loopback listener; returns the auth code

#[tauri::command]
async fn complete_google_oauth(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
    code: String,
) -> Result<GoogleCalendarConfig, String>;
// Exchanges code for tokens, persists to config.json

// Calendar
#[tauri::command]
async fn list_google_calendars(app: tauri::AppHandle) -> Result<Vec<GoogleCalendarItem>, String>;

#[tauri::command]
async fn sync_google_calendar(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<SyncSummary, String>;

#[tauri::command]
fn disconnect_google_calendar(app: tauri::AppHandle) -> Result<(), String>;

#[tauri::command]
fn get_google_calendar_config(app: tauri::AppHandle) -> Result<Option<GoogleCalendarConfig>, String>;
```

### Loopback OAuth pseudocode

```rust
async fn start_google_oauth(client_id, client_secret) {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let state = random_token();  // 32 bytes hex

    // Stash listener + state in a process-static map keyed by port
    OAUTH_LISTENERS.lock().insert(port, (listener, state.clone()));

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={}&redirect_uri=http://127.0.0.1:{}/callback\
         &response_type=code&scope={}&access_type=offline&prompt=consent\
         &state={}",
        client_id, port,
        url_encode("https://www.googleapis.com/auth/calendar.readonly"),
        state,
    );
    Ok(GoogleAuthHandshake { auth_url, port, state })
}

async fn await_google_oauth_code(port, expected_state) {
    let (listener, state) = OAUTH_LISTENERS.lock().remove(&port)?;
    if state != expected_state { return Err("state mismatch"); }
    // Accept one connection
    let (stream, _) = listener.accept().await?;
    let (code, returned_state) = parse_callback(stream).await?;
    if returned_state != state { return Err("CSRF state mismatch"); }
    write_response(stream, "Authorization complete — you can close this tab.").await?;
    Ok(code)
}

async fn complete_google_oauth(app, client_id, client_secret, code) {
    // POST to https://oauth2.googleapis.com/token
    let resp: TokenResponse = reqwest_post(
        "https://oauth2.googleapis.com/token",
        &[
            ("code", &code),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("redirect_uri", &format!("http://127.0.0.1:{}/callback", port)),
            ("grant_type", "authorization_code"),
        ],
    ).await?;
    // Fetch /userinfo to get email
    let user_email = get_user_email(&resp.access_token).await?;
    let cfg = GoogleCalendarConfig {
        client_id,
        client_secret,
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        expires_at_unix: now() + resp.expires_in,
        calendar_id: "primary".to_string(),
        user_email,
    };
    save_to_vault_config(app, cfg.clone());
    Ok(cfg)
}
```

### Sync engine pseudocode

```rust
async fn sync_google_calendar(app, vault_path) {
    let cfg = get_config(app).google_calendar?;
    let access = ensure_fresh_access_token(cfg).await?;

    let time_min = iso(now() - 30*86400);
    let time_max = iso(now() + 90*86400);
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events\
         ?singleEvents=true&timeMin={}&timeMax={}&maxResults=2500\
         &orderBy=startTime",
        cfg.calendar_id, time_min, time_max,
    );

    let mut all_events = Vec::new();
    let mut page_token = None;
    loop {
        let page_url = match page_token {
            Some(t) => format!("{}&pageToken={}", url, t),
            None => url.clone(),
        };
        let resp: GoogleEventsList = reqwest_get_authed(&page_url, &access).await?;
        all_events.extend(resp.items);
        if let Some(t) = resp.next_page_token { page_token = Some(t); } else { break; }
    }

    let conn = open_or_init_db(&vault_path)?;
    let now = unix_now();
    let mut returned_ids = HashSet::new();

    for ev in &all_events {
        if ev.status == "cancelled" { continue; }
        returned_ids.insert(ev.id.clone());
        let mapped = map_google_to_cortex(ev);
        upsert_google_event(&conn, &mapped, now)?;
    }

    // Sweep: remove Google events no longer in the response.
    delete_orphaned_google_events(&conn, &returned_ids, time_min_unix, time_max_unix)?;

    Ok(SyncSummary {
        total: all_events.len(),
        added, updated, deleted,
        last_sync_iso: iso_now(),
    })
}
```

### Schema migration

```sql
ALTER TABLE events ADD COLUMN source TEXT DEFAULT 'local';     -- 'local' or 'google'
ALTER TABLE events ADD COLUMN external_id TEXT;                -- Google event id when source='google'
ALTER TABLE events ADD COLUMN external_etag TEXT;              -- for change detection
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_external ON events(source, external_id);
```

Idempotent ALTER pattern — fails silently when column already exists.

### Field mapping (Google → Cortex)

| Google                          | Cortex                                  |
|---------------------------------|-----------------------------------------|
| `id`                            | `external_id` (source='google')         |
| `etag`                          | `external_etag`                         |
| `summary` (or "(no title)")     | `title`                                 |
| `start.dateTime` / `start.date` | `start_at` + `all_day`                  |
| `end.dateTime` / `end.date`     | `end_at`                                |
| `description`                   | `body`                                  |
| `status`                        | `status` ('confirmed' / 'tentative')    |
| `htmlLink`                      | (UI: "Open in Google Calendar" link)    |
| `recurringEventId`              | (ignored; instance fetched expanded)    |

`category` is forced to `external` (a default category created on first sync if absent). The user can re-categorise later via the modal — read-only mode only blocks UI writes, so post-sync database changes are fine.

### Auto-sync schedule

- On vault load (after config restore): if `google_calendar` config is present, run `sync_google_calendar`.
- Background timer: every 5 minutes, run `sync_google_calendar`.
- Manual: "Sync now" button in IntegrationsSettings.

The 5-minute timer lives in `App.tsx` as a `useEffect` that bumps an `indexVersion`-style counter, which the calendar component observes.

### Read-only modal enforcement

In `EventEditModal`:

```jsx
if (existingEvent?.source === "google") {
  return (
    <ReadOnlyEventModal
      event={existingEvent}
      onClose={onClose}
      htmlLink={existingEvent.external_html_link}
    />
  );
}
```

`ReadOnlyEventModal` shows the same fields rendered as plain text + a banner "Synced from Google Calendar — edits happen in Google. Last sync: 5m ago."

### What this cluster doesn't include

- **Two-way sync** (write-back from Cortex to Google). v2.0 candidate.
- **Per-instance modification of Google recurring events** (skipping one occurrence in Google appears as a missing instance after the next sync; v2 would surface "this is a Google instance you can't edit" more visibly).
- **Multi-calendar support** (one calendar per connection in v1.0). v1.1.
- **Incremental sync** via `syncToken`. v1.1 if performance bites.
- **Conflict surfacing** for events that exist locally AND in Google with similar metadata. They'll just appear as two separate events in v1.0.
- **Webhook / push notifications** so Cortex updates without polling. Requires a public-facing endpoint; way out of scope for a desktop app.
- **OAuth credentials embedded in Cortex** (we ship none; user provides their own).

## Prerequisites

- Cluster 11 v1.0+ (events schema). v1.4 (notification fields) is even better — Google events with `notify_mode` set propagate to the bell uniformly with local events. The notification UI is unchanged; Google events just have one more field set on them.
- `reqwest` already in Cargo.toml from Cluster 10.

## Triggers to build

The user picked Cluster 12 explicitly after Cluster 11 v1.4 shipped. Trigger satisfied.

## Effort estimate

v1.0: ~4-5 days, six passes.

- Pass 1 (~½ day): schema migration, struct extension, frontend type extension.
- Pass 2 (~1.5 days): OAuth loopback flow + token exchange. The trickiest part because it involves async file IO + reqwest + a TcpListener with a single-request lifecycle.
- Pass 3 (~1 day): sync engine — fetch + map + upsert + deletion sweep + token refresh.
- Pass 4 (~1 day): IntegrationsSettings UI section + Connect / Sync / Disconnect flow.
- Pass 5 (~½ day): auto-sync timer + read-only modal + visual differentiation in the calendar grid.
- Pass 6 (~½ day): verify script, NOTES.md, overview, tag.

If OAuth is finicky (it usually is), Pass 2 expands to 2 days and total ships at 5-6 days.

## What this enables

- **Cluster 13 — Outlook Calendar sync**: reuses the OAuth scaffold (different IdP, same loopback pattern). Roughly 2-day extension if Cluster 12 lands first.
- **Cluster 11 v2.0 two-way sync** (write-back). Add a per-event `pending_push` flag; periodically PATCH local edits up. Conflict resolution policy at v2.0 design time.
- **Cluster 14 (planned-vs-actual analytics)** becomes more useful when external meetings are in the data.
- **Multi-calendar / shared calendars**: v1.1 add `calendar_ids: Vec<String>` to the config.

## Open questions to revisit during build

1. **OAuth scopes.** v1 uses only `https://www.googleapis.com/auth/calendar.readonly`. Adding `userinfo.email` lets us show the connected account in the settings panel — useful for the user to confirm "yes this is the right Google account." Adding `userinfo.profile` lets us show display name. Decide: just email (one extra scope) or profile too.
2. **Where does the OAuth listener live during the auth flow?** Simplest: a process-static `Mutex<HashMap<u16, (TcpListener, String)>>`. The `start_google_oauth` command stashes; `await_google_oauth_code` removes. If the user cancels mid-flow (closes the browser, kills Cortex), the listener stays orphaned — the OS reclaims the port when Cortex exits. Acceptable.
3. **How do we tell Tauri-2 about the loopback listener so it doesn't get sandboxed away?** Tauri 2's CSP and capabilities control fetch from the WebView, not arbitrary TCP from the Rust side. The TcpListener should bind freely. Worth verifying on first run.
4. **Recurring events with exception instances.** Google emits the exceptions as separate single events with `recurringEventId` pointing back. With `singleEvents=true` we just see the expanded instances; the exception logic happens server-side. Confirm.
5. **Time zones.** Google's `dateTime` values are in RFC3339 with explicit offsets. Map to unix seconds (UTC) directly via `chrono`-free parsing or `OffsetDateTime::parse`. Cortex stores UTC; rendering uses the existing `tz_offset_minutes` plumbing.
6. **Rate limiting / backoff.** If a sync hits 403/429, we should pause + retry with exponential backoff. v1.0: log the error and surface in the bell as "couldn't sync"; v1.1 adds proper backoff.
7. **First-sync UX**: a calendar with 500+ events takes a few seconds to fetch. Show a loading indicator in the settings panel during the initial sync; non-blocking for the rest of the app.
