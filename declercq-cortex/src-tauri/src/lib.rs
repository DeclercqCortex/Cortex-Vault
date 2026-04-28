// Cortex — local-first research notebook
//
// Phase 1, Week 1:
//   Day 1: vault picker + persistent config
//   Day 2: file tree (read_vault_tree)
//   Day 4: filesystem watcher (notify)
//
// Phase 1, Week 2:
//   Day 1: read_markdown_file
//   Day 3: write_markdown_file
//   Day 5: git_auto_commit, save_last_open, load_last_open
//
// Phase 1, Week 3:
//   Day 1: ensure_daily_log
//   Day 2: SQLite FTS5 index — index_single_file / rebuild_index /
//          search_notes / list_all_notes / get_backlinks
//
// Phase 2, Cluster 1: Projects / Experiments / Iterations
//   - hierarchy table in the index
//   - create_project / create_experiment / create_iteration commands
//   - list_projects / list_experiments query commands

use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::thread;
use std::time::{Instant, SystemTime};

use git2::{Repository, Signature};
use notify::{RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

// -----------------------------------------------------------------------------
// Persisted configuration
// -----------------------------------------------------------------------------
//
// Lives at  %APPDATA%\declercq-cortex\config.json  on Windows.
// Tauri's `app.path().app_config_dir()` resolves to that location automatically.
//
// We store more than strictly needed for Day 1 so later days don't have to
// migrate the schema:
//   - vault_path: which folder the user picked
//   - last_open_file: which note was open at app close (used in Week 2 Day 5)

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct VaultConfig {
    #[serde(default)]
    vault_path: Option<String>,
    #[serde(default)]
    last_open_file: Option<String>,
    /// Cluster 10 — GitHub integration. Optional so existing config.json
    /// files (pre-Cluster-10) keep loading without migration. Present
    /// when the user has saved a token through the Integrations modal.
    #[serde(default)]
    github: Option<GitHubConfig>,
}

/// Cluster 10 — persisted GitHub integration settings. Stored inside
/// `%APPDATA%\declercq-cortex\config.json` alongside the vault path.
///
/// **Token storage tradeoff.** The cluster doc's recommendation is OS
/// keychain in v2; for Phase 3 simplicity v1 stores the token directly
/// in config.json (file is per-user under %APPDATA% so it inherits
/// user-only ACLs on Windows by default). Documented in NOTES.md.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct GitHubConfig {
    /// Personal access token, classic or fine-grained. Needs `repo`
    /// scope read for the configured repos.
    #[serde(default)]
    token: String,
    /// Repos to watch, "owner/name" format. Order is preserved in the
    /// daily-note section so the user controls what appears first.
    #[serde(default)]
    repos: Vec<String>,
}

/// Returns the absolute path to config.json, creating the parent directory if
/// it doesn't exist yet. We resolve the path through the Tauri AppHandle so we
/// honour the bundle identifier on every OS.
fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create config dir {:?}: {}", dir, e))?;
    Ok(dir.join("config.json"))
}

/// Reads the entire VaultConfig from disk. Missing file returns the default
/// (all-None) config rather than an error — first launch is not a failure.
fn read_config(app: &tauri::AppHandle) -> Result<VaultConfig, String> {
    let path = get_config_path(app)?;
    if !path.exists() {
        return Ok(VaultConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
    // If the file exists but is corrupted, we'd rather start fresh than crash.
    let cfg = serde_json::from_str::<VaultConfig>(&raw).unwrap_or_default();
    Ok(cfg)
}

/// Writes the entire VaultConfig back to disk (pretty-printed for debuggability).
fn write_config(app: &tauri::AppHandle, cfg: &VaultConfig) -> Result<(), String> {
    let path = get_config_path(app)?;
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write config to {:?}: {}", path, e))?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Tauri commands exposed to the frontend
// -----------------------------------------------------------------------------

/// Persist the chosen vault folder. Preserves any other fields already in the
/// config (e.g., last_open_file) so we don't overwrite them.
#[tauri::command]
fn save_vault_config(app: tauri::AppHandle, vault_path: String) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    cfg.vault_path = Some(vault_path);
    write_config(&app, &cfg)
}

/// Load the saved vault path, if any. Returns `None` (not an error) when:
///   - the config file doesn't exist (first launch),
///   - the config file is unreadable / corrupt,
///   - the saved path no longer exists on disk (vault was moved or deleted).
///
/// Returning None on a missing path lets the frontend cleanly show the picker
/// instead of crashing — important for the Week 4 "vault-moved" robustness test.
#[tauri::command]
fn load_vault_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let cfg = read_config(&app)?;
    let Some(path) = cfg.vault_path else {
        return Ok(None);
    };
    if !PathBuf::from(&path).exists() {
        return Ok(None);
    }
    Ok(Some(path))
}

/// Persist which file the user had open at last close so we can reopen it on
/// next launch. Pass `None` to clear.
#[tauri::command]
fn save_last_open(app: tauri::AppHandle, file_path: Option<String>) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    cfg.last_open_file = file_path;
    write_config(&app, &cfg)
}

/// Load the saved last-open file path. Returns `None` if unset or the file has
/// been deleted since last run.
#[tauri::command]
fn load_last_open(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let cfg = read_config(&app)?;
    let Some(path) = cfg.last_open_file else {
        return Ok(None);
    };
    if !PathBuf::from(&path).exists() {
        return Ok(None);
    }
    Ok(Some(path))
}

// -----------------------------------------------------------------------------
// Markdown file IO
// -----------------------------------------------------------------------------

/// Read a markdown file as UTF-8 text.
#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", p.display()));
    }
    fs::read_to_string(&p).map_err(|e| format!("Failed to read file: {}", e))
}

/// Cluster 6: binary file read for PDF rendering. Returns the raw bytes as a
/// `Vec<u8>` which Tauri serialises across the IPC boundary as a JS Number[];
/// the frontend wraps it with `new Uint8Array(arr)` and hands it to PDF.js
/// via `pdfjsLib.getDocument({ data: ... })`.
///
/// The Number[] form is wasteful for large files (~5x size on the wire) but
/// correct. If long PDFs become a performance problem, switch to Tauri's
/// asset protocol (`convertFileSrc`) and let PDF.js fetch over HTTP. Deferred
/// until measured to be necessary.
#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", p.display()));
    }
    fs::read(&p).map_err(|e| format!("Failed to read file: {}", e))
}

// =============================================================================
// Cluster 6 — Annotation sidecars
// =============================================================================
//
// For each PDF at `<vault>/path/to/paper.pdf`, annotations live alongside it
// at `<vault>/path/to/paper.pdf.annotations.json`. Format (matches the spec
// in cluster_06_pdf_reader.md):
//
//   {
//     "version": 1,
//     "pdf_path": "paper.pdf",
//     "annotations": [
//       {
//         "id": "ann-2026-04-28-1",
//         "kind": "yellow",
//         "page": 7,
//         "rects": [{"x": 142.3, "y": 521.7, "w": 230.5, "h": 14.2}],
//         "text": "the highlighted quote here",
//         "note": "optional written note",
//         "created_at": "2026-04-28T14:23:00Z",
//         "resolved": false
//       }
//     ]
//   }
//
// Coordinates are in PDF point space, top-left origin (note: PDFs natively
// use bottom-left, but we convert at write time so JSON consumers can stay
// sane). The frontend converts back when rendering.

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AnnotationRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PdfAnnotation {
    pub id: String,
    /// One of: yellow, green, pink, blue, orange, red, purple
    pub kind: String,
    pub page: i64,
    pub rects: Vec<AnnotationRect>,
    pub text: String,
    #[serde(default)]
    pub note: String,
    pub created_at: String,
    #[serde(default)]
    pub resolved: bool,
    /// Wikilink targets the user has attached to this annotation. Stored
    /// as plain strings ("Note title" or "filename"); resolution happens
    /// in the editor via existing wikilink machinery. Default-empty on
    /// older sidecars.
    #[serde(default)]
    pub linked_notes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AnnotationSidecar {
    pub version: i64,
    pub pdf_path: String,
    pub annotations: Vec<PdfAnnotation>,
}

fn sidecar_path_for(pdf_path: &str) -> PathBuf {
    let mut p = PathBuf::from(pdf_path).into_os_string();
    p.push(".annotations.json");
    PathBuf::from(p)
}

/// Read the sidecar for the given PDF. Returns an empty sidecar (with the
/// pdf_path filled in) if the file does not yet exist — that's the normal
/// state for a freshly-encountered PDF. Errors surface only for genuine
/// I/O or parse failures.
#[tauri::command]
fn read_pdf_annotations(pdf_path: String) -> Result<AnnotationSidecar, String> {
    let sidecar = sidecar_path_for(&pdf_path);
    if !sidecar.exists() {
        return Ok(AnnotationSidecar {
            version: 1,
            pdf_path: PathBuf::from(&pdf_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| pdf_path.clone()),
            annotations: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&sidecar).map_err(|e| {
        format!(
            "Failed to read sidecar at {}: {}",
            sidecar.to_string_lossy(),
            e
        )
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        format!(
            "Sidecar at {} is malformed: {}",
            sidecar.to_string_lossy(),
            e
        )
    })
}

/// Overwrite the sidecar with the given content. Pretty-prints so the file
/// is diff-friendly under git. Empty annotations vec is allowed (and writes
/// the file rather than deleting — keeps the file as a tracked git object).
#[tauri::command]
fn write_pdf_annotations(pdf_path: String, sidecar: AnnotationSidecar) -> Result<(), String> {
    let target = sidecar_path_for(&pdf_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent {:?} for sidecar: {}", parent, e))?;
    }
    let body = serde_json::to_string_pretty(&sidecar)
        .map_err(|e| format!("Failed to serialise sidecar: {}", e))?;
    fs::write(&target, body).map_err(|e| format!("Failed to write sidecar {:?}: {}", target, e))?;
    Ok(())
}

/// Cluster 6 / Pass 7: server-side PDF text extraction. Returns the
/// extracted text on success, or `None` on any failure (encrypted PDF,
/// image-only/scanned PDF, malformed file, library panic). The caller
/// treats `None` as "not searchable" — non-fatal.
///
/// `pdf-extract` can panic on some malformed PDFs in dependency code; we
/// guard with `catch_unwind` so a single bad paper can't take the whole
/// indexer down.
fn extract_pdf_text(file_path: &str) -> Option<String> {
    let path = PathBuf::from(file_path);
    let result = std::panic::catch_unwind(|| pdf_extract::extract_text(&path));
    match result {
        Ok(Ok(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Ok(Err(e)) => {
            eprintln!("[cortex] pdf-extract failed for {}: {}", file_path, e);
            None
        }
        Err(_) => {
            eprintln!(
                "[cortex] pdf-extract PANICKED for {}; indexed without text",
                file_path
            );
            None
        }
    }
}

/// Index a PDF into the same SQLite tables the markdown pipeline uses, so
/// PDF annotations flow into Cluster 3 destination views (weekly review,
/// Anti-Hype, etc.) and PDF text becomes searchable from the command
/// palette.
///
/// What happens, in order:
///   1. Drop existing rows for this path from notes / metadata / marks.
///   2. Compute a title from the file stem (PDFs have no H1 to extract).
///   3. Try to extract text via the `pdf-extract` crate (Pass 7). If it
///      fails (encrypted, scanned, malformed), we still index the file
///      with empty body so Pass 6's mark-population still happens.
///   4. Read the sidecar JSON and write one mark row per annotation.
fn index_pdf_file(vault_path: &str, file_path: &str) -> Result<(), String> {
    let conn = open_or_init_db(vault_path)?;

    // Wipe stale entries.
    conn.execute("DELETE FROM notes WHERE path = ?1", params![file_path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM metadata WHERE path = ?1", params![file_path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM links WHERE source = ?1", params![file_path])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM marks WHERE source_path = ?1",
        params![file_path],
    )
    .map_err(|e| e.to_string())?;

    let title = PathBuf::from(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("PDF")
        .to_string();

    // Pass 7: extract text. extract_pdf_text returns "" on failure rather
    // than propagating, because a non-extractable PDF is not a fatal error.
    let body = extract_pdf_text(file_path).unwrap_or_default();

    // Insert into FTS5 + metadata.
    conn.execute(
        "INSERT INTO notes (path, title, body) VALUES (?1, ?2, ?3)",
        params![file_path, &title, &body],
    )
    .map_err(|e| e.to_string())?;

    let modified = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT OR REPLACE INTO metadata (path, frontmatter, modified) VALUES (?1, ?2, ?3)",
        params![file_path, "{}", modified],
    )
    .map_err(|e| e.to_string())?;

    // Pass 6: read sidecar, populate marks table.
    let sidecar = read_pdf_annotations(file_path.to_string()).unwrap_or(AnnotationSidecar {
        version: 1,
        pdf_path: file_path.to_string(),
        annotations: Vec::new(),
    });

    let now_secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for ann in sidecar.annotations.iter() {
        // The marks table reuses `line_number` for PDF annotations as the
        // page number. Cluster 3 destination views display whatever's in
        // line_number with an "L" prefix; we accept "L7" being shown for
        // a page-7 annotation. Cosmetic; revisit if confusing in practice.
        let context = if ann.note.is_empty() {
            ann.text.clone()
        } else {
            format!("{} — {}", ann.text, ann.note)
        };
        conn.execute(
            "INSERT INTO marks
             (source_path, kind, text, context, line_number, resolved, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                file_path,
                &ann.kind,
                &ann.text,
                &context,
                ann.page,
                if ann.resolved { 1 } else { 0 },
                now_secs,
            ],
        )
        .map_err(|e| e.to_string())?;

        // Cluster 6 v1.2: each annotation's linked notes write a row
        // into the `links` table so the linked note's existing
        // BacklinksPanel surfaces this PDF as a backlink. Targets are
        // stored as the user wrote them (typically the note title);
        // the resolver in get_backlinks already does case-insensitive
        // title-or-filename matching.
        for target in &ann.linked_notes {
            let trimmed = target.trim();
            if trimmed.is_empty() {
                continue;
            }
            conn.execute(
                "INSERT OR IGNORE INTO links (source, target) VALUES (?1, ?2)",
                params![file_path, trimmed],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// =============================================================================
// Cluster 6 / Pass 8 — Reading log block populator
// =============================================================================
//
// Daily notes can contain `::reading 2026-04-28 ::end` blocks that get
// regenerated to a list of all PDF annotations created on that date.
// Mirrors the experiment-block pattern from Cluster 4.
//
// Implementation chooses to walk the vault for sidecar files (rather than
// query the marks table) because:
//   1. The sidecar's annotation `created_at` is the actual user-creation
//      time; the marks table's `created_at` is the indexing time, which
//      can drift by hours.
//   2. We don't depend on indexing having run before this populator does.
//   3. Walk + JSON parse is fast on a vault with <100 PDFs.

const SIDECAR_SUFFIX: &str = ".annotations.json";

/// True when `s` looks like a YYYY-MM-DD prefix (10 chars with dashes
/// at the right places, all-digits otherwise). Strict so "Assembly..."
/// or "today" don't accidentally pass.
fn looks_like_iso_date(s: &str) -> bool {
    if s.len() < 10 {
        return false;
    }
    let bytes = s.as_bytes();
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(|c| c.is_ascii_digit())
        && bytes[5..7].iter().all(|c| c.is_ascii_digit())
        && bytes[8..10].iter().all(|c| c.is_ascii_digit())
}

/// Returns today's date in local time as YYYY-MM-DD. Avoids a chrono
/// dependency by hand-formatting from std::time. Local-vs-UTC drift is
/// inherited from SystemTime::now (which is UTC); for now we accept the
/// possible 1-day offset around midnight.
fn today_iso_date() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days_since_epoch = (secs / 86_400) as i64;
    // Civil-from-days, public-domain algorithm by Howard Hinnant.
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Match modes for the `::reading <arg> ::end` block.
///   - Date: filter by created_at prefix
///   - Pdf:  filter by source PDF stem (case-insensitive substring)
///   - Today: shorthand for today's date
enum ReadingFilter {
    Date(String),
    Pdf(String),
    Today,
}

/// Parse the argument that follows `::reading `. Trims angle brackets,
/// quotes, whitespace, and the HTML entities that `tiptap-markdown`
/// emits when the user types literal `<text>` in the editor (its
/// html-true round-trip escapes those to `&lt;text&gt;` on save).
fn parse_reading_arg(raw: &str) -> ReadingFilter {
    let cleaned = raw
        .trim()
        // Strip HTML entities first — the editor's markdown serializer
        // turns user-typed `<` / `>` into `&lt;` / `&gt;` on save, so by
        // the time we read the file the literal trim_matches passes
        // below would not see angle brackets at all.
        .replace("&lt;", "")
        .replace("&gt;", "")
        .replace("&quot;", "")
        .replace("&amp;", "&")
        .trim()
        .trim_matches('<')
        .trim_matches('>')
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("today") {
        ReadingFilter::Today
    } else if looks_like_iso_date(&cleaned) {
        ReadingFilter::Date(cleaned[..10].to_string())
    } else {
        ReadingFilter::Pdf(cleaned)
    }
}

/// Format a Markdown list of all annotations across the vault matching
/// `arg`. Argument can be a YYYY-MM-DD date, "today", a PDF stem (with
/// or without surrounding angle brackets/quotes), or empty (= today).
fn populate_reading_log_for(vault_path: &str, arg: &str) -> String {
    let filter = parse_reading_arg(arg);
    let today = today_iso_date();
    let date_prefix = match &filter {
        ReadingFilter::Date(d) => d.clone(),
        ReadingFilter::Today => today.clone(),
        ReadingFilter::Pdf(_) => String::new(),
    };

    let mut entries: Vec<(String, PdfAnnotation)> = Vec::new();

    for entry in WalkDir::new(vault_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules")
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path_str = entry.path().to_string_lossy().to_string();
        if !path_str.ends_with(SIDECAR_SUFFIX) {
            continue;
        }
        let raw = match fs::read_to_string(entry.path()) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let sidecar: AnnotationSidecar = match serde_json::from_str(&raw) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let pdf_path = path_str[..path_str.len().saturating_sub(SIDECAR_SUFFIX.len())].to_string();

        // Pre-test the PDF stem once if filtering by PDF; cheap.
        let pdf_stem = PathBuf::from(&pdf_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let pdf_matches = match &filter {
            ReadingFilter::Pdf(needle) => pdf_stem.contains(&needle.to_lowercase()),
            _ => false,
        };

        for ann in sidecar.annotations {
            let keep = match &filter {
                ReadingFilter::Date(_) | ReadingFilter::Today => {
                    ann.created_at.starts_with(&date_prefix)
                }
                ReadingFilter::Pdf(_) => pdf_matches,
            };
            if keep {
                entries.push((pdf_path.clone(), ann));
            }
        }
    }

    if entries.is_empty() {
        return match &filter {
            ReadingFilter::Date(d) => {
                format!("_(no PDF annotations dated {} — yet)_", d)
            }
            ReadingFilter::Today => format!("_(no PDF annotations dated {} — yet)_", today),
            ReadingFilter::Pdf(needle) => {
                format!("_(no PDF annotations matching `{}` — yet)_", needle)
            }
        };
    }

    // Sort by PDF then by page number for stable output.
    entries.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.page.cmp(&b.1.page))
            .then_with(|| a.1.id.cmp(&b.1.id))
    });

    let mut out = String::new();
    for (pdf_path, ann) in entries.iter() {
        let stem = PathBuf::from(pdf_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| pdf_path.clone());
        let snippet = ann.text.replace('\n', " ");
        let note_part = if ann.note.is_empty() {
            String::new()
        } else {
            format!(" — _{}_", ann.note.replace('\n', " "))
        };
        out.push_str(&format!(
            "- **[[{stem}]]** (p. {page}, {kind}): {snippet}{note}\n",
            stem = stem,
            page = ann.page,
            kind = ann.kind,
            snippet = snippet,
            note = note_part
        ));
    }
    out
}

/// Walk the body of a daily note. For each `::reading DATE ::end` block
/// found, replace the inner content with the populated annotation list.
/// Pass-through for any other content. Returns the rewritten body.
fn process_reading_blocks(body: &str, vault_path: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("::reading ") {
            // Header line — keep as-is, capture the date.
            let date_iso = rest.trim().to_string();
            out.push_str(line);
            out.push('\n');

            // Find the matching ::end.
            let mut j = i + 1;
            while j < lines.len() && !lines[j].trim_start().starts_with("::end") {
                j += 1;
            }
            // Replace body with populated content.
            let populated = populate_reading_log_for(vault_path, &date_iso);
            out.push_str(populated.trim_end());
            out.push('\n');

            if j < lines.len() {
                out.push_str(lines[j]);
                out.push('\n');
                i = j + 1;
            } else {
                out.push_str("::end\n");
                i = j;
            }
        } else {
            out.push_str(line);
            out.push('\n');
            i += 1;
        }
    }
    // Preserve trailing newline state — body.ends_with('\n') tells us.
    if !body.ends_with('\n') {
        // Strip the synthetic trailing newline we added on the last line.
        if out.ends_with('\n') {
            out.pop();
        }
    }
    out
}

/// Populate any `::reading DATE ::end` blocks in the given daily note.
/// Idempotent — a no-op if no blocks are present, and a no-op when the
/// computed content matches what's already on disk (saves git commits).
#[tauri::command]
fn populate_reading_log(vault_path: String, daily_note_path: String) -> Result<(), String> {
    let raw = match fs::read_to_string(&daily_note_path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let new = process_reading_blocks(&raw, &vault_path);
    if new != raw {
        fs::write(&daily_note_path, new).map_err(|e| e.to_string())?;
        index_single_file(vault_path, daily_note_path)?;
    }
    Ok(())
}

/// Write a markdown file, replacing any existing contents atomically enough
/// for our needs (std::fs::write → OS-level write-truncate; good enough for
/// a single-user local app). Creates parent directories if missing, which
/// lets Week 3's new-from-wikilink flow work uniformly.
#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent {:?}: {}", parent, e))?;
    }
    fs::write(&p, content).map_err(|e| format!("Failed to write file: {}", e))
}

// -----------------------------------------------------------------------------
// Git auto-commit
// -----------------------------------------------------------------------------
//
// Every save in the app eventually (debounced on the frontend at 30s)
// becomes a commit in the vault's git history. The vault itself is a
// git repo distinct from the project's repo.
//
// On first call we init the vault as a repo. On subsequent calls we
// reuse it. If the user already version-controls their vault manually,
// we just commit into their existing repo.

#[tauri::command]
fn git_auto_commit(vault_path: String, file_path: String) -> Result<String, String> {
    let repo_path = PathBuf::from(&vault_path);
    let file_path_buf = PathBuf::from(&file_path);

    // Convert the file path into a repo-relative, forward-slashed path
    // (git's internal convention even on Windows).
    let relative = file_path_buf
        .strip_prefix(&repo_path)
        .map_err(|_| "File is not inside vault".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    // Open existing repo or create one.
    let repo = match Repository::open(&repo_path) {
        Ok(r) => r,
        Err(_) => {
            Repository::init(&repo_path).map_err(|e| format!("Failed to init repo: {}", e))?
        }
    };

    // Stage the file.
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_path(Path::new(&relative))
        .map_err(|e| format!("Failed to add file: {}", e))?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    // Author/committer: prefer git config, fall back to Cortex defaults so a
    // brand-new vault with no git config still commits successfully.
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Cortex", "cortex@local"))
        .map_err(|e| format!("Failed to create signature: {}", e))?;

    // Parent commit if HEAD exists. In a fresh repo, HEAD points to an
    // unborn branch and head() returns Err — we commit with no parents.
    let parent_commit = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|oid| repo.find_commit(oid).ok());
    let parents: Vec<&git2::Commit> = match parent_commit.as_ref() {
        Some(c) => vec![c],
        None => vec![],
    };

    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let msg = format!("Auto-commit {} at {}", relative, timestamp);

    let commit_id = repo
        .commit(Some("HEAD"), &sig, &sig, &msg, &tree, &parents)
        .map_err(|e| format!("Commit failed: {}", e))?;

    Ok(commit_id.to_string())
}

// -----------------------------------------------------------------------------
// File tree
// -----------------------------------------------------------------------------
//
// FileNode is a tagged enum that round-trips cleanly to TypeScript as a
// discriminated union: `{ "type": "file" | "folder", ... }`. The frontend
// can `switch` on `node.type` and TS narrows the type appropriately.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
enum FileNode {
    #[serde(rename = "file")]
    File { name: String, path: String },
    #[serde(rename = "folder")]
    Folder {
        name: String,
        path: String,
        children: Vec<FileNode>,
    },
}

/// Read the vault as a tree. Returns the children of the vault root (i.e., the
/// vault folder itself is implicit; the frontend just iterates the result).
///
/// Skips hidden entries (anything starting with `.`) and `node_modules`. We
/// sort folders before files, alphabetical within each group — the universal
/// file-explorer convention.
#[tauri::command]
fn read_vault_tree(vault_path: String) -> Result<Vec<FileNode>, String> {
    let root = PathBuf::from(&vault_path);
    if !root.exists() {
        return Err(format!("Vault path does not exist: {}", vault_path));
    }
    if !root.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }
    read_dir_recursive(&root)
}

fn read_dir_recursive(dir: &PathBuf) -> Result<Vec<FileNode>, String> {
    let mut entries: Vec<FileNode> = Vec::new();

    let read = fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;

    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden / system / package directories. node_modules in
        // particular can be tens of thousands of files — never want to walk it.
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;

        if metadata.is_dir() {
            let children = read_dir_recursive(&path)?;
            entries.push(FileNode::Folder {
                name,
                path: path_str,
                children,
            });
        } else if metadata.is_file() {
            entries.push(FileNode::File {
                name,
                path: path_str,
            });
        }
        // Symlinks and other special entries are ignored on purpose for now.
    }

    entries.sort_by(|a, b| match (a, b) {
        (FileNode::Folder { name: an, .. }, FileNode::Folder { name: bn, .. })
        | (FileNode::File { name: an, .. }, FileNode::File { name: bn, .. }) => {
            an.to_lowercase().cmp(&bn.to_lowercase())
        }
        (FileNode::Folder { .. }, FileNode::File { .. }) => Ordering::Less,
        (FileNode::File { .. }, FileNode::Folder { .. }) => Ordering::Greater,
    });

    Ok(entries)
}

// -----------------------------------------------------------------------------
// Filesystem watcher
// -----------------------------------------------------------------------------
//
// Watches the current vault for external changes (create/modify/delete/rename)
// and emits a debounced `vault-changed` event the frontend listens for.
//
// Lifecycle:
//   - Frontend calls start_vault_watcher(vaultPath) after vault is resolved.
//   - We hold one RecommendedWatcher at a time in Tauri's managed state.
//   - Assigning a new watcher drops the old one, which closes its channel
//     sender; the old worker thread then exits on its next `rx.recv()`.
//   - We don't expose an explicit stop command — app exit drops state, which
//     drops the watcher, which tells the worker to stop.
//
// Debouncing:
//   - A `git pull` or bulk operation can emit dozens of events in milliseconds.
//     We coalesce: if it's been <500ms since the last emit, skip this event.
//   - Downstream (App.tsx) ultimately just bumps refreshKey, which cancels any
//     in-flight fetch and starts a new one. So 500ms is generous.

struct WatcherState {
    // `_` prefix: we never read the field, we only hold it so dropping the
    // state drops the watcher. The compiler would otherwise warn.
    _watcher: Option<notify::RecommendedWatcher>,
}

/// True when every path in this event lives under a directory we don't
/// care about (hidden dot-folders or node_modules). The frontend filters
/// the same set out of the file tree, and the SQLite index sits inside
/// `.research-hub/`, so writes there should never wake the watcher loop.
fn event_is_uninteresting(event: &notify::Event) -> bool {
    if event.paths.is_empty() {
        return true;
    }
    event.paths.iter().all(|p| {
        p.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            name.starts_with('.') || name == "node_modules"
        })
    })
}

#[tauri::command]
fn start_vault_watcher(
    app: tauri::AppHandle,
    vault_path: String,
    state: tauri::State<Mutex<WatcherState>>,
) -> Result<(), String> {
    let path = PathBuf::from(&vault_path);
    if !path.exists() {
        return Err(format!("Vault path does not exist: {}", vault_path));
    }

    let (tx, rx) = channel::<notify::Event>();

    // `recommended_watcher` picks the best OS backend: ReadDirectoryChangesW
    // on Windows, FSEvents on macOS, inotify on Linux.
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                // If the receiver was dropped, this send fails silently — we
                // don't care, we're on our way out.
                let _ = tx.send(event);
            }
        })
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch vault: {}", e))?;

    // Drain the channel on a dedicated thread, coalescing bursts.
    //
    // Critically, we filter events whose paths all live under hidden /
    // ignored directories. Without this, every write to the SQLite
    // index file at `<vault>/.research-hub/index.db` would re-fire
    // vault-changed → trigger another rebuild_index → another DB write →
    // … a self-sustaining feedback loop that flashes the file tree.
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut last_emit = Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
        while let Ok(event) = rx.recv() {
            if event_is_uninteresting(&event) {
                continue;
            }
            if last_emit.elapsed().as_millis() >= 500 {
                let _ = app_handle.emit("vault-changed", ());
                last_emit = Instant::now();
            }
        }
        // rx.recv() returned Err → watcher was dropped → exit cleanly.
    });

    // Replace (and drop) any previous watcher. Old worker thread will exit
    // on its next recv() as described in the module-level comment.
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard._watcher = Some(watcher);

    Ok(())
}

// -----------------------------------------------------------------------------
// Daily log (Week 3 Day 1)
// -----------------------------------------------------------------------------

/// Ensure today's daily log exists at `<vault>/02-Daily Log/<YYYY-MM-DD>.md`,
/// creating the folder and template if needed. Returns the absolute path.
#[tauri::command]
fn ensure_daily_log(
    vault_path: String,
    date_iso: String,
    carry_over_md: Option<String>,
) -> Result<String, String> {
    let vault = PathBuf::from(&vault_path);
    let daily_dir = vault.join("02-Daily Log");

    fs::create_dir_all(&daily_dir)
        .map_err(|e| format!("Failed to create Daily Log folder: {}", e))?;

    let filename = format!("{}.md", date_iso);
    let file_path = daily_dir.join(&filename);

    if !file_path.exists() {
        let mut template = daily_log_template(&date_iso);
        // Cluster 3: pre-pend a carry-over section if the frontend
        // queried pink marks. We only inject when the file is being
        // newly created — never on subsequent opens of the same date.
        if let Some(co) = carry_over_md {
            if !co.trim().is_empty() {
                let marker = "## Today's MIT";
                let block = format!("## Carried over from earlier\n\n{}\n\n", co.trim_end());
                if let Some(idx) = template.find(marker) {
                    template.insert_str(idx, &block);
                } else {
                    template.push_str(&block);
                }
            }
        }
        fs::write(&file_path, template).map_err(|e| format!("Failed to write template: {}", e))?;
    }

    Ok(file_path.to_string_lossy().to_string())
}

fn daily_log_template(date_iso: &str) -> String {
    let day_name = day_of_week_from_iso(date_iso);
    // Note the quotes around `date:` — without them, YAML parses the
    // value as a Date and gray-matter renders it as "2026-04-25T00:00:00.000Z"
    // in the frontmatter panel, which is misleading. Quoting forces YAML
    // to treat it as a plain string, matching how it appears on disk.
    format!(
        "---\n\
         id: daily-{date}\n\
         type: daily-log\n\
         date: \"{date}\"\n\
         ---\n\
         \n\
         # {date} — {day}\n\
         \n\
         ## Today's MIT\n\
         \n\
         \n\
         ## Morning\n\
         \n\
         \n\
         ## Afternoon\n\
         \n\
         \n\
         ## End of day\n\
         \n",
        date = date_iso,
        day = day_name
    )
}

/// Day-of-week from ISO date via Zeller's congruence. Avoids a chrono
/// dependency for Phase 1 — chronological correctness only matters for
/// the heading text.
fn day_of_week_from_iso(iso: &str) -> &'static str {
    let parts: Vec<&str> = iso.split('-').collect();
    if parts.len() != 3 {
        return "Unknown";
    }
    let y: i32 = parts[0].parse().unwrap_or(2000);
    let m: u32 = parts[1].parse().unwrap_or(1);
    let d: u32 = parts[2].parse().unwrap_or(1);

    let (y2, m2) = if m < 3 { (y - 1, m + 12) } else { (y, m) };
    let k = y2 % 100;
    let j = y2 / 100;
    let h = (d as i32 + (13 * (m2 as i32 + 1)) / 5 + k + k / 4 + j / 4 - 2 * j).rem_euclid(7);
    // h: 0=Saturday, 1=Sunday, 2=Monday, 3=Tuesday, 4=Wednesday, 5=Thursday, 6=Friday
    match h {
        0 => "Saturday",
        1 => "Sunday",
        2 => "Monday",
        3 => "Tuesday",
        4 => "Wednesday",
        5 => "Thursday",
        _ => "Friday",
    }
}

// -----------------------------------------------------------------------------
// SQLite FTS5 search index (Week 3 Day 2)
// -----------------------------------------------------------------------------
//
// The index lives at `<vault>/.research-hub/index.db`. Schema:
//   - `notes` (FTS5 virtual table): full-text-searchable copy of each note.
//   - `metadata`: per-path metadata, mtime, frontmatter blob.
//   - `links`: source → target wikilink edges (used for backlinks).
//
// Index strategy:
//   - On vault load, the frontend calls `rebuild_index` to re-walk all
//     markdown files and re-populate the DB.
//   - On every save, the frontend calls `index_single_file` so the index
//     stays current without a full rebuild.

#[derive(Serialize, Deserialize, Debug)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct NoteListItem {
    pub path: String,
    pub title: String,
}

fn get_db_path(vault_path: &str) -> PathBuf {
    PathBuf::from(vault_path)
        .join(".research-hub")
        .join("index.db")
}

fn open_or_init_db(vault_path: &str) -> Result<Connection, String> {
    let db_path = get_db_path(vault_path);
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(
             path UNINDEXED,
             title,
             body,
             tokenize = 'porter unicode61'
         );
         CREATE TABLE IF NOT EXISTS metadata (
             path TEXT PRIMARY KEY,
             frontmatter TEXT,
             modified INTEGER
         );
         CREATE TABLE IF NOT EXISTS links (
             source TEXT NOT NULL,
             target TEXT NOT NULL,
             PRIMARY KEY (source, target)
         );
         CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);

         /* Phase 2 Cluster 1: project / experiment / iteration tracking. */
         CREATE TABLE IF NOT EXISTS hierarchy (
             path TEXT PRIMARY KEY,
             type TEXT NOT NULL,           -- 'project' | 'experiment' | 'iteration'
             parent_path TEXT,              -- NULL for projects
             iter_number INTEGER,           -- NULL except for iterations
             modeling INTEGER               -- 0/1, NULL for projects
         );
         CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON hierarchy(parent_path);
         CREATE INDEX IF NOT EXISTS idx_hierarchy_type ON hierarchy(type);

         /* Phase 2 Cluster 2: Mark System extracts. Populated from
            <mark class=\"mark-COLOR\"> regions during indexing.

            `resolved` will become meaningful in Cluster 3 when we detect
            strikethrough wrapping a mark. For Cluster 2 it's always 0. */
         CREATE TABLE IF NOT EXISTS marks (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             source_path TEXT NOT NULL,
             kind TEXT NOT NULL,            -- 'yellow'|'green'|'pink'|'blue'|'orange'|'red'|'purple'
             text TEXT NOT NULL,
             context TEXT,
             line_number INTEGER,
             resolved INTEGER NOT NULL DEFAULT 0,
             created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_marks_source ON marks(source_path);
         CREATE INDEX IF NOT EXISTS idx_marks_kind ON marks(kind);
         CREATE INDEX IF NOT EXISTS idx_marks_resolved ON marks(resolved);

         /* Phase 2 Cluster 4: ::experiment ... ::end block routing.
            Each block in a daily note becomes a row keyed by
            (daily_note_path, block_index). Iteration files derive
            their `## From daily notes` auto-section by querying this
            table for matching iteration_path. */
         CREATE TABLE IF NOT EXISTS experiment_routings (
             daily_note_path TEXT NOT NULL,
             block_index INTEGER NOT NULL,
             iteration_path TEXT NOT NULL,
             content TEXT NOT NULL,
             PRIMARY KEY (daily_note_path, block_index)
         );
         CREATE INDEX IF NOT EXISTS idx_routings_iteration ON experiment_routings(iteration_path);",
    )
    .map_err(|e| e.to_string())?;

    // Cluster 3 schema migration: add injected_at column for tracking
    // pink marks that have already been carried into a daily note. The
    // ALTER TABLE will fail if the column already exists; ignore that.
    let _ = conn.execute("ALTER TABLE marks ADD COLUMN injected_at INTEGER", []);

    Ok(conn)
}

/// First H1 in the document, falling back to the file stem.
fn extract_title(body: &str, path: &str) -> String {
    for line in body.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("# ") {
            return rest.trim().to_string();
        }
    }
    PathBuf::from(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// One extracted Mark System occurrence — used to populate the `marks`
/// table during indexing.
struct MarkExtraction {
    kind: &'static str, // 'yellow' | 'green' | 'pink' | 'blue' | 'orange' | 'red' | 'purple'
    text: String,
    context: String,
    line_number: i64,
    /// True when the mark is wrapped in (or wraps) a strikethrough,
    /// either markdown `~~…~~` or HTML `<s>…</s>`. Cluster 3 destinations
    /// filter resolved=1 out of "active" views by default.
    resolved: bool,
}

const COLOR_MARK_NAMES: [&str; 7] = ["yellow", "green", "pink", "blue", "orange", "red", "purple"];

/// Find every `<mark class="mark-COLOR">…</mark>` occurrence in the body.
///
/// Simple substring scan rather than a regex: the editor produces a
/// canonical `<mark class="mark-COLOR">` form so we don't need to handle
/// attribute order, quoting style, or interleaved whitespace. If a power
/// user hand-types a variant the index will miss it, which is acceptable
/// for Phase 1 of the Mark System — Cluster 3's destination view will
/// show what was captured and the user can adjust their writing if a
/// mark goes uncounted.
///
/// We also capture a one-line `context` and a line number so the
/// destination view can show where the mark came from.
fn extract_marks(body: &str) -> Vec<MarkExtraction> {
    let mut out: Vec<MarkExtraction> = Vec::new();
    let close_tag = "</mark>";

    // Pre-compute a sorted list of newline byte offsets so we can map a
    // byte index to a line number in O(log n).
    let mut newline_offsets: Vec<usize> = Vec::new();
    for (i, b) in body.bytes().enumerate() {
        if b == b'\n' {
            newline_offsets.push(i);
        }
    }
    let line_for_offset = |off: usize| -> i64 {
        // Number of newlines strictly before `off` = line index (0-based).
        // Convert to 1-based for human-friendly display.
        let n = newline_offsets.partition_point(|&p| p < off);
        (n + 1) as i64
    };
    let line_text_for_offset = |off: usize| -> String {
        let line_idx = newline_offsets.partition_point(|&p| p < off);
        let start = if line_idx == 0 {
            0
        } else {
            newline_offsets[line_idx - 1] + 1
        };
        let end = if line_idx < newline_offsets.len() {
            newline_offsets[line_idx]
        } else {
            body.len()
        };
        body[start..end].to_string()
    };

    for &color in COLOR_MARK_NAMES.iter() {
        let open_tag = format!("<mark class=\"mark-{}\">", color);
        let mut search_from = 0usize;
        while let Some(rel_start) = body[search_from..].find(&open_tag) {
            let abs_start = search_from + rel_start;
            let after_open = abs_start + open_tag.len();
            let Some(rel_end) = body[after_open..].find(close_tag) else {
                break;
            };
            let abs_end = after_open + rel_end;
            let close_end = abs_end + close_tag.len();
            let raw_inner = &body[after_open..abs_end];
            let inner_trimmed = raw_inner.trim();

            // ----- Strikethrough detection -----
            //
            // Four wrap patterns that all denote "resolved":
            //   A: <mark>~~text~~</mark>          (strike inside mark)
            //   B: ~~<mark>text</mark>~~          (strike outside mark)
            //   C: <mark><s>text</s></mark>       (HTML strike inside)
            //   D: <s><mark>text</mark></s>       (HTML strike outside)
            //
            // We accept either nesting; TipTap's choice depends on
            // extension priority and we don't want to bind to it.
            let pattern_a = inner_trimmed.starts_with("~~")
                && inner_trimmed.ends_with("~~")
                && inner_trimmed.len() >= 4;
            let pattern_c = inner_trimmed.starts_with("<s>")
                && inner_trimmed.ends_with("</s>")
                && inner_trimmed.len() >= 7;
            let before_2 = if abs_start >= 2 {
                &body[abs_start - 2..abs_start]
            } else {
                ""
            };
            let after_2 = if close_end + 2 <= body.len() {
                &body[close_end..close_end + 2]
            } else {
                ""
            };
            let pattern_b = before_2 == "~~" && after_2 == "~~";
            let before_3 = if abs_start >= 3 {
                &body[abs_start - 3..abs_start]
            } else {
                ""
            };
            let after_4 = if close_end + 4 <= body.len() {
                &body[close_end..close_end + 4]
            } else {
                ""
            };
            let pattern_d = before_3 == "<s>" && after_4 == "</s>";

            let resolved = pattern_a || pattern_b || pattern_c || pattern_d;

            // For display, strip the strikethrough markers so the queue
            // shows the underlying text rather than `~~hello~~`.
            let text = if pattern_a {
                inner_trimmed[2..inner_trimmed.len() - 2].trim().to_string()
            } else if pattern_c {
                inner_trimmed[3..inner_trimmed.len() - 4].to_string()
            } else {
                raw_inner.to_string()
            };

            let line_number = line_for_offset(abs_start);
            let context = line_text_for_offset(abs_start);

            out.push(MarkExtraction {
                kind: color,
                text,
                context,
                line_number,
                resolved,
            });

            search_from = close_end;
        }
    }
    out
}

/// Pull `[[target]]` (and `[[target|alias]]`) tokens out of the body.
/// Aliases are collapsed to the target part.
///
/// Important quirk: tiptap-markdown escapes `[` and `]` during
/// serialization, so a typed `[[X]]` lands on disk as `\[\[X\]\]`.
/// We normalize that back to `[[X]]` before scanning so backlinks
/// work for both forms — the cleaned form (after the frontend
/// unescape) and the legacy escaped form (already on disk before
/// the frontend fix landed).
fn extract_wikilinks(body: &str) -> Vec<String> {
    let normalized = body.replace("\\[\\[", "[[").replace("\\]\\]", "]]");
    let mut links = Vec::new();
    let mut rest = normalized.as_str();
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        if let Some(end) = rest.find("]]") {
            let raw = rest[..end].trim();
            if !raw.is_empty() && !raw.contains('\n') {
                let clean = raw.split('|').next().unwrap_or(raw).trim().to_string();
                if !clean.is_empty() {
                    links.push(clean);
                }
            }
            rest = &rest[end + 2..];
        } else {
            break;
        }
    }
    links
}

#[tauri::command]
fn index_single_file(vault_path: String, file_path: String) -> Result<(), String> {
    // Cluster 6: PDFs take a different indexing path — extracted text feeds
    // FTS5, sidecar JSON contributes annotations to the marks table.
    if PathBuf::from(&file_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
    {
        return index_pdf_file(&vault_path, &file_path);
    }

    let conn = open_or_init_db(&vault_path)?;
    let body = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;

    let title = extract_title(&body, &file_path);
    let links = extract_wikilinks(&body);

    // Upsert into notes (FTS5 has no UNIQUE so we delete-then-insert).
    conn.execute("DELETE FROM notes WHERE path = ?1", params![&file_path])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO notes (path, title, body) VALUES (?1, ?2, ?3)",
        params![&file_path, &title, &body],
    )
    .map_err(|e| e.to_string())?;

    let modified = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT OR REPLACE INTO metadata (path, frontmatter, modified) VALUES (?1, ?2, ?3)",
        params![&file_path, "{}", modified],
    )
    .map_err(|e| e.to_string())?;

    // Refresh outgoing wikilink edges for this file.
    conn.execute("DELETE FROM links WHERE source = ?1", params![&file_path])
        .map_err(|e| e.to_string())?;
    for target in links {
        conn.execute(
            "INSERT OR IGNORE INTO links (source, target) VALUES (?1, ?2)",
            params![&file_path, &target],
        )
        .map_err(|e| e.to_string())?;
    }

    // Refresh project/experiment/iteration hierarchy row.
    populate_hierarchy_for_file(&conn, &vault_path, &file_path, &body)?;

    // Refresh Mark System extracts. Cluster 3's destination views read
    // from this table.
    conn.execute(
        "DELETE FROM marks WHERE source_path = ?1",
        params![&file_path],
    )
    .map_err(|e| e.to_string())?;
    let now_secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    for m in extract_marks(&body) {
        conn.execute(
            "INSERT INTO marks
             (source_path, kind, text, context, line_number, resolved, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &file_path,
                m.kind,
                m.text,
                m.context,
                m.line_number,
                m.resolved as i64,
                now_secs,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn rebuild_index(vault_path: String) -> Result<usize, String> {
    use std::collections::HashSet;

    let mut walked: HashSet<String> = HashSet::new();
    let mut count = 0;

    for entry in WalkDir::new(&vault_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules")
        })
        .filter_map(|e| e.ok())
    {
        // Cluster 6 fix: include PDFs alongside markdown so PDF text is
        // walked into FTS5 and PDF annotations flow into the marks table
        // even when the user hasn't opened the PDF in this session.
        if entry.file_type().is_file() {
            let ext = entry
                .path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            if matches!(ext.as_deref(), Some("md") | Some("pdf")) {
                let path_str = entry.path().to_string_lossy().to_string();
                index_single_file(vault_path.clone(), path_str.clone())?;
                walked.insert(path_str);
                count += 1;
            }
        }
    }

    // Sweep deleted files: any path indexed but not walked has been
    // removed from disk. Drop its rows from every table that references
    // it. Without this, deleted notes' backlinks would keep showing up.
    let conn = open_or_init_db(&vault_path)?;
    let mut stmt = conn
        .prepare("SELECT path FROM metadata")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut stale: Vec<String> = Vec::new();
    for r in rows {
        let p = r.map_err(|e| e.to_string())?;
        if !walked.contains(&p) {
            stale.push(p);
        }
    }
    drop(stmt); // release borrow before mutating
    for p in stale {
        conn.execute("DELETE FROM notes WHERE path = ?1", params![&p])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM metadata WHERE path = ?1", params![&p])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM links WHERE source = ?1", params![&p])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM marks WHERE source_path = ?1", params![&p])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM hierarchy WHERE path = ?1", params![&p])
            .map_err(|e| e.to_string())?;
    }

    Ok(count)
}

/// Cluster 6 v1.2: convert a "kind" filter — "md" / "pdf" / anything-else
/// — into a SQL LIKE pattern. None / "all" keeps everything.
fn path_like_for_kind(kind: Option<&str>) -> Option<&'static str> {
    match kind {
        Some("md") => Some("%.md"),
        Some("pdf") => Some("%.pdf"),
        _ => None,
    }
}

#[tauri::command]
fn search_notes(
    vault_path: String,
    query: String,
    limit: usize,
    kind: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let conn = open_or_init_db(&vault_path)?;
    let kind_pattern = path_like_for_kind(kind.as_deref());

    // Two SQL templates: with and without the path-LIKE filter. SQLite
    // doesn't allow optional WHERE clauses without dynamic SQL, so this
    // is the simplest correct option.
    let mut out = Vec::new();
    if let Some(pat) = kind_pattern {
        let mut stmt = conn
            .prepare(
                "SELECT path, title, snippet(notes, 2, '<<', '>>', '…', 20) AS snippet
                 FROM notes
                 WHERE notes MATCH ?1 AND path LIKE ?2
                 ORDER BY rank
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&query, pat, limit as i64], |row| {
                Ok(SearchResult {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    snippet: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT path, title, snippet(notes, 2, '<<', '>>', '…', 20) AS snippet
                 FROM notes
                 WHERE notes MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&query, limit as i64], |row| {
                Ok(SearchResult {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    snippet: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

#[tauri::command]
fn list_all_notes(vault_path: String, kind: Option<String>) -> Result<Vec<NoteListItem>, String> {
    let conn = open_or_init_db(&vault_path)?;
    let kind_pattern = path_like_for_kind(kind.as_deref());

    let mut out = Vec::new();
    if let Some(pat) = kind_pattern {
        let mut stmt = conn
            .prepare(
                "SELECT path, title FROM notes
                 WHERE path LIKE ?1
                 ORDER BY title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pat], |row| {
                Ok(NoteListItem {
                    path: row.get(0)?,
                    title: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare("SELECT path, title FROM notes ORDER BY title COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(NoteListItem {
                    path: row.get(0)?,
                    title: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

#[tauri::command]
fn get_backlinks(
    vault_path: String,
    target_title: String,
    target_filename: Option<String>,
) -> Result<Vec<NoteListItem>, String> {
    let conn = open_or_init_db(&vault_path)?;
    // Wikilinks point at notes by either:
    //   - The note's H1 title (e.g., `[[Cortex — Project Notes]]`), or
    //   - The note's filename without extension (e.g., `[[NOTES]]`).
    // We match BOTH so backlinks work regardless of which form the
    // author used. The empty-string fallback for the filename keeps
    // the SQL valid when the frontend doesn't pass one.
    let filename = target_filename.unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT n.path, n.title
             FROM notes n
             JOIN links l ON l.source = n.path
             WHERE l.target = ?1 COLLATE NOCASE
                OR (?2 <> '' AND l.target = ?2 COLLATE NOCASE)
             ORDER BY n.title COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&target_title, &filename], |row| {
            Ok(NoteListItem {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// -----------------------------------------------------------------------------
// Phase 2 Cluster 3 — Mark System destinations
// -----------------------------------------------------------------------------
//
// query_marks: powers the virtual review queues (yellow/green/etc.) and
// the persistent file regeneration. Returns marks joined with the source
// note's title for display.
//
// mark_marks_injected: stamps pink marks with `injected_at` once they've
// been pulled into a daily note's "Carried over from earlier" section,
// so they don't get re-injected on subsequent days.

#[derive(Serialize, Deserialize, Debug)]
pub struct MarkWithSource {
    pub id: i64,
    pub kind: String,
    pub text: String,
    pub context: String,
    pub line_number: i64,
    pub resolved: bool,
    pub injected_at: Option<i64>,
    pub source_path: String,
    pub source_title: String,
    pub source_modified: i64,
}

/// Query the marks table.
///
///   - `kind`: required. One of yellow|green|pink|blue|orange|red|purple|advisor.
///   - `max_age_days`: if set, only marks whose source file was modified
///     within this many days. Used by the weekly/monthly review queues.
///   - `include_resolved`: if false (default), only `resolved = 0` rows.
///   - `only_uninjected`: if true, also filters `injected_at IS NULL`.
///     Used by the pink-carryover flow.
#[tauri::command]
fn query_marks(
    vault_path: String,
    kind: String,
    max_age_days: Option<i64>,
    include_resolved: Option<bool>,
    only_uninjected: Option<bool>,
) -> Result<Vec<MarkWithSource>, String> {
    let conn = open_or_init_db(&vault_path)?;

    let mut sql = String::from(
        "SELECT m.id, m.kind, m.text, m.context, m.line_number,
                m.resolved, m.injected_at,
                m.source_path,
                COALESCE(n.title, '(untitled)') AS source_title,
                COALESCE(meta.modified, 0) AS source_modified
         FROM marks m
         LEFT JOIN notes n ON n.path = m.source_path
         LEFT JOIN metadata meta ON meta.path = m.source_path
         WHERE m.kind = ?1",
    );

    if !include_resolved.unwrap_or(false) {
        sql.push_str(" AND m.resolved = 0");
    }
    if only_uninjected.unwrap_or(false) {
        sql.push_str(" AND m.injected_at IS NULL");
    }
    if let Some(days) = max_age_days {
        let cutoff = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
            - days * 86_400;
        sql.push_str(&format!(" AND meta.modified >= {}", cutoff));
    }
    sql.push_str(" ORDER BY meta.modified DESC, m.line_number ASC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&kind], |row| {
            Ok(MarkWithSource {
                id: row.get(0)?,
                kind: row.get(1)?,
                text: row.get(2)?,
                context: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                line_number: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                resolved: row.get::<_, i64>(5)? != 0,
                injected_at: row.get::<_, Option<i64>>(6)?,
                source_path: row.get(7)?,
                source_title: row.get(8)?,
                source_modified: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Stamp the listed mark IDs with the current timestamp in `injected_at`.
/// Idempotent — re-stamping is harmless.
#[tauri::command]
fn mark_marks_injected(vault_path: String, mark_ids: Vec<i64>) -> Result<(), String> {
    if mark_ids.is_empty() {
        return Ok(());
    }
    let conn = open_or_init_db(&vault_path)?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    for id in mark_ids {
        conn.execute(
            "UPDATE marks SET injected_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// -----------------------------------------------------------------------------
// Phase 2 Cluster 3 — Persistent destination files
// -----------------------------------------------------------------------------
//
// Four files live at the vault root, regenerated from the marks table on
// open. The boundary between user-editable manual notes and the auto
// section is an HTML comment marker; the regenerator preserves
// everything above the marker and replaces everything below.

const PERSISTENT_AUTO_MARKER: &str = "<!-- AUTO-GENERATED BELOW; DO NOT EDIT MANUALLY -->";

/// Map a destination kind ("bottlenecks" | "antihype" | "citations" |
/// "concepts") to (filename, mark_color, heading, blurb).
fn persistent_kind_meta(
    kind: &str,
) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    match kind {
        "bottlenecks" => Some((
            "Bottlenecks.md",
            "red",
            "Bottlenecks",
            "Things blocking progress, captured by red mark.",
        )),
        "antihype" => Some((
            "Anti-Hype.md",
            "orange",
            "Anti-Hype File",
            "Observations that contradict expectations, captured by orange mark.",
        )),
        "citations" => Some((
            "citations-to-use.md",
            "purple",
            "Citations to use",
            "References to incorporate into writing, captured by purple mark.",
        )),
        "concepts" => Some((
            "Concept Inbox.md",
            "blue",
            "Concept Inbox",
            "Concepts to be folded into proper concept notes, captured by blue mark.",
        )),
        _ => None,
    }
}

/// Render the auto-section markdown for a given color from the marks table.
///
/// Layout:
///   - A visible H2 heading so the user can SEE where the boundary is in
///     the editor (the HTML comment marker above is invisible by spec).
///   - A blockquote warning that edits below get wiped on regeneration.
///   - The mark list, one bullet per source.
fn build_auto_section(marks: &[MarkWithSource]) -> String {
    let mut out = String::from(
        "\n## ▾ Auto-generated from marks\n\n\
         > Edits below this heading are overwritten when this file is\n\
         > regenerated (next time you navigate to it). Add manual notes\n\
         > above the **AUTO-GENERATED BELOW** comment instead.\n\n",
    );
    if marks.is_empty() {
        out.push_str("_(no marks yet — go highlight some text in your notes)_\n");
        return out;
    }
    for m in marks {
        // Single-line context. Strip mark HTML tags for readability so
        // the auto section stays clean even though the source text has
        // <mark> wrappers.
        let context = strip_mark_tags(&m.context).replace('\n', " ");
        let context = context.trim();
        let backlink_target = m.source_title.replace("[[", "").replace("]]", "");
        out.push_str(&format!(
            "- **[[{title}]]** (line {line}): {ctx}\n",
            title = backlink_target,
            line = m.line_number,
            ctx = context
        ));
    }
    out
}

/// Strip `<mark class="mark-X">` and `</mark>` tags from a string,
/// leaving the inner text. Cheap; doesn't fully parse HTML.
fn strip_mark_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    loop {
        if let Some(idx) = rest.find("<mark") {
            out.push_str(&rest[..idx]);
            if let Some(end) = rest[idx..].find('>') {
                rest = &rest[idx + end + 1..];
            } else {
                break;
            }
        } else {
            break;
        }
    }
    out.push_str(rest);
    out.replace("</mark>", "")
}

/// Ensure the persistent file exists; return its path. Creates with a
/// blank manual section + freshly-regenerated auto section.
#[tauri::command]
fn ensure_persistent_file(vault_path: String, kind: String) -> Result<String, String> {
    let (filename, _color, heading, blurb) =
        persistent_kind_meta(&kind).ok_or_else(|| format!("Unknown persistent kind: {}", kind))?;
    let path = PathBuf::from(&vault_path).join(filename);
    if !path.exists() {
        // Initial scaffold. Two visible sections plus the invisible
        // HTML-comment boundary that the regenerator splits on.
        let initial = format!(
            "---\n\
             type: aggregated\n\
             kind: {kind}\n\
             ---\n\
             \n\
             # {heading}\n\
             \n\
             > {blurb}\n\
             \n\
             ## ▴ Manual notes\n\
             \n\
             _Anything above the **AUTO-GENERATED BELOW** comment is yours\n\
             to keep. The list below regenerates from your marks._\n\
             \n\
             {marker}\n",
            kind = kind,
            heading = heading,
            blurb = blurb,
            marker = PERSISTENT_AUTO_MARKER
        );
        fs::write(&path, initial).map_err(|e| e.to_string())?;
    }
    let path_str = path.to_string_lossy().to_string();
    regenerate_persistent_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

/// Regenerate the auto section of a persistent destination file.
/// Preserves everything above the marker; replaces everything below.
#[tauri::command]
fn regenerate_persistent_file(vault_path: String, file_path: String) -> Result<(), String> {
    // Derive kind from filename basename.
    let basename = PathBuf::from(&file_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let kind = match basename.as_str() {
        "Bottlenecks.md" => "bottlenecks",
        "Anti-Hype.md" => "antihype",
        "citations-to-use.md" => "citations",
        "Concept Inbox.md" => "concepts",
        _ => return Ok(()), // not a known persistent file — no-op
    };
    let (_filename, color, _heading, _blurb) =
        persistent_kind_meta(kind).ok_or_else(|| format!("Unknown kind: {}", kind))?;

    // Pull all unresolved marks of that color.
    let marks = query_marks(
        vault_path,
        color.to_string(),
        None,        // no age filter
        Some(false), // include_resolved=false
        Some(false), // only_uninjected=false
    )?;
    let auto = build_auto_section(&marks);

    // Read existing file. If file doesn't exist, write a minimal one
    // (shouldn't normally happen since ensure_persistent_file creates
    // it first, but defensive).
    let existing = fs::read_to_string(&file_path).unwrap_or_default();

    let new_content = if let Some(idx) = existing.find(PERSISTENT_AUTO_MARKER) {
        let manual = &existing[..idx];
        format!(
            "{manual}{marker}\n{auto}",
            manual = manual,
            marker = PERSISTENT_AUTO_MARKER,
            auto = auto
        )
    } else if existing.is_empty() {
        // Treat as new — caller forgot to ensure_persistent_file first.
        return Err(format!(
            "Persistent file does not exist; call ensure_persistent_file first: {}",
            file_path
        ));
    } else {
        // Marker missing — append.
        format!(
            "{existing}\n\n{marker}\n{auto}",
            existing = existing,
            marker = PERSISTENT_AUTO_MARKER,
            auto = auto
        )
    };

    fs::write(&file_path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Phase 2 Cluster 4 — Experiment routing (::experiment ... ::end)
// -----------------------------------------------------------------------------
//
// Block syntax in daily notes:
//
//   ::experiment <name> / iter-<N>
//   <body lines…>
//   ::end
//
// On save, we parse out every such block, look up the iteration file
// path via the hierarchy table, and append the block's body to that
// iteration's `## From daily notes` auto-section. The auto-section is
// regenerated wholesale from the routings table; manual content above
// the AUTO-GENERATED marker is preserved.
//
// We DO NOT modify the daily note — the block stays where the user
// wrote it. Iteration files just re-derive their auto-section from
// the routings table.

/// One parsed experiment block from a daily note.
#[derive(Debug, Clone)]
struct ExperimentBlock {
    /// Experiment name as the user typed it. Looked up case-insensitively
    /// in the hierarchy.
    name: String,
    iter_number: i64,
    /// The block's inner content (everything between the open and close
    /// lines), preserving line breaks but trimmed of surrounding
    /// whitespace.
    content: String,
}

/// Walk a markdown body and extract every `::experiment ... ::end` block.
///
/// Resilient to:
///   - Indentation before `::experiment` (we accept up to a few spaces)
///   - Empty content (block opens then immediately closes)
///   - Missing `::end` → treat as a plain-text block, NOT routing
///   - Stray `::end` without an open → ignore
///
/// Format expected after `::experiment `:
///   `<experiment name> / iter-<N>`
/// We split on the LAST `/` to allow names containing `/`.
fn extract_experiment_blocks(body: &str) -> Vec<ExperimentBlock> {
    let mut out: Vec<ExperimentBlock> = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0usize;

    // Strip leading whitespace and an optional markdown blockquote
    // prefix (`> ` or `>`). When tiptap-markdown serializes our inserted
    // paragraphs it sometimes wraps them in a blockquote — we tolerate
    // that here so the routing still works.
    fn strip_quote(line: &str) -> &str {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("> ") {
            rest
        } else if let Some(rest) = t.strip_prefix(">") {
            rest
        } else {
            t
        }
    }

    while i < lines.len() {
        let normalized = strip_quote(lines[i]);
        if let Some(rest) = normalized.strip_prefix("::experiment ") {
            // Header line. Parse "<name> / iter-<N>".
            let header = rest.trim();
            let (name_part, iter_part) = match header.rsplit_once('/') {
                Some((n, ii)) => (n.trim(), ii.trim()),
                None => {
                    i += 1;
                    continue;
                }
            };
            let iter_number: i64 = match iter_part
                .strip_prefix("iter-")
                .or_else(|| iter_part.strip_prefix("iter"))
                .and_then(|s| s.trim().parse::<i64>().ok())
            {
                Some(n) => n,
                None => {
                    i += 1;
                    continue;
                }
            };
            let name = name_part.to_string();

            // Scan forward for `::end`. Each content line gets its
            // blockquote prefix stripped before storage so the routing
            // text is clean.
            let mut j = i + 1;
            let mut content_lines: Vec<String> = Vec::new();
            let mut closed = false;
            while j < lines.len() {
                let line_norm = strip_quote(lines[j]);
                if line_norm.trim() == "::end" {
                    closed = true;
                    break;
                }
                content_lines.push(line_norm.to_string());
                j += 1;
            }

            if closed {
                let content = content_lines.join("\n").trim().to_string();
                out.push(ExperimentBlock {
                    name,
                    iter_number,
                    content,
                });
                i = j + 1;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Find the experiment's `index.md` path by name (case-insensitive,
/// matching either H1 title or folder-basename-with-NN-prefix-stripped).
/// Returns None if no such experiment exists.
fn find_experiment_path(
    conn: &Connection,
    experiment_name: &str,
) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT h.path, COALESCE(n.title, '') AS title
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'experiment'",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    let want_lower = experiment_name.trim().to_ascii_lowercase();
    eprintln!(
        "[cortex] find_experiment_path: looking for {:?} (lower={:?}); {} candidates in hierarchy",
        experiment_name,
        want_lower,
        rows.len()
    );
    for (path, title) in rows {
        if title.to_ascii_lowercase() == want_lower {
            eprintln!("[cortex]   matched by title: {}", path);
            return Ok(Some(path));
        }
        let parent = PathBuf::from(&path)
            .parent()
            .and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_default();
        let stripped = parent
            .splitn(2, '-')
            .nth(1)
            .unwrap_or(parent.as_str())
            .to_ascii_lowercase();
        if stripped == want_lower || parent.to_ascii_lowercase() == want_lower {
            eprintln!("[cortex]   matched by basename: {}", path);
            return Ok(Some(path));
        }
        eprintln!(
            "[cortex]   candidate skipped: title={:?}, basename={:?}, stripped={:?}",
            title, parent, stripped
        );
    }
    Ok(None)
}

/// Find the iteration file for (experiment, iter_number). If it doesn't
/// exist yet, create it from the standard template and index it. The
/// `date_iso` is used for the new file's filename and frontmatter.
fn find_or_create_iteration(
    conn: &Connection,
    vault_path: &str,
    experiment_index_path: &str,
    iter_number: i64,
    date_iso: &str,
) -> Result<String, String> {
    // Existing row?
    let mut stmt = conn
        .prepare(
            "SELECT path FROM hierarchy
             WHERE type = 'iteration'
               AND iter_number = ?1
               AND parent_path = ?2",
        )
        .map_err(|e| e.to_string())?;
    if let Ok(existing) = stmt.query_row(params![iter_number, experiment_index_path], |row| {
        row.get::<_, String>(0)
    }) {
        return Ok(existing);
    }
    drop(stmt);

    // Auto-create. Build the filename and template the same way
    // create_iteration does, just with an explicit iter_number.
    let exp_dir = PathBuf::from(experiment_index_path)
        .parent()
        .ok_or_else(|| "Invalid experiment path".to_string())?
        .to_path_buf();
    let exp_link_name = exp_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let filename = format!("iter-{:02} - {}.md", iter_number, date_iso);
    let iter_path = exp_dir.join(&filename);

    let template = format!(
        "---\n\
         type: iteration\n\
         experiment: \"[[{exp_link}]]\"\n\
         iter: {n}\n\
         date: \"{date}\"\n\
         ---\n\
         \n\
         # Iter {nn:02} — {date}\n\
         \n\
         ## What I did\n\
         \n\
         ## What I observed\n\
         \n\
         ## What I conclude\n\
         \n\
         <!-- AUTO-GENERATED BELOW; DO NOT EDIT MANUALLY -->\n\
         \n\
         ## From daily notes\n\
         \n\
         _(no daily-note experiment blocks routed here yet)_\n",
        exp_link = exp_link_name,
        n = iter_number,
        nn = iter_number,
        date = date_iso
    );

    fs::write(&iter_path, template).map_err(|e| e.to_string())?;
    let path_str = iter_path.to_string_lossy().to_string();
    // Re-index so the hierarchy table sees the new row before the
    // caller queries the routings table.
    index_single_file(vault_path.to_string(), path_str.clone())?;
    Ok(path_str)
}

/// Result of routing one daily note. Returned to the frontend so it can
/// surface "Experiment X not found" warnings without aborting save.
#[derive(Serialize, Deserialize, Debug)]
pub struct RoutingResult {
    pub routed: usize,
    pub warnings: Vec<String>,
}

/// Parse blocks from a daily note, refresh the routings table for it,
/// and regenerate every affected iteration file's auto-section.
///
/// `date_iso` is used to date any iteration files that get auto-created
/// during routing (when a block references an iter that didn't exist).
///
/// Called by the frontend after saveCurrentFile completes. Idempotent —
/// re-running is harmless.
#[tauri::command]
fn route_experiment_blocks(
    vault_path: String,
    daily_note_path: String,
    date_iso: String,
) -> Result<RoutingResult, String> {
    let body = fs::read_to_string(&daily_note_path).map_err(|e| e.to_string())?;
    let blocks = extract_experiment_blocks(&body);

    eprintln!(
        "[cortex] route_experiment_blocks: file={}, parsed={} blocks, body_len={}",
        daily_note_path,
        blocks.len(),
        body.len()
    );
    eprintln!(
        "[cortex]   contains_substring  '::experiment'={}  '\\\\:\\\\:experiment'={}  ':\\\\:'={}",
        body.contains("::experiment"),
        body.contains("\\:\\:experiment"),
        body.contains(":\\:")
    );
    let dump = &body[..body.len().min(800)];
    eprintln!("[cortex]   first {} chars: {:?}", dump.len(), dump);
    for (i, b) in blocks.iter().enumerate() {
        eprintln!(
            "[cortex]   block[{}]: name={:?} iter={} content_len={}",
            i,
            b.name,
            b.iter_number,
            b.content.len()
        );
    }

    let conn = open_or_init_db(&vault_path)?;

    let mut affected: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Track iterations we PREVIOUSLY routed to from this daily note —
    // they need a refresh even if no longer referenced.
    {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT iteration_path FROM experiment_routings
                 WHERE daily_note_path = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&daily_note_path], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            affected.insert(r.map_err(|e| e.to_string())?);
        }
    }

    // Replace this daily note's routing rows.
    conn.execute(
        "DELETE FROM experiment_routings WHERE daily_note_path = ?1",
        params![&daily_note_path],
    )
    .map_err(|e| e.to_string())?;

    let mut warnings: Vec<String> = Vec::new();
    let mut routed = 0;

    for (idx, block) in blocks.iter().enumerate() {
        // Resolve the experiment first.
        let exp_path = find_experiment_path(&conn, &block.name)?;
        let exp_path = match exp_path {
            Some(p) => {
                eprintln!("[cortex]   block[{}]: experiment matched → {}", idx, p);
                p
            }
            None => {
                eprintln!(
                    "[cortex]   block[{}]: experiment NOT FOUND for name={:?}",
                    idx, block.name
                );
                warnings.push(format!(
                    "Experiment \"{}\" not found — block skipped.",
                    block.name
                ));
                continue;
            }
        };
        // Find or auto-create the iteration file.
        let iter_path =
            find_or_create_iteration(&conn, &vault_path, &exp_path, block.iter_number, &date_iso)?;
        eprintln!("[cortex]   block[{}]: iteration path → {}", idx, iter_path);

        conn.execute(
            "INSERT INTO experiment_routings
             (daily_note_path, block_index, iteration_path, content)
             VALUES (?1, ?2, ?3, ?4)",
            params![&daily_note_path, idx as i64, &iter_path, &block.content],
        )
        .map_err(|e| e.to_string())?;

        affected.insert(iter_path);
        routed += 1;
    }

    eprintln!(
        "[cortex] route summary: routed={}, regenerating {} iterations",
        routed,
        affected.len()
    );
    for iter_path in affected {
        regenerate_iteration_auto_section(&conn, &iter_path)?;
        eprintln!("[cortex]   regenerated → {}", iter_path);
    }

    Ok(RoutingResult { routed, warnings })
}

/// Rewrite the iteration file's auto section ("## From daily notes")
/// from the routings table. Preserves everything above the AUTO marker.
fn regenerate_iteration_auto_section(
    conn: &Connection,
    iteration_path: &str,
) -> Result<(), String> {
    if !PathBuf::from(iteration_path).exists() {
        // Iteration file missing — nothing to regenerate.
        return Ok(());
    }

    let mut stmt = conn
        .prepare(
            "SELECT er.daily_note_path, er.content, COALESCE(n.title, '(untitled)') AS title
             FROM experiment_routings er
             LEFT JOIN notes n ON n.path = er.daily_note_path
             WHERE er.iteration_path = ?1
             ORDER BY er.daily_note_path, er.block_index",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![iteration_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    // Group by daily note title for display.
    let mut by_source: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for r in rows {
        let (_path, content, title) = r.map_err(|e| e.to_string())?;
        by_source
            .entry(title)
            .or_insert_with(Vec::new)
            .push(content);
    }

    let mut auto = String::from("\n## From daily notes\n\n");
    if by_source.is_empty() {
        auto.push_str(
            "_(no daily-note experiment blocks routed here yet — type \
             `::experiment <name> / iter-N\\n…\\n::end` in a daily note)_\n",
        );
    } else {
        for (title, blocks) in &by_source {
            auto.push_str(&format!("### From [[{}]]\n\n", title));
            for (i, content) in blocks.iter().enumerate() {
                if i > 0 {
                    auto.push_str("\n---\n\n");
                }
                auto.push_str(content);
                auto.push_str("\n");
            }
            auto.push_str("\n");
        }
    }

    let existing = fs::read_to_string(iteration_path).unwrap_or_default();
    let new_content = if let Some(idx) = existing.find(PERSISTENT_AUTO_MARKER) {
        let manual = &existing[..idx];
        format!(
            "{manual}{marker}\n{auto}",
            manual = manual,
            marker = PERSISTENT_AUTO_MARKER,
            auto = auto
        )
    } else {
        // No marker yet — append one.
        format!(
            "{existing}\n\n{marker}\n{auto}",
            existing = existing.trim_end(),
            marker = PERSISTENT_AUTO_MARKER,
            auto = auto
        )
    };
    fs::write(iteration_path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Phase 2 Cluster 1 — Projects / Experiments / Iterations
// -----------------------------------------------------------------------------
//
// Folder structure (Option A from the cluster doc — flat numbered folders):
//
//   <vault>/03-Projects/
//     01-Project Name/
//       index.md                                   ← project master file
//       01-Experiment Name/
//         index.md                                 ← experiment master file
//         iter-01 - 2026-05-04.md                  ← iteration
//         iter-02 - 2026-05-12.md
//
// The filesystem IS the hierarchy. The index.md and iter-NN files just
// hold human content + frontmatter. The `hierarchy` table is a derived
// view we rebuild from the filesystem on every index pass.

const PROJECTS_DIR: &str = "03-Projects";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HierarchyItem {
    pub path: String,
    pub name: String,
    pub iter_number: Option<i64>,
    pub modeling: Option<bool>,
}

/// Pull a single scalar value out of YAML frontmatter without bringing a
/// YAML crate along. Handles plain, single-, and double-quoted values.
/// Returns the trimmed string between the first `:` and the end of line,
/// or None if the key isn't present.
fn extract_frontmatter_field(body: &str, key: &str) -> Option<String> {
    let mut lines = body.lines();
    if lines.next() != Some("---") {
        return None;
    }
    for line in lines {
        if line == "---" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim() == key {
                let raw = v.trim();
                let stripped = raw.trim_matches('"').trim_matches('\'').trim().to_string();
                return Some(stripped);
            }
        }
    }
    None
}

/// Classify a markdown file by its position in the projects tree.
/// Returns (type, iter_number) where type is one of "project",
/// "experiment", "iteration", or "" if the file isn't part of the
/// hierarchy at all.
fn classify_in_hierarchy(vault_path: &str, file_path: &str) -> (&'static str, Option<i64>) {
    let vault = PathBuf::from(vault_path);
    let projects_root = vault.join(PROJECTS_DIR);
    let file = PathBuf::from(file_path);

    let rel = match file.strip_prefix(&projects_root) {
        Ok(r) => r,
        Err(_) => return ("", None),
    };

    let components: Vec<_> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let basename = components.last().map(|s| s.as_str()).unwrap_or("");

    // Iteration files: filename starts with "iter-NN - "
    if basename.starts_with("iter-") {
        let iter_num = basename
            .strip_prefix("iter-")
            .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|s| s.parse::<i64>().ok());
        return ("iteration", iter_num);
    }

    // index.md inside a project or experiment folder
    if basename == "index.md" {
        // depth counts the *folder* segments between projects_root and this index.md
        // - 1 component  → 03-Projects/index.md (not a real project; ignore)
        // - 2 components → 03-Projects/<Project>/index.md → project
        // - 3 components → 03-Projects/<Project>/<Experiment>/index.md → experiment
        match components.len() {
            2 => return ("project", None),
            3 => return ("experiment", None),
            _ => return ("", None),
        }
    }

    ("", None)
}

/// Compute the parent index.md for an iteration or experiment.
fn parent_index_path(file_path: &str) -> Option<String> {
    let p = PathBuf::from(file_path);
    let parent_dir = p.parent()?;

    // For iterations, the parent is the experiment's index.md (in the
    // same folder). For experiments (which ARE the index.md), the parent
    // is one folder up's index.md.
    let basename = p.file_name()?.to_string_lossy().to_string();
    let parent_index = if basename == "index.md" {
        parent_dir.parent()?.join("index.md")
    } else {
        parent_dir.join("index.md")
    };
    Some(parent_index.to_string_lossy().to_string())
}

/// Refresh the hierarchy row for one file. Called from index_single_file.
fn populate_hierarchy_for_file(
    conn: &Connection,
    vault_path: &str,
    file_path: &str,
    body: &str,
) -> Result<(), String> {
    let (kind, iter_number) = classify_in_hierarchy(vault_path, file_path);
    if kind.is_empty() {
        // Not a hierarchy file. Make sure no stale row remains (e.g., a
        // file was renamed out of the projects tree).
        conn.execute("DELETE FROM hierarchy WHERE path = ?1", params![&file_path])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let parent = if kind == "project" {
        None
    } else {
        parent_index_path(file_path)
    };

    let modeling: Option<i64> = match extract_frontmatter_field(body, "modeling")
        .as_deref()
        .map(|s| s.to_ascii_lowercase())
    {
        Some(v) if v == "true" => Some(1),
        Some(v) if v == "false" => Some(0),
        _ => None,
    };

    conn.execute(
        "INSERT OR REPLACE INTO hierarchy
         (path, type, parent_path, iter_number, modeling)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&file_path, &kind, &parent, &iter_number, &modeling],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Find the next available `NN-` prefix in a parent directory by scanning
/// existing entries.
fn next_numbered_prefix(parent: &Path) -> u32 {
    if !parent.exists() {
        return 1;
    }
    let mut max_seen: u32 = 0;
    if let Ok(read) = fs::read_dir(parent) {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Accept either "NN-..." (folder) or "iter-NN - ..." (file).
            let candidate = if name.starts_with("iter-") {
                name.strip_prefix("iter-")
                    .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
                    .and_then(|s| s.parse::<u32>().ok())
            } else {
                name.split('-').next().and_then(|s| s.parse::<u32>().ok())
            };
            if let Some(n) = candidate {
                if n > max_seen {
                    max_seen = n;
                }
            }
        }
    }
    max_seen + 1
}

/// Sanitise a user-supplied name for use as a path segment. Strips any
/// character Windows or POSIX would object to, collapses whitespace.
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Create a plain note at `<vault>/<name>.md` with note frontmatter.
/// Errors if a file already exists at that path.
#[tauri::command]
fn create_note(vault_path: String, name: String, date_iso: String) -> Result<String, String> {
    let safe = sanitize_name(&name);
    if safe.is_empty() {
        return Err("Note name is empty".to_string());
    }
    let note_path = PathBuf::from(&vault_path).join(format!("{}.md", safe));
    if note_path.exists() {
        return Err(format!(
            "A note named \"{}\" already exists in the vault root.",
            safe
        ));
    }
    let id_slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let template = format!(
        "---\n\
         id: note-{date}-{slug}\n\
         type: note\n\
         date: \"{date}\"\n\
         ---\n\
         \n\
         # {name}\n\
         \n",
        date = date_iso,
        slug = id_slug,
        name = safe
    );
    fs::write(&note_path, template).map_err(|e| e.to_string())?;
    let path_str = note_path.to_string_lossy().to_string();
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

#[tauri::command]
fn create_project(vault_path: String, name: String, date_iso: String) -> Result<String, String> {
    let safe = sanitize_name(&name);
    if safe.is_empty() {
        return Err("Project name is empty".to_string());
    }
    let projects_dir = PathBuf::from(&vault_path).join(PROJECTS_DIR);
    fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
    let n = next_numbered_prefix(&projects_dir);
    let folder_name = format!("{:02}-{}", n, safe);
    let project_dir = projects_dir.join(&folder_name);
    fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let index_path = project_dir.join("index.md");
    let today = date_iso;
    let template = format!(
        "---\n\
         type: project\n\
         created: \"{date}\"\n\
         ---\n\
         \n\
         # {name}\n\
         \n\
         ## Overview\n\
         \n\
         ## Active experiments\n\
         \n\
         ## Notes\n\
         \n",
        date = today,
        name = safe
    );
    fs::write(&index_path, template).map_err(|e| e.to_string())?;

    let path_str = index_path.to_string_lossy().to_string();
    // Re-index immediately so list_projects sees it.
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

#[tauri::command]
fn create_experiment(
    vault_path: String,
    project_path: String,
    name: String,
    modeling: bool,
    date_iso: String,
) -> Result<String, String> {
    let safe = sanitize_name(&name);
    if safe.is_empty() {
        return Err("Experiment name is empty".to_string());
    }

    // The project_path points at the project's index.md. Its parent is
    // the project folder.
    let project_index = PathBuf::from(&project_path);
    let project_dir = project_index
        .parent()
        .ok_or_else(|| "Invalid project path".to_string())?;
    if !project_dir.exists() {
        return Err(format!("Project does not exist: {}", project_dir.display()));
    }

    let n = next_numbered_prefix(project_dir);
    let exp_folder = project_dir.join(format!("{:02}-{}", n, safe));
    fs::create_dir_all(&exp_folder).map_err(|e| e.to_string())?;

    let index_path = exp_folder.join("index.md");
    let today = date_iso;
    // Build a wikilink pointing to the project's folder name (its NN-
    // prefix). This matches Phase 1 wikilink resolution.
    let project_link_name = project_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let template = format!(
        "---\n\
         type: experiment\n\
         project: \"[[{project_link}]]\"\n\
         modeling: {modeling}\n\
         created: \"{date}\"\n\
         ---\n\
         \n\
         # {name}\n\
         \n\
         ## Question\n\
         What are we trying to learn?\n\
         \n\
         ## Hypotheses\n\
         H1:\n\
         H2:\n\
         \n\
         ## Predictions\n\
         If H1 is true, we should see:\n\
         If H2 is true, we should see:\n\
         \n\
         ## Methods\n\
         \n\
         ## Iterations\n\
         (auto-populated by Cluster 4 routing, plus manual additions.)\n\
         \n",
        project_link = project_link_name,
        modeling = modeling,
        date = today,
        name = safe
    );
    fs::write(&index_path, template).map_err(|e| e.to_string())?;

    let path_str = index_path.to_string_lossy().to_string();
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

#[tauri::command]
fn create_iteration(
    vault_path: String,
    experiment_path: String,
    date_iso: String,
) -> Result<String, String> {
    // experiment_path points at the experiment's index.md.
    let exp_index = PathBuf::from(&experiment_path);
    let exp_dir = exp_index
        .parent()
        .ok_or_else(|| "Invalid experiment path".to_string())?;
    if !exp_dir.exists() {
        return Err(format!("Experiment does not exist: {}", exp_dir.display()));
    }

    let n = next_numbered_prefix(exp_dir);
    let today = date_iso;
    let filename = format!("iter-{:02} - {}.md", n, today);
    let iter_path = exp_dir.join(&filename);

    let exp_link_name = exp_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let template = format!(
        "---\n\
         type: iteration\n\
         experiment: \"[[{exp_link}]]\"\n\
         iter: {n}\n\
         date: \"{date}\"\n\
         ---\n\
         \n\
         # Iter {nn:02} — {date}\n\
         \n\
         ## What I did\n\
         \n\
         ## What I observed\n\
         \n\
         ## What I conclude\n\
         \n\
         <!-- AUTO-GENERATED BELOW; DO NOT EDIT MANUALLY -->\n\
         \n\
         ## From daily notes\n\
         \n\
         _(no daily-note experiment blocks routed here yet — type \
         `::experiment <name> / iter-N\\n…\\n::end` in a daily note)_\n",
        exp_link = exp_link_name,
        n = n,
        nn = n,
        date = today
    );
    fs::write(&iter_path, template).map_err(|e| e.to_string())?;

    let path_str = iter_path.to_string_lossy().to_string();
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

/// List all projects in the vault (their `index.md` paths).
#[tauri::command]
fn list_projects(vault_path: String) -> Result<Vec<HierarchyItem>, String> {
    let conn = open_or_init_db(&vault_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT h.path, n.title
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'project'
             ORDER BY h.path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HierarchyItem {
                path: row.get(0)?,
                name: row
                    .get::<_, Option<String>>(1)?
                    .unwrap_or_else(|| "(untitled)".to_string()),
                iter_number: None,
                modeling: None,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Hierarchy context for a single file: its kind, parent (if any), and
/// siblings/children at the same level. Used by the RelatedHierarchyPanel
/// to render up- and across-the-tree navigation links.
///
/// Semantics by kind:
///   - project    → siblings = experiments under this project (i.e., children)
///   - experiment → parent = project, siblings = sibling experiments
///   - iteration  → parent = experiment, siblings = sibling iterations
#[derive(Serialize, Deserialize, Debug)]
pub struct HierarchyContext {
    pub kind: String, // 'project' | 'experiment' | 'iteration' | ''
    pub parent: Option<HierarchyItem>,
    pub siblings: Vec<HierarchyItem>,
}

#[tauri::command]
fn get_hierarchy_context(
    vault_path: String,
    current_path: String,
) -> Result<HierarchyContext, String> {
    let conn = open_or_init_db(&vault_path)?;

    // Look up this file's row.
    let mut self_stmt = conn
        .prepare("SELECT type, parent_path FROM hierarchy WHERE path = ?1")
        .map_err(|e| e.to_string())?;
    let row: Option<(String, Option<String>)> = self_stmt
        .query_row(params![&current_path], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .ok();

    let (kind, parent_path) = match row {
        Some(t) => t,
        None => {
            return Ok(HierarchyContext {
                kind: String::new(),
                parent: None,
                siblings: Vec::new(),
            });
        }
    };

    // Fetch parent details (if any).
    let parent: Option<HierarchyItem> = if let Some(pp) = parent_path.as_deref() {
        let mut p_stmt = conn
            .prepare(
                "SELECT h.path, n.title, h.iter_number, h.modeling
                 FROM hierarchy h
                 LEFT JOIN notes n ON n.path = h.path
                 WHERE h.path = ?1",
            )
            .map_err(|e| e.to_string())?;
        p_stmt
            .query_row(params![pp], |r| {
                Ok(HierarchyItem {
                    path: r.get(0)?,
                    name: r
                        .get::<_, Option<String>>(1)?
                        .unwrap_or_else(|| "(untitled)".to_string()),
                    iter_number: r.get::<_, Option<i64>>(2)?,
                    modeling: r.get::<_, Option<i64>>(3)?.map(|v| v != 0),
                })
            })
            .ok()
    } else {
        None
    };

    // Fetch siblings (or children if this is a project).
    //
    // - For a project: list experiments whose parent_path == this project's path.
    // - For an experiment: list other experiments under the same parent project,
    //   excluding self.
    // - For an iteration: list other iterations under the same experiment,
    //   excluding self, ordered by iter_number.
    let (sql, bind_parent, bind_self): (&str, &str, &str) = match kind.as_str() {
        "project" => (
            "SELECT h.path, n.title, h.iter_number, h.modeling
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'experiment' AND h.parent_path = ?1
             ORDER BY h.path",
            current_path.as_str(),
            "",
        ),
        "experiment" => (
            "SELECT h.path, n.title, h.iter_number, h.modeling
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'experiment'
               AND h.parent_path = ?1
               AND h.path != ?2
             ORDER BY h.path",
            parent_path.as_deref().unwrap_or(""),
            current_path.as_str(),
        ),
        "iteration" => (
            "SELECT h.path, n.title, h.iter_number, h.modeling
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'iteration'
               AND h.parent_path = ?1
               AND h.path != ?2
             ORDER BY h.iter_number",
            parent_path.as_deref().unwrap_or(""),
            current_path.as_str(),
        ),
        _ => {
            return Ok(HierarchyContext {
                kind,
                parent,
                siblings: Vec::new(),
            });
        }
    };

    let mut s_stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mapper = |r: &rusqlite::Row<'_>| -> rusqlite::Result<HierarchyItem> {
        Ok(HierarchyItem {
            path: r.get(0)?,
            name: r
                .get::<_, Option<String>>(1)?
                .unwrap_or_else(|| "(untitled)".to_string()),
            iter_number: r.get::<_, Option<i64>>(2)?,
            modeling: r.get::<_, Option<i64>>(3)?.map(|v| v != 0),
        })
    };

    let mut siblings: Vec<HierarchyItem> = Vec::new();
    if kind == "project" {
        let rows = s_stmt
            .query_map(params![bind_parent], mapper)
            .map_err(|e| e.to_string())?;
        for r in rows {
            siblings.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        let rows = s_stmt
            .query_map(params![bind_parent, bind_self], mapper)
            .map_err(|e| e.to_string())?;
        for r in rows {
            siblings.push(r.map_err(|e| e.to_string())?);
        }
    }

    Ok(HierarchyContext {
        kind,
        parent,
        siblings,
    })
}

/// List experiments. If `project_path` is provided, scope to that project;
/// otherwise return every experiment in the vault.
#[tauri::command]
fn list_experiments(
    vault_path: String,
    project_path: Option<String>,
) -> Result<Vec<HierarchyItem>, String> {
    let conn = open_or_init_db(&vault_path)?;
    let (sql, has_filter) = match project_path.as_deref() {
        Some(_) => (
            "SELECT h.path, n.title, h.modeling
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'experiment' AND h.parent_path = ?1
             ORDER BY h.path",
            true,
        ),
        None => (
            "SELECT h.path, n.title, h.modeling
             FROM hierarchy h
             LEFT JOIN notes n ON n.path = h.path
             WHERE h.type = 'experiment'
             ORDER BY h.path",
            false,
        ),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<HierarchyItem> {
        Ok(HierarchyItem {
            path: row.get(0)?,
            name: row
                .get::<_, Option<String>>(1)?
                .unwrap_or_else(|| "(untitled)".to_string()),
            iter_number: None,
            modeling: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
        })
    };
    let mut out = Vec::new();
    if has_filter {
        let rows = stmt
            .query_map(params![project_path.as_deref().unwrap_or("")], mapper)
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        let rows = stmt.query_map([], mapper).map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

// =============================================================================
// Phase 3 — Cluster 8 — Structured Views (Idea Log first)
// =============================================================================
//
// `query_notes_by_type` walks the vault, filters notes whose frontmatter has
// `type: <note_type>`, and returns each match as a NoteWithMetadata. The raw
// frontmatter block is returned as a YAML string so the frontend can parse
// it with the existing gray-matter dependency — keeps a YAML crate off the
// Rust side. Per the cluster spec: "parse the frontmatter on demand from
// disk — these aren't in the index. If parsing on demand is slow for >100
// notes, add a note_metadata_extras table that caches frontmatter as JSON.
// Defer this optimization."
//
// `create_idea` is the typed creator for `04-Ideas/<name>.md`, mirroring the
// shape of `create_note` / `create_project` / etc.

const IDEAS_DIR: &str = "04-Ideas";
const METHODS_DIR: &str = "05-Methods";
const PROTOCOLS_DIR: &str = "06-Protocols";

#[derive(Serialize)]
pub struct NoteWithMetadata {
    pub path: String,
    pub title: String,
    /// Raw YAML frontmatter as a single string, *without* the `---` fences.
    /// Empty if the note had no frontmatter.
    pub frontmatter_yaml: String,
    pub modified_at: i64,
}

/// Return the raw text between the first two `---` delimiters at the top of
/// `body`, or "" if there isn't a frontmatter block. Excludes the delimiters.
fn extract_frontmatter_block(body: &str) -> String {
    let mut lines = body.lines();
    if lines.next() != Some("---") {
        return String::new();
    }
    let mut buf = String::new();
    for line in lines {
        if line == "---" {
            return buf;
        }
        if !buf.is_empty() {
            buf.push('\n');
        }
        buf.push_str(line);
    }
    // No closing --- — treat as no frontmatter.
    String::new()
}

#[tauri::command]
fn query_notes_by_type(
    vault_path: String,
    note_type: String,
) -> Result<Vec<NoteWithMetadata>, String> {
    let mut out: Vec<NoteWithMetadata> = Vec::new();

    for entry in WalkDir::new(&vault_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules")
        })
        .filter_map(|e| e.ok())
    {
        if !(entry.file_type().is_file()
            && entry.path().extension().and_then(|s| s.to_str()) == Some("md"))
        {
            continue;
        }

        let path_str = entry.path().to_string_lossy().to_string();
        let body = match fs::read_to_string(entry.path()) {
            Ok(s) => s,
            Err(_) => continue,
        };

        // Cheap pre-filter: must have `type: <note_type>` in frontmatter.
        match extract_frontmatter_field(&body, "type") {
            Some(t) if t == note_type => {}
            _ => continue,
        }

        let title = extract_title(&body, &path_str);
        let frontmatter_yaml = extract_frontmatter_block(&body);
        // Two distinct Result error types here (walkdir vs io), so we can't
        // chain `and_then`; convert to Option as we go.
        let modified_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        out.push(NoteWithMetadata {
            path: path_str,
            title,
            frontmatter_yaml,
            modified_at,
        });
    }

    // Most-recently-modified first; the frontend can re-sort.
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

#[tauri::command]
fn create_idea(vault_path: String, name: String, date_iso: String) -> Result<String, String> {
    let safe = sanitize_name(&name);
    if safe.is_empty() {
        return Err("Idea name is empty".to_string());
    }

    let ideas_dir = PathBuf::from(&vault_path).join(IDEAS_DIR);
    fs::create_dir_all(&ideas_dir).map_err(|e| e.to_string())?;
    let idea_path = ideas_dir.join(format!("{}.md", safe));
    if idea_path.exists() {
        return Err(format!(
            "An idea named \"{}\" already exists in {}.",
            safe, IDEAS_DIR
        ));
    }

    let id_slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let template = format!(
        "---\n\
         id: idea-{date}-{slug}\n\
         type: idea\n\
         status: raw\n\
         date_conceived: \"{date}\"\n\
         related_concepts: []\n\
         ---\n\
         \n\
         # {name}\n\
         \n\
         ## The idea\n\
         \n\
         \n\
         ## Why it might matter\n\
         \n\
         \n\
         ## What would test it\n\
         \n",
        date = date_iso,
        slug = id_slug,
        name = safe
    );

    fs::write(&idea_path, template).map_err(|e| e.to_string())?;
    let path_str = idea_path.to_string_lossy().to_string();
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

/// Markers that delimit the auto-regenerated Reagents/Parts table inside a
/// Method file. Cortex owns everything between START and END; the user owns
/// everything else. Mirrors `PERSISTENT_AUTO_MARKER` but scoped to one
/// section instead of the whole file.
const REAGENTS_AUTO_START: &str =
    "<!-- REAGENTS-AUTO-START — derived from protocols listed above; do not edit -->";
const REAGENTS_AUTO_END: &str = "<!-- REAGENTS-AUTO-END -->";

/// Cluster 8 — Methods Arsenal creator. Writes a templated method note in
/// `05-Methods/<name>.md`. Domain is one of the 5 known categories; the
/// caller is responsible for passing a valid value, but we don't enforce
/// that here so the schema can evolve without a Rust change.
///
/// Template sections (per Cluster 8 v2 spec):
///   Protocols List, Objective, Reagents/Parts List (auto-fed from
///   protocols), Steps, Outcome.
///
/// `last_used` is intentionally omitted — file mtime is sufficient and
/// avoids a manual-bump field that would go stale.
#[tauri::command]
fn create_method(
    vault_path: String,
    name: String,
    domain: String,
    complexity: i64,
    date_iso: String,
) -> Result<String, String> {
    let safe = sanitize_name(&name);
    if safe.is_empty() {
        return Err("Method name is empty".to_string());
    }
    let complexity = complexity.clamp(1, 5);

    let methods_dir = PathBuf::from(&vault_path).join(METHODS_DIR);
    fs::create_dir_all(&methods_dir).map_err(|e| e.to_string())?;
    let method_path = methods_dir.join(format!("{}.md", safe));
    if method_path.exists() {
        return Err(format!(
            "A method named \"{}\" already exists in {}.",
            safe, METHODS_DIR
        ));
    }

    let id_slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // The Reagents/Parts List section starts empty between markers; the
    // first `regenerate_method_reagents` call will fill it in based on the
    // wikilinks the user adds under "## Protocols List".
    let template = format!(
        "---\n\
         id: method-{date}-{slug}\n\
         type: method\n\
         domain: \"{domain}\"\n\
         complexity: {complexity}\n\
         related_experiments: []\n\
         references: []\n\
         ---\n\
         \n\
         # {name}\n\
         \n\
         ## Protocols List\n\
         \n\
         _List the protocols that compose this method as wikilinks, one per line:_\n\
         \n\
         - [[Protocol name here]]\n\
         \n\
         ## Objective\n\
         \n\
         \n\
         ## Reagents/Parts List\n\
         \n\
         {start}\n\
         _(empty — add protocols above and reopen this file to populate)_\n\
         {end}\n\
         \n\
         ## Steps\n\
         \n\
         \n\
         ## Outcome\n\
         \n",
        date = date_iso,
        slug = id_slug,
        name = safe,
        domain = domain,
        complexity = complexity,
        start = REAGENTS_AUTO_START,
        end = REAGENTS_AUTO_END,
    );

    fs::write(&method_path, template).map_err(|e| e.to_string())?;
    let path_str = method_path.to_string_lossy().to_string();
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

/// Cluster 8 — Protocols subsystem creator. Writes a templated protocol
/// note in `06-Protocols/<name>.md`. Protocols are atomic units that
/// Methods aggregate from. Each protocol owns its own reagents/parts in
/// the frontmatter; Methods regenerate their Reagents/Parts table by
/// walking the protocols linked under "## Protocols List".
#[tauri::command]
fn create_protocol(
    vault_path: String,
    name: String,
    domain: String,
    date_iso: String,
) -> Result<String, String> {
    let safe = sanitize_name(&name);
    if safe.is_empty() {
        return Err("Protocol name is empty".to_string());
    }

    let protocols_dir = PathBuf::from(&vault_path).join(PROTOCOLS_DIR);
    fs::create_dir_all(&protocols_dir).map_err(|e| e.to_string())?;
    let proto_path = protocols_dir.join(format!("{}.md", safe));
    if proto_path.exists() {
        return Err(format!(
            "A protocol named \"{}\" already exists in {}.",
            safe, PROTOCOLS_DIR
        ));
    }

    let id_slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // Reagents live in the body, not the frontmatter — the table format
    // is identical to what Methods aggregate, so the protocol authoring
    // surface and the consuming surface match. Each row of this table
    // becomes a row in the Reagents/Parts table of every Method that
    // wikilinks this protocol under "## Protocols List".
    let template = format!(
        "---\n\
         id: protocol-{date}-{slug}\n\
         type: protocol\n\
         domain: \"{domain}\"\n\
         duration: \"\"\n\
         ---\n\
         \n\
         # {name}\n\
         \n\
         ## Purpose\n\
         \n\
         _What specific thing does this protocol achieve?_\n\
         \n\
         ## Reagents/Parts List\n\
         \n\
         | Name | Description | Quantity/Amount | Price |\n\
         |------|-------------|-----------------|-------|\n\
         |      |             |                 |       |\n\
         \n\
         ## Steps\n\
         \n\
         \n\
         ## Notes\n\
         \n",
        date = date_iso,
        slug = id_slug,
        name = safe,
        domain = domain,
    );

    fs::write(&proto_path, template).map_err(|e| e.to_string())?;
    let path_str = proto_path.to_string_lossy().to_string();
    index_single_file(vault_path, path_str.clone())?;
    Ok(path_str)
}

// =============================================================================
// Reagents/Parts auto-feed
// =============================================================================
//
// Methods compose protocols. The Method file has a "## Protocols List"
// section where the user writes wikilinks ([[Protocol name]]). On open
// (or explicit regenerate), Cortex:
//   1. Parses the Protocols List section to extract wikilink targets.
//   2. Resolves each target to a protocol file (filename or H1 match).
//   3. Reads each protocol's `reagents` frontmatter array.
//   4. Concatenates them into a single markdown table.
//   5. Replaces the region between REAGENTS_AUTO_START and
//      REAGENTS_AUTO_END inside the Method file. Inserts the markers
//      under the "## Reagents/Parts List" heading if absent.

/// Pull wikilink targets out of the body region under "## Protocols List",
/// stopping at the next H2 (or EOF). Order-preserving, deduplicated.
fn extract_protocols_list(body: &str) -> Vec<String> {
    let mut in_section = false;
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("## ") {
            // Heading boundary: enter section if it's the right one,
            // exit section otherwise.
            let heading = trimmed.trim_start_matches("## ").trim();
            if heading.eq_ignore_ascii_case("Protocols List") {
                in_section = true;
                continue;
            }
            if in_section {
                break;
            }
            continue;
        }
        if !in_section {
            continue;
        }
        // Extract every [[…]] on this line.
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let after = &rest[start + 2..];
            if let Some(end) = after.find("]]") {
                let target = after[..end].trim().to_string();
                if !target.is_empty() && !seen.contains(&target) {
                    seen.insert(target.clone());
                    out.push(target);
                }
                rest = &after[end + 2..];
            } else {
                break;
            }
        }
    }
    out
}

/// One reagent row aggregated from a protocol's frontmatter.
#[derive(Debug, Clone)]
struct ReagentRow {
    name: String,
    description: String,
    quantity: String,
    price: String,
    source_protocol_title: String,
}

/// Parse a protocol's body for the markdown table inside its
/// "## Reagents/Parts List" section. The expected shape is:
///
///   ## Reagents/Parts List
///
///   | Name | Description | Quantity/Amount | Price |
///   |------|-------------|-----------------|-------|
///   | Foo  | The foo     | 5 mL            | $10   |
///
/// Cells are positional: the first four columns map to name, description,
/// quantity, and price respectively. Header and separator rows are skipped.
/// Rows whose cells are all empty (the template placeholder) are skipped.
/// The function is forgiving — anything that doesn't look like a table row
/// inside the section is silently ignored.
fn parse_reagents_table(body: &str, source_title: &str) -> Vec<ReagentRow> {
    let mut out: Vec<ReagentRow> = Vec::new();
    let mut in_section = false;
    let mut header_seen = false;
    let mut separator_skipped = false;

    for line in body.lines() {
        let lstripped = line.trim_start();

        // Heading boundary: enter on the right one, exit on any other.
        if lstripped.starts_with("## ") {
            let heading = lstripped.trim_start_matches("## ").trim();
            if heading.eq_ignore_ascii_case("Reagents/Parts List") {
                in_section = true;
                header_seen = false;
                separator_skipped = false;
                continue;
            }
            if in_section {
                break;
            }
            continue;
        }
        if !in_section {
            continue;
        }

        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }

        // First pipe row in the section is the header; skip it.
        if !header_seen {
            header_seen = true;
            continue;
        }

        // Detect & skip the separator row (cells of dashes/colons only).
        if !separator_skipped {
            let core = trimmed.trim_start_matches('|').trim_end_matches('|');
            let is_separator = core.split('|').all(|c| {
                let t = c.trim();
                !t.is_empty() && t.chars().all(|ch| ch == '-' || ch == ':')
            });
            if is_separator {
                separator_skipped = true;
                continue;
            }
            // No separator — treat header_seen line as the only header
            // and this line as data.
            separator_skipped = true;
        }

        // Data row. Split, trim, drop the leading/trailing empties from
        // the surrounding pipes, then map positionally.
        let raw: Vec<&str> = trimmed.split('|').collect();
        let mut cells: Vec<String> = raw.iter().map(|s| s.trim().to_string()).collect();
        if cells.first().map(|s| s.is_empty()).unwrap_or(false) {
            cells.remove(0);
        }
        if cells.last().map(|s| s.is_empty()).unwrap_or(false) {
            cells.pop();
        }
        if cells.iter().all(|c| c.is_empty()) {
            // Template placeholder row — skip.
            continue;
        }

        out.push(ReagentRow {
            name: cells.first().cloned().unwrap_or_default(),
            description: cells.get(1).cloned().unwrap_or_default(),
            quantity: cells.get(2).cloned().unwrap_or_default(),
            price: cells.get(3).cloned().unwrap_or_default(),
            source_protocol_title: source_title.to_string(),
        });
    }

    out
}

/// Resolve a wikilink target to a file path inside the vault. Filename
/// match first, then H1. Mirrors the frontend's openWikilink resolver but
/// runs in Rust so we can call it from auto-regen.
fn resolve_wikilink(vault_path: &str, target: &str) -> Option<PathBuf> {
    let target_lower = target.to_lowercase();
    for entry in WalkDir::new(vault_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules")
        })
        .filter_map(|e| e.ok())
    {
        if !(entry.file_type().is_file()
            && entry.path().extension().and_then(|s| s.to_str()) == Some("md"))
        {
            continue;
        }
        // Filename match (stem, case-insensitive).
        let stem = entry
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if stem.to_lowercase() == target_lower {
            return Some(entry.path().to_path_buf());
        }
    }
    // Fall back to H1 title match.
    for entry in WalkDir::new(vault_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "node_modules")
        })
        .filter_map(|e| e.ok())
    {
        if !(entry.file_type().is_file()
            && entry.path().extension().and_then(|s| s.to_str()) == Some("md"))
        {
            continue;
        }
        if let Ok(body) = fs::read_to_string(entry.path()) {
            let title = extract_title(&body, &entry.path().to_string_lossy());
            if title.to_lowercase() == target_lower {
                return Some(entry.path().to_path_buf());
            }
        }
    }
    None
}

/// Render the aggregated reagents as a GitHub-flavoured markdown table.
fn build_reagents_table(rows: &[ReagentRow], unresolved: &[String]) -> String {
    let mut out = String::new();
    if rows.is_empty() && unresolved.is_empty() {
        out.push_str(
            "_(no protocols linked yet — add wikilinks under \"## Protocols List\" above)_\n",
        );
        return out;
    }
    if !rows.is_empty() {
        out.push_str("| Name | Description | Quantity/Amount | Price | Source protocol |\n");
        out.push_str("|------|-------------|-----------------|-------|------------------|\n");
        for r in rows {
            out.push_str(&format!(
                "| {} | {} | {} | {} | [[{}]] |\n",
                escape_cell(&r.name),
                escape_cell(&r.description),
                escape_cell(&r.quantity),
                escape_cell(&r.price),
                escape_cell(&r.source_protocol_title),
            ));
        }
        out.push('\n');
    }
    if !unresolved.is_empty() {
        out.push_str("_Unresolved wikilinks (no matching protocol file): ");
        for (i, u) in unresolved.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            out.push_str(&format!("`{}`", u));
        }
        out.push_str("_\n");
    }
    out
}

/// Escape pipe and newline characters for safe inclusion in a table cell.
fn escape_cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

/// Parse the Method body, regenerate the Reagents/Parts auto-section,
/// write the file back. Idempotent — calling it on a Method with no
/// linked protocols yields a "no protocols linked yet" placeholder.
#[tauri::command]
fn regenerate_method_reagents(vault_path: String, file_path: String) -> Result<(), String> {
    // Only operate on files inside METHODS_DIR. Defensive — frontend
    // also gates this, but a stray invocation shouldn't corrupt random
    // files.
    let methods_root = PathBuf::from(&vault_path).join(METHODS_DIR);
    let path = PathBuf::from(&file_path);
    if !path.starts_with(&methods_root) {
        return Ok(());
    }
    let existing = match fs::read_to_string(&file_path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };

    // 1. Parse the Protocols List section for wikilink targets.
    let targets = extract_protocols_list(&existing);

    // 2. Resolve each, read each protocol's reagents table, aggregate.
    let mut rows: Vec<ReagentRow> = Vec::new();
    let mut unresolved: Vec<String> = Vec::new();
    for t in &targets {
        match resolve_wikilink(&vault_path, t) {
            Some(p) => {
                let body = fs::read_to_string(&p).unwrap_or_default();
                let title = extract_title(&body, &p.to_string_lossy());
                let mut found = parse_reagents_table(&body, &title);
                rows.append(&mut found);
            }
            None => unresolved.push(t.clone()),
        }
    }

    // 3. Build the auto-table.
    let table = build_reagents_table(&rows, &unresolved);

    // 4. Splice into the file between markers. Three cases:
    //    a. Both markers present — replace between them.
    //    b. Markers missing but a "## Reagents/Parts List" heading
    //       exists — insert markers at the top of that section.
    //    c. Heading missing entirely — append a new section at EOF.
    let new_content = if let (Some(start_idx), Some(end_idx)) = (
        existing.find(REAGENTS_AUTO_START),
        existing.find(REAGENTS_AUTO_END),
    ) {
        if end_idx > start_idx {
            let head = &existing[..start_idx + REAGENTS_AUTO_START.len()];
            let tail = &existing[end_idx..];
            format!("{head}\n{table}{tail}")
        } else {
            // Markers in wrong order — fall through to heading insertion.
            insert_under_heading(&existing, &table)
        }
    } else {
        insert_under_heading(&existing, &table)
    };

    if new_content != existing {
        fs::write(&file_path, new_content).map_err(|e| e.to_string())?;
        index_single_file(vault_path, file_path)?;
    }
    Ok(())
}

/// Helper: stick the markers + table directly under the
/// "## Reagents/Parts List" heading, or append a fresh section at EOF.
fn insert_under_heading(existing: &str, table: &str) -> String {
    let needle = "## Reagents/Parts List";
    if let Some(idx) = existing.find(needle) {
        // Find the end of the heading line.
        let after_heading = &existing[idx + needle.len()..];
        let line_end = after_heading.find('\n').unwrap_or(after_heading.len());
        let head_end = idx + needle.len() + line_end;
        let head = &existing[..head_end];
        let tail = &existing[head_end..];
        // Find the next H2 to limit the auto-section's reach.
        let next_h2 = tail
            .find("\n## ")
            .map(|i| i + 1)
            .unwrap_or_else(|| tail.len());
        let after_section = &tail[next_h2..];
        format!(
            "{head}\n\n{start}\n{table}{end}\n{after_section}",
            head = head,
            start = REAGENTS_AUTO_START,
            table = table,
            end = REAGENTS_AUTO_END,
            after_section = after_section,
        )
    } else {
        // No heading — append a fresh section.
        format!(
            "{existing}\n\n## Reagents/Parts List\n\n{start}\n{table}{end}\n",
            existing = existing.trim_end(),
            start = REAGENTS_AUTO_START,
            table = table,
            end = REAGENTS_AUTO_END,
        )
    }
}

// -----------------------------------------------------------------------------
// Cluster 10 — GitHub integration
// -----------------------------------------------------------------------------
//
// Read-only integration that surfaces recent commits and open PRs from
// the user's configured repos inside today's daily note. The shape:
//
//   1. The user saves a personal access token + a list of "owner/name"
//      repos via the Integrations Settings modal (Ctrl+,).
//   2. Opening today's daily note triggers `regenerate_github_section`,
//      which fetches a fresh summary (cached for 10 min) and splices it
//      between `<!-- GITHUB-AUTO-START -->` / `<!-- GITHUB-AUTO-END -->`
//      markers under the `## Today's GitHub activity` heading.
//   3. Past daily notes are NOT regenerated — they stay frozen as the
//      day's snapshot.
//   4. Ctrl+Shift+G inserts a fresh summary at the cursor in any note
//      (the slash-command equivalent).
//
// Caching follows the cluster doc's "on creation + on demand" rule:
// the summary cache has a 10-minute TTL so opening the daily note
// repeatedly doesn't hammer the API; the user-login cache lives for
// the process's lifetime (login doesn't change for a token).
//
// Offline degradation: a fetch failure becomes an italicised
// "_(couldn't fetch GitHub: ...)_" line in the markdown rather than an
// error popup. The auto-section still renders; the user knows
// something's wrong but the daily note isn't blocked.

const GITHUB_AUTO_START: &str =
    "<!-- GITHUB-AUTO-START — derived from your configured GitHub repos; do not edit -->";
const GITHUB_AUTO_END: &str = "<!-- GITHUB-AUTO-END -->";
const GITHUB_HEADING: &str = "## Today's GitHub activity";
const GITHUB_USER_AGENT: &str = "Cortex-Cluster-10";
const GITHUB_API_VERSION: &str = "application/vnd.github+json";
const GITHUB_CACHE_TTL_SECS: u64 = 600;

/// In-process cache for the authenticated user's login, keyed by
/// token fingerprint. Cleared on `set_github_config` when the token
/// changes and on `clear_github_config`.
static GITHUB_USER_LOGIN_CACHE: Mutex<Option<(String, String)>> = Mutex::new(None);

/// In-process cache of the last successful summary fetch. 10-minute
/// TTL; bypassed on token / repos change. Holds a fingerprint of the
/// config that produced it so a stale cache from before a settings
/// change isn't reused.
struct GitHubSummaryCache {
    fetched_at: SystemTime,
    config_fingerprint: String,
    summary: GitHubSummary,
}
static GITHUB_SUMMARY_CACHE: Mutex<Option<GitHubSummaryCache>> = Mutex::new(None);

/// Result returned to the frontend (settings modal "Test connection"
/// button) and used internally by the daily-note splicer.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct GitHubSummary {
    /// Markdown body to splice between the AUTO-START/AUTO-END
    /// markers. Always non-empty — even an "unconfigured" or "offline"
    /// state produces a one-line italicised note.
    markdown: String,
    /// ISO8601 timestamp of the most recent successful fetch attempt.
    /// Empty string when the cache hasn't been warmed yet or every
    /// attempt has failed.
    last_fetch_iso: String,
    /// Empty on success, populated on degraded responses so the
    /// settings modal can surface a status line without parsing the
    /// markdown body.
    error: String,
}

#[derive(Deserialize)]
struct GhUser {
    login: String,
}

#[derive(Deserialize)]
struct GhCommitItem {
    sha: String,
    commit: GhCommitInner,
}

#[derive(Deserialize)]
struct GhCommitInner {
    message: String,
}

#[derive(Deserialize)]
struct GhPullItem {
    number: u64,
    title: String,
}

fn github_config_fingerprint(cfg: &GitHubConfig) -> String {
    // Token's first 8 chars (or all of it if shorter) plus the joined
    // repo list. Used to invalidate the summary cache on config
    // changes without leaking the full token into a key.
    let token_prefix = cfg.token.chars().take(8).collect::<String>();
    format!("{}|{}", token_prefix, cfg.repos.join(","))
}

/// ISO8601 UTC timestamp from a unix-seconds value. Hand-rolled with
/// the same civil-from-days algorithm as `today_iso_date`.
fn iso_utc_from_unix(secs: u64) -> String {
    let days_since_epoch = (secs / 86_400) as i64;
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let rem = secs % 86_400;
    let h = rem / 3600;
    let mn = (rem / 60) % 60;
    let s = rem % 60;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, h, mn, s)
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_utc_from_unix(secs)
}

fn iso_24h_ago() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_utc_from_unix(secs.saturating_sub(86_400))
}

async fn gh_get_user_login(client: &reqwest::Client, token: &str) -> Result<String, String> {
    let token_prefix = token.chars().take(8).collect::<String>();
    if let Ok(g) = GITHUB_USER_LOGIN_CACHE.lock() {
        if let Some((cached_prefix, cached_login)) = &*g {
            if cached_prefix == &token_prefix {
                return Ok(cached_login.clone());
            }
        }
    }
    let resp = client
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("User-Agent", GITHUB_USER_AGENT)
        .header("Accept", GITHUB_API_VERSION)
        .send()
        .await
        .map_err(|e| format!("GitHub /user request failed: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        // 401 = bad token; 403 = rate-limit / scope. Surface the
        // distinction so the settings modal can guide the user.
        return Err(format!(
            "GitHub /user returned HTTP {} — check your token",
            status.as_u16()
        ));
    }
    let user: GhUser = resp
        .json()
        .await
        .map_err(|e| format!("GitHub /user parse failed: {}", e))?;
    if let Ok(mut g) = GITHUB_USER_LOGIN_CACHE.lock() {
        *g = Some((token_prefix, user.login.clone()));
    }
    Ok(user.login)
}

async fn gh_recent_commits(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    since_iso: &str,
) -> Result<Vec<GhCommitItem>, String> {
    // Cluster 10 doc spec: "Recent commits (last 24 hours, across
    // selected repos)" — across, not by-author. We deliberately do
    // NOT filter by author: a personal research repo is single-author
    // anyway, and a multi-contributor repo is more useful when you
    // see your collaborators' commits too. PRs DO filter by author
    // (cluster doc is explicit about that distinction).
    let url = format!(
        "https://api.github.com/repos/{}/commits?since={}&per_page=50",
        repo, since_iso
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("User-Agent", GITHUB_USER_AGENT)
        .header("Accept", GITHUB_API_VERSION)
        .send()
        .await
        .map_err(|e| format!("commits request for {} failed: {}", repo, e))?;
    let status = resp.status();
    if status.as_u16() == 409 {
        // 409 Conflict from /commits = empty repo. Treat as no
        // commits rather than an error.
        return Ok(Vec::new());
    }
    if !status.is_success() {
        return Err(github_repo_error_hint(repo, status.as_u16()));
    }
    resp.json()
        .await
        .map_err(|e| format!("commits parse for {} failed: {}", repo, e))
}

/// Translate a GitHub repo-level HTTP error into a user-friendly hint.
/// 404 in particular is the most-confusable case: GitHub returns it
/// for both "doesn't exist" AND "exists but token lacks access" so
/// private-repo holders don't leak repo existence to scoping probes.
fn github_repo_error_hint(repo: &str, status: u16) -> String {
    match status {
        404 => format!(
            "repo `{}` not visible to this token (HTTP 404 — repo doesn't exist, owner/name typo, or token lacks `repo` scope for private repos / fine-grained access to this repo)",
            repo
        ),
        401 => format!(
            "token rejected for `{}` (HTTP 401 — token may be expired or revoked)",
            repo
        ),
        403 => format!(
            "access forbidden for `{}` (HTTP 403 — rate-limited or token lacks the required scope)",
            repo
        ),
        _ => format!("`{}` returned HTTP {}", repo, status),
    }
}

async fn gh_open_prs(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    author: &str,
) -> Result<Vec<GhPullItem>, String> {
    // The /pulls listing includes a `user` field on each PR; we filter
    // client-side rather than using /search/issues so v1 has fewer
    // moving parts.
    let url = format!(
        "https://api.github.com/repos/{}/pulls?state=open&sort=updated&direction=desc&per_page=30",
        repo
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("User-Agent", GITHUB_USER_AGENT)
        .header("Accept", GITHUB_API_VERSION)
        .send()
        .await
        .map_err(|e| format!("PRs request for {} failed: {}", repo, e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(github_repo_error_hint(repo, status.as_u16()));
    }
    // Use a lenient JSON shape so unexpected fields don't break us.
    let raw: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("PRs parse for {} failed: {}", repo, e))?;
    let mut out: Vec<GhPullItem> = Vec::new();
    if let serde_json::Value::Array(items) = raw {
        for v in items {
            // Filter by author === current user.
            let pr_author = v
                .get("user")
                .and_then(|u| u.get("login"))
                .and_then(|l| l.as_str())
                .unwrap_or("");
            if pr_author != author {
                continue;
            }
            let number = v.get("number").and_then(|n| n.as_u64()).unwrap_or(0);
            let title = v
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("(untitled)")
                .to_string();
            if number > 0 {
                out.push(GhPullItem { number, title });
            }
        }
    }
    Ok(out)
}

/// Build the markdown body that goes between the AUTO markers.
/// Pure formatting — no I/O. Always returns at least a one-line
/// status so the splice never produces an empty section.
fn format_github_markdown(
    repo_results: &[(String, Result<(Vec<GhCommitItem>, Vec<GhPullItem>), String>)],
) -> String {
    if repo_results.is_empty() {
        return "_(no GitHub repos configured — open Integrations settings with Ctrl+, to add some)_".to_string();
    }
    let mut out = String::new();
    let mut any_activity = false;
    for (repo, result) in repo_results {
        out.push_str(&format!("**{}**\n", repo));
        match result {
            Err(e) => {
                out.push_str(&format!("- _(couldn't fetch: {})_\n\n", e));
            }
            Ok((commits, prs)) => {
                if commits.is_empty() && prs.is_empty() {
                    out.push_str("- _(no activity in the last 24h)_\n\n");
                    continue;
                }
                any_activity = true;
                if !commits.is_empty() {
                    out.push_str(&format!(
                        "- {} commit{} in the last 24h:\n",
                        commits.len(),
                        if commits.len() == 1 { "" } else { "s" }
                    ));
                    for c in commits.iter().take(10) {
                        let short_sha = c.sha.chars().take(7).collect::<String>();
                        let first_line = c
                            .commit
                            .message
                            .lines()
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        out.push_str(&format!("  - `{}` {}\n", short_sha, first_line));
                    }
                    if commits.len() > 10 {
                        out.push_str(&format!("  - _…and {} more_\n", commits.len() - 10));
                    }
                }
                if !prs.is_empty() {
                    out.push_str(&format!(
                        "- {} open PR{} authored by you:\n",
                        prs.len(),
                        if prs.len() == 1 { "" } else { "s" }
                    ));
                    for pr in prs.iter().take(10) {
                        let title = pr.title.replace('\n', " ");
                        out.push_str(&format!("  - #{} \"{}\"\n", pr.number, title));
                    }
                    if prs.len() > 10 {
                        out.push_str(&format!("  - _…and {} more_\n", prs.len() - 10));
                    }
                }
                out.push('\n');
            }
        }
    }
    if !any_activity && !out.is_empty() {
        out.push_str("_(quiet day across all repos)_\n");
    }
    out.trim_end().to_string()
}

/// Inner async worker that does the actual API calls. Caches results
/// for 10 minutes keyed on a fingerprint of the (token, repos) pair.
async fn fetch_github_summary_inner(cfg: GitHubConfig) -> GitHubSummary {
    if cfg.token.is_empty() {
        return GitHubSummary {
            markdown:
                "_(no GitHub token configured — open Integrations settings with Ctrl+, to connect)_"
                    .to_string(),
            last_fetch_iso: String::new(),
            error: "no token".to_string(),
        };
    }
    let fingerprint = github_config_fingerprint(&cfg);
    if let Ok(g) = GITHUB_SUMMARY_CACHE.lock() {
        if let Some(cache) = &*g {
            if cache.config_fingerprint == fingerprint {
                if let Ok(age) = SystemTime::now().duration_since(cache.fetched_at) {
                    if age.as_secs() < GITHUB_CACHE_TTL_SECS {
                        return cache.summary.clone();
                    }
                }
            }
        }
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return GitHubSummary {
                markdown: format!("_(couldn't build HTTP client: {})_", e),
                last_fetch_iso: String::new(),
                error: format!("client build failed: {}", e),
            };
        }
    };
    let login = match gh_get_user_login(&client, &cfg.token).await {
        Ok(l) => l,
        Err(e) => {
            return GitHubSummary {
                markdown: format!("_(couldn't fetch GitHub: {})_", e),
                last_fetch_iso: String::new(),
                error: e,
            };
        }
    };
    let since = iso_24h_ago();
    let mut results: Vec<(String, Result<(Vec<GhCommitItem>, Vec<GhPullItem>), String>)> =
        Vec::new();
    for repo in &cfg.repos {
        let trimmed = repo.trim();
        if trimmed.is_empty() {
            continue;
        }
        let commits = gh_recent_commits(&client, &cfg.token, trimmed, &since).await;
        let prs = gh_open_prs(&client, &cfg.token, trimmed, &login).await;
        let combined = match (commits, prs) {
            (Ok(c), Ok(p)) => Ok((c, p)),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        results.push((trimmed.to_string(), combined));
    }
    let markdown = format_github_markdown(&results);
    let now_iso = iso_now();
    let summary = GitHubSummary {
        markdown,
        last_fetch_iso: now_iso,
        error: String::new(),
    };
    if let Ok(mut g) = GITHUB_SUMMARY_CACHE.lock() {
        *g = Some(GitHubSummaryCache {
            fetched_at: SystemTime::now(),
            config_fingerprint: fingerprint,
            summary: summary.clone(),
        });
    }
    summary
}

#[tauri::command]
fn get_github_config(app: tauri::AppHandle) -> Result<Option<GitHubConfig>, String> {
    let cfg = read_config(&app)?;
    Ok(cfg.github)
}

#[tauri::command]
fn set_github_config(
    app: tauri::AppHandle,
    token: String,
    repos: Vec<String>,
) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    let token_changed = cfg
        .github
        .as_ref()
        .map(|g| g.token != token)
        .unwrap_or(true);
    let cleaned_repos: Vec<String> = repos
        .into_iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();
    cfg.github = Some(GitHubConfig {
        token,
        repos: cleaned_repos,
    });
    write_config(&app, &cfg)?;
    if token_changed {
        if let Ok(mut g) = GITHUB_USER_LOGIN_CACHE.lock() {
            *g = None;
        }
    }
    if let Ok(mut g) = GITHUB_SUMMARY_CACHE.lock() {
        *g = None;
    }
    Ok(())
}

#[tauri::command]
fn clear_github_config(app: tauri::AppHandle) -> Result<(), String> {
    let mut cfg = read_config(&app)?;
    cfg.github = None;
    write_config(&app, &cfg)?;
    if let Ok(mut g) = GITHUB_USER_LOGIN_CACHE.lock() {
        *g = None;
    }
    if let Ok(mut g) = GITHUB_SUMMARY_CACHE.lock() {
        *g = None;
    }
    Ok(())
}

/// Force a fresh fetch (bypasses the 10-min cache). Used by the
/// settings modal's "Test connection" button.
#[tauri::command]
async fn fetch_github_summary_now(app: tauri::AppHandle) -> Result<GitHubSummary, String> {
    if let Ok(mut g) = GITHUB_SUMMARY_CACHE.lock() {
        *g = None;
    }
    let cfg = read_config(&app)?.github.unwrap_or_default();
    Ok(fetch_github_summary_inner(cfg).await)
}

/// Fetch (cache-respecting). Used by Ctrl+Shift+G insert-at-cursor and
/// by `regenerate_github_section` for daily-note auto-population.
#[tauri::command]
async fn fetch_github_summary(app: tauri::AppHandle) -> Result<GitHubSummary, String> {
    let cfg = read_config(&app)?.github.unwrap_or_default();
    Ok(fetch_github_summary_inner(cfg).await)
}

/// Helper: stick the markers + body directly under
/// "## Today's GitHub activity", or append a fresh section at EOF.
/// Mirrors `insert_under_heading` for Cluster 8's reagents table.
fn insert_github_under_heading(existing: &str, body: &str) -> String {
    if let Some(idx) = existing.find(GITHUB_HEADING) {
        let after_heading = &existing[idx + GITHUB_HEADING.len()..];
        let line_end = after_heading.find('\n').unwrap_or(after_heading.len());
        let head_end = idx + GITHUB_HEADING.len() + line_end;
        let head = &existing[..head_end];
        let tail = &existing[head_end..];
        // Limit our auto-section's reach to the next H2 so we don't
        // own anything below.
        let next_h2 = tail
            .find("\n## ")
            .map(|i| i + 1)
            .unwrap_or_else(|| tail.len());
        let after_section = &tail[next_h2..];
        format!(
            "{head}\n\n{start}\n{body}\n{end}\n{after_section}",
            head = head,
            start = GITHUB_AUTO_START,
            body = body,
            end = GITHUB_AUTO_END,
            after_section = after_section,
        )
    } else {
        format!(
            "{existing}\n\n{heading}\n\n{start}\n{body}\n{end}\n",
            existing = existing.trim_end(),
            heading = GITHUB_HEADING,
            start = GITHUB_AUTO_START,
            body = body,
            end = GITHUB_AUTO_END,
        )
    }
}

/// Splice a fresh GitHub summary into the given file (typically
/// today's daily note). Three cases mirroring `regenerate_method_reagents`:
///   a. Both markers present — replace between them.
///   b. Markers missing but heading exists — insert markers under it.
///   c. Heading missing entirely — append a fresh section at EOF.
///
/// Idempotent: the file is only re-written when the computed content
/// differs from disk, avoiding spurious git commits.
///
/// Only operates on today's daily note (matched by basename ===
/// "<today_iso>.md"). Past daily notes stay frozen as the day's
/// snapshot.
#[tauri::command]
async fn regenerate_github_section(
    app: tauri::AppHandle,
    vault_path: String,
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    let basename = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let today_basename = format!("{}.md", today_iso_date());
    if basename != today_basename {
        // Past daily note — leave it alone.
        return Ok(());
    }
    let cfg = read_config(&app)?.github.unwrap_or_default();
    if cfg.token.is_empty() || cfg.repos.is_empty() {
        // Don't touch the file if the user hasn't configured anything.
        // The "no token" / "no repos" hint only appears when the user
        // explicitly asks for a summary (via Ctrl+Shift+G or the
        // settings modal); it shouldn't auto-inject into the daily
        // note.
        return Ok(());
    }
    let existing = match fs::read_to_string(&file_path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let summary = fetch_github_summary_inner(cfg).await;
    let new_content = if let (Some(start_idx), Some(end_idx)) = (
        existing.find(GITHUB_AUTO_START),
        existing.find(GITHUB_AUTO_END),
    ) {
        if end_idx > start_idx {
            let head = &existing[..start_idx + GITHUB_AUTO_START.len()];
            let tail = &existing[end_idx..];
            format!(
                "{head}\n{body}\n{tail}",
                head = head,
                body = summary.markdown,
                tail = tail
            )
        } else {
            insert_github_under_heading(&existing, &summary.markdown)
        }
    } else {
        insert_github_under_heading(&existing, &summary.markdown)
    };
    if new_content != existing {
        fs::write(&file_path, new_content).map_err(|e| e.to_string())?;
        index_single_file(vault_path, file_path)?;
    }
    Ok(())
}

// -----------------------------------------------------------------------------
// App entry
// -----------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(WatcherState { _watcher: None }))
        .invoke_handler(tauri::generate_handler![
            save_vault_config,
            load_vault_config,
            save_last_open,
            load_last_open,
            read_vault_tree,
            start_vault_watcher,
            read_markdown_file,
            read_binary_file,
            read_pdf_annotations,
            write_pdf_annotations,
            populate_reading_log,
            write_markdown_file,
            git_auto_commit,
            ensure_daily_log,
            index_single_file,
            rebuild_index,
            search_notes,
            list_all_notes,
            get_backlinks,
            create_note,
            create_project,
            create_experiment,
            create_iteration,
            list_projects,
            list_experiments,
            get_hierarchy_context,
            query_marks,
            mark_marks_injected,
            ensure_persistent_file,
            regenerate_persistent_file,
            route_experiment_blocks,
            query_notes_by_type,
            create_idea,
            create_method,
            create_protocol,
            regenerate_method_reagents,
            get_github_config,
            set_github_config,
            clear_github_config,
            fetch_github_summary,
            fetch_github_summary_now,
            regenerate_github_section,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
