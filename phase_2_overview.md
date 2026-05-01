# Cortex — Phase 2+ Overview

*The map. Read this first. Pick clusters from here.*

---

## Status snapshot (2026-04-27)

**Phase 2 proper is complete.**

| Cluster | Build order | Status |
|---|---|---|
| Cluster 1 — Projects/Experiments/Iterations | 1st | ✅ shipped |
| Cluster 2 — Mark System foundation | 2nd | ✅ shipped |
| Cluster 3 — Mark System destinations | 3rd | ✅ shipped |
| Cluster 5 — Color legend | 4th | ✅ shipped |
| Cluster 4 — `::experiment` block routing | 5th | ✅ shipped |
| Cluster 9 — Strong Inference gate | 6th | ✗ dropped |

**Why Cluster 9 was dropped:** the gate is a forcing function for behavior the user judged was already happening manually, or that the user does not want forced. The cluster doc itself flagged this case: *"If you're already disciplined about Strong Inference, this is friction without payoff. Build only if you catch yourself skipping."* Reversible decision — the cluster doc isn't deleted from history; if the trigger ever shows up in the trial journal, revisit.

**Now entering Phase 3 — clusters built on demand, in any order.**

The remaining clusters (6, 7, 8, 10) are deliberately *not* sequenced. Each has its own trigger; build only when the trigger fires.

**Currently in flight:** Cluster 8 — Structured views, plus a **Protocols subsystem** that emerged during the build.

- **Idea Log** ✅ shipped
- **Methods Arsenal** ✅ shipped (v2 — `last_used` removed, replaced with file mtime; new section structure: Protocols List / Objective / Reagents/Parts List (auto-fed) / Steps / Outcome)
- **Protocols Log** ✅ shipped — *not in the original Cluster 8 spec.* User-driven addition. Protocols are atomic units that own their own reagents/parts; each protocol has a `## Reagents/Parts List` body section containing a markdown table (Name / Description / Quantity/Amount / Price). Methods compose protocols by wikilinking them under their own `## Protocols List`, and Cortex regenerates the Method's Reagents/Parts table by aggregating the body tables from each linked protocol on file open. Same auto-section pattern as Cluster 3's persistent files (Anti-Hype, Bottlenecks, etc.), but section-scoped rather than file-global.
- **Research Roadmap** still on the shelf — defer until its own trigger fires (struggling to articulate research direction in advisor meetings). It's the architecturally heaviest of the three Cluster-8 sub-views (cards layout over project hierarchy with goal annotations and a timeline sidebar), so deferring is also a complexity-reduction win.

---

## What Phase 2+ is

Phase 1 built the foundation: a daily-driver markdown notebook with file tree, editor, wikilinks, search, backlinks, daily logs, git history, and dark mode. You used it for seven consecutive days without breaking the trial. The architecture works.

Phase 2+ is everything we deferred — the features that make Cortex specifically a *research* notebook for *your* PhD work, rather than a generic markdown editor. The deferred features cluster naturally; this document maps them.

There is no fixed schedule. Build what you need when you need it. Triggers in each cluster doc tell you when the need has arrived.

---

## How to read this document

For each cluster:

- **One-line summary** — what it does, in plain language
- **Dependencies** — clusters that must be built first
- **Triggers** — signals from your daily use that say "build this now"
- **Effort estimate** — days, with confidence
- **Why now or why later** — my opinion on placement

Skim the whole map first. Don't commit to an order until you've read all eleven cluster summaries. The right next cluster is rarely the one that sounds most exciting.

---

## The clusters

### Cluster 1: Projects / Experiments / Iterations ✅ shipped
**One-liner:** Three-level hierarchy (Project → Experiment → Iteration) for organizing research, with auto-routing from daily notes to experiment iterations.

**Dependencies:** None (pure Phase 1 extension).

**Enables:** Cluster 4 (experiment routing), Cluster 9 (Strong Inference gate). Optionally improves Cluster 3.

**Effort:** 3–4 days. Confident.

**Why now:** The structural backbone. Most other research-specific features assume this exists. Even if you don't use it heavily at first, having the schema in place makes everything downstream simpler.

**Why later:** If your trial showed you mostly write daily notes and don't think in terms of experiments yet, you can skip this and revisit when projects accumulate.

---

### Cluster 2: Mark System foundation ✅ shipped
**One-liner:** Inline marks (Ctrl+1 through Ctrl+7, strikethrough, `==text==`) that route content from daily notes to specialized destinations.

**Dependencies:** None directly, but Cluster 3 is its other half — there's no point building marks if there's nowhere for them to route to.

**Enables:** Cluster 3 (destinations), Cluster 4 (experiment routing reuses the parsing infrastructure).

**Effort:** 4–5 days. Mostly confident; TipTap mark serialization round-trip is the risky part.

**Why now:** This is Cortex's distinctive feature. The whole scaffold v4 spec was built around it. Not building this means Cortex stays generic.

**Why later:** It's invasive. Every existing note acquires the potential for marks. If you're not yet sure of the mark semantics from real use, build it after you've used Cortex for several weeks and have evidence about which marks you actually need.

---

### Cluster 3: Mark System destinations ✅ shipped
**One-liner:** The specialized views that marks route into — weekly review queue, monthly review queue, Anti-Hype File, Bottlenecks, citations-to-use, advisor meeting prep, concept inbox, tomorrow's daily note.

**Dependencies:** Cluster 2 (the marks themselves).

**Enables:** Full use of the Mark System.

**Effort:** 5–7 days. Each destination is small individually; the count is what makes it big.

**Why now:** Cluster 2 without 3 is half a feature.

**Why later:** Build alongside or immediately after Cluster 2. They're conceptually one feature split for document size.

---

### Cluster 4: Experiment routing (`::experiment ... ::end`) ✅ shipped
**One-liner:** Slash-command in daily notes opens an `::experiment [name] / iter-N ... ::end` block whose contents auto-append to the experiment's iteration file.

**Dependencies:** Cluster 1 (Projects/Experiments/Iterations exist), Cluster 2 (parser infrastructure shared with marks).

**Enables:** Cluster 9 (Strong Inference gate is on iteration files).

**Effort:** 3–4 days. Less confident — the auto-creation fallback for missing iterations has subtle race conditions if the user is fast.

**Why now:** When Cluster 1 is built and you have actual experiments to log into, this is what makes the daily-note-to-experiment flow ergonomic.

**Why later:** If you find yourself just writing experiment content directly in iteration files and not using daily notes as the single entry point, you may not need this.

---

### Cluster 5: Color legend overlay ✅ shipped
**One-liner:** Always-visible bottom-right corner overlay showing what each mark color means.

**Dependencies:** Cluster 2 (otherwise nothing to legend).

**Enables:** Nothing structurally; it's a UX feature.

**Effort:** Half a day. Fully confident.

**Why now:** Ships with Cluster 2. Without it, the marks are unlearnable for the first weeks.

**Why later:** No reason to defer past Cluster 2.

---

### Cluster 6: PDF reader ✅ shipped
**One-liner:** Open PDFs inside Cortex, annotate them with the same color marks, write notes that auto-feed into the daily note.

**Dependencies:** Cluster 2 (for color marks consistency). Technically you could build a PDF reader without marks, but if you're going to read PDFs *and* you have the Mark System, the colors should match.

**Enables:** Nothing structural. Standalone feature.

**Effort:** 8–12 days. Least confident estimate. PDF rendering at acceptable quality on desktop has historically been a rabbit hole. Sidecar annotation format is its own design problem.

**Why now:** Build when you have >20 PDFs in the vault that you'd like to read with annotations, or when leaving Cortex to read PDFs is a regular friction point in the trial journal.

**Why later:** Default position. PDFs are a big undertaking. Many researchers get by with reading PDFs in their browser and pasting quotes into daily notes manually.

---

### Cluster 7: Concept graph
**One-liner:** Visualization of the wikilink graph — notes as nodes, links as edges, clusters by tag or folder.

**Dependencies:** None beyond Phase 1 (wikilinks already exist).

**Enables:** Nothing else.

**Effort:** 4–6 days. Moderately confident. The graph layout itself is a known problem (force-directed via d3 or similar); making it useful rather than pretty is the hard part.

**Why now:** When you have >100 notes and think "I wonder what's connected to what" frequently. Useful for discovering forgotten threads.

**Why later:** Default position. Concept graphs photograph well but are rarely load-bearing for daily research. Many users build one, admire it, and never open it again.

---

### Cluster 8: Structured views (Idea Log, Methods Arsenal, Research Roadmap) — *in flight (Idea Log + Methods Arsenal shipped; Roadmap deferred)*
**One-liner:** Three specialized views for capturing different categories of research artifacts: ideas/hypotheses, methods/protocols, and the long-arc research plan.

**Dependencies:** None, but Cluster 1 (Projects) makes the Roadmap richer.

**Enables:** Nothing else.

**Effort:** 5–7 days for all three. Confident — these are essentially structured table views over filtered notes.

**Why now:** When you have specific overflow problems — too many ideas in your daily notes that you can't track, methods that you keep re-deriving because you can't find your old notes on them, no clear sense of where your research is going.

**Why later:** Default. Phase 1's wikilinks plus a few well-chosen tag conventions cover most of this informally. Build the structured views only when the informal version breaks.

**Sub-view scope:** Build only the sub-views that pass their individual triggers. Idea Log shipped first; Methods Arsenal shipped second (reuses Idea Log's infrastructure for cheap incremental cost). Research Roadmap remains on the shelf until its own trigger fires.

---

### Cluster 9: Strong Inference gate ✗ dropped
**One-liner:** UI affordance on experiment iteration files that requires you to articulate predictions for two hypotheses before logging results.

**Status:** Dropped after Cluster 4. The cluster doc warned: *"If you're already disciplined about Strong Inference, this is friction without payoff."* If usage data later shows results getting logged without predictions, revisit.

---

### Cluster 10: Integrations (GitHub, Google Calendar, Overleaf)
**One-liner:** Read-only integrations that surface external context (commits, calendar events, paper drafts) inside daily notes.

**Dependencies:** None.

**Enables:** Nothing else.

**Effort:** 3–5 days per integration. Confident on GitHub and GCal; less so on Overleaf since their API is undocumented and may require scraping.

**Why now:** Build when you'd describe an information source as "I always end up alt-tabbing to check X." If you check GitHub commits 5+ times a day to write daily notes, build that integration. If you check Calendar before every standup, build that.

**Why later:** Default. Integrations have ongoing maintenance cost as external APIs change. Don't build speculatively.

---

## Build order — actual

**Phase 2 proper (done):**

1. Cluster 1 (Projects/Experiments/Iterations) ✅
2. Cluster 2 (Mark System foundation) ✅
3. Cluster 3 (Mark System destinations) ✅ — interleaved with Cluster 2
4. Cluster 5 (Color legend) ✅
5. Cluster 4 (Experiment routing) ✅
6. Cluster 9 (Strong Inference gate) ✗ — dropped

That delivered **Phase 2 proper** — Cortex as the research notebook the v4.1 scaffold described, minus the Strong Inference forcing function.

**Phase 3 — picked on demand, in any order:**

- Cluster 8 — Structured views (Idea Log + Methods + Protocols ✅; Roadmap deferred)
- Cluster 6 — PDF reader ✅ (full cluster, multi-tab layout)
- Cluster 10 — Integrations: GitHub ✅ (Calendar + Overleaf superseded by Cluster 11/12/13)
- Cluster 11 — Personal Calendar (local-first calendar UI; in flight)
- Cluster 12 — Google Calendar sync (read-only) ✅ — two-way deferred to v2.0
- Cluster 13 — Outlook Calendar sync (planned, depends on Cluster 12 scaffold)
- Cluster 14 — Time tracking / planned-vs-actual analytics ✅ v1.0
- Cluster 15 — Reminders (overlay + bell) ✅
- Cluster 16 — QoL pack (table polish + wikilink shortcut + Ctrl+S scroll fix + multi-type blocks) ✅
- Cluster 17 — Block widget rewrite (custom TipTap node) ✅
- Cluster 18 — Excel layer for tables (drag-resize + formulas + cell types + freeze panes + sort + filter + comparison ops) ✅ v1.2
- Cluster 7 — Concept graph (not started)

Phase 3 clusters can be built in any order *except* the calendar chain
(11 → 12 / 13 / 14), where 12-14 depend on Cluster 11's schema.

## A note on premature implementation

Phase 1 was a forced march because you needed *something* working to test the architecture. Phase 2+ is not. The strongest signal that you should *not* build a cluster yet is the absence of evidence from your trial journal that you need it.

Re-read your `Cortex Trial Journal.md` and your `Phase 2 ideas.md` before starting any new cluster. If a cluster isn't represented in the wish list at all, that's data.

## A note on continuing to use Cortex

Build clusters in working sessions of 1–3 days, then go back to using Cortex for at least a week before starting the next cluster. The week of use will:

- Surface bugs in what you just built
- Update your priorities on what to build next
- Prevent the "buildaholic" failure mode where you accumulate features faster than you settle into using them

If a cluster takes 4+ days, split it. Phase 2+ is not Phase 1; momentum is not the goal anymore.

---

## Document index

| File | Cluster | Build order | Status |
|---|---|---|---|
| `cluster_01_projects_experiments_iterations.md` | Projects/Experiments/Iterations | 1st | ✅ shipped |
| `cluster_02_mark_system_foundation.md` | Mark System foundation | 2nd | ✅ shipped |
| `cluster_03_mark_system_destinations.md` | Mark System destinations | 3rd (with 2) | ✅ shipped |
| `cluster_04_experiment_routing.md` | `::experiment` blocks | 5th | ✅ shipped |
| `cluster_05_color_legend_overlay.md` | Color legend | 4th | ✅ shipped |
| `cluster_06_pdf_reader.md` | PDF reader | Phase 3, on demand | ✅ shipped |
| `cluster_07_concept_graph.md` | Concept graph | Phase 3, on demand | — |
| `cluster_08_structured_views.md` | Idea Log, Methods, Roadmap | Phase 3, in flight (Idea Log + Methods + Protocols) | 🔨 Roadmap deferred |
| `cluster_09_strong_inference_gate.md` | Strong Inference gate | (was 6th) | ✗ dropped |
| `cluster_10_integrations.md` | GitHub, GCal, Overleaf | Phase 3, on demand | ✅ GitHub shipped (v1.1); GCal moved to Cluster 12, Overleaf to Cluster 13 |
| `cluster_11_personal_calendar.md` | Personal Calendar | Phase 3, in flight | ✅ v1.4 shipped (recurrence + body-in-splice + timezone fixes + per-event notifications) — NLP/heatmap/pie/multi-tz/density/day/per-instance-edit deferred to v1.5+ |
| `cluster_12_google_calendar_sync.md` | Google Calendar sync | Phase 3, in flight | ✅ v1.0 read-only shipped — two-way, multi-calendar, syncToken deferred |
| `cluster_13_outlook_calendar_sync.md` | Outlook Calendar two-way sync | Phase 3, planned | — depends on Cluster 12 scaffold |
| `cluster_14_time_tracking.md` | Planned-vs-actual analytics | Phase 3 | ✅ v1.3 shipped — v1.0: events.actual_minutes nullable column + EventEditModal field, get_time_tracking_aggregates Tauri command, TimeTracking structured view, sidebar button. v1.1: recurring events auto-credit each instance as fully spent. v1.2: pie chart tab with deterministic-colour slices + planned/actual sub-toggle. v1.3: per-instance overrides for recurring events (new event_instance_overrides table, three Tauri commands, EventEditModal dual-save UX with Skip / Save just this / Save series buttons), Trends tab (hand-drawn SVG line chart with one line per category, planned/actual/both metric toggle), Copy CSV button. Sequenced follow-ups: title/time overrides on a single instance, sparklines per category, daily-note splice for time-tracking summary |
| `cluster_15_reminders.md` | Reminders (overlay + bell) | Phase 3 | ✅ v1.0 shipped |
| `cluster_16_qol_pack.md` | QoL pack (table polish + wikilink shortcut + Ctrl+S scroll fix + multi-type blocks + typed-block routing) | Phase 3, on demand | ✅ v1.1.4 shipped — HTML-tables-always serializer, equalize-on-insert + selected-column-scoped equalize, drag cell-selection + merge-cells, right-click menu clamped/scrollable, ::protocol/::idea/::method blocks route both directions (daily note ↔ document via per-block CORTEX-BLOCK markers + propagate_typed_block_edits), col-resize cursor at column boundaries, drag-to-resize columns, Calendar WeekView all-day row. 🔴 Known unresolved: cell-height growth on hover for tables without explicit colwidths (workaround: Equalize once). Block widget rewrite (Cluster 17) and Excel layer (Cluster 18) sequenced as follow-ups |
| `cluster_17_block_widget_rewrite.md` | Block widget rewrite (custom TipTap node) | Phase 3 | ✅ v1.1 shipped — typedBlock node + NodeView (non-editable title bar, inline rename, atomic delete), markdown serializer (on-disk format unchanged from v1.1.x), liftTypedBlocks post-setContent transform that doubles as invisible migration, BlockContextMenu, body holds bullets/ordered-lists/code/tables, Cluster 4 + Cluster 16 routing pipelines unaffected. v1.1 adds Ctrl/Cmd+Click on title bar → opens the referenced document via new `resolve_typed_block_target` Tauri command (experiments → matching iteration file or experiment index; protocol/idea/method → corresponding doc). CORTEX-BLOCK markers still emitted by regen and parsed by propagator (intentional; dropping them needs a per-routed-entry custom node for the auto-section, out of v1.x scope) |
| `cluster_18_table_excel_layer.md` | Table formulas, cell types, freeze rows/cols, custom drag-resize | Phase 3 | ✅ v1.0 shipped — CortexColumnResize plugin replacing prosemirror-tables's built-in (fully closes the v1.1.4 cell-height-growth-on-hover bug, no per-hover view updates), formula engine (~670 lines: lexer + parser + evaluator with SUM/AVG/COUNT/MIN/MAX/MEDIAN/IF, A1 refs, A1:B5 ranges, circular-ref detection), FormulaCells extension (per-cell `data-formula` + `data-formula-result` attrs round-tripping through HtmlTable serializer), CSS display swap (result italic when not focused, raw formula on focus, errors in --danger). Cell-type formatting / freeze rows/cols / sort / filter deferred to v1.1+ |
