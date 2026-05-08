// Cluster 21 v1.0 — Editor Toolbar.
//
// Sticky scrolling toolbar above the markdown editor, providing every
// formatting button + popover the user picked: basic marks, headings,
// alignment, lists, font size/family/weight, color pickers (with
// marker-pen mode for highlight), underline styled, strike-resolve
// variants, text effects (glow/shadow/gradient/animation), particle
// effects, insertion menus, layout nodes, utility (find&replace,
// counts, outline, zoom, focus, reading, invisibles, print, DOCX),
// Cortex-specific shortcuts, and toolbar-level polish.
//
// Group components are kept inline in this file to keep the file
// count manageable. Each group is a small functional component that
// receives the editor instance + relevant prefs + dispatch.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Editor } from "@tiptap/react";
// Cluster 21 v1.1 polish — rich-text replace box was attempted via a
// small TipTap mini-editor in FindReplaceBar. Disabling those imports
// while we diagnose a blank-screen on dev startup that started after
// the polish pass. Re-enable after the root cause is isolated.
// import { EditorContent, useEditor } from "@tiptap/react";
// import StarterKit from "@tiptap/starter-kit";
// import Underline from "@tiptap/extension-underline";
// import TextStyle from "@tiptap/extension-text-style";
// import Color from "@tiptap/extension-color";
import { setMarkerMode } from "../editor/CortexMarkerMode";
import {
  PARTICLE_TYPES,
  type ParticleType,
} from "../editor/CortexParticleHost";
import { CORTEX_CODE_LANGUAGES } from "../editor/CortexCodeBlock";
import { AutoReplaceModal } from "./AutoReplaceModal";

// ---- Toolbar prefs (persisted in localStorage) ---------------------------

export interface ToolbarPrefs {
  density: "compact" | "comfortable" | "spacious";
  collapsedGroups: string[];
  favorites: string[];
  pauseAnimations: boolean;
  reduceMotion: boolean;
  readingMode: boolean;
  spellcheck: boolean;
  zoom: number;
  /** Cluster 21 v1.0.2 — minimize the toolbar to a thin strip with
   *  only the expand handle visible. Persisted in localStorage. */
  minimized: boolean;
}

const DEFAULT_PREFS: ToolbarPrefs = {
  density: "comfortable",
  collapsedGroups: [],
  favorites: [],
  pauseAnimations: false,
  // Cluster 21 v1.0.3 — default reduceMotion to false so particles +
  // animations work by default. The CSS @media rule for
  // prefers-reduced-motion still applies independently to disable
  // CSS-driven animations at the OS level — but the toolbar's own
  // pause toggle stays opt-in.
  reduceMotion: false,
  readingMode: false,
  spellcheck: true,
  zoom: 1,
  minimized: false,
};

const PREFS_KEY = "cortex:editor-toolbar-prefs";

export function loadToolbarPrefs(): ToolbarPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_PREFS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

export function saveToolbarPrefs(prefs: ToolbarPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

// ---- Color palette --------------------------------------------------------

// Cluster 21 v1.0.4 — order matches Cluster 2's ColorMark / reviews
// pipeline (Ctrl+1..7): yellow → weekly, green → monthly, pink →
// tomorrow's daily, blue → concept inbox, orange → anti-hype, red
// → bottlenecks, purple → citations. The `mark` field is the
// ColorMark name; highlight buttons call toggleColorMark(name) so
// the same span feeds the Reviews tab.
const MARK_PALETTE = [
  { hex: "#ffd166", name: "Yellow", mark: "yellow" as const },
  { hex: "#06d6a0", name: "Green", mark: "green" as const },
  { hex: "#ffafcc", name: "Pink", mark: "pink" as const },
  { hex: "#3a86ff", name: "Blue", mark: "blue" as const },
  { hex: "#f78c6b", name: "Orange", mark: "orange" as const },
  { hex: "#ef476f", name: "Red", mark: "red" as const },
  { hex: "#9d4edd", name: "Purple", mark: "purple" as const },
  { hex: "#222222", name: "Black", mark: null },
  { hex: "#ffffff", name: "White", mark: null },
];

// Cluster 21 v1.1 polish — expanded font roster + each option's <option>
// element renders its label in its OWN font-family so the user can
// preview before committing. Chromium (which Tauri WebView2 uses)
// honours `font-family` on <option> since Chrome 79; the family chain
// always ends in a system fallback so anyone offline still sees
// readable labels.
//
// Google Fonts are loaded once via index.html's <link> tag covering
// every named font in this list.
const FONT_FAMILIES = [
  // System stacks (always available, no CDN load needed)
  {
    label: "Sans-serif",
    value: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  { label: "Serif", value: 'ui-serif, Georgia, "Iowan Old Style", serif' },
  {
    label: "Monospace",
    value: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  },
  // Curated webfonts (loaded via Google Fonts link in index.html)
  { label: "Inter", value: '"Inter", system-ui, sans-serif' },
  { label: "Lora", value: '"Lora", Georgia, serif' },
  {
    label: "Crimson Text",
    value: '"Crimson Text", "Times New Roman", serif',
  },
  {
    label: "Playfair Display",
    value: '"Playfair Display", "Times New Roman", serif',
  },
  { label: "EB Garamond", value: '"EB Garamond", Garamond, serif' },
  {
    label: "Source Serif",
    value: '"Source Serif Pro", "Source Serif", Georgia, serif',
  },
  { label: "JetBrains Mono", value: '"JetBrains Mono", Consolas, monospace' },
  { label: "Fira Code", value: '"Fira Code", Consolas, monospace' },
  // Display + handwriting
  { label: "Bebas Neue", value: '"Bebas Neue", Impact, sans-serif' },
  { label: "Cinzel", value: '"Cinzel", "Trajan Pro", serif' },
  { label: "Caveat", value: '"Caveat", "Comic Sans MS", cursive' },
  { label: "Pacifico", value: '"Pacifico", "Comic Sans MS", cursive' },
];

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 96];
const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

const TEXT_EFFECTS_GLOW = [
  { id: "glow-soft", label: "Soft glow" },
  { id: "glow-neon", label: "Neon glow" },
  { id: "halo", label: "Halo" },
  { id: "shadow-drop", label: "Drop shadow" },
  { id: "shadow-inset", label: "Inset shadow" },
  { id: "embossed", label: "Embossed" },
  { id: "engraved", label: "Engraved" },
  { id: "extrude-3d", label: "3D extrude" },
  { id: "outline", label: "Outline" },
];
const TEXT_EFFECTS_GRADIENT = [
  { id: "gradient-golden", label: "Golden" },
  { id: "gradient-silver", label: "Silver" },
  { id: "gradient-rainbow", label: "Rainbow" },
  { id: "gradient-sunset", label: "Sunset" },
  { id: "gradient-ocean", label: "Ocean" },
];
const TEXT_EFFECTS_ANIM = [
  { id: "anim-pulse", label: "Pulse" },
  { id: "anim-bounce", label: "Bounce" },
  { id: "anim-shake", label: "Shake" },
  { id: "anim-wave", label: "Wave" },
  { id: "anim-typewriter", label: "Typewriter" },
  { id: "anim-marquee", label: "Marquee" },
  { id: "anim-fade", label: "Fade in" },
  { id: "anim-colorcycle", label: "Color cycle" },
  { id: "anim-animgradient", label: "Animated gradient" },
  { id: "anim-glitch", label: "Glitch" },
  { id: "anim-flicker", label: "Flicker" },
  { id: "anim-heartbeat", label: "Heartbeat" },
  { id: "anim-float", label: "Float" },
];

const SPECIAL_CHARS = [
  "—",
  "–",
  "…",
  "©",
  "®",
  "™",
  "§",
  "¶",
  "†",
  "‡",
  "•",
  "‹",
  "›",
  "«",
  "»",
  "“",
  "”",
  "‘",
  "’",
];

const SYMBOLS = [
  "Σ",
  "π",
  "∞",
  "∴",
  "∵",
  "∀",
  "∃",
  "∈",
  "∉",
  "⊂",
  "∪",
  "∩",
  "≠",
  "≈",
  "≤",
  "≥",
  "±",
  "÷",
  "×",
  "√",
  "∫",
  "∂",
  "∑",
  "∇",
];

const EMOJIS = [
  "😀",
  "🚀",
  "✨",
  "🎉",
  "💡",
  "🔥",
  "⭐",
  "💎",
  "🌈",
  "📚",
  "🧪",
  "🔬",
  "📊",
  "✅",
  "❌",
  "⚠️",
  "💭",
  "❤️",
  "💜",
  "🎯",
];

// ---- Main toolbar component ----------------------------------------------

export interface EditorToolbarProps {
  editor: Editor | null;
  notePath: string | null;
  prefs: ToolbarPrefs;
  onPrefsChange: (next: ToolbarPrefs) => void;
  /** Bumps so sub-effects (FindReplace, particle scan) refresh. */
  rescanKey: number;
  /** Cluster 21 v1.0.4 — opens the existing ExperimentBlockModal
   *  (the Ctrl+Shift+B pipeline). The modal handles type / name /
   *  iteration entry and inserts the typed block at the cursor.
   *  Same UX as the keyboard shortcut, just clickable from the
   *  toolbar. The optional `preselectType` lets each toolbar button
   *  hint at which type the user is reaching for. */
  onOpenBlockModal?: (
    preselectType?: "experiment" | "protocol" | "idea" | "method",
  ) => void;
  onInsertWikilink?: () => void;
  onInsertGitHubBlock?: () => void;
}

export function EditorToolbar({
  editor,
  notePath,
  prefs,
  onPrefsChange,
  rescanKey: _rescanKey,
  onOpenBlockModal,
  onInsertWikilink,
  onInsertGitHubBlock,
}: EditorToolbarProps) {
  // ---- selection memory ----
  // Cluster 21 v1.0.3 — clicking a toolbar button (especially a
  // popover trigger) momentarily blurs the editor and collapses the
  // selection. Without preservation, every button that operates on
  // a range silently no-ops (applies the mark to a cursor with no
  // text). We track the most recent NON-EMPTY selection in a ref
  // and restore it before each command.
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      try {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          lastSelectionRef.current = { from, to };
        }
      } catch {
        /* editor view race */
      }
    };
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
  /** Run an editor chain inside the most recent non-empty selection.
   *  When current selection IS non-empty, uses that. Otherwise,
   *  restores the last-known range. Falls back to the current
   *  cursor position if neither exists. */
  const withSelection = useCallback(
    <T,>(fn: (chain: any) => T): T | undefined => {
      if (!editor) return undefined;
      try {
        const { from, to } = editor.state.selection;
        const target = from !== to ? { from, to } : lastSelectionRef.current;
        const chain = editor.chain().focus();
        if (target) chain.setTextSelection(target);
        return fn(chain);
      } catch {
        return undefined;
      }
    },
    [editor],
  );

  // ---- ad-hoc UI state ----
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [replaceMode, setReplaceMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Cluster 21 v1.1 polish — auto-replace pipeline manager modal.
  const [autoReplaceOpen, setAutoReplaceOpen] = useState(false);
  const [markerActive, setMarkerActive] = useState(false);
  // Cluster 21 v1.0.4 — marker color is a ColorMark name (one of the
  // seven Cluster 2 review-pipeline marks), not a free hex. The
  // marker plugin reads this and applies toggleColorMark(name).
  const [markerMark, setMarkerMark] = useState<string>("yellow");
  const [recentTextColors, setRecentTextColors] = useState<string[]>([]);
  const [recentHighlights, setRecentHighlights] = useState<string[]>([]);
  const [recentUnderlineColors, setRecentUnderlineColors] = useState<string[]>(
    [],
  );
  const counts = useLiveCounts(editor);

  // Body-level pause flag.
  useEffect(() => {
    document.body.classList.toggle(
      "cortex-anim-paused",
      prefs.pauseAnimations || prefs.reduceMotion,
    );
  }, [prefs.pauseAnimations, prefs.reduceMotion]);

  // Body-level marker class.
  useEffect(() => {
    document.body.classList.toggle("cortex-marker-active", markerActive);
  }, [markerActive]);

  // Apply marker state to the editor plugin.
  // v1.0.1 — defensive view access. v1.0.4 — color is now the
  // ColorMark name (one of the seven review-pipeline marks).
  useEffect(() => {
    if (!editor) return;
    try {
      setMarkerMode(editor.view, markerActive, markerMark);
    } catch {
      /* editor view not yet mounted — retry on next render */
    }
  }, [editor, markerActive, markerMark]);

  // Spellcheck attr — same defensive guard around editor.view.dom.
  useEffect(() => {
    if (!editor) return;
    try {
      editor.view.dom.setAttribute(
        "spellcheck",
        prefs.spellcheck ? "true" : "false",
      );
    } catch {
      /* editor view not yet mounted */
    }
  }, [editor, prefs.spellcheck]);

  // Reading-mode body class is handled in TabPane (so it can hide its
  // panels too); we just expose the toggle.

  // Zoom CSS transform — applied to editor wrapper via a CSS variable.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--cortex-editor-zoom",
      String(prefs.zoom),
    );
  }, [prefs.zoom]);

  const togglePref = useCallback(
    <K extends keyof ToolbarPrefs>(k: K, v: ToolbarPrefs[K]) => {
      onPrefsChange({ ...prefs, [k]: v });
    },
    [prefs, onPrefsChange],
  );

  const toggleGroup = useCallback(
    (id: string) => {
      const set = new Set(prefs.collapsedGroups);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      togglePref("collapsedGroups", Array.from(set));
    },
    [prefs.collapsedGroups, togglePref],
  );

  // Cluster 21 v1.0.7 — resolveRange MUST be declared above any
  // conditional early-return so React's hook order stays stable
  // across renders (editor goes from null -> instance after the
  // first paint, and earlier the useCallback below sat AFTER the
  // `if (!editor) return null` guard which violated Rules of Hooks
  // and produced "Rendered more hooks than during the previous
  // render"). Resolves the target range for a toolbar action;
  // prefers the current selection and falls back to the last-known
  // non-empty selection captured by the selectionUpdate listener.
  const resolveRange = useCallback((): { from: number; to: number } | null => {
    if (!editor) return null;
    try {
      const { from, to } = editor.state.selection;
      if (from !== to) return { from, to };
      if (lastSelectionRef.current) {
        const { from: lf, to: lt } = lastSelectionRef.current;
        const docSize = editor.state.doc.content.size;
        if (lf >= 0 && lt <= docSize && lf < lt) return { from: lf, to: lt };
      }
    } catch {
      /* editor view race */
    }
    return null;
  }, [editor]);

  if (!editor) return null;

  const isCollapsed = (id: string) => prefs.collapsedGroups.includes(id);
  const popoverIsOpen = (id: string) => openPopover === id;
  const togglePopover = (id: string) =>
    setOpenPopover((prev) => (prev === id ? null : id));

  // Helpers -----------------------------------------------------------------

  const rememberColor = (
    set: React.Dispatch<React.SetStateAction<string[]>>,
    color: string,
  ) => {
    set((prev) => {
      const next = [color, ...prev.filter((c) => c !== color)].slice(0, 8);
      return next;
    });
  };

  // Cluster 21 v1.0.3 — category-aware effect application. Within a
  // single category (gradient / shadow / animation), applying a new
  // effect REPLACES the existing one; across categories the effects
  // compose. So you can have gradient-golden + anim-pulse, but not
  // gradient-golden + gradient-rainbow on the same span.
  function categoryOf(effect: string): "gradient" | "anim" | "glow" {
    if (effect.startsWith("gradient-")) return "gradient";
    if (effect.startsWith("anim-")) return "anim";
    return "glow";
  }
  // Cluster 21 v1.0.6 — apply effects via DIRECT ProseMirror
  // dispatches, bypassing TipTap's chain entirely. Earlier rounds
  // tried chain.setMark + setTextSelection + custom command bodies;
  // each had a different composition ambiguity that occasionally
  // dropped the selection range and routed the mark into
  // `storedMarks` (where it'd apply to the next-typed character
  // and the user never saw it on existing text). Dispatching
  // tr.addMark / tr.removeMark with explicit (from, to) positions
  // is unambiguous and works regardless of focus state.

  const applyTextEffect = (effect: string, color?: string) => {
    if (!editor) return;
    const range = resolveRange();
    if (!range) {
      console.info(
        "[cortex] effect: select some text first (no active selection)",
      );
      return;
    }
    const markType = editor.state.schema.marks.cortexTextEffect;
    if (!markType) {
      console.warn("[cortex] cortexTextEffect mark not registered");
      return;
    }
    // Read the current effect attr from the FIRST mark in the
    // target range so we can do same-category replacement.
    let existing: string[] = [];
    editor.state.doc.nodesBetween(range.from, range.to, (node) => {
      if (existing.length > 0) return false;
      const m = node.marks?.find((mk: any) => mk.type === markType);
      if (m) {
        existing = (((m.attrs as any).effect as string) || "")
          .split(/\s+/)
          .filter(Boolean);
        return false;
      }
      return true;
    });
    const cat = categoryOf(effect);
    const filtered = existing.filter((e) => categoryOf(e) !== cat);
    const next = existing.includes(effect) ? filtered : [...filtered, effect];
    let tr = editor.state.tr;
    tr = tr.removeMark(range.from, range.to, markType);
    if (next.length > 0) {
      tr = tr.addMark(
        range.from,
        range.to,
        markType.create({
          effect: next.join(" "),
          color: color ?? null,
          gradient: null,
        }),
      );
    }
    editor.view.dispatch(tr);
    try {
      editor.view.focus();
    } catch {
      /* ignore */
    }
  };

  const applyParticle = (p: ParticleType | null, color?: string) => {
    if (!editor) return;
    const range = resolveRange();
    if (!range) {
      console.info(
        "[cortex] particle: select some text first (no active selection)",
      );
      return;
    }
    const markType = editor.state.schema.marks.cortexParticleHost;
    if (!markType) {
      console.warn("[cortex] cortexParticleHost mark not registered");
      return;
    }
    let tr = editor.state.tr.removeMark(range.from, range.to, markType);
    if (p) {
      tr = tr.addMark(
        range.from,
        range.to,
        markType.create({ particle: p, color: color ?? null }),
      );
    }
    editor.view.dispatch(tr);
    try {
      editor.view.focus();
    } catch {
      /* ignore */
    }
  };

  // Render ------------------------------------------------------------------

  return (
    <div
      className={
        `cortex-editor-toolbar density-${prefs.density}` +
        (prefs.minimized ? " minimized" : "")
      }
      // Cluster 21 v1.0.3 — `mousedown` is the event that causes
      // editor blur; preventing default on `mousedown` (not on
      // `pointerdown`, which can interfere with click dispatch in
      // popovers) keeps the editor focused and the selection alive.
      onMouseDown={(e) => {
        // Allow native focus on form controls (input / select).
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA"
        ) {
          return;
        }
        e.preventDefault();
      }}
    >
      {/* Cluster 21 v1.0.2 — minimize/expand handle. Always visible
          even when the toolbar is minimized (its group is marked
          `cortex-tb-keep-minimized` so the minimized-style rule
          doesn't hide it). */}
      <div className="cortex-editor-toolbar-group cortex-tb-keep-minimized">
        <TbBtn
          active={prefs.minimized}
          onClick={() => togglePref("minimized", !prefs.minimized)}
          title={
            prefs.minimized
              ? "Expand toolbar"
              : "Minimize toolbar to a thin strip"
          }
        >
          {prefs.minimized ? "▾" : "▴"}
        </TbBtn>
        {prefs.minimized && (
          <span
            style={{
              color: "var(--text-muted)",
              fontSize: "0.65rem",
              marginLeft: 6,
            }}
          >
            Toolbar (click ▾ to expand)
          </span>
        )}
      </div>
      {/* Format group */}
      <Group
        id="format"
        title="Format"
        collapsed={isCollapsed("format")}
        onToggle={toggleGroup}
      >
        <TbBtn
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </TbBtn>
        <TbBtn
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </TbBtn>
        <TbBtn
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </TbBtn>
        <TbBtn
          active={editor.isActive("subscript" as any)}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          title="Subscript (Ctrl+<)"
        >
          x₂
        </TbBtn>
        <TbBtn
          active={editor.isActive("superscript" as any)}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          title="Superscript (Ctrl+>)"
        >
          x²
        </TbBtn>
        <TbBtn
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Inline code"
        >
          {"</>"}
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
          title="Clear formatting (Ctrl+\\)"
        >
          ✕
        </TbBtn>
      </Group>

      {/* Strike-resolve group (replaces strikethrough). */}
      <Group
        id="strike"
        title="Strike"
        collapsed={isCollapsed("strike")}
        onToggle={toggleGroup}
      >
        <TbBtn
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strike-resolve (Ctrl+Shift+X)"
        >
          <s>S</s>
        </TbBtn>
        <TbBtn
          active={editor.isActive("cortexUnderlineStyled" as any, {
            style: "double",
          })}
          onClick={() =>
            editor.chain().focus().setUnderlineStyled({ style: "double" }).run()
          }
          title="Double strike line"
        >
          ⩵
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor.chain().focus().setUnderlineStyled({ style: "dashed" }).run()
          }
          title="Dashed strike line"
        >
          ⤍
        </TbBtn>
      </Group>

      {/* Paragraph / heading group */}
      <Group
        id="paragraph"
        title="Paragraph"
        collapsed={isCollapsed("paragraph")}
        onToggle={toggleGroup}
      >
        {[1, 2, 3].map((lvl) => (
          <TbBtn
            key={lvl}
            active={editor.isActive("heading", { level: lvl })}
            onClick={() =>
              editor
                .chain()
                .focus()
                .toggleHeading({ level: lvl as 1 | 2 | 3 })
                .run()
            }
            title={`Heading ${lvl}`}
          >
            H{lvl}
          </TbBtn>
        ))}
        <TbPopover
          isOpen={popoverIsOpen("heading-more")}
          onToggle={() => togglePopover("heading-more")}
          trigger={<>H4-6</>}
          title="More headings"
        >
          {[4, 5, 6].map((lvl) => (
            <button
              key={lvl}
              className="cortex-tb-btn"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: lvl as 4 | 5 | 6 })
                  .run();
                setOpenPopover(null);
              }}
            >
              Heading {lvl}
            </button>
          ))}
        </TbPopover>
        <TbBtn
          onClick={() => editor.chain().focus().setParagraph().run()}
          title="Body text"
        >
          ¶
        </TbBtn>
        <TbBtn
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Block quote"
        >
          ❝
        </TbBtn>
        <TbBtn
          active={editor.isActive("cortexPullQuote" as any)}
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleNode("cortexPullQuote" as any, "paragraph" as any)
              .run()
          }
          title="Pull quote"
        >
          ❛❜
        </TbBtn>
        <TbBtn
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Code block"
        >
          {"{}"}
        </TbBtn>
        {/* Cluster 21 v1.1 — language picker for the active code block.
            Visible only when the cursor is inside a codeBlock; sets
            the `language` attr that CodeBlockLowlight reads for
            syntax highlighting. */}
        {editor.isActive("codeBlock") ? (
          <select
            className="cortex-tb-lang-select"
            value={
              (editor.getAttributes("codeBlock") as any).language || "plaintext"
            }
            onChange={(e) => {
              const lang = e.target.value;
              editor
                .chain()
                .focus()
                .updateAttributes("codeBlock" as any, { language: lang })
                .run();
            }}
            title="Code block language"
          >
            {CORTEX_CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        ) : null}
        <TbBtn
          onClick={() => {
            // Drop cap: apply mark to the first character of the
            // current paragraph.
            const { from, $from } = editor.state.selection;
            const start = $from.start();
            editor
              .chain()
              .focus()
              .setTextSelection({ from: start, to: start + 1 })
              .setMark("cortexDropCap" as any)
              .setTextSelection(from)
              .run();
          }}
          title="Drop cap (apply to first character of paragraph)"
        >
          A↓
        </TbBtn>
      </Group>

      {/* Alignment group */}
      <Group
        id="align"
        title="Align"
        collapsed={isCollapsed("align")}
        onToggle={toggleGroup}
      >
        <TbBtn
          active={editor.isActive({ textAlign: "left" } as any)}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          title="Align left"
        >
          ⇤
        </TbBtn>
        <TbBtn
          active={editor.isActive({ textAlign: "center" } as any)}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          title="Align center"
        >
          ⇔
        </TbBtn>
        <TbBtn
          active={editor.isActive({ textAlign: "right" } as any)}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          title="Align right"
        >
          ⇥
        </TbBtn>
        <TbBtn
          active={editor.isActive({ textAlign: "justify" } as any)}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          title="Justify"
        >
          ☰
        </TbBtn>
      </Group>

      {/* Lists group */}
      <Group
        id="lists"
        title="Lists"
        collapsed={isCollapsed("lists")}
        onToggle={toggleGroup}
      >
        <TbBtn
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        >
          •
        </TbBtn>
        <TbBtn
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          1.
        </TbBtn>
        <TbBtn
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title="Task list"
        >
          ☐
        </TbBtn>
        <TbBtn
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
          title="Indent (Tab)"
        >
          →
        </TbBtn>
        <TbBtn
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
          title="Outdent (Shift+Tab)"
        >
          ←
        </TbBtn>
      </Group>

      {/* Size group */}
      <Group
        id="size"
        title="Size"
        collapsed={isCollapsed("size")}
        onToggle={toggleGroup}
      >
        <select
          className="cortex-tb-btn"
          value={
            (editor.getAttributes("cortexFontStyle" as any) as any)?.size ?? ""
          }
          onChange={(e) => {
            const v = e.target.value;
            editor
              .chain()
              .focus()
              .setFontSize(v ? Number(v) : null)
              .run();
          }}
          style={{ minWidth: 60 }}
        >
          <option value="">Default</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <TbBtn
          onClick={() => {
            const cur =
              (editor.getAttributes("cortexFontStyle" as any) as any)?.size ??
              16;
            const idx = FONT_SIZES.findIndex((s) => s >= cur);
            const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, idx + 1)];
            editor.chain().focus().setFontSize(next).run();
          }}
          title="Increase size (Ctrl++)"
        >
          A+
        </TbBtn>
        <TbBtn
          onClick={() => {
            const cur =
              (editor.getAttributes("cortexFontStyle" as any) as any)?.size ??
              16;
            const idx = FONT_SIZES.findIndex((s) => s >= cur);
            const next = FONT_SIZES[Math.max(0, idx - 1)];
            editor.chain().focus().setFontSize(next).run();
          }}
          title="Decrease size (Ctrl+-)"
        >
          A-
        </TbBtn>
        <TbBtn
          onClick={() => editor.chain().focus().setFontSize(null).run()}
          title="Reset size (Ctrl+0)"
        >
          A0
        </TbBtn>
      </Group>

      {/* Font family + weight */}
      <Group
        id="font"
        title="Font"
        collapsed={isCollapsed("font")}
        onToggle={toggleGroup}
      >
        <select
          className="cortex-tb-btn"
          onChange={(e) => {
            const v = e.target.value;
            editor
              .chain()
              .focus()
              .setFontFamily(v || null)
              .run();
          }}
          style={{ minWidth: 100 }}
          value={
            (editor.getAttributes("cortexFontStyle" as any) as any)?.family ??
            ""
          }
        >
          <option value="">Default</option>
          {FONT_FAMILIES.map((f) => (
            // Cluster 21 v1.1 polish — render each option's label in
            // its own font so the user previews before committing.
            // Chromium honours font-family on <option> (since Chrome
            // 79); the family chain in `f.value` ends in a system
            // fallback so offline users still see readable labels.
            <option
              key={f.label}
              value={f.value}
              style={{ fontFamily: f.value }}
            >
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="cortex-tb-btn"
          value={
            (editor.getAttributes("cortexFontStyle" as any) as any)?.weight ??
            ""
          }
          onChange={(e) => {
            const v = e.target.value;
            editor
              .chain()
              .focus()
              .setFontWeight(v ? Number(v) : null)
              .run();
          }}
          style={{ minWidth: 60 }}
        >
          <option value="">Weight</option>
          {FONT_WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Group>

      {/* Color group */}
      <Group
        id="color"
        title="Color"
        collapsed={isCollapsed("color")}
        onToggle={toggleGroup}
      >
        <TbPopover
          isOpen={popoverIsOpen("color")}
          onToggle={() => togglePopover("color")}
          trigger={<span style={{ color: "var(--accent)" }}>A</span>}
          title="Text color"
        >
          <ColorPicker
            recents={recentTextColors}
            onPick={(hex) => {
              editor.chain().focus().setColor(hex).run();
              rememberColor(setRecentTextColors, hex);
              setOpenPopover(null);
            }}
            onReset={() => {
              editor.chain().focus().unsetColor().run();
              setOpenPopover(null);
            }}
            extraButtons={
              <>
                <button
                  className="cortex-tb-btn"
                  onClick={async () => {
                    const ed = (window as any).EyeDropper;
                    if (!ed) return;
                    try {
                      const res = await new ed().open();
                      if (res?.sRGBHex) {
                        editor.chain().focus().setColor(res.sRGBHex).run();
                        rememberColor(setRecentTextColors, res.sRGBHex);
                      }
                    } catch {
                      /* user cancelled */
                    }
                  }}
                >
                  💧 Eyedropper
                </button>
                <button
                  className="cortex-tb-btn"
                  onClick={() => applyMultiColor(editor, MARK_PALETTE)}
                  title="Cycle palette colors per character"
                >
                  Multi-color
                </button>
                <button
                  className="cortex-tb-btn"
                  onClick={() => applyRandomSprinkle(editor)}
                  title="Random color per character"
                >
                  Sprinkle
                </button>
              </>
            }
          />
        </TbPopover>
      </Group>

      {/* Highlight group */}
      <Group
        id="highlight"
        title="Highlight"
        collapsed={isCollapsed("highlight")}
        onToggle={toggleGroup}
      >
        {/* Cluster 21 v1.0.4 — wired to Cluster 2's ColorMark via
            `toggleColorMark(name)`. Order matches Ctrl+1..7 so the
            seven highlights feed the Reviews / Weekly / Monthly /
            Tomorrow / Concept Inbox / Anti-Hype / Bottlenecks /
            Citations destinations correctly. */}
        {MARK_PALETTE.slice(0, 7).map((c, i) => (
          <button
            key={c.hex}
            className="cortex-tb-swatch"
            style={{ background: c.hex }}
            title={`${c.name} (Ctrl+${i + 1})`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!c.mark) return;
              withSelection((chain) => chain.toggleColorMark(c.mark!).run());
            }}
          />
        ))}
        <button
          className={"cortex-tb-btn" + (markerActive ? " active" : "")}
          onClick={() => setMarkerActive((v) => !v)}
          title="Marker pen — drag to highlight; release to apply"
        >
          ✏️ Marker
        </button>
        {/* Marker color is restricted to the seven Cluster 2 mark
            names (Ctrl+1..7). The plugin applies toggleColorMark(name)
            so highlights from marker-pen mode feed the Reviews tab
            just like the keyboard shortcut path. */}
        <select
          className="cortex-tb-btn"
          value={markerMark}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setMarkerMark(e.target.value)}
          title="Marker pen color (mark colors only)"
        >
          {MARK_PALETTE.slice(0, 7).map((c, i) => (
            <option key={c.hex} value={c.mark!}>
              {i + 1}. {c.name}
            </option>
          ))}
        </select>
        <TbBtn
          onClick={() => {
            // Cluster 21 v1.0.5 — Reset clears the Cluster 2
            // ColorMark (which is what swatches and the marker
            // apply now). Also clears any legacy `highlight` mark
            // for forward compat.
            withSelection((chain) =>
              chain
                .unsetColorMark()
                .unsetMark("highlight" as any)
                .run(),
            );
          }}
          title="Reset highlight"
        >
          ⌫
        </TbBtn>
      </Group>

      {/* Underline styled */}
      <Group
        id="underline"
        title="Underline"
        collapsed={isCollapsed("underline")}
        onToggle={toggleGroup}
      >
        <input
          type="color"
          onChange={(e) => {
            editor
              .chain()
              .focus()
              .setUnderlineStyled({ color: e.target.value })
              .run();
            rememberColor(setRecentUnderlineColors, e.target.value);
          }}
          title="Underline color"
          style={{ width: 22, height: 22, border: "none", padding: 0 }}
        />
        <select
          className="cortex-tb-btn"
          onChange={(e) =>
            editor
              .chain()
              .focus()
              .setUnderlineStyled({ thickness: e.target.value as any })
              .run()
          }
          defaultValue=""
        >
          <option value="">Thickness</option>
          <option value="thin">Thin</option>
          <option value="medium">Medium</option>
          <option value="thick">Thick</option>
          <option value="extra-thick">Extra-thick</option>
        </select>
        <select
          className="cortex-tb-btn"
          onChange={(e) =>
            editor
              .chain()
              .focus()
              .setUnderlineStyled({ style: e.target.value as any })
              .run()
          }
          defaultValue=""
        >
          <option value="">Style</option>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="double">Double</option>
          <option value="wavy">Wavy</option>
        </select>
        <TbBtn
          onClick={() =>
            editor.chain().focus().setUnderlineStyled({ marching: true }).run()
          }
          title="Marching-ants underline"
        >
          ━━
        </TbBtn>
      </Group>

      {/* Effects group (glow + gradient + animation) */}
      <Group
        id="effects"
        title="Effects"
        collapsed={isCollapsed("effects")}
        onToggle={toggleGroup}
      >
        <TbPopover
          isOpen={popoverIsOpen("glow")}
          onToggle={() => togglePopover("glow")}
          trigger={<>✨</>}
          title="Glow / shadow"
        >
          {TEXT_EFFECTS_GLOW.map((e) => (
            <button
              key={e.id}
              className="cortex-tb-btn"
              onClick={() => applyTextEffect(e.id)}
            >
              <span className={`tx-${e.id}`}>{e.label}</span>
            </button>
          ))}
        </TbPopover>
        <TbPopover
          isOpen={popoverIsOpen("gradient")}
          onToggle={() => togglePopover("gradient")}
          trigger={<>🌈</>}
          title="Gradient"
        >
          {TEXT_EFFECTS_GRADIENT.map((e) => (
            <button
              key={e.id}
              className="cortex-tb-btn"
              onClick={() => applyTextEffect(e.id)}
            >
              <span className={`tx-${e.id}`}>{e.label}</span>
            </button>
          ))}
        </TbPopover>
        <TbPopover
          isOpen={popoverIsOpen("anim")}
          onToggle={() => togglePopover("anim")}
          trigger={<>🎬</>}
          title="Animation"
        >
          {TEXT_EFFECTS_ANIM.map((e) => (
            <button
              key={e.id}
              className="cortex-tb-btn"
              onClick={() => applyTextEffect(e.id)}
            >
              <span className={`tx-${e.id}`}>{e.label}</span>
            </button>
          ))}
          <button
            className="cortex-tb-btn"
            onClick={() => editor.chain().focus().clearTextEffect().run()}
            style={{ color: "var(--danger)" }}
          >
            Remove all effects
          </button>
        </TbPopover>
      </Group>

      {/* Particles group */}
      <Group
        id="particles"
        title="Particles"
        collapsed={isCollapsed("particles")}
        onToggle={toggleGroup}
      >
        <TbPopover
          isOpen={popoverIsOpen("particles")}
          onToggle={() => togglePopover("particles")}
          trigger={<>🪄</>}
          title="Particle effects"
        >
          {PARTICLE_TYPES.map((p) => (
            <button
              key={p}
              className="cortex-tb-btn"
              onClick={() => applyParticle(p)}
            >
              {p}
            </button>
          ))}
          <button
            className="cortex-tb-btn"
            onClick={() => applyParticle(null)}
            style={{ color: "var(--danger)" }}
          >
            Remove particles
          </button>
        </TbPopover>
      </Group>

      {/* Insert group */}
      <Group
        id="insert"
        title="Insert"
        collapsed={isCollapsed("insert")}
        onToggle={toggleGroup}
      >
        <TbBtn
          onClick={() => {
            // Cluster 21 v1.0.3 — capture the selection BEFORE the
            // prompt() blurs the editor.
            // Cluster 21 v1.1 polish — when the cursor has no
            // selection, `setLink` silently no-ops (a link mark needs
            // a range to wrap), and the typed URL was discarded. Now
            // we INSERT the URL as link text when there's no
            // selection.
            // Cluster 21 v1.1 polish (link label) — also offer the
            // user a second prompt for a custom display label, so the
            // link can read "see paper" instead of the raw URL. Empty
            // label falls back to the URL itself; if there is already
            // a selection, the selection acts as the label and we
            // skip the second prompt.
            const sel = editor.state.selection;
            const from = sel.from;
            const to = sel.to;
            const hasSelection = from !== to;
            const raw = window.prompt(
              hasSelection
                ? "URL for the selected text:"
                : "URL:",
            );
            if (!raw) return;
            const trimmed = raw.trim();
            if (!trimmed) return;
            // Light URL hygiene: prepend https:// for bare domains
            // (anything without a scheme that isn't a relative path).
            const url =
              /^(https?:|mailto:|tel:|file:|\/|\.\.?\/|#)/i.test(trimmed)
                ? trimmed
                : `https://${trimmed}`;
            if (hasSelection) {
              editor
                .chain()
                .focus()
                .setTextSelection({ from, to })
                .setLink({ href: url })
                .run();
            } else {
              // No selection: ask for the optional display label.
              // Cancelling the label prompt aborts the whole insert
              // (so accidental Esc doesn't dump a raw URL into the
              // doc); leaving it empty falls back to the URL string.
              const labelRaw = window.prompt(
                "Display text (leave blank to use the URL):",
                "",
              );
              if (labelRaw === null) return;
              const labelTrimmed = labelRaw.trim();
              const linkText = labelTrimmed.length > 0 ? labelTrimmed : trimmed;
              editor
                .chain()
                .focus()
                .setTextSelection({ from, to })
                .insertContent(linkText)
                .setTextSelection({ from, to: from + linkText.length })
                .setLink({ href: url })
                // Move cursor to the end of the inserted link so the
                // user can keep typing prose after it.
                .setTextSelection(from + linkText.length)
                .run();
            }
          }}
          title="Link"
        >
          🔗
        </TbBtn>
        <TbBtn
          onClick={() => {
            const id = window.prompt("Footnote number:") || "1";
            editor
              .chain()
              .focus()
              .insertContent(
                `<sup class="cortex-fn" data-id="${id}">[${id}]</sup>`,
              )
              .run();
          }}
          title="Footnote"
        >
          ⁽¹⁾
        </TbBtn>
        <TbBtn
          onClick={() => {
            const id = window.prompt("Citation number:") || "1";
            editor
              .chain()
              .focus()
              .insertContent(
                `<span class="cortex-citation" data-id="${id}">[${id}]</span>`,
              )
              .run();
          }}
          title="Citation"
        >
          ❡
        </TbBtn>
        <TbBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
        >
          ▬
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent('<hr class="cortex-page-break" />')
              .run()
          }
          title="Page break"
        >
          ⤓
        </TbBtn>
        <TbPopover
          isOpen={popoverIsOpen("special")}
          onToggle={() => togglePopover("special")}
          trigger={<>§</>}
          title="Special character"
        >
          <div className="cortex-tb-grid-7">
            {SPECIAL_CHARS.map((c) => (
              <button
                key={c}
                className="cortex-tb-btn"
                onClick={() => {
                  editor.chain().focus().insertContent(c).run();
                  setOpenPopover(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </TbPopover>
        <TbPopover
          isOpen={popoverIsOpen("emoji")}
          onToggle={() => togglePopover("emoji")}
          trigger={<>😀</>}
          title="Emoji"
        >
          <div className="cortex-tb-grid-6">
            {EMOJIS.map((c) => (
              <button
                key={c}
                className="cortex-tb-btn"
                onClick={() => {
                  editor.chain().focus().insertContent(c).run();
                  setOpenPopover(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </TbPopover>
        <TbPopover
          isOpen={popoverIsOpen("symbol")}
          onToggle={() => togglePopover("symbol")}
          trigger={<>Σ</>}
          title="Symbol"
        >
          <div className="cortex-tb-grid-6">
            {SYMBOLS.map((c) => (
              <button
                key={c}
                className="cortex-tb-btn"
                onClick={() => {
                  editor.chain().focus().insertContent(c).run();
                  setOpenPopover(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </TbPopover>
        <TbBtn
          onClick={() => {
            const tex = window.prompt("LaTeX (e.g. x^2 + y^2 = z^2):") || "";
            if (tex) {
              editor
                .chain()
                .focus()
                .insertContent(
                  `<span class="cortex-math-inline" data-tex="${tex}">$${tex}$</span>`,
                )
                .run();
            }
          }}
          title="Math equation"
        >
          √
        </TbBtn>
        <TbBtn
          onClick={() => {
            const d = new Date().toLocaleString();
            editor.chain().focus().insertContent(d).run();
          }}
          title="Date / time stamp"
        >
          📅
        </TbBtn>
      </Group>

      {/* Layout group */}
      <Group
        id="layout"
        title="Layout"
        collapsed={isCollapsed("layout")}
        onToggle={toggleGroup}
      >
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "cortexColumns" as any,
                attrs: { count: 2 },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Left" }],
                  },
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Right" }],
                  },
                ],
              })
              .run()
          }
          title="2 columns"
        >
          ⫼
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "cortexColumns" as any,
                attrs: { count: 3 },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "1" }] },
                  { type: "paragraph", content: [{ type: "text", text: "2" }] },
                  { type: "paragraph", content: [{ type: "text", text: "3" }] },
                ],
              })
              .run()
          }
          title="3 columns"
        >
          ⫼⫼
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "cortexSideBySide" as any,
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "A" }] },
                  { type: "paragraph", content: [{ type: "text", text: "B" }] },
                ],
              })
              .run()
          }
          title="Side-by-side"
        >
          ⊞
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              // Cluster 21 v1.1 — panel-per-tab schema. Each tab is
              // its own cortexTabPanel child holding any block+
              // content; the panel owns its title attr.
              //
              // We also append a trailing empty paragraph after the
              // tabs block so the user has somewhere to keep typing
              // below — without it, inserting the tabs block at the
              // end of the document leaves no place to write further
              // prose, and there's no way to "exit" the tabs block
              // by pressing arrow-down at the end of an isolated
              // panel.
              .insertContent([
                {
                  type: "cortexTabsBlock" as any,
                  attrs: { activeTab: 0 },
                  content: [
                    {
                      type: "cortexTabPanel" as any,
                      attrs: { title: "Tab 1" },
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Tab 1 content" },
                          ],
                        },
                      ],
                    },
                    {
                      type: "cortexTabPanel" as any,
                      attrs: { title: "Tab 2" },
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Tab 2 content" },
                          ],
                        },
                      ],
                    },
                  ],
                },
                { type: "paragraph" },
              ])
              .run()
          }
          title="Tabs"
        >
          ⊟
        </TbBtn>
        <TbPopover
          isOpen={popoverIsOpen("deco-glyph")}
          onToggle={() => togglePopover("deco-glyph")}
          trigger={<>❦</>}
          title="Decorative divider"
        >
          {/* Cluster 21 v1.0.3 — glyph picker. Inserts ONLY when
              the user picks a glyph; clicking outside / Esc closes
              without inserting (was a bug previously where Cancel
              still inserted ❦). */}
          <div className="cortex-tb-grid-7">
            {[
              "❦",
              "✦",
              "◆",
              "※",
              "❖",
              "❀",
              "✿",
              "★",
              "☆",
              "•",
              "○",
              "─",
              "═",
              "✧",
            ].map((g) => (
              <button
                key={g}
                className="cortex-tb-btn"
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: "cortexDecoSeparator" as any,
                      attrs: { glyph: g },
                    })
                    .run();
                  setOpenPopover(null);
                }}
                style={{ fontSize: "1.1em" }}
              >
                {g}
              </button>
            ))}
          </div>
        </TbPopover>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "cortexCollapsible" as any,
                attrs: { summary: "Click to expand" },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Hidden content" }],
                  },
                ],
              })
              .run()
          }
          title="Collapsible block"
        >
          ▸
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "cortexMarginNote" as any,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Margin note" }],
                  },
                ],
              })
              .run()
          }
          title="Margin note"
        >
          ⊳
        </TbBtn>
        <TbBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "cortexFrame" as any,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Framed" }],
                  },
                ],
              })
              .run()
          }
          title="Frame"
        >
          ▢
        </TbBtn>
        <TbPopover
          isOpen={popoverIsOpen("callout")}
          onToggle={() => togglePopover("callout")}
          trigger={<>ⓘ</>}
          title="Callout"
        >
          {(["info", "tip", "warning", "danger", "note"] as const).map((v) => (
            <button
              key={v}
              className="cortex-tb-btn"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "cortexCallout" as any,
                    attrs: { variant: v },
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: v.toUpperCase() }],
                      },
                    ],
                  })
                  .run();
                setOpenPopover(null);
              }}
            >
              {v}
            </button>
          ))}
        </TbPopover>
      </Group>

      {/* Utility group */}
      <Group
        id="utility"
        title="Utility"
        collapsed={isCollapsed("utility")}
        onToggle={toggleGroup}
      >
        <TbBtn
          active={findOpen}
          onClick={() => {
            setFindOpen((v) => !v);
            setReplaceMode(false);
          }}
          title="Find (Ctrl+F)"
        >
          🔍
        </TbBtn>
        <TbBtn
          active={findOpen && replaceMode}
          onClick={() => {
            setFindOpen(true);
            setReplaceMode(true);
          }}
          title="Find & replace (Ctrl+H)"
        >
          ⇄
        </TbBtn>
        <TbBtn
          active={outlineOpen}
          onClick={() => setOutlineOpen((v) => !v)}
          title="Outline panel"
        >
          ☰
        </TbBtn>
        <TbBtn
          active={autoReplaceOpen}
          onClick={() => setAutoReplaceOpen(true)}
          title="Auto-replace rules — typed shortcut → symbol substitutions"
        >
          ↔
        </TbBtn>
        <select
          className="cortex-tb-btn"
          value={prefs.zoom}
          onChange={(e) => togglePref("zoom", Number(e.target.value))}
          title="Zoom"
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <TbBtn
          onClick={() => togglePref("readingMode", !prefs.readingMode)}
          title="Reading mode (Ctrl+Alt+R)"
          active={prefs.readingMode}
        >
          📖
        </TbBtn>
        <TbBtn
          onClick={() => togglePref("spellcheck", !prefs.spellcheck)}
          title="Spellcheck (F7)"
          active={prefs.spellcheck}
        >
          ✓
        </TbBtn>
        <TbBtn
          onClick={() => togglePref("pauseAnimations", !prefs.pauseAnimations)}
          title="Pause animations / particles"
          active={prefs.pauseAnimations}
        >
          ⏸
        </TbBtn>
        <TbBtn onClick={() => window.print()} title="Print / save as PDF">
          🖨
        </TbBtn>
        <TbBtn onClick={() => exportDocx(editor, notePath)} title="Export DOCX">
          📄
        </TbBtn>
        <span style={countStyle} title="Words / characters / reading time">
          {counts.words}w · {counts.chars}c · {counts.readingMinutes}m
        </span>
      </Group>

      {/* Cortex group */}
      <Group
        id="cortex"
        title="Cortex"
        collapsed={isCollapsed("cortex")}
        onToggle={toggleGroup}
      >
        {/* Cluster 21 v1.0.4 — all four Cortex block buttons open
            the existing ExperimentBlockModal (the Ctrl+Shift+B
            pipeline). The modal handles type / name / iteration
            entry and inserts the typed block at the cursor. The
            optional `preselectType` is a hint — the modal can
            default its type-picker to it. */}
        <TbBtn
          onClick={() => onOpenBlockModal?.("experiment")}
          title="Insert ::experiment block (Ctrl+Shift+B)"
        >
          🧪
        </TbBtn>
        <TbBtn
          onClick={() => onOpenBlockModal?.("protocol")}
          title="Insert ::protocol block"
        >
          📋
        </TbBtn>
        <TbBtn
          onClick={() => onOpenBlockModal?.("idea")}
          title="Insert ::idea block"
        >
          💡
        </TbBtn>
        <TbBtn
          onClick={() => onOpenBlockModal?.("method")}
          title="Insert ::method block"
        >
          🔬
        </TbBtn>
        <TbBtn
          onClick={() => onInsertWikilink?.()}
          title="Wikilink (Ctrl+Shift+W)"
        >
          [[ ]]
        </TbBtn>
        <TbBtn
          onClick={() => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            editor
              .chain()
              .focus()
              .insertContent(`[[${yyyy}-${mm}-${dd}]]`)
              .run();
          }}
          title="Today's daily-log link"
        >
          📅
        </TbBtn>
        <TbBtn
          onClick={() => onInsertGitHubBlock?.()}
          title="GitHub commits today (Ctrl+Shift+G)"
        >
          🐙
        </TbBtn>
      </Group>

      {/* Polish group */}
      <Group
        id="polish"
        title="Polish"
        collapsed={isCollapsed("polish")}
        onToggle={toggleGroup}
      >
        <select
          className="cortex-tb-btn"
          value={prefs.density}
          onChange={(e) =>
            togglePref("density", e.target.value as ToolbarPrefs["density"])
          }
          title="Density"
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </select>
        <TbBtn
          onClick={() => togglePref("reduceMotion", !prefs.reduceMotion)}
          active={prefs.reduceMotion}
          title="Reduce motion"
        >
          🌊
        </TbBtn>
      </Group>

      {/* Find/replace bar */}
      {findOpen && (
        <FindReplaceBar
          editor={editor}
          query={findQuery}
          replace={replaceQuery}
          replaceMode={replaceMode}
          onQueryChange={setFindQuery}
          onReplaceChange={setReplaceQuery}
          onClose={() => setFindOpen(false)}
        />
      )}
      {outlineOpen && (
        <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />
      )}
      {/* Cluster 21 v1.1 polish — auto-replace rules manager. */}
      {autoReplaceOpen && (
        <AutoReplaceModal onClose={() => setAutoReplaceOpen(false)} />
      )}
    </div>
  );
}

// ---- Sub-components ------------------------------------------------------

function Group({
  id,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "cortex-editor-toolbar-group" + (collapsed ? " collapsed" : "")
      }
      data-group={id}
    >
      <button
        type="button"
        className="cortex-tb-group-title cortex-tb-btn"
        onClick={() => onToggle(id)}
        title={`${collapsed ? "Expand" : "Collapse"} ${title}`}
        style={{ color: "var(--text-muted)", fontSize: "0.7em" }}
      >
        {collapsed ? "▸" : "▾"} {title}
      </button>
      {!collapsed && children}
    </div>
  );
}

function TbBtn({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={"cortex-tb-btn" + (active ? " active" : "")}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function TbPopover({
  isOpen,
  onToggle,
  trigger,
  title,
  children,
}: {
  isOpen: boolean;
  onToggle: () => void;
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={"cortex-tb-btn" + (isOpen ? " active" : "")}
        onClick={onToggle}
        title={title}
      >
        {trigger}
      </button>
      {isOpen && (
        <div
          className="cortex-tb-popover"
          style={{ top: "calc(100% + 4px)", left: 0 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

function ColorPicker({
  recents,
  onPick,
  onReset,
  extraButtons,
}: {
  recents: string[];
  onPick: (hex: string) => void;
  onReset: () => void;
  extraButtons?: React.ReactNode;
}) {
  const [hex, setHex] = useState("#3a86ff");
  return (
    <div>
      <div className="cortex-tb-grid-7">
        {MARK_PALETTE.map((c) => (
          <button
            key={c.hex}
            className="cortex-tb-swatch"
            style={{ background: c.hex }}
            onClick={() => onPick(c.hex)}
            title={c.name}
          />
        ))}
      </div>
      {recents.length > 0 && (
        <>
          <div
            style={{
              fontSize: "0.65rem",
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            Recent
          </div>
          <div className="cortex-tb-grid-7">
            {recents.map((c) => (
              <button
                key={c}
                className="cortex-tb-swatch"
                style={{ background: c }}
                onClick={() => onPick(c)}
              />
            ))}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          style={{ width: 28, height: 24, border: "none" }}
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="cortex-tb-btn"
          style={{ flex: 1 }}
        />
        <button className="cortex-tb-btn" onClick={() => onPick(hex)}>
          Apply
        </button>
        <button className="cortex-tb-btn" onClick={onReset}>
          Reset
        </button>
      </div>
      {extraButtons}
    </div>
  );
}

// ---- Find / Replace bar --------------------------------------------------

function FindReplaceBar({
  editor,
  query,
  replace,
  replaceMode,
  onQueryChange,
  onReplaceChange,
  onClose,
}: {
  editor: Editor;
  query: string;
  replace: string;
  replaceMode: boolean;
  onQueryChange: (v: string) => void;
  onReplaceChange: (v: string) => void;
  onClose: () => void;
}) {
  const [matchCount, setMatchCount] = useState(0);

  // Cluster 21 v1.1 polish — rich-text replace box.
  //
  // The "Replace with" field is a contenteditable div instead of a
  // plain <input>, so users can apply Bold / Italic / Underline /
  // Strike / inline color to the replacement text and have those
  // marks land in the document. The HTML inside the div is captured
  // on every input event and pushed up to the parent via
  // `onReplaceChange`, so the parent's `replace` state is always the
  // current HTML payload.
  //
  // Why a contenteditable + execCommand instead of nesting another
  // TipTap editor here: nesting a second TipTap editor inside the
  // toolbar of the first caused a hard-to-diagnose blank-screen bug
  // on dev startup (heavy module-load chain at the top of the
  // toolbar file). A contenteditable + execCommand is ~30 lines, has
  // zero new imports, and produces clean HTML (<b>/<i>/<u>/<strike>/
  // <font color>) that the editor's parser already understands.
  // execCommand is officially deprecated but every Chromium-based
  // engine — including Tauri's WebView2 — still implements it, and
  // there is no equivalent imperative alternative.
  const replaceRef = useRef<HTMLDivElement | null>(null);

  // Initialize the contenteditable's HTML once on mount (or when the
  // bar is reopened with a stored value). After that, the div owns
  // its own DOM state and we never write to innerHTML again — that
  // would clobber the cursor on each keystroke.
  useEffect(() => {
    const el = replaceRef.current;
    if (!el) return;
    if (el.innerHTML !== replace) el.innerHTML = replace || "";
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply a formatting command (bold/italic/etc.) to the current
  // selection inside the replace box. We focus the box first so the
  // command targets the right element even if the user just clicked
  // a button. After the command, push the new HTML up.
  const applyFmt = (command: string, value?: string) => {
    const el = replaceRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      // execCommand can throw in some sandboxed contexts. Ignore —
      // the user can still type plain text.
    }
    onReplaceChange(el.innerHTML);
  };

  // Simple find: highlight matches in the editor's DOM via the
  // browser's window.find(). Lightweight; v1.1 can do PM decorations.
  const doFind = () => {
    if (!query) return;
    (window as any).find?.(query, false, false, true, false, true, false);
  };

  const doReplaceAll = () => {
    if (!query) return;
    const html = editor.getHTML();
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    const count = (html.match(re) || []).length;
    // Escape the regex-replacement metacharacter `$` in the user's
    // HTML so things like `$&` inside a styled span aren't treated
    // as backreferences. (Most rich-text payloads will never contain
    // `$`, but tag attributes do contain things like `&` which are
    // fine — only `$` is problematic for String.prototype.replace.)
    const safeReplacement = (replace || "").replace(/\$/g, "$$$$");
    const next = html.replace(re, safeReplacement);
    editor.commands.setContent(next, { emitUpdate: true });
    setMatchCount(count);
  };

  return (
    <div className="cortex-find-replace-bar">
      <input
        autoFocus
        placeholder="Find"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") doFind();
          if (e.key === "Escape") onClose();
        }}
      />
      <button className="cortex-tb-btn" onClick={doFind}>
        Find
      </button>
      {replaceMode && (
        <>
          <div className="cortex-find-replace-rich-wrap">
            <div
              ref={replaceRef}
              className="cortex-find-replace-rich-input"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Replace with (rich text)"
              data-placeholder="Replace with"
              onInput={(e) => {
                onReplaceChange((e.target as HTMLDivElement).innerHTML);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
                // Prevent newlines — the replace box is single-line
                // by design (see CSS .cortex-find-replace-rich-input
                // white-space: nowrap).
                if (e.key === "Enter") e.preventDefault();
              }}
            />
            <div className="cortex-find-replace-rich-tools">
              <button
                type="button"
                className="cortex-tb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFmt("bold")}
                title="Bold"
                style={{ fontWeight: 700 }}
              >
                B
              </button>
              <button
                type="button"
                className="cortex-tb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFmt("italic")}
                title="Italic"
                style={{ fontStyle: "italic" }}
              >
                I
              </button>
              <button
                type="button"
                className="cortex-tb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFmt("underline")}
                title="Underline"
                style={{ textDecoration: "underline" }}
              >
                U
              </button>
              <button
                type="button"
                className="cortex-tb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFmt("strikeThrough")}
                title="Strikethrough"
                style={{ textDecoration: "line-through" }}
              >
                S
              </button>
              <input
                type="color"
                title="Text color"
                onMouseDown={(e) => e.preventDefault()}
                onChange={(e) => applyFmt("foreColor", e.target.value)}
                style={{
                  width: 22,
                  height: 22,
                  padding: 0,
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  background: "transparent",
                  cursor: "pointer",
                }}
              />
              <button
                type="button"
                className="cortex-tb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFmt("removeFormat")}
                title="Clear formatting"
              >
                ⨯ᶠ
              </button>
            </div>
          </div>
          <button className="cortex-tb-btn" onClick={doReplaceAll}>
            Replace all
          </button>
          {matchCount > 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
              {matchCount} replaced
            </span>
          )}
        </>
      )}
      <button className="cortex-tb-btn" onClick={onClose} title="Close">
        ✕
      </button>
    </div>
  );
}

// ---- Outline panel -------------------------------------------------------

function OutlinePanel({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    Array<{ level: number; text: string; pos: number }>
  >([]);
  useEffect(() => {
    const update = () => {
      const next: Array<{ level: number; text: string; pos: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          next.push({
            level: Number(node.attrs.level),
            text: node.textContent || "(empty)",
            pos,
          });
        }
        return true;
      });
      setItems(next);
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  return (
    <div className="cortex-outline-panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <strong>Outline</strong>
        <button className="cortex-tb-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {items.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
          No headings yet.
        </div>
      )}
      {items.map((it, i) => (
        <div
          key={`${it.pos}-${i}`}
          className={`cortex-outline-item h${Math.min(3, it.level)}`}
          onClick={() => {
            editor
              .chain()
              .focus()
              .setTextSelection(it.pos + 1)
              .scrollIntoView()
              .run();
          }}
        >
          {it.text}
        </div>
      ))}
    </div>
  );
}

// ---- Live counts ---------------------------------------------------------

function useLiveCounts(editor: Editor | null) {
  const [counts, setCounts] = useState({
    words: 0,
    chars: 0,
    readingMinutes: 0,
  });
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text = editor.state.doc.textContent;
      const words = (text.match(/\S+/g) || []).length;
      const chars = text.length;
      const readingMinutes = Math.max(1, Math.ceil(words / 220));
      setCounts({ words, chars, readingMinutes });
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  return counts;
}

// ---- Multi-color + sprinkle helpers --------------------------------------

function applyMultiColor(editor: Editor, palette: { hex: string }[]): void {
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const text = editor.state.doc.textBetween(from, to);
  const html = Array.from(text)
    .map(
      (ch, i) =>
        `<span style="color: ${palette[i % palette.length].hex}">${ch}</span>`,
    )
    .join("");
  editor.chain().focus().deleteRange({ from, to }).insertContent(html).run();
}

function applyRandomSprinkle(editor: Editor): void {
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const text = editor.state.doc.textBetween(from, to);
  const html = Array.from(text)
    .map((ch) => {
      const hue = Math.floor(Math.random() * 360);
      return `<span style="color: hsl(${hue}, 80%, 55%)">${ch}</span>`;
    })
    .join("");
  editor.chain().focus().deleteRange({ from, to }).insertContent(html).run();
}

// ---- DOCX export ---------------------------------------------------------

async function exportDocx(
  editor: Editor,
  notePath: string | null,
): Promise<void> {
  // v1.0: rough HTML → DOCX conversion via a Blob + the .doc extension.
  // Word will open .doc files containing HTML happily; full .docx
  // (which is a zip with XML inside) lands in v1.1 with a JS lib.
  const html = editor.getHTML();
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  const blob = new Blob(["﻿", wrapped], {
    type: "application/msword",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stem = notePath
    ? (notePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? "note")
    : "note";
  a.download = `${stem}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const countStyle: CSSProperties = {
  marginLeft: "0.4rem",
  color: "var(--text-muted)",
  fontSize: "0.7rem",
  whiteSpace: "nowrap",
};
