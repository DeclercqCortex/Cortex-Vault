// Cluster 21 v1.2 — Math Equation Modal.
//
// v1.2.1 rewrite: the composition area now renders ACTUAL MATH, not
// LaTeX source. Clicking the ∫ button inserts ∫, not "\int_{}^{}";
// clicking α inserts α. LaTeX is purely the output format — the user
// never sees a backslash unless they type one themselves.
//
// How that works:
//
//   The composition area is a `contenteditable` div instead of a
//   textarea. Each palette button has a `display` (the Unicode/HTML
//   shown both on the button AND inserted into the area) and a
//   `latex` (the LaTeX equivalent, never shown). On click we either
//
//     (a) For simple symbols — Greek letters, operators, relations,
//         arrows, set/logic — insert the Unicode glyph as plain
//         text. The user can backspace it like any character.
//
//     (b) For templates — \frac, \sqrt, ^, _, the big-op limit
//         scaffolds — insert a small HTML "atom": an inline-block
//         element with `data-template` plus child slots that are
//         themselves contenteditable. The user can click into the
//         numerator slot and type or click more buttons to fill it.
//         The atom itself is `contenteditable=false` so backspace
//         deletes the whole construct.
//
//     (c) For common-equation presets (quadratic formula, Euler,
//         etc.) — insert an opaque atom carrying the entire LaTeX
//         in `data-latex`. The visual is a best-effort Unicode
//         rendering for in-modal preview; the LaTeX in `data-latex`
//         is what survives to the document.
//
//   On Done we walk the contenteditable's DOM with `htmlToLatex`:
//     - text nodes → mapped through UNICODE_TO_LATEX so α becomes
//       `\alpha`, ∫ becomes `\int`, etc. (chars not in the table
//       pass through, so plain ASCII like `x + y = z` survives).
//     - elements with `data-template` → reconstruct the LaTeX from
//       their slot contents, e.g. `\frac{NUM}{DEN}`.
//     - elements with `data-latex` → emit that string verbatim.
//   The result is the LaTeX string handed up via onDone, where the
//   toolbar inserts a cortexMathBlock and the CSS counter handles
//   numbering.
//
// Centering: still rendered via createPortal to document.body so the
// fixed-positioned scrim escapes any sticky/transformed ancestor.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface MathEquationModalProps {
  /** Initial LaTeX value. Empty for a fresh equation. (We don't yet
   *  parse incoming LaTeX back into the rendered atom layout — for
   *  now we just dump it as plain text in the composition area. The
   *  user can edit / replace as needed.) */
  initial?: string;
  onDone: (latex: string) => void;
  onCancel: () => void;
  /** Optional — when provided, the modal renders a Delete button in
   *  its footer. The toolbar passes this only when in EDIT mode (an
   *  existing math block is being modified), so deleting from the
   *  modal removes that block. v1.2.3. */
  onDelete?: () => void;
}

// ---- Palette types -------------------------------------------------------

type PaletteEntry =
  | {
      kind: "char";
      /** Unicode glyph shown on the button and inserted as text. */
      display: string;
      /** LaTeX command this glyph represents. Used to map back at
       *  Done time and to populate UNICODE_TO_LATEX. */
      latex: string;
      title?: string;
    }
  | {
      kind: "template";
      /** Visible label / mini-render on the button. */
      display: string;
      /** Identifier this atom carries via data-template. The Done
       *  walker uses this to know how to reconstruct LaTeX from the
       *  atom's child slots. */
      template: "frac" | "sqrt" | "nthroot" | "sup" | "sub";
      /** Pretty visualisation of the construct, with editable slots
       *  rendered as small underlined boxes. The Done walker reads
       *  the slots by their class. */
      title?: string;
    }
  | {
      kind: "bigop";
      /** Visible label on the button (compact mini-rendering of the
       *  operator with bounds). */
      display: string;
      /** Operator glyph rendered in the inserted atom. */
      symbol: string;
      /** LaTeX form of the operator (\int, \sum, \prod, \oint, \lim). */
      op: string;
      /** Default value seeded into the lower-bound slot at insert
       *  time. Empty for "fill in yourself"; "i=1" for the Riemann-
       *  sum preset; "x \to a" for limits. */
      defaultLower?: string;
      /** Default value for the upper-bound slot. "n" for Riemann
       *  sum; empty for the others. Limits don't use upper. */
      defaultUpper?: string;
      /** Variant: "limits" (\lim style: only an "under" slot, no
       *  upper) vs "bounds" (\int / \sum / \prod / \oint style:
       *  lower _{} and upper ^{} on either side). */
      variant: "bounds" | "limits";
      title?: string;
    }
  | {
      kind: "preset";
      /** Friendly name shown on the button. */
      display: string;
      /** Best-effort Unicode-only render shown inside the inserted
       *  atom (so the user can recognise it in the composition
       *  area). LaTeX is what's emitted on Done. */
      preview: string;
      latex: string;
      title?: string;
    };

interface PaletteCategory {
  name: string;
  cols: number;
  entries: PaletteEntry[];
}

// ---- Unicode → LaTeX map -------------------------------------------------
//
// Every char that a `kind: "char"` palette entry inserts gets a row
// here so the Done walker can turn it back into LaTeX. Plain ASCII
// (a-z, 0-9, +, -, =, etc.) doesn't need an entry — those pass
// through unchanged. We also include a few extras the user might
// type directly (∞, ∂) for convenience.

const UNICODE_TO_LATEX: Record<string, string> = {
  // Greek lowercase
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  ε: "\\epsilon",
  ζ: "\\zeta",
  η: "\\eta",
  θ: "\\theta",
  ι: "\\iota",
  κ: "\\kappa",
  λ: "\\lambda",
  μ: "\\mu",
  ν: "\\nu",
  ξ: "\\xi",
  π: "\\pi",
  ρ: "\\rho",
  σ: "\\sigma",
  τ: "\\tau",
  υ: "\\upsilon",
  φ: "\\phi",
  χ: "\\chi",
  ψ: "\\psi",
  ω: "\\omega",
  // Greek uppercase
  Γ: "\\Gamma",
  Δ: "\\Delta",
  Θ: "\\Theta",
  Λ: "\\Lambda",
  Ξ: "\\Xi",
  Π: "\\Pi",
  Σ: "\\Sigma",
  Υ: "\\Upsilon",
  Φ: "\\Phi",
  Ψ: "\\Psi",
  Ω: "\\Omega",
  // Operators
  "×": "\\times",
  "÷": "\\div",
  "·": "\\cdot",
  "±": "\\pm",
  "∓": "\\mp",
  "∗": "\\ast",
  "∘": "\\circ",
  "⊕": "\\oplus",
  "⊗": "\\otimes",
  "−": "-", // minus sign → ASCII minus
  // Relations
  "≠": "\\neq",
  "≈": "\\approx",
  "≡": "\\equiv",
  "≤": "\\leq",
  "≥": "\\geq",
  "≪": "\\ll",
  "≫": "\\gg",
  "∝": "\\propto",
  "∼": "\\sim",
  "≃": "\\simeq",
  "≅": "\\cong",
  // Sets / logic
  "∈": "\\in",
  "∉": "\\notin",
  "⊂": "\\subset",
  "⊃": "\\supset",
  "⊆": "\\subseteq",
  "⊇": "\\supseteq",
  "∪": "\\cup",
  "∩": "\\cap",
  "∅": "\\emptyset",
  "∀": "\\forall",
  "∃": "\\exists",
  "∄": "\\nexists",
  "¬": "\\neg",
  "∧": "\\land",
  "∨": "\\lor",
  ℝ: "\\mathbb{R}",
  ℕ: "\\mathbb{N}",
  ℤ: "\\mathbb{Z}",
  ℚ: "\\mathbb{Q}",
  ℂ: "\\mathbb{C}",
  // Arrows
  "→": "\\to",
  "←": "\\leftarrow",
  "↔": "\\leftrightarrow",
  "⇒": "\\Rightarrow",
  "⇐": "\\Leftarrow",
  "⇔": "\\Leftrightarrow",
  "↦": "\\mapsto",
  "↑": "\\uparrow",
  "↓": "\\downarrow",
  // Big operators (typed plain — user fills limits via _ ^ themselves
  // in the composition area, which become subscript / superscript
  // atoms when added via the template buttons)
  "∑": "\\sum",
  "∏": "\\prod",
  "∫": "\\int",
  "∮": "\\oint",
  "⋃": "\\bigcup",
  "⋂": "\\bigcap",
  "∞": "\\infty",
  "∂": "\\partial",
  "∇": "\\nabla",
  "√": "\\surd",
  ℏ: "\\hbar",
};

// ---- Palette content -----------------------------------------------------

const C = (display: string, latex: string, title?: string): PaletteEntry => ({
  kind: "char",
  display,
  latex,
  title: title ?? latex,
});

const GREEK_LOWER: PaletteEntry[] = [
  C("α", "\\alpha"),
  C("β", "\\beta"),
  C("γ", "\\gamma"),
  C("δ", "\\delta"),
  C("ε", "\\epsilon"),
  C("ζ", "\\zeta"),
  C("η", "\\eta"),
  C("θ", "\\theta"),
  C("ι", "\\iota"),
  C("κ", "\\kappa"),
  C("λ", "\\lambda"),
  C("μ", "\\mu"),
  C("ν", "\\nu"),
  C("ξ", "\\xi"),
  C("π", "\\pi"),
  C("ρ", "\\rho"),
  C("σ", "\\sigma"),
  C("τ", "\\tau"),
  C("υ", "\\upsilon"),
  C("φ", "\\phi"),
  C("χ", "\\chi"),
  C("ψ", "\\psi"),
  C("ω", "\\omega"),
];

const GREEK_UPPER: PaletteEntry[] = [
  C("Γ", "\\Gamma"),
  C("Δ", "\\Delta"),
  C("Θ", "\\Theta"),
  C("Λ", "\\Lambda"),
  C("Ξ", "\\Xi"),
  C("Π", "\\Pi"),
  C("Σ", "\\Sigma"),
  C("Υ", "\\Upsilon"),
  C("Φ", "\\Phi"),
  C("Ψ", "\\Psi"),
  C("Ω", "\\Omega"),
];

const OPERATORS: PaletteEntry[] = [
  C("+", "+"),
  C("−", "-"),
  C("×", "\\times"),
  C("÷", "\\div"),
  C("·", "\\cdot"),
  C("±", "\\pm"),
  C("∓", "\\mp"),
  C("∗", "\\ast"),
  C("∘", "\\circ"),
  C("⊕", "\\oplus"),
  C("⊗", "\\otimes"),
];

const RELATIONS: PaletteEntry[] = [
  C("=", "="),
  C("≠", "\\neq"),
  C("≈", "\\approx"),
  C("≡", "\\equiv"),
  C("<", "<"),
  C(">", ">"),
  C("≤", "\\leq"),
  C("≥", "\\geq"),
  C("≪", "\\ll"),
  C("≫", "\\gg"),
  C("∝", "\\propto"),
  C("∼", "\\sim"),
  C("≃", "\\simeq"),
  C("≅", "\\cong"),
];

const SET_LOGIC: PaletteEntry[] = [
  C("∈", "\\in"),
  C("∉", "\\notin"),
  C("⊂", "\\subset"),
  C("⊃", "\\supset"),
  C("⊆", "\\subseteq"),
  C("⊇", "\\supseteq"),
  C("∪", "\\cup"),
  C("∩", "\\cap"),
  C("∅", "\\emptyset"),
  C("ℝ", "\\mathbb{R}"),
  C("ℕ", "\\mathbb{N}"),
  C("ℤ", "\\mathbb{Z}"),
  C("ℚ", "\\mathbb{Q}"),
  C("ℂ", "\\mathbb{C}"),
  C("∀", "\\forall"),
  C("∃", "\\exists"),
  C("∄", "\\nexists"),
  C("¬", "\\neg"),
  C("∧", "\\land"),
  C("∨", "\\lor"),
];

// Plain big-op glyphs (no bounds attached). Use the BIG_OPS_BOUNDS
// section below for the templates with lower/upper slots.
const BIG_OPS: PaletteEntry[] = [
  C("∑", "\\sum"),
  C("∏", "\\prod"),
  C("∫", "\\int"),
  C("∮", "\\oint"),
  C("⋃", "\\bigcup"),
  C("⋂", "\\bigcap"),
  C("∞", "\\infty"),
  C("∂", "\\partial"),
  C("∇", "\\nabla"),
  C("ℏ", "\\hbar"),
];

// Big operators WITH bounds (the user explicitly asked for these in
// v1.2.2 — definite integrals, Riemann sums, etc.). The "Riemann
// sum" preset is the same template seeded with i=1 / n so it drops
// in as a finished construct the user just types into.
const BIG_OPS_BOUNDS: PaletteEntry[] = [
  {
    kind: "bigop",
    display: "∫ₐᵇ",
    symbol: "∫",
    op: "\\int",
    variant: "bounds",
    title: "Definite integral \\int_{a}^{b}",
  },
  {
    kind: "bigop",
    display: "Σₐᵇ",
    symbol: "∑",
    op: "\\sum",
    variant: "bounds",
    title: "Sum with bounds \\sum_{a}^{b}",
  },
  {
    kind: "bigop",
    display: "Σᵢ₌₁ⁿ",
    symbol: "∑",
    op: "\\sum",
    defaultLower: "i=1",
    defaultUpper: "n",
    variant: "bounds",
    title: "Riemann sum \\sum_{i=1}^{n} (finite n terms)",
  },
  {
    kind: "bigop",
    display: "∏ₐᵇ",
    symbol: "∏",
    op: "\\prod",
    variant: "bounds",
    title: "Product with bounds \\prod_{a}^{b}",
  },
  {
    kind: "bigop",
    display: "∮ₐᵇ",
    symbol: "∮",
    op: "\\oint",
    variant: "bounds",
    title: "Contour integral \\oint_{a}^{b}",
  },
  {
    kind: "bigop",
    display: "⋃ₐᵇ",
    symbol: "⋃",
    op: "\\bigcup",
    variant: "bounds",
    title: "Big union \\bigcup_{a}^{b}",
  },
  {
    kind: "bigop",
    display: "⋂ₐᵇ",
    symbol: "⋂",
    op: "\\bigcap",
    variant: "bounds",
    title: "Big intersection \\bigcap_{a}^{b}",
  },
  {
    kind: "bigop",
    display: "lim",
    symbol: "lim",
    op: "\\lim",
    defaultLower: "x \\to a",
    variant: "limits",
    title: "Limit \\lim_{x \\to a}",
  },
];

const ARROWS: PaletteEntry[] = [
  C("→", "\\to"),
  C("←", "\\leftarrow"),
  C("↔", "\\leftrightarrow"),
  C("⇒", "\\Rightarrow"),
  C("⇐", "\\Leftarrow"),
  C("⇔", "\\Leftrightarrow"),
  C("↦", "\\mapsto"),
  C("↑", "\\uparrow"),
  C("↓", "\\downarrow"),
];

const TEMPLATES: PaletteEntry[] = [
  {
    kind: "template",
    display: "□/□",
    template: "frac",
    title: "Fraction (numerator over denominator)",
  },
  {
    kind: "template",
    display: "√□",
    template: "sqrt",
    title: "Square root",
  },
  {
    kind: "template",
    display: "ⁿ√□",
    template: "nthroot",
    title: "n-th root",
  },
  {
    kind: "template",
    display: "x²",
    template: "sup",
    title: "Superscript",
  },
  {
    kind: "template",
    display: "xₙ",
    template: "sub",
    title: "Subscript",
  },
];

const COMMON_EQUATIONS: PaletteEntry[] = [
  {
    kind: "preset",
    display: "Quadratic",
    preview: "x = (−b ± √(b²−4ac)) / 2a",
    latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  },
  {
    kind: "preset",
    display: "Pythagoras",
    preview: "a² + b² = c²",
    latex: "a^2 + b^2 = c^2",
  },
  {
    kind: "preset",
    display: "Euler",
    preview: "e^(iπ) + 1 = 0",
    latex: "e^{i\\pi} + 1 = 0",
  },
  {
    kind: "preset",
    display: "Mass-energy",
    preview: "E = mc²",
    latex: "E = mc^2",
  },
  {
    kind: "preset",
    display: "Newton II",
    preview: "F = ma",
    latex: "F = ma",
  },
  {
    kind: "preset",
    display: "Gauss",
    preview: "∮ E · dA = Q/ε₀",
    latex: "\\oint_S \\vec{E} \\cdot d\\vec{A} = \\frac{Q}{\\epsilon_0}",
  },
  {
    kind: "preset",
    display: "Schrödinger",
    preview: "iℏ ∂ψ/∂t = Ĥψ",
    latex: "i\\hbar \\frac{\\partial}{\\partial t} \\Psi = \\hat{H} \\Psi",
  },
  {
    kind: "preset",
    display: "Mean",
    preview: "x̄ = (1/n) Σ xᵢ",
    latex: "\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i",
  },
  {
    kind: "preset",
    display: "Std dev",
    preview: "σ = √((1/n) Σ (xᵢ − x̄)²)",
    latex: "\\sigma = \\sqrt{\\frac{1}{n} \\sum_{i=1}^{n} (x_i - \\bar{x})^2}",
  },
];

const PALETTE: PaletteCategory[] = [
  { name: "Greek (lowercase)", cols: 12, entries: GREEK_LOWER },
  { name: "Greek (uppercase)", cols: 12, entries: GREEK_UPPER },
  { name: "Operators", cols: 12, entries: OPERATORS },
  { name: "Relations", cols: 12, entries: RELATIONS },
  { name: "Sets & Logic", cols: 10, entries: SET_LOGIC },
  { name: "Arrows", cols: 10, entries: ARROWS },
  { name: "Big operators", cols: 10, entries: BIG_OPS },
  {
    name: "With bounds (∫, Σ, Riemann sum, lim)",
    cols: 4,
    entries: BIG_OPS_BOUNDS,
  },
  { name: "Templates", cols: 5, entries: TEMPLATES },
  { name: "Common equations", cols: 4, entries: COMMON_EQUATIONS },
];

// ---- Component -----------------------------------------------------------

export function MathEquationModal({
  initial = "",
  onDone,
  onCancel,
  onDelete,
}: MathEquationModalProps) {
  const inputRef = useRef<HTMLDivElement | null>(null);
  // Live count of children — used to disable Done while empty so the
  // user doesn't accidentally insert a blank math block.
  const [hasContent, setHasContent] = useState(initial.length > 0);

  // On mount: focus the composition area and seed it with the
  // initial value (just plain text — we don't try to parse incoming
  // LaTeX into atoms yet).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (initial) el.textContent = initial;
    el.focus();
    placeCursorAtEnd(el);
  }, [initial]);

  const refreshHasContent = () => {
    const el = inputRef.current;
    setHasContent(!!el && (el.textContent ?? "").trim().length > 0);
  };

  // Insert a palette entry into the contenteditable at the current
  // cursor position. Re-focuses the area first so cursor math works
  // even if the user clicked the button (mousedown.preventDefault on
  // the button keeps focus, but focus() is cheap insurance).
  const insertEntry = (entry: PaletteEntry) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (entry.kind === "char") {
      execInsertText(entry.display);
    } else if (entry.kind === "template") {
      const html = templateHtml(entry.template);
      const inserted = execInsertHtml(html);
      if (inserted) {
        const firstSlot =
          inserted.querySelector<HTMLElement>(".cortex-math-slot");
        if (firstSlot) placeCursorAtEnd(firstSlot);
      }
    } else if (entry.kind === "bigop") {
      const html = bigopHtml(entry);
      const inserted = execInsertHtml(html);
      if (inserted) {
        // For pre-seeded variants (Riemann sum, lim), place cursor
        // OUTSIDE the atom so the user can keep typing. For empty-
        // bound variants, drop into the lower slot to fill in.
        if (entry.defaultLower) {
          // Cursor AFTER the atom so the user types the integrand /
          // summand next.
          placeCursorAfter(inserted);
        } else {
          const lower = inserted.querySelector<HTMLElement>(
            ".cortex-math-bigop-lower",
          );
          if (lower) placeCursorAtEnd(lower);
        }
      }
    } else {
      // preset
      const html = presetHtml(entry.display, entry.preview, entry.latex);
      execInsertHtml(html);
    }
    refreshHasContent();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const latex = htmlToLatex(inputRef.current);
      if (latex.trim()) onDone(latex);
    }
    // Plain Enter inside the contenteditable inserts a <br>; we
    // override to a no-op for now so multi-line equations don't
    // produce stray break markers in the output. Users typing
    // align/cases environments can still get newlines via the
    // Common-equation presets which embed them as LaTeX.
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
    }
  };

  const node = (
    <div style={styles.scrim} onClick={onCancel}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Insert math equation"
      >
        <div style={styles.headerRow}>
          <h2 style={styles.heading}>Insert math equation</h2>
          <span style={styles.headerHint}>
            Click symbols to insert · Ctrl+Enter to finish
          </span>
        </div>

        <div style={styles.paletteWrap}>
          {PALETTE.map((cat) => (
            <PaletteSection
              key={cat.name}
              category={cat}
              onInsert={insertEntry}
            />
          ))}
        </div>

        <div
          ref={inputRef}
          className="cortex-math-input"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Equation composition area"
          spellCheck={false}
          style={styles.input}
          onInput={refreshHasContent}
          data-placeholder="Click a symbol above, or type your equation here. The (rendered) math is what you'll see in the document."
        />

        <div style={styles.footer}>
          <button onClick={onCancel} style={styles.btnGhost}>
            Cancel
          </button>
          {onDelete && (
            <button
              onClick={() => {
                // Confirm here because the user may have typed an
                // edit they wanted to keep — losing it accidentally
                // would be costly. The right-click context menu
                // skips this confirm since the user explicitly
                // chose Delete from a focused menu.
                if (
                  window.confirm(
                    "Delete this equation? This cannot be undone (other than Ctrl+Z).",
                  )
                ) {
                  onDelete();
                }
              }}
              style={styles.btnDanger}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              const latex = htmlToLatex(inputRef.current);
              if (latex.trim()) onDone(latex);
            }}
            style={styles.btnPrimary}
            disabled={!hasContent}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}

// ---- Sub-components ------------------------------------------------------

function PaletteSection({
  category,
  onInsert,
}: {
  category: PaletteCategory;
  onInsert: (e: PaletteEntry) => void;
}) {
  const gridStyle = useMemo<React.CSSProperties>(
    () => ({
      ...styles.paletteGrid,
      gridTemplateColumns: `repeat(${category.cols}, minmax(0, 1fr))`,
    }),
    [category.cols],
  );
  return (
    <div style={styles.paletteSection}>
      <div style={styles.paletteSectionLabel}>{category.name}</div>
      <div style={gridStyle}>
        {category.entries.map((e, i) => (
          <button
            key={`${e.kind}-${i}`}
            onClick={() => onInsert(e)}
            // mousedown.preventDefault keeps focus in the input so
            // the cursor position survives the click.
            onMouseDown={(ev) => ev.preventDefault()}
            style={styles.paletteBtn}
            title={e.title ?? e.display}
          >
            {e.display}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Insertion / DOM helpers --------------------------------------------

function execInsertText(text: string) {
  // execCommand is deprecated but still works in WebView2 / Chromium.
  // It correctly preserves the existing selection and undo stack.
  document.execCommand("insertText", false, text);
}

function execInsertHtml(html: string): HTMLElement | null {
  // We wrap the html in a uniquely-id'd outer span so we can find
  // the inserted element after the command runs. Otherwise selection
  // math gets fiddly.
  const id = `__cm_${Math.random().toString(36).slice(2)}`;
  const wrapped = `<span id="${id}">${html}</span>`;
  document.execCommand("insertHTML", false, wrapped);
  const wrapper = document.getElementById(id);
  if (!wrapper) return null;
  // Unwrap: move children up and remove the wrapper. The first child
  // is the atom we want a handle to.
  const firstChild = wrapper.firstElementChild as HTMLElement | null;
  while (wrapper.firstChild) {
    wrapper.parentNode!.insertBefore(wrapper.firstChild, wrapper);
  }
  wrapper.remove();
  return firstChild;
}

function placeCursorAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Place the cursor immediately AFTER `el` in its parent. Used for
 *  pre-seeded big-op atoms (Riemann sum, lim) so the user can type
 *  the integrand/summand next. */
function placeCursorAfter(el: HTMLElement) {
  const range = document.createRange();
  if (!el.parentNode) return;
  range.setStartAfter(el);
  range.setEndAfter(el);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- Template HTML -------------------------------------------------------
//
// Inline-block atoms with editable inner slots. Class names on the
// slots (`cortex-math-slot` + a role-specific class) are how the
// Done walker knows what to read out. The atoms themselves are
// `contenteditable=false` so backspace deletes the whole construct.

function templateHtml(
  template: "frac" | "sqrt" | "nthroot" | "sup" | "sub",
): string {
  switch (template) {
    case "frac":
      return `<span class="cortex-math-atom cortex-math-frac" data-template="frac" contenteditable="false"><span class="cortex-math-slot cortex-math-num" contenteditable="true"></span><span class="cortex-math-bar"></span><span class="cortex-math-slot cortex-math-den" contenteditable="true"></span></span>`;
    case "sqrt":
      return `<span class="cortex-math-atom cortex-math-sqrt" data-template="sqrt" contenteditable="false"><span class="cortex-math-radical">√</span><span class="cortex-math-slot cortex-math-arg" contenteditable="true"></span></span>`;
    case "nthroot":
      return `<span class="cortex-math-atom cortex-math-nthroot" data-template="nthroot" contenteditable="false"><span class="cortex-math-slot cortex-math-idx" contenteditable="true"></span><span class="cortex-math-radical">√</span><span class="cortex-math-slot cortex-math-arg" contenteditable="true"></span></span>`;
    case "sup":
      return `<span class="cortex-math-atom cortex-math-sup" data-template="sup" contenteditable="false"><span class="cortex-math-slot cortex-math-arg" contenteditable="true"></span></span>`;
    case "sub":
      return `<span class="cortex-math-atom cortex-math-sub" data-template="sub" contenteditable="false"><span class="cortex-math-slot cortex-math-arg" contenteditable="true"></span></span>`;
  }
}

/** Build the HTML for a big-operator-with-bounds atom.
 *
 * "bounds" variant (∫, Σ, ∏, ∮, ⋃, ⋂): operator glyph on the left,
 * a stacked column on the right with upper-bound on top of lower-
 * bound. Renders as `<op>_{lower}^{upper}` in LaTeX.
 *
 * "limits" variant (\lim): operator glyph on top, single under-slot
 * below. Renders as `\lim_{lower}` (no upper).
 */
function bigopHtml(entry: {
  kind: "bigop";
  symbol: string;
  op: string;
  defaultLower?: string;
  defaultUpper?: string;
  variant: "bounds" | "limits";
}): string {
  const lo = escapeHtml(entry.defaultLower ?? "");
  const up = escapeHtml(entry.defaultUpper ?? "");
  const opAttr = escapeHtml(entry.op);
  const variantAttr = entry.variant;
  const sym = escapeHtml(entry.symbol);
  if (entry.variant === "bounds") {
    return (
      `<span class="cortex-math-atom cortex-math-bigop cortex-math-bigop-bounds" ` +
      `data-template="bigop" data-variant="${variantAttr}" data-op="${opAttr}" contenteditable="false">` +
      `<span class="cortex-math-bigop-sym">${sym}</span>` +
      `<span class="cortex-math-bigop-stack">` +
      `<span class="cortex-math-slot cortex-math-bigop-upper" contenteditable="true">${up}</span>` +
      `<span class="cortex-math-slot cortex-math-bigop-lower" contenteditable="true">${lo}</span>` +
      `</span>` +
      `</span>`
    );
  }
  // limits variant — symbol stacked above the under-slot.
  return (
    `<span class="cortex-math-atom cortex-math-bigop cortex-math-bigop-limits" ` +
    `data-template="bigop" data-variant="${variantAttr}" data-op="${opAttr}" contenteditable="false">` +
    `<span class="cortex-math-bigop-sym">${sym}</span>` +
    `<span class="cortex-math-slot cortex-math-bigop-lower" contenteditable="true">${lo}</span>` +
    `</span>`
  );
}

function presetHtml(name: string, preview: string, latex: string): string {
  // Escape the latex value for safe attribute embedding.
  const safe = latex
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Preview text: show the Unicode-rendered approximation. The
  // full LaTeX is held in data-latex and emitted verbatim on Done.
  return `<span class="cortex-math-atom cortex-math-preset" data-latex="${safe}" contenteditable="false" title="${name}">${escapeHtml(preview)}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- DOM → LaTeX walker --------------------------------------------------

function htmlToLatex(root: Node | null): string {
  if (!root) return "";
  return Array.from(root.childNodes).map(nodeToLatex).join("");
}

function nodeToLatex(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return unicodeToLatex(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;

  // Opaque preset — emit the raw LaTeX.
  if (el.dataset.latex && !el.dataset.template) {
    return el.dataset.latex;
  }

  const t = el.dataset.template;
  if (t === "frac") {
    const num = readSlot(el, ".cortex-math-num");
    const den = readSlot(el, ".cortex-math-den");
    return `\\frac{${num}}{${den}}`;
  }
  if (t === "sqrt") {
    const arg = readSlot(el, ".cortex-math-arg");
    return `\\sqrt{${arg}}`;
  }
  if (t === "nthroot") {
    const idx = readSlot(el, ".cortex-math-idx");
    const arg = readSlot(el, ".cortex-math-arg");
    return `\\sqrt[${idx}]{${arg}}`;
  }
  if (t === "sup") {
    const arg = readSlot(el, ".cortex-math-arg");
    return `^{${arg}}`;
  }
  if (t === "sub") {
    const arg = readSlot(el, ".cortex-math-arg");
    return `_{${arg}}`;
  }
  if (t === "bigop") {
    const op = el.dataset.op || "";
    const variant = el.dataset.variant || "bounds";
    const lower = readSlot(el, ".cortex-math-bigop-lower");
    if (variant === "limits") {
      // \lim_{x \to a} — only the lower (under) slot.
      return lower ? `${op}_{${lower}}` : op;
    }
    // bounds variant: \int_{lo}^{up} / \sum_{lo}^{up} / etc.
    const upper = readSlot(el, ".cortex-math-bigop-upper");
    let out = op;
    if (lower) out += `_{${lower}}`;
    if (upper) out += `^{${upper}}`;
    return out;
  }

  // Generic element — recurse into children and concatenate.
  return Array.from(el.childNodes).map(nodeToLatex).join("");
}

function readSlot(parent: HTMLElement, selector: string): string {
  const slot = parent.querySelector(selector);
  if (!slot) return "";
  return htmlToLatex(slot);
}

function unicodeToLatex(s: string): string {
  let out = "";
  for (const ch of s) {
    const mapped = UNICODE_TO_LATEX[ch];
    if (mapped) {
      // Pad LaTeX commands with a trailing space so consecutive
      // commands don't run together (`\alpha\beta` is fine but
      // `\alphabeta` is one undefined command). The space gets
      // collapsed by LaTeX's tokenizer at render time.
      out += mapped.startsWith("\\") ? mapped + " " : mapped;
    } else {
      out += ch;
    }
  }
  return out;
}

// ---- Styles --------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim, rgba(0,0,0,0.4))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    width: "min(820px, 92vw)",
    maxHeight: "84vh",
    display: "flex",
    flexDirection: "column",
    padding: "1.1rem 1.35rem 0.9rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow, 0 12px 40px rgba(0,0,0,0.35))",
    overflow: "hidden",
  },
  headerRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: "0.6rem",
    gap: "0.5rem",
  },
  heading: {
    margin: 0,
    fontSize: "1.05rem",
    fontWeight: 600,
  },
  headerHint: {
    fontSize: "0.74rem",
    color: "var(--text-muted)",
  },
  paletteWrap: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingRight: "4px",
    marginBottom: "0.7rem",
    border: "1px solid var(--border-2)",
    borderRadius: "6px",
    padding: "0.4rem 0.55rem",
    background: "var(--bg-deep)",
  },
  paletteSection: {
    marginBottom: "0.7rem",
  },
  paletteSectionLabel: {
    fontSize: "0.68rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    fontWeight: 600,
    marginBottom: "0.25rem",
  },
  paletteGrid: {
    display: "grid",
    gap: "3px",
  },
  paletteBtn: {
    cursor: "pointer",
    background: "var(--bg)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    padding: "4px 6px",
    fontSize: "0.92rem",
    color: "var(--text)",
    fontFamily: "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', serif",
    minHeight: "26px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  input: {
    flexShrink: 0,
    minHeight: "92px",
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "0.7rem 0.9rem",
    fontFamily:
      "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', ui-serif, Georgia, serif",
    fontSize: "1.15rem",
    lineHeight: 1.7,
    outline: "none",
    overflow: "auto",
  },
  footer: {
    marginTop: "0.7rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  btnGhost: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "var(--primary)",
    color: "var(--on-primary, #fff)",
    border: "1px solid var(--primary)",
    borderRadius: "4px",
    fontWeight: 600,
  },
  // v1.2.3 — Delete button used when editing an existing equation.
  btnDanger: {
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: "4px",
    fontWeight: 500,
  },
};
