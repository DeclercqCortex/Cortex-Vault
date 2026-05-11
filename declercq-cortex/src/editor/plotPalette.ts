// plotPalette — Cluster 27 v1.0.
//
// Color palette resolution for Recharts series. The "aurora" palette
// reads from the same CSS vars that the Cortex v1.0 design system
// uses for chrome accents, so plots automatically match the active
// theme (dark/light) without re-rendering on theme swap.
//
// Recharts accepts color strings as `var(--accent)` directly — modern
// browsers resolve CSS vars inside SVG `fill` / `stroke` attributes.
// We surface them as a CSS-var-only palette so the dark/light token
// swap is transparent.
//
// Scientific palettes (viridis, magma, plasma, cividis, RdBu) ship
// as static 12-stop interpolated arrays — no runtime CSS-var coupling
// needed, since these palettes are perceptually uniform regardless of
// app theme.

import type { PlotConfig } from "./CortexPlotNode";

export type PaletteName = NonNullable<PlotConfig["palette"]>;

/** The Aurora palette — every color is a CSS var so dark/light swap
 *  is automatic. Order matches the Cluster 14 v1.2 pie palette
 *  ordering (Cortex v1.0 §H locked this in for the design system). */
const AURORA: ReadonlyArray<string> = [
  "var(--accent)",
  "var(--accent-2)",
  "var(--warning)",
  "var(--danger)",
  "var(--aurora-3)",
  "var(--success)",
  // Extras for series > 6:
  "var(--accent-bg)",
  "var(--text-2)",
];

/** Discrete sampled stops from the matplotlib viridis colormap.
 *  Source: matplotlib/_cm_listed.py, 12 evenly-spaced samples. */
const VIRIDIS: ReadonlyArray<string> = [
  "#440154",
  "#482878",
  "#3e4989",
  "#31688e",
  "#26828e",
  "#1f9e89",
  "#35b779",
  "#6ece58",
  "#b5de2b",
  "#fde725",
  "#7ad151",
  "#22a884",
];

const MAGMA: ReadonlyArray<string> = [
  "#000004",
  "#180f3d",
  "#440f76",
  "#721f81",
  "#9e2f7f",
  "#cd4071",
  "#f1605d",
  "#fd9668",
  "#feca8d",
  "#fcfdbf",
  "#f8765c",
  "#b73779",
];

const PLASMA: ReadonlyArray<string> = [
  "#0d0887",
  "#3a049a",
  "#5c01a6",
  "#7e03a8",
  "#9c179e",
  "#b52f8c",
  "#cc4778",
  "#de5f65",
  "#ed7953",
  "#f89540",
  "#fdb42f",
  "#f0f921",
];

const CIVIDIS: ReadonlyArray<string> = [
  "#00224e",
  "#123570",
  "#3b496c",
  "#575d6d",
  "#707173",
  "#8a8678",
  "#a59c74",
  "#c3b369",
  "#e1cc55",
  "#fee838",
  "#999073",
  "#766a4f",
];

const RD_BU: ReadonlyArray<string> = [
  "#67001f",
  "#b2182b",
  "#d6604d",
  "#f4a582",
  "#fddbc7",
  "#f7f7f7",
  "#d1e5f0",
  "#92c5de",
  "#4393c3",
  "#2166ac",
  "#053061",
  "#053061",
];

const ACCESSIBLE: ReadonlyArray<string> = [
  // Wong colorblind-friendly palette.
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#F0E442",
  "#56B4E9",
  "#D55E00",
  "#CC79A7",
  "#000000",
];

const GRAYSCALE: ReadonlyArray<string> = [
  "#222",
  "#444",
  "#666",
  "#888",
  "#aaa",
  "#ccc",
  "#333",
  "#555",
];

const PALETTES: Record<PaletteName, ReadonlyArray<string>> = {
  aurora: AURORA,
  viridis: VIRIDIS,
  magma: MAGMA,
  plasma: PLASMA,
  cividis: CIVIDIS,
  RdBu: RD_BU,
  accessible: ACCESSIBLE,
  grayscale: GRAYSCALE,
};

/**
 * Resolve a series index → color string. Uses `seriesColors` override
 * if present, else cycles through the named palette.
 */
export function colorForSeries(
  seriesIndex: number,
  config: PlotConfig,
): string {
  const override = config.seriesColors?.[seriesIndex];
  if (override) return override;
  const palette = PALETTES[config.palette ?? "aurora"] ?? AURORA;
  return palette[seriesIndex % palette.length];
}

/**
 * Yield N colors from a palette, evenly stepped through the gamut.
 * Used for plot types that need many discrete colors at once (pie,
 * stacked bar, multi-category scatter).
 */
export function discreteColors(
  count: number,
  palette: PaletteName = "aurora",
): string[] {
  const stops = PALETTES[palette] ?? AURORA;
  if (count <= stops.length) return stops.slice(0, count);
  // For very high counts: wrap around (deterministic).
  return Array.from({ length: count }, (_, i) => stops[i % stops.length]);
}

/** All palette names — used by the sidebar's palette picker. */
export const ALL_PALETTES: ReadonlyArray<{
  name: PaletteName;
  label: string;
  preview: string[];
}> = [
  { name: "aurora", label: "Aurora (default)", preview: AURORA.slice(0, 5) },
  { name: "viridis", label: "Viridis", preview: VIRIDIS.slice(0, 5) },
  { name: "magma", label: "Magma", preview: MAGMA.slice(0, 5) },
  { name: "plasma", label: "Plasma", preview: PLASMA.slice(0, 5) },
  { name: "cividis", label: "Cividis", preview: CIVIDIS.slice(0, 5) },
  { name: "RdBu", label: "Red ↔ Blue", preview: RD_BU.slice(0, 5) },
  {
    name: "accessible",
    label: "Colorblind-friendly",
    preview: ACCESSIBLE.slice(0, 5),
  },
  { name: "grayscale", label: "Grayscale", preview: GRAYSCALE.slice(0, 5) },
];
