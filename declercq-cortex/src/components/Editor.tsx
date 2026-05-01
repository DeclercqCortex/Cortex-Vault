import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
// TipTap v3 ships these as named exports (not default), unlike the older
// extensions above. Mismatch here was the white-screen culprit:
//   "does not provide an export named 'default'" at Editor.tsx:6.
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextAlign } from "@tiptap/extension-text-align";
import { Markdown } from "tiptap-markdown";
import { DOMSerializer } from "@tiptap/pm/model";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { useEffect, useState } from "react";
import { WikilinkDecoration } from "../editor/WikilinkDecoration";
import { ColorMark } from "../editor/ColorMark";
// Cluster 17 — replaces ExperimentBlockDecoration. The block is now a
// real TipTap custom node (TypedBlockNode) rather than a decoration over
// plain paragraphs, with a markdown serializer that keeps the on-disk
// `::TYPE NAME … ::end` format intact (so route_*_blocks on the Rust
// side keeps working unchanged) and a post-setContent transform that
// lifts legacy paragraph runs into the new node on load.
import { SerializingTypedBlockNode } from "../editor/TypedBlockSerializer";
import { liftTypedBlocks } from "../editor/TypedBlockTransform";
import { TableContextMenu, type TableAction } from "./TableContextMenu";
import { BlockContextMenu, type BlockAction } from "./BlockContextMenu";
import {
  EDIT_TYPED_BLOCK_EVENT,
  FOLLOW_TYPED_BLOCK_EVENT,
} from "./TypedBlockNodeView";
import type { TypedBlockType } from "../editor/TypedBlockNode";
import {
  FormulaTableCell,
  FormulaTableHeader,
  FormulaEvaluator,
} from "../editor/FormulaCells";
import { CortexColumnResize } from "../editor/CortexColumnResize";
import { CortexTableView } from "../editor/CortexTableView";

/**
 * Cluster 18 — table cells now carry verticalAlign (Cluster 16) AND
 * formula / formulaResult (Cluster 18 v1.0) attributes. The combined
 * extensions are defined in src/editor/FormulaCells.ts to keep this
 * file from sprawling. We import them under their new names; behaviour
 * for verticalAlign is unchanged.
 *
 * The accompanying FormulaEvaluator plugin walks every table cell
 * after each transaction and (re-)evaluates any cell whose text starts
 * with `=`, storing the result in data-formula-result. The CSS in
 * src/index.css overlays the result via ::after when the cell is not
 * focused. Click-to-edit reveals the raw formula text.
 */

/**
 * Cluster 16 v1.1 — Table serialized as raw HTML, always.
 *
 * v1.0 left tiptap-markdown's default Table serializer in place, which
 * emits GFM pipe-table markdown. Pipe tables have no syntax for
 * column widths or per-cell vertical alignment, so both attributes
 * were silently stripped on save and the user lost their layout on
 * reload. v1.1 overrides the markdown.serialize hook for the Table
 * node and emits the entire table as HTML using ProseMirror's
 * DOMSerializer.
 *
 * Why DOMSerializer rather than hand-rolled HTML: each cell can
 * carry rich content — paragraphs, marks (bold / italic / colour),
 * lists, even nested HTML — and the schema's `toDOM` already knows
 * how to render every one of them. Walking the cells ourselves
 * would mean replicating that logic. DOMSerializer hands us a
 * faithful HTML fragment for free.
 *
 * On reload, tiptap-markdown's `html: true` parser preserves the
 * `<table>…</table>` block; markdown-it follows the CommonMark
 * "type-6 HTML block" rule which leaves content inside `<table>`
 * untouched (no markdown re-parse). The schema's parseHTML rules
 * then read attributes back: `data-colwidth` on cells (standard
 * prosemirror-tables attr), `style="vertical-align: …"` (our
 * custom ValignTableCell / ValignTableHeader parsers), `colspan`
 * / `rowspan`, etc.
 *
 * The on-disk format change is one-way: tables that previously
 * lived as pipe-tables continue to be readable (parseHTML for
 * pipe-table markdown still runs through markdown-it's
 * GFM table plugin), but on next save they re-emit as HTML. So
 * existing vault files seamlessly migrate.
 */
const HtmlTable = Table.extend({
  // Cluster 18 v1.1 — freeze rows / freeze columns. Both are stored as
  // table-level attributes (parseHTML reads from data-frozen-rows /
  // data-frozen-cols; renderHTML writes them back). The frozenCellsPlugin
  // in FormulaCells.ts reads these attrs and emits per-cell decorations
  // with data-frozen-row / data-frozen-col so CSS can apply
  // `position: sticky` to the frozen region.
  addAttributes() {
    return {
      ...this.parent?.(),
      frozenRows: {
        default: 0,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-frozen-rows");
          const n = v ? parseInt(v, 10) : 0;
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const n = Number(attrs.frozenRows ?? 0) | 0;
          if (n <= 0) return {};
          return { "data-frozen-rows": String(n) };
        },
      },
      frozenCols: {
        default: 0,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-frozen-cols");
          const n = v ? parseInt(v, 10) : 0;
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const n = Number(attrs.frozenCols ?? 0) | 0;
          if (n <= 0) return {};
          return { "data-frozen-cols": String(n) };
        },
      },
      // Cluster 18 v1.2 — row filter. filterCol is the 0-based column
      // index of the value the user filtered on; filterValue is the
      // case-insensitive substring rows must contain in that column to
      // remain visible. Both null means no filter is active. The
      // filtered-rows decoration plugin in FormulaCells.ts reads these
      // attrs and emits data-filtered="true" on hidden rows; CSS does
      // display: none.
      filterCol: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-filter-col");
          if (v == null) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n >= 0 ? n : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = attrs.filterCol;
          if (v == null) return {};
          return { "data-filter-col": String(v) };
        },
      },
      filterValue: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-filter-value") || null,
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = attrs.filterValue as string | null | undefined;
          if (v == null || v === "") return {};
          return { "data-filter-value": v };
        },
      },
    };
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const serializer = DOMSerializer.fromSchema(node.type.schema);
          const fragment = serializer.serializeNode(node);
          const wrapper = document.createElement("div");
          wrapper.appendChild(fragment);
          state.write(wrapper.innerHTML);
          state.closeBlock(node);
        },
        parse: { setup: () => {} },
      },
    };
  },
  // Cluster 18 v1.0.1 — install our own minimal TableView.
  // Replaces the prosemirror-tables-provided one we lost when
  // disabling the columnResizing plugin. The view's update() reads
  // colwidth attrs from cells and maintains a colgroup of matching
  // <col> elements with inline widths, so drag and equalize changes
  // appear live (they were only landing on next reload before this
  // fix). Also trims stale <col>s when the column count shrinks,
  // which closes the white-line artifact on column delete.
  addNodeView() {
    return ({ node }) => {
      const view = new CortexTableView(node);
      return {
        dom: view.dom,
        contentDOM: view.contentDOM,
        update: (updatedNode) => view.update(updatedNode),
        ignoreMutation: (record) => view.ignoreMutation(record),
      };
    };
  },
});

/**
 * Strike that serializes as `<s>…</s>` HTML rather than tiptap-markdown's
 * default `~~…~~`. Reason: when struck text overlaps a colour mark
 * (`<mark class="mark-X">`), the `~~` form lands adjacent to HTML tags
 * and markdown-it can mis-parse on reload (you'd see the literal
 * `<~~mark class="mark-yellow">…` text in the editor instead of a
 * highlighted, struck span). Pure-HTML strike composes with our marks
 * losslessly.
 *
 * The `markdown.serialize.{open,close}` storage hook is tiptap-markdown's
 * extension point for overriding mark serialisation.
 */
const HtmlStrike = Strike.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: {
          open: "<s>",
          close: "</s>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    };
  },
});

/**
 * Cluster 8 v2.1.5: Underline support, Ctrl+U.
 *
 * Markdown has no native underline syntax (`__text__` renders as bold,
 * not underline), so we follow the same HTML-wrap pattern as HtmlStrike:
 * the mark serializes as `<u>…</u>` in the saved markdown, and on reload
 * the `html: true` markdown parser plus TipTap's Underline `parseHTML`
 * round-trip it cleanly.
 *
 * The keymap (Mod-u → toggleUnderline) is provided by the base extension
 * — no override needed. Bold (Ctrl+B) and Italic (Ctrl+I) come from
 * StarterKit and serialize as native markdown (**bold** / *italic*).
 */
const HtmlUnderline = Underline.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: {
          open: "<u>",
          close: "</u>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    };
  },
});

// Cluster 8 v2.1.1 fix: TipTap's StarterKit doesn't include table support,
// so markdown tables in protocol/method files weren't rendering. The four
// standard extensions are registered with their built-in keybindings —
// Tab/Shift+Tab navigate cells. To add a row the user hand-edits the
// markdown source for now; a row-append shortcut is a follow-up.

/**
 * Cluster 8 v2.1.3: text-align shortcuts. The base TextAlign extension
 * doesn't ship its own keymap; we wire Ctrl+Shift+L/E/R for left/center/
 * right via `addKeyboardShortcuts`. Mod-* is TipTap-speak for "Ctrl on
 * Win/Linux, Cmd on Mac" — gives us free cross-platform behaviour.
 *
 * Ctrl+Shift+E specifically takes precedence over the App-level "new
 * experiment" shortcut whenever the editor has focus, because TipTap's
 * keymap is bound to the editor DOM and only fires there. App.tsx gates
 * its hierarchy shortcuts on `!isEditorFocused()` to make this explicit.
 */
const TextAlignWithShortcuts = TextAlign.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.setTextAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
    };
  },
});

/**
 * Cluster 8 v2.1.4 fix: alignment didn't persist across save/reload.
 *
 * The cause: tiptap-markdown's `html: true` config only affects the parse
 * direction (markdown → HTML → ProseMirror). On save, paragraph and
 * heading nodes are serialized through prosemirror-markdown's defaults,
 * which emit just the inline text and discard custom node attributes
 * like `textAlign`. So `<p style="text-align:center">Hello</p>` saved
 * to disk as plain `Hello`, and reload had no `style` to detect.
 *
 * The fix: override the markdown serialization for both nodes so that
 * when `textAlign` is set to anything non-default, the node is emitted
 * as raw HTML instead of plain markdown. Default-aligned nodes still
 * use the standard markdown form, so files don't get polluted with
 * unnecessary HTML wrappers.
 *
 * `addStorage().markdown.serialize` is tiptap-markdown's hook for
 * customising a node's output (same shape as the existing HtmlStrike
 * mark override, but the function form for nodes).
 */
function isDefaultAlign(align: unknown): boolean {
  return !align || align === "left";
}

const AlignmentAwareParagraph = Paragraph.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const align = node.attrs?.textAlign;
          if (isDefaultAlign(align)) {
            state.renderInline(node);
            state.closeBlock(node);
          } else {
            state.write(`<p style="text-align: ${align}">`);
            state.renderInline(node);
            state.write(`</p>`);
            state.closeBlock(node);
          }
        },
        parse: { setup: () => {} },
      },
    };
  },
});

const AlignmentAwareHeading = Heading.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const align = node.attrs?.textAlign;
          const level = node.attrs?.level || 1;
          if (isDefaultAlign(align)) {
            state.write("#".repeat(level) + " ");
            state.renderInline(node);
            state.closeBlock(node);
          } else {
            state.write(`<h${level} style="text-align: ${align}">`);
            state.renderInline(node);
            state.write(`</h${level}>`);
            state.closeBlock(node);
          }
        },
        parse: { setup: () => {} },
      },
    };
  },
});

interface EditorProps {
  /** The markdown body as a string (without frontmatter). */
  content: string;
  /** Fired on every keystroke with the editor's serialized markdown. */
  onChange?: (markdown: string) => void;
  /** False switches the editor to a read-only view. */
  editable?: boolean;
  /**
   * Called when the user Ctrl+Clicks on a `[[Target]]` token. The argument
   * is the resolved target (alias stripped). The host decides whether to
   * navigate, prompt to create, etc.
   */
  onFollowWikilink?: (target: string) => void;
  /**
   * Cluster 4: lets the App grab the underlying TipTap Editor instance
   * so it can call `editor.chain().focus().insertContent(…)` for the
   * experiment-block scaffold.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditorReady?: (editor: any) => void;
  /**
   * Cluster 8 v2.1.2: when the user picks "Insert table…" from the
   * editor's right-click menu, we ask the App to open its Insert Table
   * modal (App owns modals; the editor doesn't). The shared App-level
   * modal is also reachable via Ctrl+Shift+T.
   */
  onRequestInsertTable?: () => void;
  /**
   * Cluster 17 v1.1: Ctrl/Cmd+Click on a typedBlock's title bar fires
   * this with the block's attrs. The host (App) is responsible for
   * resolving the reference (typically via the
   * `resolve_typed_block_target` Tauri command) and opening the result
   * in the active pane. Editor stays free of vault-path knowledge.
   */
  onFollowTypedBlock?: (attrs: {
    blockType: TypedBlockType;
    name: string;
    iterNumber: number | null;
  }) => void;
}

/**
 * TipTap-backed markdown editor with live preview.
 *
 * Wikilinks Phase 1 strategy: stored as plain markdown text `[[X]]` —
 * we don't try to render them as a special inline node, because the
 * doc itself flagged that as fragile. Following a link is via Ctrl+Click
 * (or Cmd+Click on macOS): we project the click to a doc position via
 * ProseMirror's posAtCoords, then scan the surrounding text for an
 * enclosing `[[...]]` pair and emit onFollowWikilink with its contents.
 */
export function Editor({
  content,
  onChange,
  editable = true,
  onFollowWikilink,
  onEditorReady,
  onRequestInsertTable,
  onFollowTypedBlock,
}: EditorProps) {
  // Right-click context-menu state. `inTable`, `canMerge`, `canSplit`
  // are computed from the editor's selection at click time and frozen
  // for the menu's lifetime — TipTap's `editor.can().X()` predicates
  // are reactive and would otherwise change while the menu is open.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    inTable: boolean;
    canMerge: boolean;
    canSplit: boolean;
  } | null>(null);
  // Cluster 17 — when the right-click lands inside a typedBlock node
  // (and not inside a nested table), show the BlockContextMenu instead.
  // We freeze `blockPos` at open time so the action handler can address
  // the same node even if the doc has shifted.
  const [blockMenu, setBlockMenu] = useState<{
    x: number;
    y: number;
    blockPos: number;
    blockType: TypedBlockType;
    blockName: string;
  } | null>(null);
  const editor = useEditor({
    extensions: [
      // - strike: replaced with HtmlStrike below so strike serializes
      //   as <s>…</s> rather than ~~…~~ (see HtmlStrike doc-comment).
      // - link: StarterKit v3.22 ships its own Link, which conflicts
      //   with our explicit Link.configure(…) below. Omit StarterKit's
      //   so our configured Link is the only one registered.
      // - paragraph / heading: replaced with AlignmentAwareParagraph /
      //   AlignmentAwareHeading so non-default textAlign attribute
      //   round-trips through markdown as inline HTML (Cluster 8 v2.1.4).
      StarterKit.configure({
        strike: false,
        link: false,
        paragraph: false,
        heading: false,
      }),
      HtmlStrike,
      HtmlUnderline,
      AlignmentAwareParagraph,
      AlignmentAwareHeading,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      // Tables — required for protocol Reagents/Parts and method
      // auto-generated Reagents/Parts aggregations to render as actual
      // tables instead of pipe-delimited text. Cluster 16 v1.1
      // swapped Table for HtmlTable so column widths + vertical
      // alignment survive the markdown round-trip (pipe-table syntax
      // has no slot for either).
      //
      // Cluster 16 v1.1.4: drag-to-resize is back. The cell-height
      // growth on hover (v1.1.2 diagnosis) was caused by
      // prosemirror-tables's columnResizing plugin re-running
      // `updateColumnsOnResize()` on every hover-near-boundary state
      // change, which falls back to `defaultCellMinWidth = 100px` for
      // cells without explicit `data-colwidth`. Disabling the plugin
      // (v1.1.3) eliminated the bug at the cost of drag-to-resize.
      // v1.1.4 keeps the plugin enabled but ensures every cell has
      // an explicit `colwidth` from the moment the table is inserted
      // (TabPane.insertTable auto-calls equalizeColumnWidths post-
      // insert). With every cell having a width, `fixedWidth = true`
      // in updateColumnsOnResize, the table gets `style.width =
      // totalWidth + "px"`, and re-runs on hover set the SAME values
      // — the browser detects no change and skips the layout pass.
      // Cluster 18 v1.0 — disable prosemirror-tables's columnResizing
      // plugin. CortexColumnResize (registered below) is the sole source
      // of truth for column resizing now, and unlike the built-in plugin
      // it doesn't run any per-hover view updates — fully fixing the
      // v1.1.4 known issue "cell-height growth on hover for tables
      // without explicit colwidths". The auto-equalize-on-insert path
      // from v1.1.4 stays in place as a defensive measure for fresh
      // tables.
      HtmlTable.configure({
        HTMLAttributes: { class: "cortex-table" },
        resizable: false,
      }),
      TableRow,
      // Cluster 18 — FormulaTableHeader/FormulaTableCell carry both
      // verticalAlign (Cluster 16) and formula / formulaResult attrs.
      FormulaTableHeader,
      FormulaTableCell,
      // Cluster 18 — Cortex's own column-resize plugin replaces
      // prosemirror-tables's built-in. Plus the FormulaEvaluator plugin
      // that re-evaluates `=…` cells on every transaction (skipping the
      // cell with the cursor). Order: resize first, formulas second —
      // formula transactions don't trigger resize.
      CortexColumnResize,
      FormulaEvaluator,
      // Text alignment with Ctrl+Shift+L/E/R shortcuts. Round-trips
      // through tiptap-markdown's html:true as inline style attributes.
      TextAlignWithShortcuts.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "center", "right"],
      }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown.configure({
        // html: true is needed so the Mark System's colour marks
        // (`<mark class="mark-yellow">…</mark>`) round-trip through
        // save/load. Without it, the HTML is stripped on serialization
        // and the user loses every highlight on save.
        html: true,
        tightLists: true,
        linkify: false,
        breaks: true,
        transformPastedText: true,
      }),
      WikilinkDecoration,
      ColorMark,
      // Cluster 17 — typedBlock node + serializer. Replaces the old
      // ExperimentBlockDecoration. Node sources both the in-editor
      // widget treatment and the markdown serialize hook.
      SerializingTypedBlockNode,
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      if (!onChange) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (editor.storage as any).markdown.getMarkdown() as string;
      // tiptap-markdown escapes `[` and `]` during serialization because
      // `[` is a CommonMark link starter. Without this, typing `[[X]]` in
      // the editor lands on disk as `\[\[X\]\]`, which the Rust index's
      // literal-substring scan can't see — breaking backlinks.
      // Undo the double-bracket escaping while leaving single escapes
      // alone (which preserves cases like markdown reference links).
      const md = unescapeWikilinkBrackets(raw);
      onChange(md);
    },
  });

  // Push new content in without firing onUpdate — avoids briefly flagging
  // the new file as dirty.
  //
  // v1 had a Ctrl+S scroll-jump bug: `getMarkdown()` returns wikilinks
  // with escaped brackets (`\[\[Foo\]\]`) because tiptap-markdown sees
  // `[` as a link starter, while the `content` prop holds the user-
  // facing unescaped form (the onUpdate path runs the same
  // `unescapeWikilinkBrackets` transform). The two never matched, so
  // every save triggered an unnecessary `setContent` that re-parsed
  // the doc and reset scroll. Comparing apples-to-apples (both
  // unescaped) makes the comparison correctly skip the no-op
  // re-render and the scroll position is preserved.
  useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (editor.storage as any).markdown.getMarkdown() as string;
    const current = unescapeWikilinkBrackets(raw);
    if (current !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    // Cluster 17 — after content is set (or on initial load where the
    // editor's own seeded content matched our compare-side `content`
    // prop), lift any plain-paragraph `::TYPE NAME … ::end` runs into
    // typedBlock nodes. Idempotent on regions already lifted; gated
    // out of undo history so the user can't Ctrl+Z back to the
    // pre-lifted state.
    const tr = liftTypedBlocks(editor.state);
    if (tr) {
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  // Cluster 17 v1.1 — listen for follow-typed-block events fired by the
  // typedBlock NodeView's title-bar Ctrl/Cmd+Click. The handler routes
  // the event detail up to the host via onFollowTypedBlock; the host
  // (App.tsx) invokes the Rust resolver and opens the resulting path
  // in the active slot.
  useEffect(() => {
    if (!editor) return;
    if (!onFollowTypedBlock) return;
    const dom = editor.view.dom;
    function handler(e: Event) {
      const detail = (
        e as CustomEvent<{
          blockType: TypedBlockType;
          name: string;
          iterNumber: number | null;
        }>
      ).detail;
      if (!detail) return;
      onFollowTypedBlock!(detail);
    }
    dom.addEventListener(FOLLOW_TYPED_BLOCK_EVENT, handler);
    return () => dom.removeEventListener(FOLLOW_TYPED_BLOCK_EVENT, handler);
  }, [editor, onFollowTypedBlock]);

  // Hand the editor instance back to the host once it's ready, so App
  // can call insertContent for the Cluster 4 experiment-block scaffold.
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  function handleClick(e: React.MouseEvent) {
    if (!editor) return;
    if (!onFollowWikilink) return;
    if (!(e.ctrlKey || e.metaKey)) return;

    // ProseMirror gives us the doc position the user clicked.
    const pos = editor.view.posAtCoords({
      left: e.clientX,
      top: e.clientY,
    });
    if (!pos) return;

    const target = wikilinkAtPos(editor.state.doc, pos.pos);
    if (target) {
      e.preventDefault();
      onFollowWikilink(target);
    }
  }

  /**
   * Right-click → custom table-aware context menu. We translate the
   * click position into a doc position via posAtCoords, move the
   * selection there (so `editor.isActive('table')` reflects the click,
   * not whatever was selected before), then snapshot the relevant
   * predicates and open the menu.
   *
   * Cluster 16 v1.1: preserve an existing CellSelection. v1.0
   * unconditionally called setTextSelection on every right-click,
   * which collapsed any drag-selected range back to a single caret.
   * That meant `editor.can().mergeCells()` always returned false even
   * after the user dragged across cells — the "Merge cells" affordance
   * never appeared. The fix: only re-aim the selection when the
   * current selection isn't already a CellSelection.
   */
  function handleContextMenu(e: React.MouseEvent) {
    if (!editor) return;
    e.preventDefault();

    // Cluster 17 — first detect whether the right-click landed inside a
    // typedBlock node and not inside a nested table. If so, the
    // BlockContextMenu wins. A right-click inside a table that's
    // inside a typedBlock still goes to the table menu (the more
    // specific surface for the immediate context).
    const coordPos = editor.view.posAtCoords({
      left: e.clientX,
      top: e.clientY,
    });
    if (coordPos) {
      try {
        const $pos = editor.state.doc.resolve(coordPos.pos);
        let typedBlockNode: import("@tiptap/pm/model").Node | null = null;
        let typedBlockPos: number | null = null;
        let inTableAncestor = false;
        for (let d = $pos.depth; d >= 0; d--) {
          const ancestor = $pos.node(d);
          if (ancestor.type.name === "typedBlock" && !typedBlockNode) {
            typedBlockNode = ancestor;
            typedBlockPos = d === 0 ? 0 : $pos.before(d);
          }
          if (ancestor.type.name === "table") {
            inTableAncestor = true;
          }
        }
        if (typedBlockNode && typedBlockPos !== null && !inTableAncestor) {
          const attrs = typedBlockNode.attrs as {
            blockType?: TypedBlockType;
            name?: string;
          };
          setBlockMenu({
            x: e.clientX,
            y: e.clientY,
            blockPos: typedBlockPos,
            blockType: attrs.blockType ?? "experiment",
            blockName: attrs.name ?? "",
          });
          return;
        }
      } catch (err) {
        console.warn("typedBlock right-click probe failed:", err);
      }
    }

    const sel = editor.state.selection;
    if (!(sel instanceof CellSelection)) {
      const pos = editor.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      });
      if (pos) {
        editor.chain().focus().setTextSelection(pos.pos).run();
      }
    }

    const inTable = editor.isActive("table");
    // can().X() probes whether a command would run in the current state.
    // mergeCells requires a multi-cell selection; splitCell requires a
    // single cell that has been merged. They're mutually exclusive in
    // practice, but we expose whichever the editor says is valid.
    const canMerge = inTable && editor.can().mergeCells();
    const canSplit = inTable && editor.can().splitCell();

    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      inTable,
      canMerge,
      canSplit,
    });
  }

  /**
   * Cluster 17 — actions from the BlockContextMenu. `blockPos` is the
   * doc position of the typedBlock as captured when the menu opened.
   *
   *   - editName: dispatch a CustomEvent on view.dom; the NodeView at
   *     that position flips its title bar into edit-name mode.
   *   - deleteBlock: replace the [pos, pos+nodeSize] range via tr.delete
   *     wrapped in editor.chain so the operation lands as one history
   *     step.
   */
  function runBlockAction(kind: BlockAction, blockPos: number) {
    if (!editor) return;
    if (kind === "editName") {
      const event = new CustomEvent(EDIT_TYPED_BLOCK_EVENT, {
        detail: { pos: blockPos },
      });
      editor.view.dom.dispatchEvent(event);
      return;
    }
    if (kind === "deleteBlock") {
      try {
        const node = editor.state.doc.nodeAt(blockPos);
        if (!node || node.type.name !== "typedBlock") {
          console.warn(
            "deleteBlock: node at",
            blockPos,
            "is not a typedBlock (got",
            node?.type.name,
            ")",
          );
          return;
        }
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.delete(blockPos, blockPos + node.nodeSize);
            return true;
          })
          .run();
      } catch (err) {
        console.warn("deleteBlock failed:", err);
      }
    }
  }

  /** Run a TipTap command from the context menu. */
  function runTableAction(kind: TableAction) {
    if (!editor) return;
    const c = editor.chain().focus();
    switch (kind) {
      case "addRowBefore":
        c.addRowBefore().run();
        break;
      case "addRowAfter":
        c.addRowAfter().run();
        break;
      case "addColumnBefore":
        c.addColumnBefore().run();
        break;
      case "addColumnAfter":
        c.addColumnAfter().run();
        break;
      case "deleteRow":
        c.deleteRow().run();
        break;
      case "deleteColumn":
        c.deleteColumn().run();
        break;
      case "deleteTable":
        c.deleteTable().run();
        break;
      case "toggleHeaderRow":
        c.toggleHeaderRow().run();
        break;
      case "mergeCells":
        c.mergeCells().run();
        break;
      case "splitCell":
        c.splitCell().run();
        break;
      case "equalizeColumns":
        equalizeColumnWidths(editor);
        break;
      case "valignTop":
        // Cluster 18 v1.1.2 — applyCellAttrsAcrossSelection iterates
        // CellSelection.forEachCell so multi-cell selections all
        // update at once; falls back to the cursor's cell otherwise.
        applyCellAttrsAcrossSelection(editor, { verticalAlign: "top" });
        break;
      case "valignMiddle":
        applyCellAttrsAcrossSelection(editor, { verticalAlign: "middle" });
        break;
      case "valignBottom":
        applyCellAttrsAcrossSelection(editor, { verticalAlign: "bottom" });
        break;
      // Cluster 18 v1.1 — cell type formatting. Each case sets the
      // cellType attribute on every cell in the selection. The
      // FormulaEvaluator plugin picks up the change on its next
      // appendTransaction pass and writes the formatted display via
      // cellDisplay (or, for formula cells, via formulaResult).
      case "cellTypeText":
        applyCellAttrsAcrossSelection(editor, { cellType: null });
        break;
      case "cellTypeNumber":
        applyCellAttrsAcrossSelection(editor, { cellType: "number" });
        break;
      case "cellTypeMoney":
        applyCellAttrsAcrossSelection(editor, { cellType: "money" });
        break;
      case "cellTypePercent":
        applyCellAttrsAcrossSelection(editor, { cellType: "percent" });
        break;
      case "cellTypeDate":
        applyCellAttrsAcrossSelection(editor, { cellType: "date" });
        break;
      // Cluster 18 v1.1 — freeze rows / freeze columns. Set the
      // table-level attribute. A submenu in TableContextMenu lets the
      // user pick 1 / 2 / 3 / Off — runTableAction takes the chosen
      // count as a number suffix on the action kind.
      case "freezeRows0":
      case "freezeRows1":
      case "freezeRows2":
      case "freezeRows3":
        c.updateAttributes("table", {
          frozenRows: parseInt(kind.replace("freezeRows", ""), 10),
        }).run();
        break;
      case "freezeCols0":
      case "freezeCols1":
      case "freezeCols2":
      case "freezeCols3":
        c.updateAttributes("table", {
          frozenCols: parseInt(kind.replace("freezeCols", ""), 10),
        }).run();
        break;
      // Cluster 18 v1.2 — sort + filter.
      case "sortAsc":
        sortTableColumn(editor, "asc");
        break;
      case "sortDesc":
        sortTableColumn(editor, "desc");
        break;
      case "filterMatch": {
        // Read the clicked cell's column + text and apply as a filter.
        const sel2 = editor.state.selection;
        let cellPos2: number | null = null;
        for (let d = sel2.$from.depth; d > 0; d--) {
          const node = sel2.$from.node(d);
          if (
            node.type.name === "tableCell" ||
            node.type.name === "tableHeader"
          ) {
            cellPos2 = sel2.$from.before(d);
            break;
          }
        }
        if (cellPos2 == null) break;
        const cellNode = editor.state.doc.nodeAt(cellPos2);
        if (!cellNode) break;
        // Find table to compute column index.
        const $cell2 = editor.state.doc.resolve(cellPos2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let tableNode2: any = null;
        let tablePos2: number | null = null;
        for (let d = $cell2.depth; d > 0; d--) {
          const n = $cell2.node(d);
          if (n.type.name === "table") {
            tableNode2 = n;
            tablePos2 = $cell2.before(d);
            break;
          }
        }
        if (!tableNode2 || tablePos2 == null) break;
        try {
          const map = TableMap.get(tableNode2);
          const rect = map.findCell(cellPos2 - tablePos2 - 1);
          setTableFilter(editor, rect.left, cellNode.textContent.trim());
        } catch (e) {
          console.warn("filterMatch: TableMap.findCell failed:", e);
        }
        break;
      }
      case "filterClear":
        setTableFilter(editor, null, null);
        break;
    }
  }

  /**
   * Double-click inside a colour-marked range selects the whole mark
   * rather than just the word at the click point. Useful for: striking
   * an entire highlighted phrase, swapping its colour, or unmarking.
   *
   * We walk the DOM from the event target up looking for a `<mark>`
   * ancestor inside the editor, then convert the element's DOM range
   * to ProseMirror positions via `view.posAtDOM`.
   */
  function handleDoubleClick(e: React.MouseEvent) {
    if (!editor) return;
    let el = e.target as HTMLElement | null;
    const root = e.currentTarget as HTMLElement;
    while (el && el !== root) {
      if (el.tagName === "MARK") break;
      el = el.parentElement;
    }
    if (!el || el.tagName !== "MARK") return;

    try {
      const view = editor.view;
      // posAtDOM(node, offset) — offset 0 is the start, childNodes.length
      // is the end. We use those to compute the PM range that the mark
      // occupies.
      const start = view.posAtDOM(el, 0);
      const end = view.posAtDOM(el, el.childNodes.length);
      if (typeof start === "number" && typeof end === "number" && end > start) {
        e.preventDefault();
        editor.chain().focus().setTextSelection({ from: start, to: end }).run();
      }
    } catch (err) {
      console.warn("expand mark selection failed:", err);
    }
  }

  if (!editor) return null;

  return (
    <>
      <div
        // No `prose-invert` here — it forces dark-mode prose colours
        // regardless of theme, which makes bold/headings stay white in
        // light mode. Our index.css drives prose colour off CSS variables
        // (`var(--text)`) which already follow the active theme.
        className="prose max-w-none"
        style={{ fontSize: "15px" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <EditorContent editor={editor} />
      </div>
      {ctxMenu && (
        <TableContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          inTable={ctxMenu.inTable}
          canMerge={ctxMenu.canMerge}
          canSplit={ctxMenu.canSplit}
          onClose={() => setCtxMenu(null)}
          onInsertTable={() => {
            if (onRequestInsertTable) onRequestInsertTable();
          }}
          onAction={runTableAction}
        />
      )}
      {blockMenu && (
        <BlockContextMenu
          x={blockMenu.x}
          y={blockMenu.y}
          blockType={blockMenu.blockType}
          blockName={blockMenu.blockName}
          onClose={() => setBlockMenu(null)}
          onAction={(kind) => runBlockAction(kind, blockMenu.blockPos)}
        />
      )}
    </>
  );
}

/**
 * Convert tiptap-markdown's escaped wikilink brackets back to the
 * literal form. `\[\[X\]\]` → `[[X]]`. Single-bracket escapes are
 * intentionally left as-is to avoid breaking real markdown link
 * reference syntax (`\[label\]: url`).
 */
function unescapeWikilinkBrackets(md: string): string {
  return md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
}

/**
 * Cluster 18 v1.1.2 — apply a partial set of cell attributes to every
 * cell in the current selection. Walks a CellSelection's cells
 * explicitly via `forEachCell`; falls back to the cell containing the
 * cursor when the selection is not a CellSelection.
 *
 * Why a custom helper rather than `editor.chain().focus().updateAttributes`:
 *   - `updateAttributes("tableCell", …)` walks `nodesBetween(from, to)`
 *     over the selection range. For a CellSelection that spans a
 *     non-contiguous rectangle of cells in document order, this
 *     either misses cells or hits unselected cells in between.
 *   - `chain().focus()` can interact with the CellSelection in ways
 *     that collapse it before subsequent commands in the chain run.
 *
 * One dispatched transaction updates every affected cell at once, so
 * undo lands as a single step.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCellAttrsAcrossSelection(
  editor: any,
  attrs: Record<string, unknown>,
) {
  if (!editor) return;
  const state = editor.state;
  const sel = state.selection;
  const tr = state.tr;
  let touched = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyAt(cellPos: number) {
    const cell = state.doc.nodeAt(cellPos);
    if (!cell) return;
    const t = cell.type.name;
    if (t !== "tableCell" && t !== "tableHeader") return;
    tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, ...attrs });
    touched = true;
  }

  if (sel instanceof CellSelection) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sel.forEachCell((_cell: any, cellPos: number) => {
      applyAt(cellPos);
    });
  } else {
    // No CellSelection — find the enclosing cell at the cursor.
    const $from = sel.$from;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        applyAt($from.before(d));
        break;
      }
    }
  }

  if (touched) {
    editor.view.dispatch(tr);
  }
}

/**
 * Cluster 18 v1.2 — sort the table column the cursor is in.
 * `direction` is "asc" or "desc". Walks the table's rows, picks the
 * cell at the cursor's column from each, and sorts by the cell's text
 * value with cell-type-aware comparison (number / money / percent →
 * numeric; date → chronological; everything else → lexicographic).
 *
 * Header rows (any row containing a tableHeader cell) and frozen rows
 * (per the table's frozenRows attr) are kept in their original
 * positions; only the body rows are sorted. The sort modifies the
 * underlying ProseMirror doc, so the new order persists on save and
 * is reflected in formulas that reference cell positions.
 *
 * Dispatched as a single transaction so undo lands as one step.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sortTableColumn(editor: any, direction: "asc" | "desc") {
  if (!editor) return;
  const state = editor.state;
  const sel = state.selection;

  // Find the cell at the cursor.
  let cellPos: number | null = null;
  for (let d = sel.$from.depth; d > 0; d--) {
    const node = sel.$from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellPos = sel.$from.before(d);
      break;
    }
  }
  if (cellPos === null) return;

  // Find the enclosing table.
  const $cell = state.doc.resolve(cellPos);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tableNode: any = null;
  let tablePos: number | null = null;
  for (let d = $cell.depth; d > 0; d--) {
    const n = $cell.node(d);
    if (n.type.name === "table") {
      tableNode = n;
      tablePos = $cell.before(d);
      break;
    }
  }
  if (!tableNode || tablePos === null) return;

  // Compute the dragged column's index via TableMap.
  let colIdx: number;
  try {
    const map = TableMap.get(tableNode);
    const rect = map.findCell(cellPos - tablePos - 1);
    colIdx = rect.left;
  } catch {
    return;
  }

  // Pull cellType from the cell the user clicked (fallback null = text).
  const clickedCell = state.doc.nodeAt(cellPos);
  const cellType =
    (clickedCell?.attrs?.cellType as string | null | undefined) ?? null;

  // Walk rows, partition header/frozen vs body, build a sortKey for each.
  const frozenRows = Math.max(0, Number(tableNode.attrs?.frozenRows ?? 0) | 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerRows: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyRows: { row: any; sortKey: number | string }[] = [];
  let rowIdx = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableNode.forEach((row: any) => {
    let isHeader = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.forEach((cell: any) => {
      if (cell.type.name === "tableHeader") isHeader = true;
    });
    const isFrozen = rowIdx < frozenRows;
    if (isHeader || isFrozen) {
      headerRows.push(row);
    } else {
      // Find the cell at colIdx via colspan-aware scan.
      let curCol = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cellAtCol: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      row.forEach((cell: any) => {
        if (cellAtCol) return;
        const span = (cell.attrs?.colspan ?? 1) as number;
        if (curCol <= colIdx && curCol + span > colIdx) {
          cellAtCol = cell;
        }
        curCol += span;
      });
      const text = (cellAtCol?.textContent ?? "").trim();
      const sortKey = computeSortKey(text, cellType);
      bodyRows.push({ row, sortKey });
    }
    rowIdx++;
  });

  // Stable sort. JS's Array.sort is stable in modern engines (V8 / Chromium).
  bodyRows.sort((a, b) => {
    let cmp: number;
    if (typeof a.sortKey === "number" && typeof b.sortKey === "number") {
      // NaN-safe: NaN bubbles to the end regardless of direction.
      const an = a.sortKey;
      const bn = b.sortKey;
      const aBad = !Number.isFinite(an);
      const bBad = !Number.isFinite(bn);
      if (aBad && bBad) cmp = 0;
      else if (aBad) cmp = 1;
      else if (bBad) cmp = -1;
      else cmp = an - bn;
    } else {
      cmp = String(a.sortKey).localeCompare(String(b.sortKey), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }
    return direction === "asc" ? cmp : -cmp;
  });

  // Rebuild the table content with header rows first, body rows sorted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newRows = [...headerRows, ...bodyRows.map((b) => b.row)];
  const sameOrder = newRows.every((r, i) => r === tableNode.child(i));
  if (sameOrder) return; // no-op

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newTable = (tableNode as any).copy(
    (
      tableNode as {
        type: { schema: { nodes: { tableRow: { create: () => unknown } } } };
      } &
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any
    ).content.constructor.from(newRows),
  );
  const tr = state.tr;
  tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);
  editor.view.dispatch(tr);
}

/**
 * Compute a sort key for a cell's raw text given the cell type. Numeric
 * types parse to a number (NaN passes through to bubble unsortable
 * values to the end); text and unknown types pass through as-is.
 */
function computeSortKey(
  text: string,
  cellType: string | null,
): number | string {
  if (!text) return "";
  if (cellType === "number" || cellType === "money" || cellType === "percent") {
    const cleaned = text
      .replace(/^\s*\$\s*/, "")
      .replace(/\s*%\s*$/, "")
      .replace(/,/g, "")
      .trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  if (cellType === "date") {
    const t = new Date(text).getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  return text;
}

/**
 * Cluster 18 v1.2 — set or clear the table-level row filter. Pass
 * `null` for value to clear. The filter applies as a Decoration via
 * the buildFilteredRowsPlugin in FormulaCells.ts, which reads
 * filterCol + filterValue and emits data-filtered="true" on rows that
 * don't match.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setTableFilter(
  editor: any,
  filterCol: number | null,
  filterValue: string | null,
) {
  if (!editor) return;
  const state = editor.state;
  const sel = state.selection;

  // Find the cell at the cursor → its enclosing table.
  let cellPos: number | null = null;
  for (let d = sel.$from.depth; d > 0; d--) {
    const node = sel.$from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellPos = sel.$from.before(d);
      break;
    }
  }
  if (cellPos === null) return;
  const $cell = state.doc.resolve(cellPos);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tableNode: any = null;
  let tablePos: number | null = null;
  for (let d = $cell.depth; d > 0; d--) {
    const n = $cell.node(d);
    if (n.type.name === "table") {
      tableNode = n;
      tablePos = $cell.before(d);
      break;
    }
  }
  if (!tableNode || tablePos === null) return;

  const tr = state.tr;
  tr.setNodeMarkup(tablePos, undefined, {
    ...tableNode.attrs,
    filterCol,
    filterValue,
  });
  editor.view.dispatch(tr);
}

/**
 * Cluster 16 v1.1.4 — exported wrapper so TabPane.insertTable can
 * call equalize immediately after creating a new table. Auto-
 * equalize-on-insert ensures every cell has an explicit colwidth,
 * which keeps prosemirror-tables's `updateColumnsOnResize` in its
 * fast no-op path on hover (no per-hover layout shift).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function equalizeTableColumnWidths(editor: any) {
  equalizeColumnWidths(editor);
}

/**
 * Cluster 16 v1.1 — Equalize column widths.
 *
 * Walks up from the current selection to the nearest `table` ancestor,
 * then:
 *  - If the selection is a CellSelection (the user dragged across
 *    cells), restrict the equalisation to the columns those cells
 *    span. Cells in unselected columns keep their existing widths.
 *  - Otherwise, equalize every column in the table.
 *
 * Target width per column is computed from the table's actual
 * rendered width (via `view.nodeDOM(tablePos).getBoundingClientRect()`),
 * with a fallback to the sum of existing colwidth attributes, and
 * finally a per-column constant if neither is available. v1.0
 * hardcoded `TARGET = 150`, which made tables visibly narrower than
 * the page after equalisation; v1.1 measures.
 *
 * Merged cells (colspan > 1) get their colwidth filled with N copies
 * of the per-column target so the merged cell stays merged-width
 * across the equalisation. ProseMirror handles the re-layout.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function equalizeColumnWidths(editor: any) {
  const { state, view } = editor;
  const sel = state.selection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tableNode: any = null;
  let tablePos: number | null = null;
  for (let d = sel.$from.depth; d >= 0; d--) {
    const node = sel.$from.node(d);
    if (node.type.name === "table") {
      tableNode = node;
      tablePos = sel.$from.before(d);
      break;
    }
  }
  if (!tableNode || tablePos === null) return;

  // Column count from the first row, summing colspans.
  const firstRow = tableNode.firstChild;
  if (!firstRow) return;
  let colCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  firstRow.forEach((cell: any) => {
    colCount += cell.attrs?.colspan ?? 1;
  });
  if (colCount === 0) return;

  // Compute the set of columns to scope the equalisation to.
  // CellSelection.forEachCell hands us cell positions inside the
  // table; TableMap.findCell maps each to a {left, top, right, bottom}
  // rect in column/row indices. left = first col, right = exclusive
  // end col.
  let selectedCols: Set<number> | null = null;
  if (sel instanceof CellSelection) {
    selectedCols = new Set<number>();
    try {
      const map = TableMap.get(tableNode);
      // forEachCell hands us absolute doc positions; TableMap operates
      // in table-local positions (0 = first cell), so we shift.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sel.forEachCell((_cellNode: any, cellPos: number) => {
        const localPos = cellPos - tablePos! - 1; // -1 to step inside the table node
        const rect = map.findCell(localPos);
        for (let c = rect.left; c < rect.right; c++) {
          selectedCols!.add(c);
        }
      });
      // If the user happened to select all columns (or none), drop
      // the scoping and just equalize the whole table.
      if (selectedCols.size === 0 || selectedCols.size === colCount) {
        selectedCols = null;
      }
    } catch (e) {
      console.warn("equalize: TableMap selection scope failed:", e);
      selectedCols = null;
    }
  }

  // Compute the total width to distribute over the equalised columns.
  // 1) Prefer the actual rendered table width — matches what the user
  //    sees on screen.
  // 2) Fall back to the sum of explicit colwidths from the first row.
  // 3) Last resort: 150px per column (the v1.0 default).
  let totalWidth = 0;
  const tableDOM = view.nodeDOM(tablePos) as HTMLElement | null;
  if (tableDOM && typeof tableDOM.getBoundingClientRect === "function") {
    totalWidth = Math.round(tableDOM.getBoundingClientRect().width);
  }
  if (totalWidth < colCount * 30) {
    let summed = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firstRow.forEach((cell: any) => {
      const cw = cell.attrs?.colwidth;
      if (Array.isArray(cw)) {
        for (const w of cw) summed += typeof w === "number" ? w : 0;
      }
    });
    if (summed >= colCount * 30) totalWidth = summed;
  }
  if (totalWidth < colCount * 30) {
    totalWidth = colCount * 150;
  }

  // When scoping to a column subset, the totalWidth from the rendered
  // measurement covers all columns; we want to keep unselected columns
  // at their current widths. So compute the "selected slice" target as
  // (sum of selected columns' current widths) / |selectedCols|, falling
  // back to the per-column average of the whole table.
  const wholeTableTarget = Math.floor(totalWidth / colCount);
  let scopedTarget = wholeTableTarget;
  if (selectedCols) {
    let scopedSum = 0;
    let scopedSeen = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firstRow.forEach((cell: any, _o: number, _i: number) => {
      const cw = cell.attrs?.colwidth;
      const span = cell.attrs?.colspan ?? 1;
      if (Array.isArray(cw)) {
        for (let k = 0; k < span; k++) {
          const colIdx = scopedSeen + k;
          if (selectedCols!.has(colIdx)) {
            scopedSum += typeof cw[k] === "number" ? cw[k] : 0;
          }
        }
      }
      scopedSeen += span;
    });
    if (scopedSum >= selectedCols.size * 30) {
      scopedTarget = Math.floor(scopedSum / selectedCols.size);
    }
  }

  const tr = state.tr;
  const tableEnd = tablePos + tableNode.nodeSize;

  // Walk every cell in the table; for each spanned column, decide
  // whether the equalisation applies. Cells whose ALL spanned columns
  // are unselected get left alone; cells with any selected columns
  // get their colwidth rebuilt entry-by-entry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.doc.descendants((node: any, pos: number) => {
    if (pos < tablePos! || pos >= tableEnd) return false;
    const name = node.type.name;
    if (name !== "tableCell" && name !== "tableHeader") return true;
    const span = node.attrs?.colspan ?? 1;

    // Find this cell's leftmost column index via TableMap.findCell.
    let cellLeft = 0;
    try {
      const map = TableMap.get(tableNode);
      const rect = map.findCell(pos - tablePos! - 1);
      cellLeft = rect.left;
    } catch {
      // If TableMap can't resolve (transient state), default to a
      // monotonic walk; the worst case is treating an in-scope cell
      // as out-of-scope.
    }

    if (selectedCols) {
      // Column-scoped: rebuild colwidth column-by-column.
      const incoming = Array.isArray(node.attrs?.colwidth)
        ? [...node.attrs.colwidth]
        : new Array(span).fill(null);
      let touched = false;
      for (let k = 0; k < span; k++) {
        const colIdx = cellLeft + k;
        if (selectedCols.has(colIdx)) {
          incoming[k] = scopedTarget;
          touched = true;
        }
      }
      if (touched) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          colwidth: incoming,
        });
      }
    } else {
      // Whole-table: same target for every column.
      const newColwidth = new Array(span).fill(wholeTableTarget);
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        colwidth: newColwidth,
      });
    }
    return false; // don't descend into cell content
  });

  view.dispatch(tr);
}

/**
 * Given a ProseMirror Doc node and an absolute position, return the
 * wikilink target (without aliases) if the position falls inside a
 * `[[...]]` pair on the same text node, else null.
 *
 * We resolve to the text node containing `pos`, then inspect its full
 * text content. This is robust to ProseMirror's marks because wikilinks
 * are stored as plain text, not as a marked range. We accept `doc` as
 * `any` to avoid pulling in @tiptap/pm/model as a direct dependency.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wikilinkAtPos(doc: any, pos: number): string | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const parent = $pos.parent;
  // Concatenate all text in the parent block — works for paragraphs,
  // headings, list items, etc. Tables/code blocks fall through harmlessly.
  let text = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parent.forEach((child: any) => {
    if (child.isText) text += child.text ?? "";
  });
  if (!text.includes("[[")) return null;

  const offset = $pos.parentOffset;
  const re = /\[\[([^\[\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (offset >= start && offset <= end) {
      const raw = m[1].trim();
      if (raw.length === 0) return null;
      return raw.split("|")[0].trim();
    }
  }
  return null;
}
