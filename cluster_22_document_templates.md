# Cluster 22 — Document Templates

_Phase 3, picked from the v1.1+ deferred list at the end of Cluster 21. No upstream dependencies beyond the existing creation flows (`create_*` Tauri commands + `ensure_daily_log`)._

---

## What this is

A **Templates** button in the sidebar opens a modal listing every document-type template. Each template is a real `.md` file at `<vault>/.cortex/document-templates/<type>.md` that the user can open and edit like any other note — structure, headings, frontmatter defaults, font sizes, effects, animations, spacing — anything Cluster 21's toolbar can apply. When a document of that type is created via the existing creation flows (`Ctrl+D` for daily logs, the hierarchy modal for projects / experiments / iterations, `Ctrl+N` for plain notes, etc.), the new file is seeded with a deep copy of the template's content with placeholder tokens substituted in.

## Why we want it

The eight types of documents Cortex creates each had a hardcoded body baked into Rust. Customising any of them required editing `lib.rs` and recompiling — fine for the early scaffolding phase, but a friction point once the user wanted to add a "Mood / energy" section to every daily log, or pull the iteration "What I did / observed / conclude" headings up into the iteration's own conventions. Templates that live as editable `.md` files in the vault remove that friction and double as a vehicle for delivering Cluster 21's effects to every freshly-created document.

## Architectural shape

- **Per-type template files at `<vault>/.cortex/document-templates/<type>.md`.** Hand-editable; live in the vault so they version-control alongside the rest of the notes via the existing git auto-commit.
- **Frontmatter passes through.** The template's frontmatter is the new document's starting frontmatter — `kind: experiment`, `tags: [planning]`, etc. all inherit.
- **Body formatting passes through.** Because Cluster 21 effects round-trip via inline HTML spans, the template's effects (gradient titles, animated text, etc.) copy verbatim into the new doc.
- **Placeholder substitution.** A small token replacer runs on the seed text — `{{date}}` → today's local ISO date, `{{title}}` → user-supplied title from the creation modal, `{{slug}}` → kebab-case of title, `{{iteration_number}}` → next iteration number, `{{parent_project}}` / `{{parent_experiment}}` → name of the containing folder, etc.
- **Sidebar button.** "Templates" opens a modal with a row per type. Each row: Edit (opens the template in the active slot) / Reset (regenerates the bundled default).
- **Defaults bundled.** First-run, when a template doesn't exist on disk, `read_or_init_template` writes the bundled default and returns it.
- **Tauri commands:** `list_document_templates`, `read_document_template`, `write_document_template`, `reset_document_template`, `preview_document_template`.

## Document types in v1.0

1. **Daily Log** — seeded by `Ctrl+D` and the calendar's "open today" path.
2. **Project** — seeded by `+ Proj` / hierarchy modal.
3. **Experiment** — `+ Exp` / `Ctrl+Shift+E` / hierarchy modal.
4. **Iteration** — `+ Iter` / `Ctrl+Shift+I` / hierarchy modal. Also: `find_or_create_iteration` (the Cluster 4 auto-create path that fires when a user types `::experiment X / iter-N` in a daily note and the iteration doesn't exist yet) always honours the template if present so iteration files have one shape regardless of how they're created.
5. **Protocol** — created via `+ Protocol` sidebar.
6. **Idea** — created via `+ Idea` sidebar.
7. **Method** — created via `+ Method` sidebar.
8. **Plain note** — `Ctrl+N` / `+ Note` button.

Reading-log entry and per-folder default are intentionally deferred to v1.1+ (see Sequenced follow-ups).

## Placeholder tokens in v1.0

| Token | Meaning |
|---|---|
| `{{date}}` | Today's local ISO date `YYYY-MM-DD` |
| `{{datetime}}` | Local date + 24h time `YYYY-MM-DD HH:mm` |
| `{{title}}` | User-typed title from the creation modal |
| `{{slug}}` | Kebab-case of the title |
| `{{iteration_number}}` | Auto-incremented iteration index for that experiment |
| `{{iteration_number_padded}}` | Same, zero-padded to 2 digits |
| `{{parent_project}}` | Name of containing project folder (experiments / iterations only) |
| `{{parent_experiment}}` | Name of containing experiment folder (iterations only) |
| `{{vault_name}}` | Name of the vault root folder |
| `{{prev_daily_link}}` | Wikilink to yesterday's daily log (daily-log template only) |
| `{{week_number}}` | ISO week number |
| `{{day_of_week}}` | "Monday" / "Tuesday" / ... |
| `{{modeling}}` | "true" / "false" (experiments only) |
| `{{domain}}` | Method/protocol domain (modeling / wet-lab / etc.) |
| `{{complexity}}` | Method complexity 1–5 |
| `{{reagents_auto_start}}` / `{{reagents_auto_end}}` | The Cluster 8 reagents-auto sentinels — placeholder-form so the user can edit surrounding markdown without breaking marker syntax |

`{{author}}` was on the spec but deferred — it would need an author-config schema, and there's no existing hook for one in `config.json`.

## Template-management UI in v1.0

1. Sidebar **Templates** button (next to GH).
2. Modal: list of all eight types, last-modified timestamp, Edit / Reset buttons.
3. Edit-in-active-slot: clicking Edit closes the modal and routes the template's `.md` path through `selectFileInSlot(templatePath, activeSlotIdx)`. The template opens like any other note in the active TabPane.
4. Default-template auto-creation lazy on first read.
5. Global "Templates enabled" toggle in the modal header. Persisted in localStorage at `cortex:templates-enabled` (default `true`). When off, every `create_*` invoke from the frontend passes `useTemplate: false`, and the backend takes its hardcoded fallback body verbatim — pure escape hatch for when a template breaks something.
6. Live preview pane: the right side of the modal shows what a freshly-created document of the selected type would look like, rendered against sample placeholder values. Updates whenever a different row is selected.

## Decisions made

- **Templates own ONLY the body** of the new file. Filename, directory, and any post-creation regen passes (Cluster 4 routing AUTO-GENERATED footer, Cluster 8 reagents auto-section, Cluster 14 time-tracking splice) stay owned by the `create_*` function. This means a user can't accidentally break those pipelines by deleting marker text from the template.
- **Iteration files always carry the AUTO-GENERATED footer.** If the template doesn't include it, `create_iteration` and `find_or_create_iteration` append it after placeholder substitution. Cluster 4 routing is non-negotiable.
- **Reagents-auto sentinels via `{{reagents_auto_start}}` / `{{reagents_auto_end}}`.** Method templates use the placeholder form; substitution swaps in the real `<!-- REAGENTS-AUTO-START -->` / `<!-- REAGENTS-AUTO-END -->` markers. This way the user can rename "Reagents/Parts List" or add prose around the markers in the template without breaking the regen scanner.
- **Unknown tokens stay literal.** A template that uses `{{author}}` (deferred) renders with the literal `{{author}}` text in the output, so the user can spot which tokens haven't been wired up. Failing to a literal is gentler than failing to an empty string.
- **Lazy first-run defaults.** No "initialize templates" wizard — the first time the user clicks Edit (or the first time `read_document_template` is invoked from anywhere), the bundled default is written to disk for that one type. Eight individual lazy initializations rather than one big atomic one.

## Architecture sketch

### Backend (`src-tauri/src/lib.rs`)

```
const DOCUMENT_TEMPLATES_DIR = ".cortex/document-templates"
const DOC_TYPES = [8 strings]

fn default_template_for(doc_type) -> &'static str
struct PlaceholderContext { date, title, slug, iteration_number, ... }
fn apply_placeholders(template, ctx) -> String
fn read_or_init_template(vault, doc_type) -> Result<String>
fn resolve_template_body(vault, doc_type, use_template) -> Option<String>
fn iso_week_number(iso) -> i64
fn iso_date_minus_one_day(iso) -> Option<String>
fn vault_basename(vault) -> String

#[tauri::command] fn list_document_templates(vault) -> Vec<DocumentTemplateInfo>
#[tauri::command] fn read_document_template(vault, doc_type) -> String
#[tauri::command] fn write_document_template(vault, doc_type, body) -> ()
#[tauri::command] fn reset_document_template(vault, doc_type) -> String
#[tauri::command] fn preview_document_template(template_body, ...ctx) -> String
```

Every `create_*` command grew an `Option<bool>` `use_template` arg. The body-construction line changed from a flat `format!()` to:

```rust
let template = match resolve_template_body(&vault_path, "<type>", use_template) {
    Some(body) => apply_placeholders(&body, &PlaceholderContext { ... }),
    None       => format!("...existing hardcoded body..."),
};
```

The hardcoded body stays in source as the escape-hatch fallback. Both branches end at the same `fs::write(&path, template)` call so no other code below changes.

### Frontend

```
src/components/TemplatesModal.tsx
  exports TemplatesModal, readTemplatesEnabled

src/App.tsx
  + import TemplatesModal, readTemplatesEnabled
  + templatesModalOpen state
  + "Templates" sidebar button next to GH
  + ensure_daily_log call passes useTemplate
  + modal mount with onEdit → setTemplatesModalOpen(false) + selectFileInSlot()

src/components/NewHierarchyModal.tsx
  + import readTemplatesEnabled
  + read once at top of submit() → useTemplate
  + every create_* invoke passes useTemplate
```

## Verify pointer

`verify-cluster-22-v1.0.ps1` walks 11 smoke passes (A–K) covering: sidebar button + modal opens, first-run lazy defaults, edit-template-then-create, placeholder substitution, reset to default, Templates-enabled escape hatch, Cluster 4 auto-create path, preview pane sample values, reagents auto-section round-trip, Cluster 21 effects round-tripping through templates, cross-cluster regression smoke (Cluster 4 / 8 / 6 / 19).

## Sequenced follow-ups (v1.1+)

1. **Per-folder default template** — any new note created inside a specific subfolder picks up that folder's template (e.g., new note in `04-Ideas/` uses the idea template even when created via `Ctrl+N`). Depends on a folder→template-path mapping picker UI; sized as its own session.
2. **Reading-log entry template** — for the Cluster 6 v1.4 reading-log section splice. That's section-level not file-level; bigger refactor.
3. **Template export / import** — zip of all templates so a user can share their template set across machines.
4. **`{{author}}` placeholder** — needs an author-name field in `config.json`.
5. **Per-document-type sub-templates** — e.g., "Phase 1 experiment" vs "Phase 2 experiment".
6. **Template inheritance** — child template extends parent.
7. **Conditional sections** — `{{#if iteration_number > 1}}…{{/if}}`.
8. **Template-driven file-tree icons / colors** — based on template metadata.
9. **Marketplace / community-shared templates.**
