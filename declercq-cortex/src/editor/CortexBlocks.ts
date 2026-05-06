// Cluster 21 v1.0 — Cortex layout / structure nodes + paragraph attrs.
//
// Consolidated file for the small extensions that the toolbar's
// Layout / Paragraph / Insert groups operate on. Each node /
// extension uses minimal schema and emits HTML with classes that
// match src/index.css. Markdown round-trip via tiptap-markdown's
// `html: true`.
//
// Nodes:
//   CortexCallout      — info/tip/warning/danger/note variants
//   CortexColumns      — 2-col / 3-col grid
//   CortexSideBySide   — equal-split with a vertical divider
//   CortexCollapsible  — <details>/<summary>
//   CortexMarginNote   — float-right annotation
//   CortexFrame        — bordered box around content
//   CortexPullQuote    — large italic quote
//   CortexDecoSeparator — divider with a glyph
//   CortexPageBreak    — page-break HR
//   CortexMathBlock    — stylized math block (KaTeX in v1.1)
//   CortexTabsBlock    — minimal tab-set (v1.0: stacked panels with titles)
//
// Marks:
//   CortexFootnoteRef  — `<sup class="cortex-fn" data-id>…</sup>`
//   CortexCitationRef  — `<span class="cortex-citation" data-id>…</span>`
//   CortexMathInline   — inline `<span class="cortex-math-inline">$x^2$</span>`
//   CortexDropCap      — first-character drop-cap mark
//
// Paragraph extension:
//   CortexParagraphAttrs — adds lineHeight / spacingTop / spacingBottom / indent attrs

import { Mark, Node, mergeAttributes } from "@tiptap/core";

// ---- Callout ------------------------------------------------------------

export const CortexCallout = Node.create({
  name: "cortexCallout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-variant") || "info",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-variant": String(a.variant ?? "info"),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.cortex-callout" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const variant = String(node.attrs.variant || "info");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: `cortex-callout cortex-callout-${variant}`,
      }),
      0,
    ];
  },
});

// ---- Columns 2 / 3 -------------------------------------------------------

export const CortexColumns = Node.create({
  name: "cortexColumns",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (el) => Number(el.getAttribute("data-count") || 2),
        renderHTML: (a: Record<string, unknown>) => ({
          "data-count": String(a.count ?? 2),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.cortex-columns" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const c = Number(node.attrs.count) === 3 ? 3 : 2;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: `cortex-columns cortex-columns-${c}`,
      }),
      0,
    ];
  },
});

// ---- Side-by-side --------------------------------------------------------

export const CortexSideBySide = Node.create({
  name: "cortexSideBySide",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "div.cortex-side-by-side" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-side-by-side" }),
      0,
    ];
  },
});

// ---- Collapsible (details / summary) -------------------------------------

export const CortexCollapsible = Node.create({
  name: "cortexCollapsible",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      summary: {
        default: "Toggle",
        parseHTML: (el) => el.getAttribute("data-summary") || "Toggle",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-summary": String(a.summary ?? "Toggle"),
        }),
      },
      open: {
        default: false,
        parseHTML: (el) =>
          el.hasAttribute("open") || el.getAttribute("data-open") === "true",
        renderHTML: (a: Record<string, unknown>) =>
          a.open ? { open: "", "data-open": "true" } : { "data-open": "false" },
      },
    };
  },
  // Cluster 21 v1.1 — accept both the v1.0 native <details> emission
  // and a generic .cortex-toggle wrapper (the NodeView's wrapper
  // class), so on save we round-trip via the same parseHTML rules
  // regardless of which renderer wrote the markup last.
  parseHTML() {
    return [{ tag: "details.cortex-toggle" }, { tag: "div.cortex-toggle" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const summary = String(node.attrs.summary ?? "Toggle");
    const open = Boolean(node.attrs.open);
    return [
      "details",
      mergeAttributes(HTMLAttributes, { class: "cortex-toggle" }),
      ["summary", {}, summary],
      [
        "div",
        { class: "cortex-toggle-body", "data-open": open ? "true" : "false" },
        0,
      ],
    ];
  },
});

// ---- Margin note ---------------------------------------------------------

export const CortexMarginNote = Node.create({
  name: "cortexMarginNote",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "aside.cortex-margin-note" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { class: "cortex-margin-note" }),
      0,
    ];
  },
});

// ---- Frame ---------------------------------------------------------------

export const CortexFrame = Node.create({
  name: "cortexFrame",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "div.cortex-frame" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-frame" }),
      0,
    ];
  },
});

// ---- Pull quote ----------------------------------------------------------

export const CortexPullQuote = Node.create({
  name: "cortexPullQuote",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "blockquote.cortex-pull-quote" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "blockquote",
      mergeAttributes(HTMLAttributes, { class: "cortex-pull-quote" }),
      0,
    ];
  },
});

// ---- Decorative separator ------------------------------------------------

export const CortexDecoSeparator = Node.create({
  name: "cortexDecoSeparator",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      glyph: {
        default: "❦",
        parseHTML: (el) => el.getAttribute("data-glyph") || "❦",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-glyph": String(a.glyph ?? "❦"),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.cortex-deco-separator" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-deco-separator" }),
      ["span", {}, String(node.attrs.glyph ?? "❦")],
    ];
  },
});

// ---- Page break ----------------------------------------------------------

export const CortexPageBreak = Node.create({
  name: "cortexPageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "hr.cortex-page-break" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "hr",
      mergeAttributes(HTMLAttributes, { class: "cortex-page-break" }),
    ];
  },
});

// ---- Math block (v1.0: stylized text; KaTeX render in v1.1) --------------

export const CortexMathBlock = Node.create({
  name: "cortexMathBlock",
  group: "block",
  content: "text*",
  marks: "",
  defining: true,
  parseHTML() {
    return [{ tag: "div.cortex-math-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-math-block" }),
      0,
    ];
  },
});

// ---- Tabs block (v1.0: simple stacked) -----------------------------------

export const CortexTabsBlock = Node.create({
  name: "cortexTabsBlock",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      tabs: {
        default: "Tab 1|Tab 2",
        parseHTML: (el) => el.getAttribute("data-tabs") || "Tab 1|Tab 2",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-tabs": String(a.tabs ?? "Tab 1|Tab 2"),
        }),
      },
      // Cluster 21 v1.1 — currently visible tab index, persisted
      // through markdown round-trip via data-active-tab so a user
      // who switches to tab 2 and saves the file reopens with
      // tab 2 showing rather than always defaulting to the first.
      activeTab: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-active-tab") || 0),
        renderHTML: (a: Record<string, unknown>) => ({
          "data-active-tab": String(Number(a.activeTab) || 0),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.cortex-tabs" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const titles = String(node.attrs.tabs ?? "")
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean);
    const active = Math.min(
      Math.max(0, Number(node.attrs.activeTab) || 0),
      Math.max(0, titles.length - 1),
    );
    const titleEls: any[] = [
      "div",
      { class: "cortex-tabs-titles" },
      ...titles.map((t, i) => [
        "span",
        { class: "cortex-tab-title" + (i === active ? " active" : "") },
        t,
      ]),
    ];
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "cortex-tabs",
        style: `--cortex-tab-active: ${active + 1}`,
      }),
      titleEls,
      ["div", { class: "cortex-tab-body" }, 0],
    ];
  },
});

// ---- Footnote ref --------------------------------------------------------

export const CortexFootnoteRef = Mark.create({
  name: "cortexFootnoteRef",
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: "1",
        parseHTML: (el) => el.getAttribute("data-id") || "1",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-id": String(a.id ?? "1"),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "sup.cortex-fn" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "cortex-fn" }), 0];
  },
});

// ---- Citation ref --------------------------------------------------------

export const CortexCitationRef = Mark.create({
  name: "cortexCitationRef",
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: "1",
        parseHTML: (el) => el.getAttribute("data-id") || "1",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-id": String(a.id ?? "1"),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span.cortex-citation" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "cortex-citation" }),
      0,
    ];
  },
});

// ---- Math inline (mark) --------------------------------------------------

export const CortexMathInline = Mark.create({
  name: "cortexMathInline",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span.cortex-math-inline" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "cortex-math-inline" }),
      0,
    ];
  },
});

// ---- Drop cap (mark, applied to first character) -------------------------

export const CortexDropCap = Mark.create({
  name: "cortexDropCap",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span.cortex-drop-cap" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "cortex-drop-cap" }),
      0,
    ];
  },
});
