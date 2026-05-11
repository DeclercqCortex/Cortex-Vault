// RichAfterEditor — Cluster 21 v1.2.
//
// Sub-modal launched from AutoReplaceModal's Edit / Add flow when the
// user wants to author a RICH replacement (a Frame, Tabs, Callout,
// Columns, Collapsible, etc., plus rich marks like font/color/effect/
// particle) for an auto-replace rule's "after" content.
//
// Mounts:
//   - A small TipTap editor instance configured with the same Cortex
//     extension stack the main Editor.tsx uses (so every block / mark
//     /effect that's available in normal documents is also available
//     here as a snippet target).
//   - A separate EditorToolbar instance bound to that mini editor so
//     all toolbar actions (font, color, structural blocks, particles,
//     etc.) drive the snippet editor — NOT whichever pane was active
//     when the modal opened.
//
// On Save:
//   - editor.getHTML() → the rule's afterHtml field (drives the
//     rich-content insertion path in CortexAutoReplace).
//   - editor's plain-text content → the rule's after field (used as
//     the textual fallback shown in the rule list and as a
//     graceful-degradation if Slice parsing fails at trigger time).
//
// UX notes:
//   - The sub-modal does NOT close on outside click — user must click
//     Save / Cancel / Esc. This mirrors the parent AutoReplaceModal's
//     stickiness so a misplaced click doesn't lose draft content.
//   - The toolbar lives at the top of the sub-modal so it has the
//     same vertical position the user is used to from the main
//     editor.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { Markdown } from "tiptap-markdown";

import {
  EditorToolbar,
  loadToolbarPrefs,
  saveToolbarPrefs,
  type ToolbarPrefs,
} from "./EditorToolbar";

import { ColorMark } from "../editor/ColorMark";
import { CortexFontStyle } from "../editor/CortexFontStyle";
import { CortexUnderlineStyled } from "../editor/CortexUnderlineStyled";
import { CortexTextEffect } from "../editor/CortexTextEffect";
import { CortexParticleHost } from "../editor/CortexParticleHost";
import { CortexAutoReplace } from "../editor/CortexAutoReplace";
import { CortexCodeBlock } from "../editor/CortexCodeBlock";
import {
  CortexCallout,
  CortexColumns,
  CortexSideBySide,
  CortexCollapsible,
  CortexMarginNote,
  CortexFrame,
  CortexPullQuote,
  CortexDecoSeparator,
  CortexPageBreak,
  CortexMathBlock,
  CortexTabsBlock,
  CortexTabPanel,
  CortexFootnoteRef,
  CortexCitationRef,
  CortexMathInline,
  CortexDropCap,
} from "../editor/CortexBlocks";
import {
  CortexCollapsibleNodeView,
  CortexTabsNodeView,
  CortexMathBlockNodeView,
} from "../editor/CortexBlockNodeViews";
import {
  CortexStrikeRevision,
  buildStrikeRevisionPlugin,
} from "../editor/CortexStrikeRevision";

interface RichAfterEditorProps {
  /** Initial rich content (HTML). When undefined, the editor starts
   *  with the textual `initialAfter` as a single paragraph so the
   *  user can build on top of their plain-text rule. */
  initialAfterHtml?: string;
  /** Initial textual replacement (used to seed the editor when no
   *  HTML is present). */
  initialAfter: string;
  /** Called with both the new rich HTML and the textual fallback when
   *  the user clicks Save. */
  onSave: (next: { afterHtml: string; after: string }) => void;
  onClose: () => void;
}

export function RichAfterEditor({
  initialAfterHtml,
  initialAfter,
  onSave,
  onClose,
}: RichAfterEditorProps) {
  // Toolbar prefs persist across instances of this sub-modal — we
  // share the same localStorage key the main toolbar uses so density
  // / favorites / collapsed-groups carry over.
  const [prefs, setPrefs] = useState<ToolbarPrefs>(() => loadToolbarPrefs());
  useEffect(() => {
    saveToolbarPrefs(prefs);
  }, [prefs]);

  // RescanKey for ParticleOverlay-style sub-effects. We don't actually
  // mount a ParticleOverlay in this sub-modal (snippets are short, the
  // particle eye candy isn't needed mid-authoring), but EditorToolbar
  // requires the prop.
  const [rescanKey, setRescanKey] = useState(0);

  // Build the seed content once. Prefer the existing afterHtml; if
  // none, wrap the plain-text initialAfter in a paragraph so the
  // editor opens with the user's existing text already in place.
  const seedContent = useMemo(() => {
    if (initialAfterHtml && initialAfterHtml.trim().length > 0) {
      return initialAfterHtml;
    }
    if (initialAfter.length > 0) {
      // HTML-escape the textual content before wrapping in <p> so
      // characters like `<` / `&` don't get interpreted as markup.
      const esc = initialAfter
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p>${esc}</p>`;
    }
    return "<p></p>";
  }, [initialAfterHtml, initialAfter]);

  // Cluster 21 v1.2 fix — autofocus the editor on mount so the user
  // can start typing immediately. Without this, the editor exists in
  // a "no focus, no caret" state until the user finds and clicks
  // exactly the right spot inside the contenteditable; in a small
  // empty doc that's annoyingly narrow.
  const editor = useEditor({
    autofocus: "end",
    extensions: [
      // Match the main Editor.tsx's StarterKit configuration so blocks
      // like codeBlock + strike + link are owned by the right Cortex
      // extensions, not StarterKit's defaults.
      StarterKit.configure({
        strike: false,
        link: false,
        codeBlock: false,
      }),
      CortexCodeBlock,
      CortexAutoReplace,
      CortexStrikeRevision.extend({
        addProseMirrorPlugins() {
          return [buildStrikeRevisionPlugin()];
        },
      }),
      // Cluster 21 v1.2 — fixes from immediate dogfooding. Without
      // these extensions registered, the toolbar's alignment buttons
      // and Link insertion call commands that simply don't exist on
      // this editor and silently no-op.
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "center", "right"],
      }),
      Underline,
      Subscript,
      Superscript,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CortexFontStyle,
      CortexUnderlineStyled,
      CortexTextEffect,
      CortexParticleHost,
      ColorMark,
      Markdown.configure({
        html: true,
        tightLists: true,
        linkify: false,
        breaks: true,
        transformPastedText: true,
      }),
      CortexCallout,
      CortexColumns,
      CortexSideBySide,
      CortexCollapsible.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CortexCollapsibleNodeView);
        },
      }),
      CortexMarginNote,
      CortexFrame,
      CortexPullQuote,
      CortexDecoSeparator,
      CortexPageBreak,
      CortexMathBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CortexMathBlockNodeView);
        },
      }),
      CortexTabPanel,
      CortexTabsBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CortexTabsNodeView);
        },
      }),
      CortexFootnoteRef,
      CortexCitationRef,
      CortexMathInline,
      CortexDropCap,
    ],
    content: seedContent,
    editable: true,
    onUpdate: () => {
      setRescanKey((k) => k + 1);
    },
  });

  // Esc closes the sub-modal. Wraps cancel — same as clicking Cancel.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSave() {
    if (!editor) return;
    const html = editor.getHTML();
    const text = editor.getText();
    onSave({ afterHtml: html, after: text });
  }

  const node = (
    <div
      style={styles.scrim}
      // Click-outside-no-close: scrim swallows clicks but does NOT close
      // the modal (matches parent AutoReplaceModal stickiness).
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={containerRef}
        style={styles.panel}
        role="dialog"
        aria-label="Rich auto-replace editor"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.headerRow}>
          <h2 style={styles.heading}>Rich after-content</h2>
          <button onClick={onClose} style={styles.iconBtn} aria-label="Close">
            ✕
          </button>
        </div>
        <p style={styles.hint}>
          Build a rich snippet — frames, tabs, callouts, columns, collapsibles,
          font / color / effects / particles all work here. When the rule fires,
          this exact content (parsed through the schema) replaces the trigger.
        </p>

        {/* Toolbar bound to THIS mini editor. Toolbar prefs share the
            main editor's localStorage so density / favorites carry over. */}
        <div style={styles.toolbarShell}>
          <EditorToolbar
            editor={editor}
            notePath={null}
            prefs={prefs}
            onPrefsChange={setPrefs}
            rescanKey={rescanKey}
          />
        </div>

        {/* Cluster 21 v1.2 fix — click anywhere inside the editor shell
            (including the empty padding below short content) focuses
            the mini editor. Without this, an almost-empty editor with
            a single empty paragraph leaves most of the visible area
            non-clickable for input — clicks land on padding rather
            than on the contenteditable.
            v1.2 patch — early-return when the click originated inside
            a TOOLBAR POPOVER that visually overlaps the editor (font-
            family dropdown, color picker, structural-block submenu,
            etc.). Without this guard, clicking an option inside the
            popover bubbled up to this onClick, which immediately
            refocused the editor and stole focus from the popover —
            making the option click visually "fail". */}
        <div
          style={styles.editorShell}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            // Click on existing PM content → let PM handle it.
            if (
              t.classList?.contains("ProseMirror") ||
              t.closest?.(".ProseMirror")
            ) {
              return;
            }
            // Click that originated in toolbar / popover / form
            // controls visually layered over the editor area → don't
            // steal focus.
            if (
              t.closest?.(".cortex-tb-popover") ||
              t.closest?.(".cortex-tb-btn") ||
              t.closest?.(".cortex-editor-toolbar") ||
              t.closest?.("select") ||
              t.closest?.("input") ||
              t.closest?.("button")
            ) {
              return;
            }
            try {
              editor?.commands.focus("end");
            } catch {
              /* editor not ready yet */
            }
          }}
        >
          <div className="prose max-w-none" style={styles.editorScroll}>
            <EditorContent editor={editor} />
          </div>
        </div>

        <div style={styles.footerRow}>
          <button onClick={onClose} style={styles.btnSecondary}>
            Cancel
          </button>
          <button onClick={handleSave} style={styles.btnPrimary}>
            Save snippet
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    // Higher than the parent AutoReplaceModal so this sub-modal floats
    // above it. AutoReplaceModal's scrim is around z 1000.
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
  },
  panel: {
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
    width: "min(960px, 92vw)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    // Cluster 21 v1.2 fix — overflow MUST be visible at the panel
    // level so toolbar popovers (font-family, color picker, structural-
    // block menus, etc.) that extend beyond the panel's bounds aren't
    // clipped at the panel edge. The editor's scroll-when-tall
    // behavior is now scoped to `editorShell` below.
    overflow: "visible",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--border)",
  },
  heading: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 600,
  },
  iconBtn: {
    background: "transparent",
    border: 0,
    color: "var(--text)",
    fontSize: "1.1rem",
    cursor: "pointer",
    padding: "4px 8px",
    borderRadius: "4px",
  },
  hint: {
    margin: 0,
    padding: "0.5rem 1rem 0.75rem",
    fontSize: "0.82rem",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
  },
  toolbarShell: {
    borderBottom: "1px solid var(--border)",
    background: "var(--bg)",
    flex: "0 0 auto",
    // Cluster 21 v1.2 patch — establish a stacking context above the
    // editor area so toolbar popovers (font, color, structural blocks)
    // that extend down INTO the editor area visually layer on top of
    // it instead of behind. Without this, `editorShell`'s `overflow:
    // auto` was creating its own paint layer that could mask the
    // popovers depending on draw order.
    position: "relative",
    zIndex: 5,
  },
  editorShell: {
    flex: "1 1 auto",
    minHeight: "240px",
    overflow: "auto",
    padding: "1rem",
    // Hint via cursor that clicking the empty area is meaningful
    // (focuses the editor — handled by the onClick above).
    cursor: "text",
    // Cluster 21 v1.2 patch — stack BELOW the toolbar shell so
    // popovers from the toolbar that extend down into the editor
    // area render on top, not behind.
    position: "relative",
    zIndex: 1,
  },
  editorScroll: {
    fontSize: "calc(15px * var(--cortex-editor-zoom, 1))",
    minHeight: "180px",
  },
  footerRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
    padding: "0.75rem 1rem",
    borderTop: "1px solid var(--border)",
    background: "var(--bg)",
  },
  btnSecondary: {
    padding: "6px 14px",
    fontSize: "0.9rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "6px 16px",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
};
