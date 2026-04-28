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
import { useEffect, useState } from "react";
import { WikilinkDecoration } from "../editor/WikilinkDecoration";
import { ColorMark } from "../editor/ColorMark";
import { ExperimentBlockDecoration } from "../editor/ExperimentBlockDecoration";
import { TableContextMenu, type TableAction } from "./TableContextMenu";

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
      // tables instead of pipe-delimited text.
      Table.configure({ HTMLAttributes: { class: "cortex-table" } }),
      TableRow,
      TableHeader,
      TableCell,
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
      ExperimentBlockDecoration,
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
  useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown.getMarkdown() as string;
    if (current !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

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
   */
  function handleContextMenu(e: React.MouseEvent) {
    if (!editor) return;
    e.preventDefault();

    const pos = editor.view.posAtCoords({
      left: e.clientX,
      top: e.clientY,
    });
    if (pos) {
      editor.chain().focus().setTextSelection(pos.pos).run();
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
