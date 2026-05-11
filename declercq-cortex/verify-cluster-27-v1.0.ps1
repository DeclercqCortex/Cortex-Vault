# verify-cluster-27-v1.0.ps1
# Phase 3 Cluster 27 v1.0 — Interactive Plotter.
#
#   cd "C:\Declercq Cortex\declercq-cortex"
#   pnpm install            # picks up recharts + d3-array (added in pass 1)
#   pnpm tauri dev          # Rust changes (new Tauri commands) — full restart
#   .\verify-cluster-27-v1.0.ps1
#
# What ships
# ----------
#
# An end-to-end interactive plotter embedded inside markdown notes.
# Toolbar button + Ctrl+Alt+P inserts a `cortexPlot` atom node at the
# cursor. Clicking the inserted plot binds the right-side PlotterSidebar
# to it. The sidebar carries plot-type tiles, an editable data grid,
# series mapping (with multi-Y + per-series L/R axis), appearance
# controls (palette, axis grid, bar layout, histogram bin count, pie
# donut), statistics (trendline + 95% CI band + reference lines),
# and exports (PNG/SVG/CSV/clipboard/print + orphan-plots GC).
#
# v1.0 covers 15 plot types: scatter, line, area, bar (grouped + stacked),
# horizontal bar, histogram, pie/donut, error-bar, ECDF, Q-Q, Bland-
# Altman, regression-with-CI-band, residual, time-series, dual-Y.
# Persistence model: nodes ≤50 rows × 4 cols embed data inline via
# base64-JSON on a `data-data` attr; larger datasets go to a sidecar
# JSON file at `<note-stem>-plots/<plotId>.json` (orphan-GC friendly).
#
# Library: Recharts + d3-array. Aurora Glass theming everywhere via
# CSS vars on stroke/fill (no theme-swap re-render needed). Stats math
# is hand-rolled (Acklam-algorithm normal inverse CDF, Gaussian-
# elimination polynomial fit). AI plot-type suggest is a frontend
# heuristic that scores each plot type against the column-type
# signature, cardinality, and row count.
#
# Architecture
# ------------
#
# Frontend (src/):
#   editor/CortexPlotNode.ts          — atom TipTap node + types
#   editor/CortexPlotNodeView.tsx     — React NodeView (the rendered plot)
#   editor/plotFormulaAdapter.ts      — Cluster 18 formula engine reuse (:= prefix)
#   editor/plotCsv.ts                 — CSV parse + serialize
#   editor/plotPalette.ts             — 8 palettes (Aurora via CSS vars)
#   editor/plotStats.ts               — descriptive stats + regression
#   editor/plotSuggest.ts             — auto plot-type suggest heuristic
#   editor/plotExport.ts              — PNG raster + clipboard + print
#   components/PlotRenderers.tsx      — 15 Recharts plot renderers
#   components/PlotDataGrid.tsx       — editable Excel-style grid
#   components/PlotterSidebar.tsx     — right-side editing sidebar
#   components/OrphanPlotsModal.tsx   — sidecar GC modal
#
# Backend (src-tauri/src/lib.rs):
#   read_plot_sidecar / update_plot_sidecar / delete_plot_sidecar
#   find_orphan_plots
#   write_text_file / write_binary_file (CSV/SVG/PNG export)
#
# Editor.tsx — CortexPlot registered with storage {notePath, vaultPath,
# dataCache, cacheVersion}. App.tsx — Ctrl+Alt+P + cortex:focus-plot
# listener + PlotterBinding state + <PlotterSidebar> mount.
# EditorToolbar.tsx — 📈 button in Cortex group. ShortcutsHelp.tsx —
# Ctrl+Alt+P entry. index.css — full theme block for `.cortex-plot-*` /
# `.cortex-plotter-*` selectors.
#
# Smoke tests
# -----------
#
# Pass A — Insert via toolbar + shortcut + node round-trip:
#   1. Open any .md note. Click the 📈 button in the editor toolbar.
#      A glass-bordered empty plot card with text "Empty plot · click
#      to edit · SCATTER · Ctrl+Alt+P" appears at the cursor.
#   2. Press Ctrl+Alt+P with the cursor elsewhere → second plot inserts.
#   3. Click each plot → the right sidebar opens bound to that plot.
#      Clicking a different plot retargets the sidebar.
#   4. Press Ctrl+S → file saves. Inspect the markdown on disk: each
#      plot renders as `<div data-cortex-plot="1" data-plot-id="..."
#      data-plot-type="scatter" ...>` with `data-data` base64 payload
#      (small plots) or no `data-data` (sidecar mode).
#   5. Ctrl+R the note → both plots survive; chart re-renders identically.
#
# Pass B — Data grid (manual entry):
#   1. In the sidebar, click a cell in the data grid. Input replaces text.
#   2. Type 1.5, Tab, type 2.5, Enter → first row.
#   3. Continue: 2.5, 3.5; 3.5, 4.5. Plot updates live as a 3-point line.
#   4. Click a header → rename mode. Type "time", Enter.
#   5. Click a header's type pill (#/Aa/📅) → cycles Numeric → Category
#      → Date and re-coerces cells.
#   6. Click row number → row deletes.
#   7. Click "+ Row" → row appends.
#
# Pass C — Computed columns (Cluster 18 formula reuse):
#   1. Add a third column. Click its header → rename mode → type
#      `:= 2 * A` (with the := prefix and a space) → Enter.
#   2. Column header now shows "ƒ 2 * A" (italic ƒ); cells in that
#      column render the doubled value of the first column.
#   3. Try `:= sin(A) + B` → trigonometric expression evaluates
#      per-row (the formula engine recognizes math fns).
#   4. Circular reference: `:= D` in column D → cell shows #ERR.
#
# Pass D — CSV import:
#   1. Click "Import CSV…". Pick a small CSV file with comma decimals
#      (e.g. "x,y\n0.1,0.5\n0.2,0.8\n").
#   2. Grid populates with two numeric columns; auto-mapping sets
#      X to col 0 and Y to col 1.
#   3. Plot re-renders with the imported data.
#   4. Try a CSV with a date column: "date,value\n2026-01-01,5\n
#      2026-01-02,7\n". The date column infers as type Date.
#   5. ★ Bug-2 regression: import a single-row CSV like
#      "0.5,1,2,3,4,5,6,7". The "." in 0.5 MUST survive (decimal is
#      forced to "." whenever the delimiter is ","). First cell
#      displays as 0.5, not 5 or 15.
#
# Pass E — CSV sidecar round-trip:
#   1. Import a CSV with 60+ rows (above the inline threshold).
#   2. Ctrl+S → save. Inspect the file system: a
#      `<note-stem>-plots/<plotId>.json` file appears next to the note.
#      `data-data` on the plot div is absent.
#   3. ★ Bug-3 regression: Ctrl+R the note. The plot must show "Loading
#      plot data…" briefly, then render the imported data (no empty
#      placeholder). The NodeView calls read_plot_sidecar on mount.
#
# Pass F — Plot type swap:
#   1. With a scatter plot bound to the sidebar, click each plot-type
#      tile in turn. The chart re-renders for each type.
#   2. ★ Bug-1 regression: the active-tile accent gradient highlight
#      MUST follow each click immediately (driven by local sidebar
#      state, not the stale binding prop).
#   3. Pass-2 statistical types all live: ECDF, Q-Q, Bland-Altman,
#      Regression, Residual, Time-series, Dual-Y. None throw.
#
# Pass G — Statistical plots:
#   1. ECDF: single numeric column → step plot, X = value, Y = P(X ≤ x).
#   2. Q-Q: single numeric column → scatter of theoretical normal
#      quantiles vs observed; reference line falls through the data.
#   3. Bland-Altman: 2 numeric columns → scatter of mean vs diff
#      with mean and ±1.96σ ReferenceLines.
#   4. Regression: 2 numeric columns → scatter + fitted line +
#      confidence band; legend shows equation + R².
#   5. In Statistics section, change fit kind to "Quadratic" or
#      "Exponential" → equation + R² update.
#   6. Toggle "Confidence band" off → band disappears.
#   7. Residual: same data → residual scatter against zero ref line.
#
# Pass H — Time-series + Dual-Y:
#   1. Time-series: load a CSV with date + numeric columns.
#      Switch to Time-series tile. X axis shows ISO dates.
#   2. Dual-Y: load three numeric columns. Switch to Dual-Y tile.
#      Two YAxis appear (left + right). Each Y line bound to its scale.
#
# Pass I — Multi-Y series with per-series axis (pass 3):
#   1. Load data with 3+ numeric columns. Switch to Line plot type.
#   2. Series section now shows "Y columns" with a single row.
#   3. Click "+ Y series" → a second Y row appears. Pick another col.
#   4. Chart shows two lines.
#   5. Click the L/R toggle on the second Y series → it becomes "R".
#   6. Chart re-renders with a SECOND Y axis on the right side.
#      The right-axis line scales independently; on-screen tick labels
#      reflect that series' value range.
#   7. Italic note "Right-axis series share an independent scale."
#      appears below the list.
#   8. Switch to Bar (vertical) → multi-Y + right axis still work.
#   9. Switch to Area → same.
#  10. Try with horizontal bar — the L/R toggle is hidden because
#      horizontal bars have categorical Y.
#
# Pass J — Trendlines + reference lines:
#   1. Regression plot: cycle through fit kinds. Each produces a
#      different curve.
#   2. Statistics section → "+ Reference line" → row appears with
#      axis dropdown / value text / label text. Enter axis=y, value=mean.
#   3. The plot shows a dashed accent line at the mean of Y.
#   4. Try value=median → same with median.
#   5. Try value=42 (literal number) → line at y=42.
#   6. Multiple reference lines: add 3 → all 3 render.
#
# Pass K — Suggest button + auto-suggest on import:
#   1. With empty data + scatter plot type, click "Suggest" → status
#      says "No suggestion — add data first."
#   2. Enter 2-column numeric data. Click Suggest → it picks scatter
#      or regression and shows a reason.
#   3. Empty plot → import a CSV with date + numeric → auto-applies
#      time-series as the plot type. Status footer reads
#      "best fit: timeseries".
#
# Pass L — Aurora theme:
#   1. Toggle dark/light theme via the topbar. All plot surfaces
#      re-paint correctly without a re-render (CSS vars resolve in SVG).
#   2. Selection halo: clicking a plot adds a 2px accent ring.
#
# Pass M — PNG export:
#   1. Sidebar Export → click PNG. Save dialog. Pick a path.
#   2. Open the saved file. It is a crisp 2× DPR PNG matching the
#      on-screen chart, with a white background.
#   3. The exported PNG has CSS-var colors resolved to RGB (no
#      "var(--accent)" literals visible in the bytes).
#
# Pass N — SVG export:
#   1. Sidebar Export → SVG. Pick a path. Open the file in a vector
#      editor. The chart renders identically; theme tokens are
#      inlined as resolved colors.
#
# Pass O — CSV export:
#   1. Sidebar Export → CSV. Save. Open in Excel / a text editor.
#      The cell values match the data grid (computed columns export
#      their evaluated displays, NOT the formula source).
#
# Pass P — Copy to clipboard:
#   1. Sidebar Export → Copy. Status reads "Plot copied to clipboard."
#   2. Paste into MS Paint / Photoshop / Word / any image-accepting
#      app. The chart pastes as a PNG.
#
# Pass Q — Print:
#   1. Sidebar Export → Print… A new window opens with the chart
#      rasterized, a title bar showing the plot id, and the print
#      dialog automatically prompts.
#   2. Print to PDF. The output is a clean white-background page.
#   3. The print window auto-closes after the print dialog is dismissed.
#
# Pass R — Orphan plots GC:
#   1. Create + save a plot with sidecar data (large CSV).
#   2. Manually delete the plot's <div> from the markdown file
#      (open the .md in another editor or via a small text edit
#      in Cortex itself — but DO NOT delete the sidecar JSON).
#   3. Reload the note.
#   4. Sidebar → Export section → Orphans… button.
#   5. The modal lists the orphan sidecar with note path + plot id +
#      file size. Per-row Delete works; Delete all sweeps.
#   6. Refresh → orphan disappears from the list.
#
# Pass S — Resize handle:
#   1. Hover the plot. The corner handle (⤡) appears bottom-right.
#   2. Drag → chart resizes (width and height update via node attrs).
#   3. Ctrl+R → the resized dimensions survive.
#
# Pass T — Toolbar/shortcut coverage in ShortcutsHelp:
#   1. Ctrl+/ → shortcuts modal opens.
#   2. "Always available" section lists "Ctrl+Alt+P — Insert an
#      interactive plot at the cursor (Cluster 27 — opens the
#      Plotter sidebar on click)".
#
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> 1/4  Prettier on src/" -ForegroundColor Cyan
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

Write-Host "==> 2/4  cargo fmt + check (no new crates — pure Rust additions)" -ForegroundColor Cyan
Push-Location src-tauri
try {
    cargo fmt
    cargo check --quiet
}
finally {
    Pop-Location
}

Write-Host "==> 3/4  git commit (cluster 27 v1.0)" -ForegroundColor Cyan
git add .
git commit -m "Cluster 27 v1.0 - Interactive Plotter. 15 plot types via Recharts + d3-array: scatter, line, area, bar (grouped/stacked), horizontal bar, histogram, pie/donut, error-bar, ECDF, Q-Q, Bland-Altman, regression with 95% CI band, residual, time-series, dual-Y. Atom TipTap node cortexPlot mirrors cortexImage pattern with sidecar JSON at <note-stem>-plots/<plotId>.json for datasets above 50 rows x 4 cols; inline base64-JSON for smaller ones. PlotterSidebar (right-side, glass chrome) carries plot-type tiles, editable Excel-style data grid with the Cluster 18 formula engine reused via the := prefix for computed columns, series mapping with pass-3 multi-Y + per-series L/R axis toggle, appearance (8 palettes including Aurora CSS-var palette + scientific scales), statistics (trendlines linear/poly2/poly3/exp/log/power, 95% CI band, reference lines with mean/median/literal value), and exports (PNG raster via offscreen canvas at 2x DPR, SVG, CSV, clipboard via ClipboardItem, print via popup window). Tauri commands: read_plot_sidecar, update_plot_sidecar, delete_plot_sidecar, find_orphan_plots, write_text_file, write_binary_file. Orphan-plots GC modal via the existing find_orphan_plots backend. Aurora theme via CSS vars on stroke/fill. Plot-type auto-suggest via a frontend heuristic that scores plot types against the column-type signature + cardinality + size; auto-applies on CSV import when the user is still on default scatter + empty data. Bug fixes from pass-1 use: (1) active-tile accent gradient now follows clicks via local sidebar state; (2) CSV decimal point preserved when delimiter is comma (decimal forced to period, regex relaxed for .5 / 1. forms); (3) sidecar data loads automatically on Ctrl+R via read_plot_sidecar call in the NodeView's mount effect with a loading-state placeholder. Deferred to v1.1: drag-to-edit data points (F70 — requires custom recharts shape components + manual screen-to-data coordinate transformation)."

Write-Host "==> 4/4  tag cluster-27-v1.0-complete" -ForegroundColor Cyan
git tag -f cluster-27-v1.0-complete

Write-Host ""
Write-Host "Done. Push with:" -ForegroundColor Green
Write-Host '  cd "C:\Declercq Cortex"'
Write-Host '  git push'
Write-Host '  git push origin cluster-27-v1.0-complete --force'
