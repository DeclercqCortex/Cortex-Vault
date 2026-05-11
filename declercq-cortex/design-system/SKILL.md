---
name: cortex-design-system
description: Cortex is a local-first research notebook desktop app (Tauri 2 + React + TipTap) with an "Aurora Glass" identity — translucent chrome surfaces, three soft corner gradients on the body, blue-violet → violet accents, JetBrains Mono / Inter type. Use this skill any time you design FOR or AGAINST the Cortex app: new screens, new chrome, new modals, marketing surfaces, or in-app illustrations. The skill ships full design tokens as CSS variables (`colors_and_type.css`), a brand-mark set in `assets/`, atomic preview cards in `preview/`, and a working hi-fi recreation of the desktop window in `ui_kits/cortex-app/`.
---

# Cortex Design System

This folder is a self-contained design system for the Cortex desktop app. Read this file first; it tells you what the rest of the folder is for and how to use it.

## When to use

- **Use this skill** when designing anything that lives inside or alongside Cortex: new toolbar buttons, new modals or overlays, new layout slots, splash variations, in-app illustrations, marketing-adjacent surfaces (the app has none today; if you're asked to invent one, the brand identity comes from here).
- **Skip this skill** for unrelated work — Cortex's identity is specific (cool slate aurora, glass chrome, no emoji, sentence case) and applying it outside the product would be wrong.

## What's here

- `README.md` — full reference: company context, sources, content fundamentals (voice/tone/casing), visual foundations (colors / type / motion / shadow / glass), iconography rules.
- `colors_and_type.css` — every CSS variable from the production `src/index.css`, plus body aurora rules and semantic typography classes (`.h1`, `.h2`, `.body`, `.code`, etc.). Import this in any mock to inherit the full token set.
- `assets/` — `cortex-mark.svg` (cartoon-anatomical brain, side view, accent gradient halo), `cortex-wordmark.svg`, `electron-particle.svg`, `aurora-backdrop.svg`.
- `preview/` — atomic specimen cards (one HTML file per token group / component) registered to the Design System review pane.
- `ui_kits/cortex-app/` — a working pixel-fidelity recreation of the Cortex desktop window. Open `index.html` to see the toolbar, sidebar, editor, command palette, modal, welcome card, and Cluster 26 splash placeholder. Crib markup, class names, and structure from here when designing new surfaces — it is the canonical reference for chrome geometry and behavior.

## How to use

1. Always **read `README.md`** before designing — the CONTENT FUNDAMENTALS, VISUAL FOUNDATIONS, and ICONOGRAPHY sections are the system's load-bearing rules.
2. **Import `colors_and_type.css`** in any new mock. Never re-declare colors or type by hex / px — always reach for the variables. Token names match the production app exactly so designs paste back into the codebase with no rename.
3. **Reuse the chrome from `ui_kits/cortex-app/`** as a starting point for new screens. Copy the relevant component file (`chrome.jsx`, `editor.jsx`, `overlays.jsx`) into your new file and edit; do not redraw the toolbar or sidebar from scratch.
4. **Match the voice.** Engineer's-notebook terse. Sentence case. Surface keyboard shortcuts in tooltips. No emoji, no exclamation marks, no first-person. See `CONTENT FUNDAMENTALS` in `README.md` for examples ripped from source.
5. **Honor the motion budget.** All transitions go through `--motion-fast / -medium / -slow` on `--ease`. Ambient (brand) motion is 7s+ and runs only on splash / brand surfaces. Always test that the design degrades cleanly under `prefers-reduced-motion`.
6. **Keep light-mode parity.** The 3-way Auto / Light / Dark contract is non-negotiable. Every surface must look right in `:root.light` as well as `:root.dark`.

## Sources

- Codebase: `declercq-cortex/` (Tauri 2 + Vite + React + TipTap). Tokens mirrored from `src/index.css`. Component patterns mirrored from `src/App.tsx`, `src/components/EditorToolbar.tsx`, `src/components/ThemeToggle.tsx`, `src/components/FileTree.tsx`, `src/components/NotificationBell.tsx`, `src/components/CommandPalette.tsx`.
- Brief: Cluster 26 — Cerebrum splash + theme refresh.
- Prior art: Aurora Glass refresh (Cluster 25, already on disk).

## What this system does NOT cover

- Rust / Tauri backend logic, vault IO, or the TipTap node schema.
- A marketing site, mobile app, or docs site — Cortex has none.
- A graphical icon system. Cortex uses text labels + a curated set of Unicode glyphs (`↻ ▸ ▶ ◀ ⏱`). If a future surface needs SVG icons, the documented fallback is Lucide via CDN at 1.5px stroke weight, monochrome — see `ICONOGRAPHY` in `README.md`.
