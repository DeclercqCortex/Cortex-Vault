# verify-cluster-22-v1.0.ps1
# Phase 3 Cluster 22 v1.0 — Document Templates.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm tauri dev          # Cargo changes here — full restart required
#   .\verify-cluster-22-v1.0.ps1
#
# What ships
# ----------
#
# A "Templates" button in the App sidebar that opens a modal listing
# every document-type template. Each template is a real .md file at
# `<vault>/.cortex/document-templates/<type>.md` that you can open and
# edit like any other note — structure, headings, frontmatter defaults,
# every Cluster 21 effect (font sizes, gradient text, glow, animation,
# particle marks) all apply because we're editing a real .md file
# through the standard TipTap pipeline.
#
# When a document is created via the existing creation flows (Ctrl+D
# for daily logs, NewHierarchyModal for projects / experiments /
# iterations / ideas / methods / protocols / plain notes), the new
# file's body is seeded with a deep copy of the template's content.
# Placeholder tokens get substituted at creation time:
#
#   {{date}}                today's local ISO date YYYY-MM-DD
#   {{datetime}}            local date + 24h time
#   {{title}}               user-supplied title from creation modal
#   {{slug}}                kebab-case of title
#   {{iteration_number}}    auto-incremented iteration index
#   {{iteration_number_padded}}  zero-padded NN form
#   {{parent_project}}      name of containing project folder
#   {{parent_experiment}}   name of containing experiment folder
#   {{vault_name}}          name of the vault root folder
#   {{prev_daily_link}}     wikilink to yesterday (daily-log only)
#   {{week_number}}         ISO week number
#   {{day_of_week}}         "Monday" / "Tuesday" / ...
#   {{modeling}}            "true" / "false" (experiments only)
#   {{domain}}              method/protocol domain
#   {{complexity}}          method complexity 1-5
#   {{reagents_auto_start}} / {{reagents_auto_end}}  the Cluster 8
#                          REAGENTS-AUTO sentinels — placeholders so
#                          the user can edit surrounding text without
#                          breaking the marker syntax
#
# Architecture
# ------------
#
# Backend (src-tauri/src/lib.rs):
#
#   const DOCUMENT_TEMPLATES_DIR = ".cortex/document-templates"
#   const DOC_TYPES = ["daily-log","project","experiment","iteration",
#                      "protocol","idea","method","note"]
#
#   default_template_for(doc_type) returns a bundled string constant
#   per type (DEFAULT_TEMPLATE_DAILY_LOG / _PROJECT / _EXPERIMENT /
#   _ITERATION / _PROTOCOL / _IDEA / _METHOD / _NOTE).
#
#   apply_placeholders(template, ctx) is the substitution helper.
#   PlaceholderContext struct holds every supported field. Unknown
#   tokens are left literal so the user can spot which haven't been
#   wired up.
#
#   read_or_init_template(vault, doc_type) reads from disk if
#   present; if missing, lazily writes the bundled default and
#   returns it. First-run UX is "open Templates modal → see entries
#   for every type, click Edit → see the populated default already
#   on disk".
#
#   resolve_template_body(vault, doc_type, use_template) is the
#   per-create_* helper. When use_template is Some(false), returns
#   None and the create_* function falls back to its existing
#   hardcoded format!() body — pure escape hatch.
#
# Five new Tauri commands:
#   - list_document_templates(vault) → Vec<DocumentTemplateInfo>
#   - read_document_template(vault, doc_type) → String (lazy init)
#   - write_document_template(vault, doc_type, body) → ()
#   - reset_document_template(vault, doc_type) → String (default)
#   - preview_document_template(template_body, ...ctx fields) → String
#
# All seven create_* commands and ensure_daily_log grew an optional
# `use_template: Option<bool>` arg; default behaviour (None or
# Some(true)) reads the template, applies placeholders, writes.
# Some(false) takes the existing hardcoded path. find_or_create_iteration
# (the Cluster 4 auto-create path) always uses the template if
# present so the iteration file format is consistent regardless of
# how it was created.
#
# Frontend:
#
#   src/components/TemplatesModal.tsx — list of types + Edit / Reset
#   buttons + live preview pane + "Templates enabled" toggle. Edit
#   routes through selectFileInSlot(templatePath, activeSlotIdx),
#   which means TipTap, the Cluster 21 toolbar, every effect work
#   on templates with no extra wiring.
#
#   readTemplatesEnabled() / writeTemplatesEnabled() helpers. The
#   localStorage key is `cortex:templates-enabled`, default true.
#
#   App.tsx wires templatesModalOpen state, a "Templates" sidebar
#   button (next to GH), and the modal mount. NewHierarchyModal
#   reads the toggle once per submit and threads useTemplate into
#   each create_* invoke. App.tsx threads useTemplate into the
#   ensure_daily_log invoke (Ctrl+D path).
#
# v1.0 deferrals
# --------------
#
#   - Per-folder default template (placeholder #5) — depends on a
#     folder→template-path mapping UI; sized as its own session.
#   - Reading-log entry template — that's a section splice rather
#     than file creation; bigger refactor.
#   - Template export / import (zip of all templates) — sized as
#     its own session.
#   - {{author}} placeholder — needs an author config schema.
#   - Per-document-type sub-templates ("Phase 1 experiment" vs
#     "Phase 2") — v1.1+ in the cluster doc.
#   - Template inheritance / conditional sections — v1.1+.
#   - Marketplace / community-shared templates — v1.1+.
#
# Smoke tests
# -----------
#
# Pass A — Sidebar button + modal opens:
#   1. Open the app. Sidebar shows a "Templates" button next to GH.
#   2. Click it. A modal appears titled "Document templates" with
#      eight rows: Daily Log, Plain note, Idea, Method, Protocol,
#      Project, Experiment, Iteration. Each row shows its last-
#      edited timestamp (or "Default (not yet customised)" on
#      first run) and Edit / Reset buttons.
#   3. The "Templates enabled" checkbox in the header is on.
#   4. Click any row → the right-hand preview pane re-renders with
#      a sample-rendered version of that template (sample title,
#      slug, etc. filled in).
#   5. Esc closes the modal.
#
# Pass B — First-run defaults written lazily:
#   1. On a fresh vault, click Templates → Daily Log row → Edit.
#   2. Modal closes; the active slot opens
#      `<vault>/.cortex/document-templates/daily-log.md`.
#   3. The file contains the bundled default with `{{date}}`,
#      `{{week_number}}`, `{{day_of_week}}` tokens visible.
#   4. Verify on disk: the file exists at the expected path.
#   5. Repeat for every other type — each time the file is lazily
#      written on first read.
#
# Pass C — Edit a template, create a new doc:
#   1. Open the daily-log template (Templates → Daily Log → Edit).
#   2. Add a section above "## Today's MIT", e.g.:
#        ## Mood / energy
#
#        Energy: ___ / 10
#        Mood: ___ / 10
#   3. Save (Ctrl+S).
#   4. Press Ctrl+D to open today's daily log.
#   5. The new daily log includes the "## Mood / energy" section
#      between the title and "## Today's MIT".
#
# Pass D — Placeholder substitution at creation time:
#   1. Open the iteration template (Templates → Iteration → Edit).
#   2. Verify the body contains `{{iteration_number}}`,
#      `{{parent_experiment}}`, `{{date}}`.
#   3. Create a new iteration via the +Iter sidebar button →
#      pick an experiment → confirm.
#   4. The new iteration file has `iter: <N>` (the literal number)
#      in the frontmatter, the `{{parent_experiment}}` token
#      replaced by the experiment folder name, and `{{date}}`
#      replaced by today's local ISO date.
#   5. The Cluster 4 AUTO-GENERATED footer is appended (the
#      template's footer is added if missing — non-negotiable).
#
# Pass E — Reset to default:
#   1. Edit the idea template — strip everything except a single
#      H1, save.
#   2. Templates modal → Idea → Reset → confirm.
#   3. The template re-fills with the bundled default body.
#   4. Preview pane re-renders.
#   5. Open Edit again → file content matches the default.
#
# Pass F — Templates-enabled toggle (escape hatch):
#   1. Templates modal → uncheck "Templates enabled".
#   2. Close modal.
#   3. Create a new note (+ Note button → Enter "Test note" →
#      Create). The new note uses the v1.0-pre hardcoded body
#      (no template-rendered output, even if the user customised
#      the note template).
#   4. Re-open Templates → re-check Templates enabled.
#   5. Create another new note. This one uses the template.
#   6. Reload the app. The toggle survives — localStorage at
#      cortex:templates-enabled.
#
# Pass G — Cluster 4 auto-create path:
#   1. Templates → Iteration → Edit. Add a `## Pre-flight checklist`
#      section above the AUTO-GENERATED footer. Save.
#   2. Open today's daily log (Ctrl+D). Type
#        ::experiment <NewExperimentName> / iter-1
#        observed something
#        ::end
#   3. Save. The auto-created iteration file in the experiment
#      folder includes the "## Pre-flight checklist" section
#      from the template, the AUTO-GENERATED footer, and the
#      routed daily-note block.
#
# Pass H — Preview pane sample values:
#   1. Templates modal → Experiment row.
#   2. Preview pane shows:
#        title: Boundary condition sweep
#        modeling: true
#        parent_project: 01-Mean-field tumor modeling
#   3. Switch to Iteration → preview shows
#        iter: 3, parent_experiment: 01-Boundary condition sweep
#   4. Every doc type has plausible sample values that exercise
#      the placeholders that type uses.
#
# Pass I — Reagents-auto-section round-trip (Method template):
#   1. Templates → Method → Edit.
#   2. Verify the body contains `{{reagents_auto_start}}` /
#      `{{reagents_auto_end}}` literal placeholder text — the
#      Cluster 8 sentinels are template-time tokens so the user
#      can edit surrounding markdown without breaking the markers.
#   3. Create a new method (+ Method button). The new file's
#      Reagents/Parts List section contains the real
#      `<!-- REAGENTS-AUTO-START — derived from protocols listed
#      above; do not edit -->` and `<!-- REAGENTS-AUTO-END -->`
#      sentinels — the placeholder substitution swaps them in.
#   4. Add wikilinks to existing protocols under "## Protocols
#      List", reopen the file → existing Cluster 8 regen still
#      works (it scans for the real sentinels).
#
# Pass J — Cluster 21 effects survive in templates:
#   1. Open the daily-log template via Edit.
#   2. Apply gradient-golden + glow-soft to the H1 line.
#   3. Add a particle-sparkle mark to "MIT" in the
#      "## Today's MIT" heading.
#   4. Save.
#   5. Press Ctrl+D to create today's daily log (delete today's
#      first if present).
#   6. The new daily log shows the gradient-golden + glow-soft
#      H1 (with today's date) and the sparkle particles around
#      "MIT". Every Cluster 21 effect round-trips through the
#      template because templates are .md files like any other.
#
# Pass K — Cross-cluster regression smoke:
#   1. Cluster 4 routing — daily-note ::experiment block creates
#      a fresh iteration (auto-create path) → iteration file is
#      seeded from the template, has the AUTO-GENERATED footer.
#   2. Cluster 8 reagents auto-feed — open a method file with
#      protocols listed → reagents table re-aggregates as before.
#   3. Cluster 6 daily-log carry-over — pink marks still inject
#      a "## Carried over from earlier" section above
#      "## Today's MIT".
#   4. Cluster 19 image insert — drag an image into a note
#      created from the new note template; image embeds
#      correctly.
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
    cargo check --quiet
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cluster 22 v1.0)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 22 v1.0 - Document Templates (per-type .md templates at <vault>/.cortex/document-templates/<type>.md, edited like any other note; placeholder substitution at creation time for {{date}}/{{title}}/{{slug}}/{{iteration_number}}/{{parent_project}}/{{parent_experiment}}/{{vault_name}}/{{prev_daily_link}}/{{week_number}}/{{day_of_week}}/{{modeling}}/{{domain}}/{{complexity}} and the Cluster 8 reagents-auto sentinel placeholders; bundled defaults lazily written on first read; Templates sidebar button + modal with per-type Edit/Reset, live preview pane, and Templates-enabled escape-hatch toggle; five new Tauri commands list/read/write/reset/preview_document_template; create_note/project/experiment/iteration/idea/method/protocol + ensure_daily_log all gain optional use_template arg; find_or_create_iteration (Cluster 4 auto-create) always uses template when present)"

Write-Host "==> 4/4  tag cluster-22-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-22-v1.0-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-22-v1.0-complete --force'
