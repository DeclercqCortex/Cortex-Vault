// Cluster 21 v1.1 polish — Cortex Auto-Replace.
//
// Inline text → symbol substitutions that fire as the user types.
// Two layers of rules:
//
//   1. CORTEX_AUTOREPLACE_BUILTIN — the curated set baked into the
//      app (arrows, comparison operators, math, Greek letters, common
//      typography). These are read-only.
//
//   2. User rules — { before, after } pairs the user added in the
//      AutoReplace modal. Persisted to localStorage at
//      `cortex:autoreplace:user-rules`. Read on every keystroke so
//      additions take effect immediately, without remounting the
//      editor.
//
// Implementation:
//
// We use a custom ProseMirror plugin with `handleTextInput` instead
// of TipTap's `textInputRule` helper. `textInputRule` caches its
// regex list at extension-construction time, which means a new user
// rule wouldn't take effect until the editor was re-created.
// `handleTextInput` lets us consult a fresh rule list (built-ins +
// localStorage) on each keystroke at the cost of one JSON parse per
// keystroke — negligible.
//
// Matching: literal `endsWith` against the text immediately before
// the cursor. We deliberately avoid regex in user rules to keep the
// "Before" input intuitive (no need to escape regex metacharacters).
// Built-in rules also use literal triggers for uniformity. Longer
// patterns are checked first so `<--> ` matches before `--> `.
//
// Trigger character: every rule's `before` should END with whatever
// character is meant to fire the replacement (typically a space, but
// could be a punctuation character). The replacement preserves the
// trigger naturally because the trigger is part of the substitution
// string in `after`.
//
// Undo behavior: each replacement dispatches one transaction, so
// Ctrl+Z reverts the substitution to the original characters.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";

export const AUTOREPLACE_LS_KEY = "cortex:autoreplace:user-rules";
export const AUTOREPLACE_DISABLED_LS_KEY =
  "cortex:autoreplace:disabled-builtins";
export const AUTOREPLACE_CHANGED_EVENT = "cortex:autoreplace-changed";

export interface AutoReplaceRule {
  /** Literal trigger string. Must include the trailing trigger char
   *  (typically a space). Example: "--> ". */
  before: string;
  /** Replacement string. Should normally include the same trailing
   *  char so the trigger is preserved. Example: "→ ". */
  after: string;
  /** Cluster 21 v1.2 — optional rich-content replacement. When present,
   *  the input-rule handler parses this HTML through the editor's
   *  schema into a ProseMirror Slice and replaces the matched range
   *  with the resulting nodes. Supports structural blocks (Frame /
   *  Tabs / Callout / Columns / Collapsible / etc.) and rich marks
   *  (font, color, effects, particles).
   *
   *  When absent (every built-in plus most user rules), the plain
   *  `after` string is used via the textInputRule path — same
   *  behavior as v1.0/v1.1.
   *
   *  The plain `after` field is still required even when `afterHtml`
   *  is present: it serves as the textual fallback shown in the
   *  rule list, and as a sensible default if the schema parser
   *  can't make sense of the HTML for some reason. */
  afterHtml?: string;
  /** Optional category label for grouping in the UI. Built-ins only. */
  category?: string;
}

// Built-in rules — keep ordered by category for the modal's grouped
// display. Sort by length DESC happens at use time, so display order
// here doesn't affect matching priority.
export const CORTEX_AUTOREPLACE_BUILTIN: AutoReplaceRule[] = [
  // Bidirectional arrows (3-char)
  { before: "<--> ", after: "↔ ", category: "Arrows" },
  { before: "<==> ", after: "⇔ ", category: "Arrows" },

  // Right-pointing arrows
  { before: "--> ", after: "→ ", category: "Arrows" },
  { before: "==> ", after: "⇒ ", category: "Arrows" },
  { before: "->> ", after: "↠ ", category: "Arrows" },

  // Left-pointing arrows
  { before: "<-- ", after: "← ", category: "Arrows" },
  { before: "<== ", after: "⇐ ", category: "Arrows" },

  // Comparison operators
  { before: "<= ", after: "≤ ", category: "Comparison" },
  { before: ">= ", after: "≥ ", category: "Comparison" },
  { before: "!= ", after: "≠ ", category: "Comparison" },

  // Math / approximation
  { before: "+- ", after: "± ", category: "Math" },
  { before: "-+ ", after: "∓ ", category: "Math" },
  { before: "~= ", after: "≈ ", category: "Math" },
  { before: "=~ ", after: "≅ ", category: "Math" },

  // Set / logic / definition
  { before: ":= ", after: "≔ ", category: "Math" },
  { before: "=: ", after: "≕ ", category: "Math" },

  // Typography
  { before: "... ", after: "… ", category: "Typography" },
  { before: "--- ", after: "— ", category: "Typography" }, // em-dash
  { before: "-- ", after: "– ", category: "Typography" }, // en-dash

  // Fractions
  { before: "1/2 ", after: "½ ", category: "Fractions" },
  { before: "1/3 ", after: "⅓ ", category: "Fractions" },
  { before: "2/3 ", after: "⅔ ", category: "Fractions" },
  { before: "1/4 ", after: "¼ ", category: "Fractions" },
  { before: "3/4 ", after: "¾ ", category: "Fractions" },

  // Common symbols
  { before: "(c) ", after: "© ", category: "Symbols" },
  { before: "(r) ", after: "® ", category: "Symbols" },
  { before: "(tm) ", after: "™ ", category: "Symbols" },
  { before: "(deg) ", after: "° ", category: "Symbols" },

  // Greek letters (LaTeX-style shorthand)
  { before: "\\alpha ", after: "α ", category: "Greek" },
  { before: "\\beta ", after: "β ", category: "Greek" },
  { before: "\\gamma ", after: "γ ", category: "Greek" },
  { before: "\\delta ", after: "δ ", category: "Greek" },
  { before: "\\epsilon ", after: "ε ", category: "Greek" },
  { before: "\\theta ", after: "θ ", category: "Greek" },
  { before: "\\lambda ", after: "λ ", category: "Greek" },
  { before: "\\mu ", after: "μ ", category: "Greek" },
  { before: "\\pi ", after: "π ", category: "Greek" },
  { before: "\\rho ", after: "ρ ", category: "Greek" },
  { before: "\\sigma ", after: "σ ", category: "Greek" },
  { before: "\\tau ", after: "τ ", category: "Greek" },
  { before: "\\phi ", after: "φ ", category: "Greek" },
  { before: "\\omega ", after: "ω ", category: "Greek" },
  { before: "\\Delta ", after: "Δ ", category: "Greek" },
  { before: "\\Sigma ", after: "Σ ", category: "Greek" },
  { before: "\\Omega ", after: "Ω ", category: "Greek" },

  // Math operators
  { before: "\\inf ", after: "∞ ", category: "Math" },
  { before: "\\sum ", after: "Σ ", category: "Math" },
  { before: "\\prod ", after: "∏ ", category: "Math" },
  { before: "\\int ", after: "∫ ", category: "Math" },
  { before: "\\sqrt ", after: "√ ", category: "Math" },
  { before: "\\partial ", after: "∂ ", category: "Math" },
];

/** Read user-added rules from localStorage. Returns [] on parse failure.
 *  Cluster 21 v1.2 — also reads the optional `afterHtml` field for
 *  rich-content rules. Older entries without `afterHtml` round-trip
 *  unchanged. */
export function readUserAutoReplaceRules(): AutoReplaceRule[] {
  try {
    const raw = localStorage.getItem(AUTOREPLACE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is AutoReplaceRule =>
          r &&
          typeof r === "object" &&
          typeof r.before === "string" &&
          typeof r.after === "string" &&
          r.before.length > 0,
      )
      .map((r) => {
        // Strip / coerce afterHtml to a string|undefined.
        const out: AutoReplaceRule = { before: r.before, after: r.after };
        if (typeof (r as { afterHtml?: unknown }).afterHtml === "string") {
          out.afterHtml = (r as { afterHtml?: string }).afterHtml;
        }
        if (typeof (r as { category?: unknown }).category === "string") {
          out.category = (r as { category?: string }).category;
        }
        return out;
      });
  } catch {
    return [];
  }
}

/** Persist user rules and broadcast a change event for any listening UIs. */
export function writeUserAutoReplaceRules(rules: AutoReplaceRule[]) {
  try {
    localStorage.setItem(AUTOREPLACE_LS_KEY, JSON.stringify(rules));
  } catch {
    /* localStorage may be unavailable; in-session changes still apply */
  }
  try {
    window.dispatchEvent(new Event(AUTOREPLACE_CHANGED_EVENT));
  } catch {
    /* SSR or sandboxed contexts */
  }
}

/** Read the set of built-in `before` strings the user has disabled.
 *  A disabled built-in is filtered out of getActiveRules(). The user
 *  can also override a built-in by adding a user rule with the same
 *  `before` — see getActiveRules. */
export function readDisabledBuiltins(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTOREPLACE_DISABLED_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s): s is string => typeof s === "string"));
  } catch {
    return new Set();
  }
}

export function writeDisabledBuiltins(set: Set<string>) {
  try {
    localStorage.setItem(AUTOREPLACE_DISABLED_LS_KEY, JSON.stringify([...set]));
  } catch {
    /* localStorage may be unavailable */
  }
  try {
    window.dispatchEvent(new Event(AUTOREPLACE_CHANGED_EVENT));
  } catch {
    /* SSR or sandboxed contexts */
  }
}

/** Reset everything: clear user rules and the disabled-builtins set.
 *  Brings the pipeline back to the shipped defaults. */
export function resetAutoReplaceToDefaults() {
  try {
    localStorage.removeItem(AUTOREPLACE_LS_KEY);
    localStorage.removeItem(AUTOREPLACE_DISABLED_LS_KEY);
  } catch {
    /* localStorage may be unavailable */
  }
  try {
    window.dispatchEvent(new Event(AUTOREPLACE_CHANGED_EVENT));
  } catch {
    /* SSR or sandboxed contexts */
  }
}

/** Combined active rule list, sorted by `before` length DESC so
 *  longer patterns (e.g. `<--> `) match before shorter ones (`--> `).
 *
 *  Conflict resolution between the two layers:
 *   - If a `before` appears in BOTH the disabled-builtins set and the
 *     built-in list, the built-in is filtered out.
 *   - If a `before` appears in BOTH the built-in list and a user
 *     rule, the user rule wins (override) and the built-in is
 *     filtered out — even if it isn't in the disabled set.
 */
function getActiveRules(): AutoReplaceRule[] {
  const disabled = readDisabledBuiltins();
  const userRules = readUserAutoReplaceRules();
  const userBefores = new Set(userRules.map((r) => r.before));
  const builtinActive = CORTEX_AUTOREPLACE_BUILTIN.filter(
    (r) => !disabled.has(r.before) && !userBefores.has(r.before),
  );
  const all = [...builtinActive, ...userRules];
  return all
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const d = b.r.before.length - a.r.before.length;
      if (d !== 0) return d;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

const pluginKey = new PluginKey("cortexAutoReplace");

export const CortexAutoReplace = Extension.create({
  name: "cortexAutoReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          // Fires for every text-input event. We look at the text
          // immediately before the cursor + the new char and check
          // whether any rule's `before` matches at the end of that
          // window. If so, we replace the matched range with `after`.
          handleTextInput(view, from, to, text) {
            if (text.length === 0) return false;

            const rules = getActiveRules();
            if (rules.length === 0) return false;

            const $from = view.state.doc.resolve(from);
            // Pull up to 32 chars before the cursor from the same
            // text-block parent. This bounds the work per keystroke
            // while comfortably covering all built-in patterns plus
            // typical user rules.
            const lookbackLen = 32;
            const blockStart = $from.start();
            const start = Math.max(blockStart, from - lookbackLen);
            const before = view.state.doc.textBetween(start, from, "\n", "\n");
            const candidate = before + text;

            for (const rule of rules) {
              if (candidate.endsWith(rule.before)) {
                const matchLen = rule.before.length;
                // Compute the start of the matched range in the doc.
                // The newly-typed `text` accounts for `text.length`
                // characters at the end; the rest comes from the
                // existing doc.
                const replaceFrom = from - (matchLen - text.length);
                if (replaceFrom < blockStart) continue; // out of block

                // Cluster 21 v1.2 — RICH-CONTENT path. When the rule
                // carries an afterHtml string, parse it through the
                // editor's schema into a ProseMirror Slice and replace
                // the matched range with the resulting nodes. Lets the
                // user expand a trigger like `--frame-- ` into a real
                // Frame block, or `--tabs-- ` into a Tabs container,
                // by editing the rule's "after" with the rich editor.
                if (rule.afterHtml && rule.afterHtml.length > 0) {
                  try {
                    const tmp = document.createElement("div");
                    tmp.innerHTML = rule.afterHtml;
                    const pmParser = PMDOMParser.fromSchema(view.state.schema);
                    const slice = pmParser.parseSlice(tmp);
                    const tr = view.state.tr.replaceRange(
                      replaceFrom,
                      to,
                      slice,
                    );
                    tr.setMeta("cortexAutoReplace", true);
                    view.dispatch(tr);
                    return true;
                  } catch {
                    // Fall through to the plain-text path below if HTML
                    // parsing fails for any reason — the user still
                    // gets the textual `after` as a graceful fallback.
                  }
                }

                // Preserve the active marks (bold, italic, etc.) at
                // the cursor so an auto-replace inside bold text
                // stays bold.
                const marks = view.state.storedMarks ?? $from.marks();

                // Cluster 26 — consume the trigger whitespace.
                //
                // Built-ins were originally authored with `after`
                // including a trailing space (e.g., "→ ") to "preserve
                // the trigger" character. In practice users expect
                // Word/Notion-style autocorrect: typing `--> ` should
                // produce `→` with the cursor parked right after the
                // arrow, NOT `→ ` with a leftover space.
                //
                // We strip the trailing trigger char from `after` at
                // apply time WHEN the trigger char (last char of
                // `before`) is whitespace AND `after` ends with that
                // same char. Non-whitespace triggers (e.g., `)` in
                // `(c)`) are preserved untouched — those rules don't
                // have the same "leftover whitespace" feel. Stored
                // rule values are NOT mutated; the strip is purely
                // run-time so users can still edit / inspect rules
                // exactly as authored.
                let effectiveAfter = rule.after;
                const trigger = rule.before[rule.before.length - 1];
                if (
                  trigger &&
                  /\s/.test(trigger) &&
                  effectiveAfter.endsWith(trigger)
                ) {
                  effectiveAfter = effectiveAfter.slice(0, -1);
                }

                let tr;
                if (effectiveAfter.length === 0) {
                  // Empty replacement = delete the trigger entirely.
                  tr = view.state.tr.delete(replaceFrom, to);
                } else {
                  tr = view.state.tr.replaceWith(
                    replaceFrom,
                    to,
                    view.state.schema.text(effectiveAfter, marks),
                  );
                }
                tr.setMeta("cortexAutoReplace", true);
                view.dispatch(tr);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
