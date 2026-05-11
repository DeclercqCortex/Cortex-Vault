// plotExport — Cluster 27 v1.0 pass 3.
//
// PNG raster + clipboard helpers for the Plotter. SVG and CSV
// exports already shipped in pass 1 (sidebar's exportSvg / exportCsv).
// This module adds:
//
//   - svgToPng(svg, scale)    — serialize an <svg> to a PNG Blob via
//                                an offscreen canvas at the requested
//                                device-pixel-ratio scale.
//   - svgToClipboard(svg)     — same pipeline but writes the PNG into
//                                navigator.clipboard via ClipboardItem.
//   - printPlot(svg, title)   — opens a print-friendly window with a
//                                high-contrast palette + black axes so
//                                the chart reads cleanly on paper or
//                                in a PDF, then triggers window.print.
//
// All three operate on a live SVG element (the recharts surface) so
// they capture exactly what the user sees. Theme tokens (CSS vars)
// are resolved against the element's computed style before
// serialization — without this step CSS vars in `fill="var(--accent)"`
// would render as "var(--accent)" literal in the exported PNG.

/**
 * Inline-resolve every CSS variable referenced in an SVG's attributes
 * + inline style. The serialized SVG stays standalone (no dependency
 * on the page's stylesheet) so it renders correctly when embedded in
 * an <img>, exported as a file, or pasted to clipboard.
 */
function inlineSvgStyles(src: SVGElement): SVGElement {
  const clone = src.cloneNode(true) as SVGElement;
  const allOriginals: Element[] = [
    src,
    ...Array.from(src.querySelectorAll("*")),
  ];
  const allClones: Element[] = [
    clone,
    ...Array.from(clone.querySelectorAll("*")),
  ];
  for (let i = 0; i < allOriginals.length; i++) {
    const orig = allOriginals[i];
    const dest = allClones[i];
    const cs = window.getComputedStyle(orig as Element);
    // Inline the visual properties that recharts relies on. We keep
    // this list tight — copying every computed property bloats the
    // SVG dramatically and triggers lint warnings on some viewers.
    const PROPS = [
      "fill",
      "fill-opacity",
      "stroke",
      "stroke-width",
      "stroke-opacity",
      "stroke-dasharray",
      "color",
      "font-family",
      "font-size",
      "font-weight",
      "opacity",
    ];
    let inline = "";
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "") inline += `${p}:${v};`;
    }
    if (inline) {
      const existing = (dest as HTMLElement).getAttribute("style") ?? "";
      (dest as HTMLElement).setAttribute("style", existing + inline);
    }
  }
  // Stamp an explicit white background rect so PNGs do not export
  // transparent (clipboard pastes look weird against any non-white
  // surface). The user can override by passing `transparentBg: true`.
  return clone;
}

/**
 * Serialize an SVG element to a PNG Blob via an offscreen canvas.
 * `scale` defaults to window.devicePixelRatio for a crisp export.
 */
export async function svgToPng(
  svg: SVGElement,
  options: {
    scale?: number;
    transparentBg?: boolean;
    bgColor?: string;
  } = {},
): Promise<Blob> {
  const scale = options.scale ?? Math.max(window.devicePixelRatio || 1, 2);
  const inlined = inlineSvgStyles(svg);
  // Set explicit width/height so the rasterizer knows the target.
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  inlined.setAttribute("width", String(w));
  inlined.setAttribute("height", String(h));
  // Optional background rect.
  if (!options.transparentBg) {
    const bg = inlined.ownerDocument!.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", options.bgColor ?? "#ffffff");
    inlined.insertBefore(bg, inlined.firstChild);
  }
  // Serialize to a self-contained string.
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    new XMLSerializer().serializeToString(inlined);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas 2d context unavailable"));
          return;
        }
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("canvas toBlob returned null"));
        }, "image/png");
      };
      img.onerror = () => reject(new Error("svg rasterization failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Write a PNG of the SVG to the system clipboard. Returns true on
 * success. The clipboard API requires a secure context (https or
 * Tauri's webview, which counts as secure for this purpose).
 */
export async function svgToClipboard(svg: SVGElement): Promise<boolean> {
  const png = await svgToPng(svg);
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    !("write" in navigator.clipboard)
  ) {
    return false;
  }
  try {
    const item = new ClipboardItem({ "image/png": png });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert an SVG to a base64 data URI of the rasterized PNG. Useful
 * for embedding the chart inline in an HTML document (the print mode
 * below uses this so the printable window doesn't need a separate
 * fetch).
 */
export async function svgToDataUri(svg: SVGElement): Promise<string> {
  const blob = await svgToPng(svg);
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onloadend = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("FileReader failed"));
    fr.readAsDataURL(blob);
  });
}

/**
 * Open a print-friendly window with the chart rasterized at 2× DPR,
 * then trigger print. The window is closed when the user dismisses
 * the print dialog. Uses a high-contrast white background so the
 * chart reads cleanly on paper.
 */
export async function printPlot(
  svg: SVGElement,
  title: string = "Plot",
): Promise<void> {
  const dataUri = await svgToDataUri(svg);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    // Pop-up blocked — fall back to printing the current window with
    // a temporary print stylesheet would require more wiring; instead
    // we surface a clear error to the caller.
    throw new Error(
      "Could not open a print window. Allow pop-ups for the Cortex window and retry.",
    );
  }
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 12mm; }
    html, body { margin: 0; padding: 0; background: white; color: #000; font-family: system-ui, sans-serif; }
    .wrap { padding: 24px; }
    h1 { font-size: 1rem; font-weight: 500; margin: 0 0 12px; letter-spacing: 0.02em; }
    img { max-width: 100%; height: auto; display: block; box-shadow: 0 0 0 1px #ddd; }
    .stamp { margin-top: 8px; color: #666; font-size: 0.75rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    <img src="${dataUri}" alt="${escapeHtml(title)}" />
    <div class="stamp">Exported from Cortex — ${new Date().toLocaleString()}</div>
  </div>
  <script>
    window.addEventListener("load", () => {
      // Give the image a moment to settle, then print.
      setTimeout(() => {
        window.focus();
        window.print();
      }, 100);
    });
    window.addEventListener("afterprint", () => {
      window.close();
    });
  </script>
</body>
</html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Helper: find the active recharts SVG for a given plotId inside the
 * editor DOM. The wrap div carries `data-plot-id="<id>"`, and the
 * Recharts surface inside has class `.recharts-surface`. Returns null
 * if not found (e.g. the plot is currently off-screen / scrolled out).
 */
export function findPlotSvg(plotId: string): SVGElement | null {
  const wrap = document.querySelector(
    `.cortex-plot-wrap[data-plot-id="${CSS.escape(plotId)}"]`,
  );
  if (!wrap) return null;
  return wrap.querySelector("svg.recharts-surface") as SVGElement | null;
}
