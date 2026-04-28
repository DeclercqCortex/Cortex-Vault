import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// -----------------------------------------------------------------------------
// Phase 3 — Cluster 6 — PDF Reader
//
// Architecture (post-bug-fix iteration):
//
//   Page wrapper (per page, created ONCE on document load):
//     ├── canvas                  — re-rendered on zoom only
//     ├── pdf-text-layer          — re-rendered on zoom only
//     └── pdf-annotation-overlay  — re-rendered on sidecar change
//
//   Decoupling the annotation overlay from canvas/text-layer is what
//   stopped the "every action scrolls to the top" flicker: previously
//   creating a single highlight wiped innerHTML on every page wrapper
//   and reflowed the whole document; now only the overlay <div> for
//   each page gets cleared and rebuilt.
//
//   Selection-rect dedup: when the user drags-selects, getClientRects()
//   often returns nested rects (one big line-rect plus several smaller
//   character-rects). We sort by area and drop rects fully contained
//   in a kept rect, so a single highlight renders as one solid region.
//
//   Ctrl+Click: a plain click on a highlight is a no-op; modifier-click
//   opens the side panel. Lets the user read past their own highlights
//   without accidentally triggering edits.
//
//   Annotation list mode: clicking the "X annotations" count flips the
//   side panel from "single annotation editing" to "list of all
//   annotations"; clicking a list row jumps to that page and reopens
//   the single-annotation panel.
//
//   Linked notes: each annotation can carry an array of wikilink targets
//   (`linked_notes`). The side panel shows them as removable chips and
//   exposes a popup that searches list_all_notes to add new ones.
// -----------------------------------------------------------------------------

const MARK_COLORS = [
  "yellow",
  "green",
  "pink",
  "blue",
  "orange",
  "red",
  "purple",
] as const;
type MarkColor = (typeof MARK_COLORS)[number];

const COLOR_RGBA: Record<MarkColor, string> = {
  yellow: "rgba(255, 215, 64, 0.40)",
  green: "rgba(102, 187, 106, 0.40)",
  pink: "rgba(236, 64, 122, 0.35)",
  blue: "rgba(66, 165, 245, 0.35)",
  orange: "rgba(255, 138, 51, 0.40)",
  red: "rgba(229, 57, 53, 0.35)",
  purple: "rgba(171, 71, 188, 0.35)",
};

interface AnnotationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PdfAnnotation {
  id: string;
  kind: MarkColor | string;
  page: number;
  rects: AnnotationRect[];
  text: string;
  note: string;
  created_at: string;
  resolved: boolean;
  linked_notes: string[];
}

interface AnnotationSidecar {
  version: number;
  pdf_path: string;
  annotations: PdfAnnotation[];
}

interface NoteListItem {
  path: string;
  title: string;
}

interface SearchHit {
  page: number;
  /** The matched substring (preserves casing from the PDF). */
  text: string;
  /** ~30 chars on either side of the match, single-line, for display. */
  context: string;
  /** Where to draw the search highlight. PDF-coords like annotation rects. */
  rects: AnnotationRect[];
  /** Character offset in the page text — used for stable sort. */
  offset: number;
  /**
   * True when this hit's rects intersect at least one existing
   * annotation on the same page. The list panel sorts starred hits to
   * the top and prefixes their row with ★.
   */
  starred: boolean;
}

interface PDFReaderProps {
  vaultPath: string;
  filePath: string;
  onClose: () => void;
  /**
   * True when the host TabPane is the active slot. Window-level
   * keydown listeners (Ctrl+K) gate on this so a press doesn't toggle
   * every mounted PDFReader at once when multiple slots have PDFs.
   */
  isActive?: boolean;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.15;
const ZOOM_DEFAULT = 1.25;

// Search-hit overlay colours. Distinctly NOT one of the seven mark
// colours so a user scanning the page can immediately tell "this is a
// search hit, not one of my highlights." Teal: high contrast against
// both white paper and most of the mark palette. Alpha kept low so the
// underlying text remains readable; the current hit's outline tells
// the user which match they're on without saturating the colour.
const SEARCH_HIT_RGBA = "rgba(0, 200, 200, 0.20)";
const SEARCH_HIT_CURRENT_RGBA = "rgba(0, 200, 200, 0.40)";
const SEARCH_HIT_CURRENT_OUTLINE = "rgba(0, 180, 180, 1.0)";

type PanelMode = "none" | "single" | "list";

/**
 * Reusable rect cleanup for both annotation creation and in-PDF search.
 * Steps:
 *   1. Drop zero-area rects.
 *   2. Drop rects fully contained in another (PDF.js often emits a per-
 *      line rect plus per-character sub-rects; keeping all of them
 *      multi-tints the overlay).
 *   3. Convert to PDF coords (origin = page wrapper top-left, units =
 *      PDF points = client px / zoom).
 *   4. Merge horizontally-adjacent rects on the same baseline so a
 *      single multi-line selection renders without inter-span gaps.
 */
function processClientRects(
  rawRects: DOMRect[],
  wrapperBox: DOMRect,
  zoom: number,
): AnnotationRect[] {
  const filtered = rawRects.filter((r) => r.width > 0 && r.height > 0);
  // Dedup nested.
  const eps = 1;
  const sortedByArea = [...filtered].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  const kept: DOMRect[] = [];
  for (const r of sortedByArea) {
    const contained = kept.some(
      (k) =>
        r.left >= k.left - eps &&
        r.top >= k.top - eps &&
        r.right <= k.right + eps &&
        r.bottom <= k.bottom + eps,
    );
    if (!contained) kept.push(r);
  }
  // Convert to PDF coords.
  const inPdfCoords: AnnotationRect[] = kept.map((r) => ({
    x: (r.left - wrapperBox.left) / zoom,
    y: (r.top - wrapperBox.top) / zoom,
    w: r.width / zoom,
    h: r.height / zoom,
  }));
  // Merge horizontally on the same baseline.
  const lineEps = 2;
  const gapEps = 6;
  const sortedByPos = [...inPdfCoords].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: AnnotationRect[] = [];
  for (const r of sortedByPos) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(last.y - r.y) < lineEps &&
      Math.abs(last.h - r.h) < lineEps &&
      r.x - (last.x + last.w) < gapEps
    ) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      last.w = right - last.x;
      last.h = Math.max(last.h, r.h);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * Lowercase + map common typographic characters to their ASCII
 * equivalents so the user's straight-quote query matches PDFs that
 * render apostrophes as curly U+2019, em/en dashes, NBSPs etc.
 *
 * Crucial property: the *length* of the returned string is identical
 * to the input. Each replacement is a single-codepoint -> single-char
 * swap. Otherwise an `indexOf` match in normalized space couldn't be
 * trusted to slice the same range out of the original text.
 */
function normalizeForSearch(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let ch: string;
    // Single quotes / apostrophes: U+2018, U+2019, U+201A, U+201B, U+2032
    if (
      c === 0x2018 ||
      c === 0x2019 ||
      c === 0x201a ||
      c === 0x201b ||
      c === 0x2032
    ) {
      ch = "'";
      // Double quotes: U+201C, U+201D, U+201E, U+201F, U+2033
    } else if (
      c === 0x201c ||
      c === 0x201d ||
      c === 0x201e ||
      c === 0x201f ||
      c === 0x2033
    ) {
      ch = '"';
      // Hyphens / dashes: U+2010..U+2015
    } else if (c >= 0x2010 && c <= 0x2015) {
      ch = "-";
      // Non-breaking space and other "weird" spaces → regular space
    } else if (
      c === 0x00a0 ||
      c === 0x2002 ||
      c === 0x2003 ||
      c === 0x2009 ||
      c === 0x200a ||
      c === 0x202f ||
      c === 0x205f
    ) {
      ch = " ";
    } else {
      ch = s[i];
    }
    out += ch.toLowerCase();
  }
  return out;
}

/** Axis-aligned rect intersection test in PDF coords. */
function rectsOverlap(a: AnnotationRect, b: AnnotationRect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/**
 * Build a DOM Range covering the [start, end) character offsets within
 * the concatenated text content of `root`. Used by the in-PDF search to
 * locate matches in the PDF.js text layer so we can call getClientRects
 * on the result.
 */
function makeRangeForOffset(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (!startNode && acc + len >= start) {
      startNode = node;
      startOffset = start - acc;
    }
    if (acc + len >= end) {
      endNode = node;
      endOffset = end - acc;
      break;
    }
    acc += len;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    return null;
  }
  return range;
}

export function PDFReader({
  vaultPath,
  filePath,
  onClose,
  isActive = true,
}: PDFReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(ZOOM_DEFAULT);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("1");

  const [sidecar, setSidecar] = useState<AnnotationSidecar | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("none");
  const [selectedAnnotation, setSelectedAnnotation] =
    useState<PdfAnnotation | null>(null);
  const [selectionBubble, setSelectionBubble] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [linkPopupFor, setLinkPopupFor] = useState<PdfAnnotation | null>(null);

  const liveSelectionRef = useRef<{
    page: number;
    text: string;
    rects: AnnotationRect[];
  } | null>(null);

  // ----- In-PDF search state ------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [currentHitIdx, setCurrentHitIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bumped after each renderAllContent settles so search effects can
  // wait for the new text-layer DOM to mount before calling
  // getClientRects. Without this, search runs in parallel with
  // re-render on zoom change and reads stale span positions, producing
  // misaligned highlights.
  const [renderTick, setRenderTick] = useState(0);

  // "single" stacks pages vertically (default). "two" arranges pages in
  // pairs side-by-side (1-2, 3-4, …) like a magazine spread. Persisted
  // in localStorage so the user's preferred layout survives a restart.
  const [pageLayout, setPageLayout] = useState<"single" | "two">(() => {
    try {
      const saved = localStorage.getItem("cortex:pdf-layout");
      return saved === "two" ? "two" : "single";
    } catch {
      return "single";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("cortex:pdf-layout", pageLayout);
    } catch {
      // ignore — same SecurityError caveat as the rest of localStorage.
    }
  }, [pageLayout]);

  // Derive a normalised, decoupled side-panel state. When sidecar mutates
  // (e.g., we change a colour), the selectedAnnotation state can hold a
  // stale object; reconcile by id every render.
  const liveSelected: PdfAnnotation | null =
    selectedAnnotation && sidecar
      ? (sidecar.annotations.find((a) => a.id === selectedAnnotation.id) ??
        null)
      : null;

  // ----- Render helpers -----------------------------------------------------

  /**
   * Create the stable wrapper div for each page once. Subsequent zoom or
   * sidecar changes update the wrapper's contents in place; the wrapper
   * itself stays put so scroll position is preserved.
   */
  const setupWrappers = useCallback((nPages: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    for (let i = 1; i <= nPages; i++) {
      const w = document.createElement("div");
      w.dataset.pageNumber = String(i);
      w.style.position = "relative";
      // Margin/centering is handled by the container's class (.pdf-pages-*
      // in index.css). Inline-margin'ing here would break the two-column
      // grid layout because CSS Grid doesn't honour `margin: auto` inside
      // tracks the same way a flex column does.
      w.style.background = "white";
      w.style.boxShadow = "0 1px 3px rgba(0,0,0,0.15)";
      container.appendChild(w);
    }
  }, []);

  /** (Re-)render one page's canvas + text layer at the current zoom. */
  const renderPageContent = useCallback(
    async (
      pdfDoc: pdfjsLib.PDFDocumentProxy,
      pageNum: number,
      cssScale: number,
    ) => {
      const container = containerRef.current;
      if (!container) return;
      const wrapper = container.querySelector(
        `div[data-page-number="${pageNum}"]`,
      ) as HTMLDivElement | null;
      if (!wrapper) return;

      // Strip everything before re-rendering at the new scale. The
      // annotation overlay and the in-PDF search overlay are both
      // re-emitted afterwards (annotations by updateAllOverlays in the
      // zoom effect, search overlay by the search effect that runs
      // after renderTick bumps). Without including .pdf-search-overlay
      // here, stale search rects positioned at the previous zoom would
      // survive into the new layout and look misaligned alongside any
      // new ones the search effect adds.
      wrapper.querySelector("canvas")?.remove();
      wrapper.querySelector(".pdf-text-layer")?.remove();
      wrapper.querySelector(".pdf-annotation-overlay")?.remove();
      wrapper.querySelector(".pdf-search-overlay")?.remove();

      const page = await pdfDoc.getPage(pageNum);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * dpr });

      // Resize the wrapper to match the new page dimensions. Without this
      // the overlay layer sits at stale dimensions for one frame.
      wrapper.style.width = `${viewport.width / dpr}px`;
      wrapper.style.height = `${viewport.height / dpr}px`;

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      canvas.style.display = "block";
      canvas.dataset.pageNumber = String(pageNum);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      }
      wrapper.appendChild(canvas);

      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "pdf-text-layer";
      textLayerDiv.style.position = "absolute";
      textLayerDiv.style.left = "0";
      textLayerDiv.style.top = "0";
      textLayerDiv.style.width = `${viewport.width / dpr}px`;
      textLayerDiv.style.height = `${viewport.height / dpr}px`;
      textLayerDiv.dataset.pageNumber = String(pageNum);
      wrapper.appendChild(textLayerDiv);

      try {
        const cssViewport = page.getViewport({ scale: cssScale });
        const textContent = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const TL = (pdfjsLib as any).TextLayer;
        if (TL) {
          const textLayer = new TL({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: cssViewport,
          });
          await textLayer.render();
        }
      } catch (e) {
        console.warn(`text layer render failed for page ${pageNum}:`, e);
      }
    },
    [],
  );

  /**
   * Rebuild the annotation overlay <div> for one page from the current
   * sidecar. Cheap; called whenever the sidecar mutates. Does NOT touch
   * the canvas or text layer, so creating a highlight no longer flickers
   * the entire document.
   */
  const updatePageOverlay = useCallback(
    (
      pageNum: number,
      cssScale: number,
      annotations: PdfAnnotation[],
      onAnnotationClick: (ann: PdfAnnotation, e: MouseEvent) => void,
    ) => {
      const container = containerRef.current;
      if (!container) return;
      const wrapper = container.querySelector(
        `div[data-page-number="${pageNum}"]`,
      ) as HTMLDivElement | null;
      if (!wrapper) return;

      wrapper.querySelector(".pdf-annotation-overlay")?.remove();

      const overlay = document.createElement("div");
      overlay.className = "pdf-annotation-overlay";
      overlay.style.position = "absolute";
      overlay.style.left = "0";
      overlay.style.top = "0";
      overlay.style.width = wrapper.style.width;
      overlay.style.height = wrapper.style.height;
      overlay.style.pointerEvents = "none";
      wrapper.appendChild(overlay);

      // Hover state — when the cursor enters any rect of an annotation,
      // we want every other rect of the same annotation to light up too,
      // so a multi-line highlight reads as one logical group rather than
      // a stack of individual line-pieces. We toggle `.ann-hover` on all
      // siblings with the same data-annotation-id; the actual visual
      // (outline + cursor) is gated by `body.cortex-mod-pressed` in
      // index.css so it only appears when Ctrl/Cmd is held.
      function applyGroupHover(id: string, on: boolean) {
        const peers = overlay.querySelectorAll(
          `[data-annotation-id="${id}"]`,
        ) as NodeListOf<HTMLElement>;
        peers.forEach((el) => {
          if (on) el.classList.add("ann-hover");
          else el.classList.remove("ann-hover");
        });
      }

      const onPage = annotations.filter((a) => a.page === pageNum);
      for (const ann of onPage) {
        const color = (ann.kind in COLOR_RGBA ? ann.kind : "yellow") as
          | MarkColor
          | string;
        const colorRgba =
          (COLOR_RGBA as Record<string, string>)[color] ?? COLOR_RGBA.yellow;
        for (const r of ann.rects) {
          const div = document.createElement("div");
          div.style.position = "absolute";
          div.style.left = `${r.x * cssScale}px`;
          div.style.top = `${r.y * cssScale}px`;
          div.style.width = `${r.w * cssScale}px`;
          div.style.height = `${r.h * cssScale}px`;
          div.style.background = colorRgba;
          div.style.borderRadius = "1px";
          // Plain click is a no-op (so the user can read past highlights).
          // Ctrl/Cmd+Click opens the side panel.
          //
          // Cursor is intentionally NOT set inline. Inline styles
          // outrank stylesheet rules without `!important`, so an inline
          // `cursor: default` here would clobber the index.css rule
          // that flips to `cursor: pointer` on `.ann-hover`. Letting
          // index.css drive the cursor end-to-end keeps the hand-pointer
          // affordance visible on hover.
          div.style.pointerEvents = "auto";
          div.style.opacity = ann.resolved ? "0.45" : "1";
          div.dataset.annotationId = ann.id;
          div.title = `Ctrl+Click to edit · ${ann.text}${ann.note ? " — " + ann.note : ""}`;
          div.addEventListener("mousedown", (e) => e.preventDefault());
          div.addEventListener("click", (e) => onAnnotationClick(ann, e));
          div.addEventListener("mouseenter", () =>
            applyGroupHover(ann.id, true),
          );
          div.addEventListener("mouseleave", () =>
            applyGroupHover(ann.id, false),
          );
          overlay.appendChild(div);
        }
      }
    },
    [],
  );

  const updateAllOverlays = useCallback(
    (cssScale: number, annotations: PdfAnnotation[]) => {
      const handler = (ann: PdfAnnotation, e: MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
          setSelectedAnnotation(ann);
          setPanelMode("single");
        }
      };
      const container = containerRef.current;
      if (!container) return;
      const wrappers = container.querySelectorAll(
        "div[data-page-number]",
      ) as NodeListOf<HTMLDivElement>;
      wrappers.forEach((w) => {
        const p = Number(w.dataset.pageNumber || "0");
        if (p) updatePageOverlay(p, cssScale, annotations, handler);
      });
    },
    [updatePageOverlay],
  );

  const renderAllContent = useCallback(
    async (pdfDoc: pdfjsLib.PDFDocumentProxy, cssScale: number) => {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        await renderPageContent(pdfDoc, i, cssScale);
      }
    },
    [renderPageContent],
  );

  // ----- In-PDF search ------------------------------------------------------
  //
  // We walk every page wrapper's already-rendered text-layer and run a
  // case-insensitive substring search on its concatenated textContent.
  // For each match we build a DOM Range, getClientRects on it, and
  // `processClientRects` to convert to PDF coords (so the overlay
  // renders correctly at any zoom). Search runs are cheap on a typical
  // paper; for a 200-page book it's still well under a frame because
  // we operate on already-mounted DOM nodes.

  const runSearch = useCallback(
    (query: string): SearchHit[] => {
      // Normalize typographic differences so a straight-quote query
      // matches PDFs that render apostrophes as curly U+2019, em-dashes
      // as U+2014, etc. normalizeForSearch keeps string length stable
      // (one codepoint in, one char out) so an indexOf match in
      // normalized space still slices the same range out of the
      // original `text` for context/snippet purposes.
      const lc = normalizeForSearch(query);
      // Real-time: as soon as the user has typed a single character, we
      // search. Empty query returns [] which clears the overlay.
      if (!lc) return [];
      const container = containerRef.current;
      if (!container) return [];
      const wrappers = container.querySelectorAll(
        "div[data-page-number]",
      ) as NodeListOf<HTMLDivElement>;
      const hits: SearchHit[] = [];
      const annotations = sidecar?.annotations ?? [];

      wrappers.forEach((wrapper) => {
        const pageNum = Number(wrapper.dataset.pageNumber || "0");
        if (!pageNum) return;
        const textLayer = wrapper.querySelector(
          ".pdf-text-layer",
        ) as HTMLElement | null;
        if (!textLayer) return;
        const text = textLayer.textContent ?? "";
        const lcText = normalizeForSearch(text);
        let i = 0;
        while ((i = lcText.indexOf(lc, i)) !== -1) {
          const range = makeRangeForOffset(textLayer, i, i + lc.length);
          if (!range) {
            i += lc.length;
            continue;
          }
          const wrapperBox = wrapper.getBoundingClientRect();
          const rawRects = Array.from(range.getClientRects());
          const rects = processClientRects(rawRects, wrapperBox, zoom);
          const ctxStart = Math.max(0, i - 30);
          const ctxEnd = Math.min(text.length, i + lc.length + 30);
          const context = text
            .slice(ctxStart, ctxEnd)
            .replace(/\s+/g, " ")
            .trim();
          // Star this hit if it overlaps any annotation on this page.
          const annsOnPage = annotations.filter((a) => a.page === pageNum);
          const starred = annsOnPage.some((ann) =>
            ann.rects.some((ar) => rects.some((hr) => rectsOverlap(ar, hr))),
          );
          hits.push({
            page: pageNum,
            text: text.slice(i, i + lc.length),
            context,
            rects,
            offset: i,
            starred,
          });
          i += lc.length;
        }
      });
      // Starred-first; otherwise stable by page + offset.
      hits.sort((a, b) => {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return a.page - b.page || a.offset - b.offset;
      });
      return hits;
    },
    [zoom, sidecar],
  );

  /** Replace search overlay on every page from the current hits. */
  const updateSearchOverlay = useCallback(
    (hits: SearchHit[], currentIdx: number, cssScale: number) => {
      const container = containerRef.current;
      if (!container) return;
      // Defensive: remove ALL pdf-search-overlay elements in the
      // container in one pass before re-emitting per-page. Belt-and-
      // braces against any path that ever ends up creating multiple
      // overlay divs in the same wrapper (querySelector singular would
      // miss the extras).
      container
        .querySelectorAll(".pdf-search-overlay")
        .forEach((el) => el.remove());
      const wrappers = container.querySelectorAll(
        "div[data-page-number]",
      ) as NodeListOf<HTMLDivElement>;
      wrappers.forEach((wrapper) => {
        const pageNum = Number(wrapper.dataset.pageNumber || "0");
        if (!pageNum) return;
        const overlay = document.createElement("div");
        overlay.className = "pdf-search-overlay";
        overlay.style.position = "absolute";
        overlay.style.left = "0";
        overlay.style.top = "0";
        overlay.style.width = wrapper.style.width;
        overlay.style.height = wrapper.style.height;
        overlay.style.pointerEvents = "none";
        wrapper.appendChild(overlay);
        hits.forEach((hit, i) => {
          if (hit.page !== pageNum) return;
          const isCurrent = i === currentIdx;
          for (const r of hit.rects) {
            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.left = `${r.x * cssScale}px`;
            div.style.top = `${r.y * cssScale}px`;
            div.style.width = `${r.w * cssScale}px`;
            div.style.height = `${r.h * cssScale}px`;
            div.style.background = isCurrent
              ? SEARCH_HIT_CURRENT_RGBA
              : SEARCH_HIT_RGBA;
            div.style.borderRadius = "1px";
            if (isCurrent) {
              div.style.outline = `2px solid ${SEARCH_HIT_CURRENT_OUTLINE}`;
              div.style.outlineOffset = "-1px";
            }
            overlay.appendChild(div);
          }
        });
      });
    },
    [],
  );

  /** Strip the search overlay from every page (called on close). */
  const clearSearchOverlay = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container
      .querySelectorAll(".pdf-search-overlay")
      .forEach((el) => el.remove());
  }, []);

  // ----- Initial load (PDF + sidecar) ---------------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const [bytes, side] = await Promise.all([
          invoke<number[]>("read_binary_file", { path: filePath }),
          invoke<AnnotationSidecar>("read_pdf_annotations", {
            pdfPath: filePath,
          }).catch((e) => {
            console.warn("read_pdf_annotations failed; starting empty:", e);
            return {
              version: 1,
              pdf_path: filePath,
              annotations: [],
            } as AnnotationSidecar;
          }),
        ]);
        if (cancelled) return;

        // Defensive: ensure linked_notes is always an array on the
        // frontend, even if a stale sidecar lacks it.
        const normalised: AnnotationSidecar = {
          ...side,
          annotations: side.annotations.map((a) => ({
            ...a,
            linked_notes: Array.isArray(a.linked_notes) ? a.linked_notes : [],
          })),
        };

        const data = new Uint8Array(bytes);
        const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) {
          pdfDoc.destroy();
          return;
        }

        if (pdfDocRef.current) {
          try {
            pdfDocRef.current.destroy();
          } catch {
            // ignore
          }
        }
        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
        setCurrentPage(1);
        setPageInput("1");
        setSidecar(normalised);
        setSelectedAnnotation(null);
        setPanelMode("none");

        setupWrappers(pdfDoc.numPages);
        await renderAllContent(pdfDoc, zoom);
        if (!cancelled) {
          updateAllOverlays(zoom, normalised.annotations);
          setLoading(false);
          setRenderTick((t) => t + 1);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("PDF load failed:", e);
          setError(String(e));
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, filePath]);

  // ----- Re-render canvas + text layer on zoom only -------------------------

  useEffect(() => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc || loading || !sidecar) return;
    let cancelled = false;
    void (async () => {
      await renderAllContent(pdfDoc, zoom);
      if (cancelled) return;
      // Overlays must be re-emitted at the new scale.
      updateAllOverlays(zoom, sidecar.annotations);
      setRenderTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // ----- Update overlays only on sidecar change (no canvas rerender) --------

  useEffect(() => {
    if (loading || !sidecar) return;
    updateAllOverlays(zoom, sidecar.annotations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecar]);

  // Cleanup
  useEffect(() => {
    return () => {
      const doc = pdfDocRef.current;
      pdfDocRef.current = null;
      if (doc) {
        try {
          doc.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Ctrl/Cmd+K toggles the search bubble. App.tsx skips its global
  // palette while the ACTIVE slot's view is "pdf-reader", so this
  // listener is the sole owner of Ctrl+K when the reader is mounted
  // *in the active slot*. Multiple PDFReader instances may be mounted
  // simultaneously (multi-tab layout) — the `isActive` gate ensures
  // only the active slot's reader reacts. The Escape and F3 / Ctrl+G
  // hit-navigation paths are also gated so an inactive PDF's bubble
  // doesn't intercept those when another slot is in focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isActive) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen((s) => !s);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      } else if (
        searchOpen &&
        searchHits.length > 0 &&
        // F3 / Shift+F3 alternate to prev/next, matching browser conventions.
        (e.key === "F3" ||
          ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")))
      ) {
        e.preventDefault();
        gotoHit(currentHitIdx + (e.shiftKey ? -1 : 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, searchOpen, searchHits.length, currentHitIdx]);

  // Focus the search input as soon as the bubble opens, AND select the
  // existing query so a fresh keystroke replaces it. searchQuery state
  // intentionally persists across close/reopen — it's friendlier to
  // pop right back to the previous search than to wipe and force the
  // user to retype. Selecting on focus gives the best of both: prior
  // query visible (for context) but immediately overwritten by typing.
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => {
      const el = searchInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
    return () => clearTimeout(t);
  }, [searchOpen]);

  // Run the search whenever the query changes, the bubble opens, or a
  // re-render completes (renderTick). The renderTick gate is what makes
  // search highlights align after a zoom change: without it the search
  // effect would race with renderAllContent and getClientRects on a
  // half-rendered text-layer.
  useEffect(() => {
    if (!searchOpen) {
      clearSearchOverlay();
      setSearchHits([]);
      return;
    }
    const hits = runSearch(searchQuery);
    setSearchHits(hits);
    setCurrentHitIdx(0);
    updateSearchOverlay(hits, 0, zoom);
    // Auto-scroll to the first hit on a real query so the user sees
    // something happen. Skip when the query is empty (we just cleared).
    if (hits.length > 0 && searchQuery.length > 0) {
      const h = hits[0];
      requestAnimationFrame(() =>
        scrollToRectInPage(h.page, h.rects[0] ?? null),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, searchQuery, renderTick]);

  /** Move to the (possibly-wrapped) hit index, update overlay, scroll. */
  function gotoHit(idx: number) {
    if (searchHits.length === 0) return;
    const next =
      ((idx % searchHits.length) + searchHits.length) % searchHits.length;
    setCurrentHitIdx(next);
    updateSearchOverlay(searchHits, next, zoom);
    const h = searchHits[next];
    scrollToRectInPage(h.page, h.rects[0] ?? null);
  }

  // ----- Page tracking ------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { page: number; ratio: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const target = e.target as HTMLElement;
          const page = Number(target.dataset.pageNumber || "0");
          if (!page) continue;
          if (!best || e.intersectionRatio > best.ratio) {
            best = { page, ratio: e.intersectionRatio };
          }
        }
        if (best) {
          setCurrentPage(best.page);
          setPageInput(String(best.page));
        }
      },
      { threshold: [0.1, 0.5, 0.9] },
    );

    const initial = container.querySelectorAll(
      "div[data-page-number]",
    ) as NodeListOf<HTMLElement>;
    initial.forEach((w) => observer.observe(w));

    return () => {
      observer.disconnect();
    };
  }, [numPages]);

  // ----- Selection -> floating colour toolbar -------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onSelectionChange() {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        liveSelectionRef.current = null;
        setSelectionBubble(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const ancestor =
        range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      const textLayer = ancestor?.closest?.(
        ".pdf-text-layer",
      ) as HTMLElement | null;
      if (!textLayer) {
        liveSelectionRef.current = null;
        setSelectionBubble(null);
        return;
      }
      const pageNum = Number(textLayer.dataset.pageNumber || "0");
      if (!pageNum) return;

      const wrapper = textLayer.parentElement;
      if (!wrapper) return;
      const wrapperBox = wrapper.getBoundingClientRect();

      const rawClient = Array.from(range.getClientRects());
      const rects = processClientRects(rawClient, wrapperBox, zoom);
      if (rects.length === 0) return;
      // Bubble anchor — first non-empty client rect for positioning.
      const first = rawClient.find((r) => r.width > 0 && r.height > 0);
      if (!first) return;

      const text = sel.toString().trim();
      if (!text) return;

      liveSelectionRef.current = { page: pageNum, text, rects };
      setSelectionBubble({
        x: first.left + first.width / 2,
        y: first.top - 8,
      });
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [zoom]);

  // ----- Sidecar mutations --------------------------------------------------

  async function persistSidecar(next: AnnotationSidecar) {
    setSidecar(next);
    try {
      await invoke("write_pdf_annotations", {
        pdfPath: filePath,
        sidecar: next,
      });
      await invoke("index_single_file", {
        vaultPath,
        filePath,
      }).catch(() => {});
    } catch (e) {
      console.error("write_pdf_annotations failed:", e);
      setError(`Failed to save annotation: ${e}`);
    }
  }

  function nextAnnotationId(): string {
    const date = new Date();
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;
    const seq = (sidecar?.annotations.length ?? 0) + 1;
    return `ann-${ymd}-${seq}`;
  }

  async function createAnnotation(color: MarkColor) {
    const live = liveSelectionRef.current;
    if (!live || !sidecar) return;
    const ann: PdfAnnotation = {
      id: nextAnnotationId(),
      kind: color,
      page: live.page,
      rects: live.rects,
      text: live.text,
      note: "",
      created_at: new Date().toISOString(),
      resolved: false,
      linked_notes: [],
    };
    const next: AnnotationSidecar = {
      ...sidecar,
      annotations: [...sidecar.annotations, ann],
    };
    setSelectionBubble(null);
    document.getSelection()?.removeAllRanges();
    liveSelectionRef.current = null;
    await persistSidecar(next);
  }

  async function updateAnnotation(id: string, patch: Partial<PdfAnnotation>) {
    if (!sidecar) return;
    const next: AnnotationSidecar = {
      ...sidecar,
      annotations: sidecar.annotations.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    };
    await persistSidecar(next);
  }

  async function deleteAnnotation(id: string) {
    if (!sidecar) return;
    const next: AnnotationSidecar = {
      ...sidecar,
      annotations: sidecar.annotations.filter((a) => a.id !== id),
    };
    if (selectedAnnotation?.id === id) {
      setSelectedAnnotation(null);
      setPanelMode("none");
    }
    await persistSidecar(next);
  }

  // ----- Page navigation / zoom ---------------------------------------------

  function scrollToPage(pageNum: number) {
    const container = containerRef.current;
    if (!container) return;
    const w = container.querySelector(
      `div[data-page-number="${pageNum}"]`,
    ) as HTMLElement | null;
    if (w) w.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * Scroll so a target rect lands centred in the viewport. We drop a
   * 1px marker at the rect's PDF-coords-derived pixel position inside
   * the page wrapper, call scrollIntoView with `block: "center"`, then
   * remove the marker after a short delay (gives smooth-scroll time to
   * settle before the DOM mutation).
   *
   * Used by both the annotation-tab "Jump to page" link and the in-PDF
   * search "go to result" path.
   */
  function scrollToRectInPage(pageNum: number, rect: AnnotationRect | null) {
    const container = containerRef.current;
    if (!container) return;
    const wrapper = container.querySelector(
      `div[data-page-number="${pageNum}"]`,
    ) as HTMLElement | null;
    if (!wrapper) return;
    if (!rect) {
      wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const marker = document.createElement("div");
    marker.style.position = "absolute";
    marker.style.left = "0";
    marker.style.top = `${rect.y * zoom + (rect.h * zoom) / 2}px`;
    marker.style.width = "1px";
    marker.style.height = "1px";
    marker.style.pointerEvents = "none";
    wrapper.appendChild(marker);
    marker.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => marker.remove(), 1200);
  }

  function scrollToAnnotation(ann: PdfAnnotation) {
    scrollToRectInPage(ann.page, ann.rects[0] ?? null);
  }

  function gotoPage(pageNum: number) {
    const clamped = Math.max(1, Math.min(numPages || 1, pageNum));
    setCurrentPage(clamped);
    setPageInput(String(clamped));
    scrollToPage(clamped);
  }

  function zoomIn() {
    setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  }
  function zoomOut() {
    setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  }
  function zoomReset() {
    setZoom(ZOOM_DEFAULT);
  }
  function fitWidth() {
    const container = containerRef.current;
    const pdfDoc = pdfDocRef.current;
    if (!container || !pdfDoc) return;
    const firstWrap = container.querySelector(
      'div[data-page-number="1"]',
    ) as HTMLElement | null;
    if (!firstWrap) return;
    const currentCssWidth = parseFloat(firstWrap.style.width || "0");
    if (!currentCssWidth) return;
    const naturalAt1 = currentCssWidth / zoom;
    const containerEl = container.parentElement;
    const available =
      (containerEl?.clientWidth ?? container.clientWidth ?? currentCssWidth) -
      24;
    const newZoom = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, +(available / naturalAt1).toFixed(2)),
    );
    setZoom(newZoom);
  }

  // ----- Render -------------------------------------------------------------

  // Cluster 6 v1.6 — PDFReader owns its own scroll container. The wrap
  // is a non-scrolling flex column (header + scrollable pages). Search
  // bubble + annotation panels live as siblings of the scroll area
  // inside the wrap, so they pin to the visible viewport instead of
  // scrolling away with the pages. TabPane's paneRoot stops scrolling
  // for PDF view (it switches to overflow: hidden) so only the inner
  // page scrollbar shows — fixes the "outer scrollbar moves when
  // clicking a search hit" report.

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title} title={filePath}>
            {basename(filePath)}
          </h2>
          <div style={styles.headerActions}>
            <button
              onClick={onClose}
              style={styles.backBtn}
              title="Back to editor"
            >
              ← Back
            </button>
          </div>
        </div>

        {!loading && !error && (
          <div style={styles.toolbar}>
            <div style={styles.toolbarGroup}>
              <button
                onClick={() => gotoPage(currentPage - 1)}
                disabled={currentPage <= 1}
                style={styles.toolBtn}
                title="Previous page"
              >
                ◀
              </button>
              <input
                type="text"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = parseInt(pageInput, 10);
                    if (Number.isFinite(n)) gotoPage(n);
                  }
                }}
                onBlur={() => {
                  const n = parseInt(pageInput, 10);
                  if (Number.isFinite(n)) gotoPage(n);
                  else setPageInput(String(currentPage));
                }}
                style={styles.pageInput}
                aria-label="Page number"
              />
              <span style={styles.muted}>/ {numPages}</span>
              <button
                onClick={() => gotoPage(currentPage + 1)}
                disabled={currentPage >= numPages}
                style={styles.toolBtn}
                title="Next page"
              >
                ▶
              </button>
            </div>

            <div style={styles.toolbarGroup}>
              <button
                onClick={zoomOut}
                disabled={zoom <= ZOOM_MIN + 0.001}
                style={styles.toolBtn}
                title="Zoom out"
              >
                −
              </button>
              <button
                onClick={zoomReset}
                style={styles.toolBtn}
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={zoomIn}
                disabled={zoom >= ZOOM_MAX - 0.001}
                style={styles.toolBtn}
                title="Zoom in"
              >
                +
              </button>
              <button
                onClick={fitWidth}
                style={styles.toolBtn}
                title="Fit width"
              >
                ↔
              </button>
              <button
                onClick={() =>
                  setPageLayout((p) => (p === "single" ? "two" : "single"))
                }
                style={{
                  ...styles.toolBtn,
                  ...(pageLayout === "two" ? styles.toolBtnActive : {}),
                }}
                title={
                  pageLayout === "single"
                    ? "Switch to two-page view"
                    : "Switch to single-page view"
                }
                aria-pressed={pageLayout === "two"}
              >
                {pageLayout === "single" ? "1pp" : "2pp"}
              </button>
            </div>

            <div style={{ ...styles.toolbarGroup, marginLeft: "auto" }}>
              <button
                onClick={() => {
                  if (!sidecar?.annotations.length) return;
                  setSelectedAnnotation(null);
                  setPanelMode((m) => (m === "list" ? "none" : "list"));
                }}
                disabled={!sidecar?.annotations.length}
                style={{
                  ...styles.toolBtn,
                  ...(panelMode === "list" ? styles.toolBtnActive : {}),
                }}
                title="Open the annotations list"
              >
                {sidecar?.annotations.length ?? 0} annotation
                {(sidecar?.annotations.length ?? 0) === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {(loading || error) && (
          <p style={styles.blurb}>
            {loading ? "Loading PDF…" : `Could not open PDF: ${error}`}
          </p>
        )}
      </header>

      <div style={styles.scrollArea}>
        <div
          ref={containerRef}
          className={
            pageLayout === "two"
              ? "pdf-pages pdf-pages-two"
              : "pdf-pages pdf-pages-single"
          }
          style={styles.pages}
        />
      </div>

      {selectionBubble && (
        <div
          style={{
            ...styles.bubble,
            left: selectionBubble.x,
            top: selectionBubble.y,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {MARK_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => createAnnotation(c)}
              style={{
                ...styles.bubbleSwatch,
                background: COLOR_RGBA[c],
                borderColor: COLOR_RGBA[c],
              }}
              title={`Highlight ${c}`}
              aria-label={`Highlight ${c}`}
            />
          ))}
        </div>
      )}

      {panelMode === "single" && liveSelected && (
        <AnnotationSidePanel
          annotation={liveSelected}
          onClose={() => {
            setSelectedAnnotation(null);
            setPanelMode("none");
          }}
          onSwitchToList={() => {
            setSelectedAnnotation(null);
            setPanelMode("list");
          }}
          onChangeColor={(c) => updateAnnotation(liveSelected.id, { kind: c })}
          onUpdateNote={(note) => updateAnnotation(liveSelected.id, { note })}
          onToggleResolved={() =>
            updateAnnotation(liveSelected.id, {
              resolved: !liveSelected.resolved,
            })
          }
          onDelete={() => deleteAnnotation(liveSelected.id)}
          onJumpToPage={() => scrollToAnnotation(liveSelected)}
          onRemoveLinkedNote={(target) =>
            updateAnnotation(liveSelected.id, {
              linked_notes: liveSelected.linked_notes.filter(
                (t) => t !== target,
              ),
            })
          }
          onOpenLinkPopup={() => setLinkPopupFor(liveSelected)}
        />
      )}

      {panelMode === "list" && sidecar && (
        <AnnotationListPanel
          annotations={sidecar.annotations}
          onClose={() => setPanelMode("none")}
          onPick={(ann) => {
            // Update the page tracker so the toolbar reflects where we
            // are, then scroll to the annotation's actual position
            // rather than the top of the page.
            setCurrentPage(ann.page);
            setPageInput(String(ann.page));
            setSelectedAnnotation(ann);
            setPanelMode("single");
            // Defer to next paint so the panel mode flip and selection
            // state changes have settled before we initiate the scroll.
            requestAnimationFrame(() => scrollToAnnotation(ann));
          }}
        />
      )}

      {linkPopupFor && (
        <LinkNotePopup
          vaultPath={vaultPath}
          alreadyLinked={linkPopupFor.linked_notes}
          onClose={() => setLinkPopupFor(null)}
          onPick={(target) => {
            const set = new Set([...linkPopupFor.linked_notes, target]);
            updateAnnotation(linkPopupFor.id, {
              linked_notes: Array.from(set),
            });
            setLinkPopupFor(null);
          }}
        />
      )}

      {searchOpen && (
        <aside style={styles.searchBubble} aria-label="In-PDF search">
          <header style={styles.searchHeader}>
            <button
              onClick={() => gotoHit(currentHitIdx - 1)}
              disabled={searchHits.length === 0}
              style={styles.toolBtn}
              title="Previous match (Shift+F3)"
              aria-label="Previous match"
            >
              ◀
            </button>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (searchHits.length === 0) return;
                  e.preventDefault();
                  gotoHit(currentHitIdx + (e.shiftKey ? -1 : 1));
                }
              }}
              placeholder="Search this PDF…"
              style={styles.searchInput}
            />
            <button
              onClick={() => gotoHit(currentHitIdx + 1)}
              disabled={searchHits.length === 0}
              style={styles.toolBtn}
              title="Next match (F3 or Enter)"
              aria-label="Next match"
            >
              ▶
            </button>
            <button
              onClick={() => setSearchOpen(false)}
              style={styles.toolBtn}
              title="Close (Esc)"
              aria-label="Close search"
            >
              ×
            </button>
          </header>
          <div style={styles.searchStatus}>
            {searchQuery.length === 0
              ? "Type at least 2 characters"
              : searchQuery.length === 1
                ? "Keep typing…"
                : searchHits.length === 0
                  ? "No matches"
                  : `${currentHitIdx + 1} of ${searchHits.length}`}
          </div>
          {searchHits.length > 0 && (
            <ul style={styles.searchList}>
              {searchHits.map((h, i) => (
                <li key={`${h.page}-${h.offset}`} style={styles.listItem}>
                  <button
                    onClick={() => gotoHit(i)}
                    style={{
                      ...styles.searchListBtn,
                      ...(i === currentHitIdx
                        ? styles.searchListBtnActive
                        : null),
                    }}
                  >
                    <span style={styles.listMeta}>
                      {h.starred && (
                        <span
                          style={styles.searchListStar}
                          title="This match is inside one of your highlights"
                        >
                          ★
                        </span>
                      )}
                      <span style={styles.listPage}>p. {h.page}</span>
                    </span>
                    <span style={styles.listText}>
                      {renderSearchSnippet(h.context, h.text)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * Render a snippet with the matched substring wrapped in a <strong>.
 * Case-insensitive matching, returns React fragments so we don't need
 * dangerouslySetInnerHTML.
 */
function renderSearchSnippet(context: string, match: string) {
  const lcCtx = context.toLowerCase();
  const lcMatch = match.toLowerCase();
  const idx = lcCtx.indexOf(lcMatch);
  if (idx < 0) return context;
  return (
    <>
      {context.slice(0, idx)}
      <strong style={{ color: "var(--accent)" }}>
        {context.slice(idx, idx + match.length)}
      </strong>
      {context.slice(idx + match.length)}
    </>
  );
}

// ----- Side panel (single annotation editing) ------------------------------

interface AnnotationSidePanelProps {
  annotation: PdfAnnotation;
  onClose: () => void;
  onSwitchToList: () => void;
  onChangeColor: (c: MarkColor) => void;
  onUpdateNote: (note: string) => void;
  onToggleResolved: () => void;
  onDelete: () => void;
  onJumpToPage: () => void;
  onRemoveLinkedNote: (target: string) => void;
  onOpenLinkPopup: () => void;
}
function AnnotationSidePanel({
  annotation,
  onClose,
  onSwitchToList,
  onChangeColor,
  onUpdateNote,
  onToggleResolved,
  onDelete,
  onJumpToPage,
  onRemoveLinkedNote,
  onOpenLinkPopup,
}: AnnotationSidePanelProps) {
  const [noteDraft, setNoteDraft] = useState(annotation.note);
  useEffect(() => setNoteDraft(annotation.note), [annotation.id]);

  return (
    <aside style={styles.panel}>
      <header style={styles.panelHeader}>
        <strong style={styles.panelTitle}>Annotation</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onSwitchToList}
            style={styles.toolBtn}
            title="View all annotations"
          >
            ☰
          </button>
          <button
            onClick={onClose}
            style={styles.toolBtn}
            aria-label="Close panel"
          >
            ×
          </button>
        </div>
      </header>
      <div style={styles.panelBody}>
        <div style={styles.panelRow}>
          <span style={styles.panelLabel}>Page</span>
          <button onClick={onJumpToPage} style={styles.linkBtn}>
            Jump to page {annotation.page}
          </button>
        </div>
        <div style={styles.panelRow}>
          <span style={styles.panelLabel}>Highlighted text</span>
          <blockquote style={styles.panelQuote}>{annotation.text}</blockquote>
        </div>
        <div style={styles.panelRow}>
          <span style={styles.panelLabel}>Colour</span>
          <div style={styles.swatches}>
            {MARK_COLORS.map((c) => {
              const active = annotation.kind === c;
              return (
                <button
                  key={c}
                  onClick={() => onChangeColor(c)}
                  style={{
                    ...styles.bubbleSwatch,
                    background: COLOR_RGBA[c],
                    borderColor: active ? "var(--text)" : COLOR_RGBA[c],
                    outline: active ? "2px solid var(--accent)" : "none",
                  }}
                  title={c}
                  aria-label={c}
                />
              );
            })}
          </div>
        </div>
        <label style={styles.panelRow}>
          <span style={styles.panelLabel}>Note</span>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              if (noteDraft !== annotation.note) onUpdateNote(noteDraft);
            }}
            placeholder="Add a written note (optional)"
            style={styles.panelTextarea}
            rows={4}
          />
        </label>

        <div style={styles.panelRow}>
          <span style={styles.panelLabel}>Linked notes</span>
          {annotation.linked_notes.length === 0 ? (
            <p style={styles.muted}>No links yet.</p>
          ) : (
            <div style={styles.chipList}>
              {annotation.linked_notes.map((t) => (
                <span key={t} style={styles.chip}>
                  [[{t}]]
                  <button
                    onClick={() => onRemoveLinkedNote(t)}
                    style={styles.chipClose}
                    title="Remove link"
                    aria-label="Remove link"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            onClick={onOpenLinkPopup}
            style={{ ...styles.toolBtn, marginTop: 6 }}
          >
            + Link to note…
          </button>
        </div>

        <label style={styles.panelCheckboxRow}>
          <input
            type="checkbox"
            checked={annotation.resolved}
            onChange={onToggleResolved}
          />
          <span>Mark as resolved</span>
        </label>
        <div style={styles.panelFooter}>
          <button onClick={onDelete} style={styles.dangerBtn}>
            Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

// ----- List panel (all annotations) ---------------------------------------

interface AnnotationListPanelProps {
  annotations: PdfAnnotation[];
  onClose: () => void;
  onPick: (ann: PdfAnnotation) => void;
}
function AnnotationListPanel({
  annotations,
  onClose,
  onPick,
}: AnnotationListPanelProps) {
  const sorted = [...annotations].sort(
    (a, b) => a.page - b.page || a.id.localeCompare(b.id),
  );
  return (
    <aside style={styles.panel}>
      <header style={styles.panelHeader}>
        <strong style={styles.panelTitle}>
          Annotations ({annotations.length})
        </strong>
        <button onClick={onClose} style={styles.toolBtn} aria-label="Close">
          ×
        </button>
      </header>
      <div style={styles.panelBody}>
        {sorted.length === 0 ? (
          <p style={styles.muted}>
            No annotations yet. Drag-select text on a page to start.
          </p>
        ) : (
          <ul style={styles.list}>
            {sorted.map((ann) => {
              const color = (ann.kind in COLOR_RGBA ? ann.kind : "yellow") as
                | MarkColor
                | string;
              const colorRgba =
                (COLOR_RGBA as Record<string, string>)[color] ??
                COLOR_RGBA.yellow;
              return (
                <li key={ann.id} style={styles.listItem}>
                  <button
                    onClick={() => onPick(ann)}
                    style={{
                      ...styles.listBtn,
                      opacity: ann.resolved ? 0.6 : 1,
                    }}
                    title={`Page ${ann.page} — click to jump`}
                  >
                    <span style={styles.listMeta}>
                      <span
                        style={{
                          ...styles.listSwatch,
                          background: colorRgba,
                          borderColor: colorRgba,
                        }}
                      />
                      <span style={styles.listPage}>p. {ann.page}</span>
                    </span>
                    <span style={styles.listText}>{ann.text}</span>
                    {ann.note && (
                      <span style={styles.listNote}>— {ann.note}</span>
                    )}
                    {ann.linked_notes.length > 0 && (
                      <span style={styles.listLinks}>
                        {ann.linked_notes.map((t) => `[[${t}]]`).join(" ")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ----- Link-to-note popup --------------------------------------------------

interface LinkNotePopupProps {
  vaultPath: string;
  alreadyLinked: string[];
  onClose: () => void;
  onPick: (target: string) => void;
}
function LinkNotePopup({
  vaultPath,
  alreadyLinked,
  onClose,
  onPick,
}: LinkNotePopupProps) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Only markdown notes — linking a PDF to another PDF would be
    // surprising in this picker. Server-side filter keeps the result
    // set small even on big vaults.
    invoke<NoteListItem[]>("list_all_notes", { vaultPath, kind: "md" })
      .then(setNotes)
      .catch((e) => console.warn("list_all_notes failed:", e));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [vaultPath]);

  const q = query.trim().toLowerCase();
  const linkedSet = new Set(alreadyLinked.map((s) => s.toLowerCase()));
  const filtered = notes
    .filter((n) => {
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
      );
    })
    .slice(0, 30);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && filtered.length > 0) {
      onPick(filtered[0].title);
    }
  }

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.linkPanel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <header style={styles.panelHeader}>
          <strong style={styles.panelTitle}>Link to note</strong>
          <button onClick={onClose} style={styles.toolBtn} aria-label="Close">
            ×
          </button>
        </header>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ ...styles.panelTextarea, height: "32px", resize: "none" }}
        />
        <ul style={{ ...styles.list, marginTop: 8 }}>
          {filtered.length === 0 ? (
            <li style={{ padding: 8, color: "var(--text-muted)" }}>
              {notes.length === 0 ? "Loading notes…" : "No matches."}
            </li>
          ) : (
            filtered.map((n) => {
              const already = linkedSet.has(n.title.toLowerCase());
              return (
                <li key={n.path} style={styles.listItem}>
                  <button
                    disabled={already}
                    onClick={() => onPick(n.title)}
                    style={{
                      ...styles.listBtn,
                      opacity: already ? 0.45 : 1,
                      cursor: already ? "default" : "pointer",
                    }}
                    title={n.path}
                  >
                    <span style={styles.listText}>{n.title}</span>
                    {already && (
                      <span style={styles.muted}>(already linked)</span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <p style={styles.muted}>Enter to pick the first match · Esc to close</p>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  return path.split(sep).pop() ?? path;
}

const styles: Record<string, React.CSSProperties> = {
  // `position: relative` anchors the search bubble (which uses
  // position: absolute) to the PDF reader's bounding box, so it
  // pins to the top-right of *its own tab* in multi-tab layouts
  // instead of escaping to the window-level top-right.
  //
  // v1.6: wrap is now a flex column with overflow: hidden. The
  // header is a non-shrinking child at the top; the pages live in
  // a scrollable child (`scrollArea`) below; absolute-positioned
  // overlays (search bubble) anchor to the wrap so they pin to
  // the visible area instead of scrolling away with the pages.
  wrap: {
    maxWidth: "1100px",
    margin: "0 auto",
    position: "relative",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    paddingBottom: "0.75rem",
    marginBottom: "1rem",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg)",
    zIndex: 2,
    flex: "0 0 auto",
  },
  // The PDFReader's own scroll container (added in v1.6). Keeps
  // marker.scrollIntoView() targeting this container instead of
  // bubbling up to TabPane's paneRoot — that's what made the
  // "outer scrollbar moves on search hit" bug visible.
  scrollArea: {
    flex: "1 1 auto",
    overflowY: "auto",
    position: "relative",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    marginBottom: "0.4rem",
  },
  headerActions: { display: "flex", gap: "0.5rem" },
  title: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--text)",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  backBtn: {
    fontSize: "0.8rem",
    padding: "4px 12px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    flexWrap: "wrap",
  },
  toolbarGroup: { display: "flex", alignItems: "center", gap: "4px" },
  toolBtn: {
    fontSize: "0.85rem",
    padding: "3px 9px",
    minWidth: "28px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  toolBtnActive: {
    background: "var(--bg-deep)",
    color: "var(--text)",
    borderColor: "var(--accent)",
  },
  pageInput: {
    width: "44px",
    padding: "3px 6px",
    fontSize: "0.85rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    textAlign: "center",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  muted: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  blurb: {
    margin: "0.4rem 0 0",
    fontSize: "0.82rem",
    color: "var(--text-muted)",
  },
  pages: { paddingBottom: "2rem" },
  bubble: {
    position: "fixed",
    transform: "translate(-50%, -100%)",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "4px 6px",
    display: "flex",
    gap: "4px",
    boxShadow: "var(--shadow)",
    zIndex: 1100,
  },
  bubbleSwatch: {
    width: "20px",
    height: "20px",
    borderRadius: "3px",
    border: "1px solid",
    cursor: "pointer",
  },
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: "340px",
    background: "var(--bg-card)",
    borderLeft: "1px solid var(--border)",
    boxShadow: "var(--shadow)",
    zIndex: 1200,
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  },
  panelTitle: { fontSize: "0.95rem", color: "var(--text)" },
  panelBody: { padding: "12px 14px", overflowY: "auto", flex: 1 },
  panelRow: { display: "block", marginBottom: "0.85rem" },
  panelLabel: {
    display: "block",
    fontSize: "0.74rem",
    color: "var(--text-2)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "0.3rem",
  },
  panelQuote: {
    margin: 0,
    padding: "8px 10px",
    background: "var(--bg-deep)",
    borderLeft: "3px solid var(--accent)",
    borderRadius: "3px",
    fontSize: "0.88rem",
    color: "var(--text)",
    lineHeight: 1.4,
  },
  swatches: { display: "flex", gap: "6px" },
  panelTextarea: {
    width: "100%",
    padding: "6px 8px",
    fontSize: "0.88rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    boxSizing: "border-box",
    resize: "vertical",
    fontFamily: "inherit",
  },
  panelCheckboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.85rem",
    color: "var(--text)",
    marginBottom: "0.85rem",
  },
  panelFooter: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: "0.4rem",
    borderTop: "1px solid var(--border)",
    marginTop: "0.4rem",
  },
  dangerBtn: {
    fontSize: "0.8rem",
    padding: "5px 12px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "var(--accent)",
    cursor: "pointer",
    padding: 0,
    fontSize: "0.85rem",
    textDecoration: "underline",
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  listItem: { padding: 0, margin: 0 },
  listBtn: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: "pointer",
    marginBottom: 6,
    fontSize: "0.85rem",
    lineHeight: 1.4,
  },
  listMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  listSwatch: {
    width: 12,
    height: 12,
    borderRadius: 2,
    border: "1px solid",
    display: "inline-block",
  },
  listPage: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    color: "var(--text-muted)",
    fontSize: "0.78rem",
  },
  listText: {
    display: "block",
    color: "var(--text)",
  },
  listNote: {
    display: "block",
    color: "var(--text-muted)",
    fontStyle: "italic",
    marginTop: 2,
  },
  listLinks: {
    display: "block",
    color: "var(--accent)",
    fontSize: "0.78rem",
    marginTop: 2,
  },
  chipList: { display: "flex", flexWrap: "wrap", gap: 4 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 6px",
    background: "var(--bg-deep)",
    color: "var(--accent)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    fontSize: "0.78rem",
  },
  chipClose: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
    padding: 0,
    fontSize: "0.9rem",
    lineHeight: 1,
  },
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1300,
  },
  linkPanel: {
    width: "440px",
    maxHeight: "70vh",
    padding: "10px 14px",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
  },
  // ---- in-PDF search bubble ----
  // `position: absolute` anchors to the PDF reader's wrap (which is
  // position: relative AND overflow: hidden). The wrap doesn't scroll
  // — the inner scrollArea does — so the bubble pins to the top-right
  // of the visible PDF tab and doesn't scroll away as the user moves
  // through pages. v1.6 fix.
  //
  // `top: 12px` overlays the toolbar's right edge by design; the
  // bubble is wide enough that pushing it below the header would
  // require either a header-height observer or a hardcoded offset
  // that breaks if the header content wraps (e.g., long PDF
  // filename). Overlaying with z-index 1250 > header z-index 2 is
  // the simpler choice; the user can dismiss the bubble with Esc
  // if they need the toolbar back.
  searchBubble: {
    position: "absolute",
    top: "12px",
    right: "12px",
    width: "340px",
    maxHeight: "70vh",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow)",
    zIndex: 1250,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  searchHeader: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
  },
  searchInput: {
    flex: 1,
    padding: "5px 8px",
    fontSize: "0.88rem",
    background: "var(--bg-deep)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    outline: "none",
  },
  searchStatus: {
    padding: "6px 12px",
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  searchList: {
    listStyle: "none",
    padding: "8px",
    margin: 0,
    overflowY: "auto",
    flex: 1,
  },
  searchListBtn: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 8px",
    background: "transparent",
    color: "var(--text)",
    border: "1px solid transparent",
    borderRadius: "4px",
    cursor: "pointer",
    marginBottom: 3,
    fontSize: "0.82rem",
    lineHeight: 1.35,
  },
  searchListBtnActive: {
    background: "var(--bg-deep)",
    border: "1px solid var(--accent)",
  },
  searchListStar: {
    color: "var(--warning, #f59e0b)",
    fontSize: "0.85rem",
    marginRight: 4,
  },
};
