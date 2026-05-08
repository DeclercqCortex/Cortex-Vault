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
//   CortexTabsBlock    — tab-set; v1.1 wraps each tab's content in a
//                         CortexTabPanel child so a tab can hold any block+.
//   CortexTabPanel     — one tab's worth of block content (v1.1).
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

// ---- Math block (v1.2.2: atom + KaTeX-rendered NodeView) -----------------
//
// v1.0 stored the LaTeX as the node's text content (`content: "text*"`)
// and showed it as italic monospace — basically a stylized text echo.
// v1.2 added the math-equation builder modal but the document still
// rendered raw LaTeX source, which the user (rightly) called out.
//
// v1.2.2 makes the node ATOMIC and stores the LaTeX in a `latex` attr.
// Why atomic: a NodeView that renders KaTeX would conflict with PM's
// expectation that the node's contentDOM holds the visible content.
// With `atom: true` there is no contentDOM — the NodeView fully owns
// what's painted on screen, and PM treats the node as one selectable
// unit (NodeSelection on click, single-keystroke delete, etc.).
//
// Backward compatibility: the parseHTML fallback reads `el.textContent`
// when data-latex is missing, so existing math blocks saved as
// `<div class="cortex-math-block">x^2</div>` parse correctly into
// `{ latex: "x^2" }`. They re-emit on next save with the new attr form.
//
// renderHTML emits both data-latex (for round-trip) AND the LaTeX as
// text content inside the div, so a markdown export viewed without
// JS still shows something readable.

export const CortexMathBlock = Node.create({
  name: "cortexMathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-latex") || el.textContent || "",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-latex": String(a.latex ?? ""),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.cortex-math-block" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const latex = String(node.attrs.latex ?? "");
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-math-block" }),
      latex,
    ];
  },
});

// ---- Tabs block (v1.1: panel-per-tab) ------------------------------------
//
// v1.0 had a "1 child block per tab title" model where the tabs node's
// content was `block+` and the title strip was rendered in renderHTML
// alongside a `data-tabs="A|B"` pipe-list. The fundamental problem:
// pressing Enter inside tab 1 made ProseMirror split into two paragraphs,
// and the NodeView's children-count-sync would then DELETE the second
// paragraph (mistaking it for a stray child without a title). Tabs
// could never hold more than one paragraph.
//
// v1.1 replaces that with a real two-level schema:
//   cortexTabsBlock   content: cortexTabPanel+, attr: activeTab
//   cortexTabPanel    content: block+,           attr: title
// Each panel owns its own title and can hold any block content. Add /
// remove a tab = insert / delete a cortexTabPanel. Rename = setNodeMarkup
// on the specific panel. Switching tabs only updates the parent's
// activeTab attr; the CSS rule
//   .cortex-tabs[data-active-tab="N"] > .cortex-tab-body > *:nth-child(N+1)
// shows only the active panel.
//
// Old v1.0 docs that have `data-tabs="A|B"` with bare `<p>` children
// will fail schema validation when re-opened (cortexTabsBlock now
// requires cortexTabPanel children). That's acceptable: cluster 21
// v1.0 just shipped, only test tabs exist; the user re-inserts.

export const CortexTabPanel = Node.create({
  name: "cortexTabPanel",
  // No `group` — this node only ever appears inside cortexTabsBlock,
  // which references it by name in its `content` constraint. Keeping
  // it out of the global `block` group means the user can't accidentally
  // wrap something in a tab panel through the structural-block menu.
  content: "block+",
  defining: true,
  // Selection / paste / drag won't accidentally cross a panel boundary
  // — typing in tab 1 stays in tab 1, even if tab 2 is rendered
  // adjacent in the DOM (it's just hidden via CSS).
  isolating: true,
  addAttributes() {
    return {
      title: {
        default: "Tab",
        parseHTML: (el) => el.getAttribute("data-title") || "Tab",
        renderHTML: (a: Record<string, unknown>) => ({
          "data-title": String(a.title ?? "Tab"),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.cortex-tab-panel" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-tab-panel" }),
      0,
    ];
  },
});

export const CortexTabsBlock = Node.create({
  name: "cortexTabsBlock",
  group: "block",
  content: "cortexTabPanel+",
  defining: true,
  addAttributes() {
    return {
      // Currently-visible tab index, persisted through markdown round-
      // trip via data-active-tab so reopening lands on the same tab.
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
  // The on-disk format is just <div class="cortex-tabs" data-active-tab="N">
  // wrapping the panel children — minimal because the interactive title
  // strip is rendered by the NodeView at runtime, not stored in the
  // markdown body.
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "cortex-tabs" }),
      0,
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
