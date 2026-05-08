// CortexStrikeRevision — Cluster 23 v1.0.
//
// Two pieces in one file (mirrors the imageMultiSelect.ts shape):
//
//   1. CortexStrikeRevision — TipTap mark, extends @tiptap/extension-strike.
//      Adds a `revision` attr (string | null) round-tripping via
//      `data-revision` on the `<s>` tag. Markdown serializer emits the
//      attr in the open tag when non-empty so the value survives
//      save / reload through tiptap-markdown's `html: true` path.
//
//   2. strikeRevisionPlugin — ProseMirror plugin tracking which strike
//      ranges currently have an OPEN bubble. State is ephemeral
//      (Array<{ id, from, to }>): bubbles are not persisted across
//      reloads — only the revision text is. The bubble itself is
//      rendered by RevisionBubbleOverlay.tsx, which reads this
//      plugin's state via `strikeRevisionKey.getState(view.state)`.
//
// Click flow (Ctrl/Cmd+click on a strike mark):
//   - handleClickOn detects the modifier + that the click is inside a
//     strike mark
//   - finds the contiguous strike range covering the click position
//   - toggles that range in the plugin state ("toggle" meta)
//   - the overlay re-renders, mounting (or unmounting) the bubble
//
// Position handling on doc changes:
//   - on tr.docChanged with no toggle meta, every stored range is
//     mapped through tr.mapping
//   - if the mapped range no longer carries a strike mark or the
//     range collapsed (from >= to), the entry is dropped
//   - this keeps bubbles aligned to their text as the user types
//     above / inside / around the struck range
//
// Why ranges and not just a position:
//   - the bubble needs both ends of the strike to compute the
//     top-right anchor (top of last visual line, right edge of
//     last char). Storing both lets the overlay use coordsAtPos(to)
//     directly and avoids re-walking the doc each render.
//   - on toggle we walk outward from the click pos to find the
//     full strike range so the bubble lands on the whole struck
//     phrase even if the click was in the middle of it.
//
// Strike mark semantics (preserved from Cluster 2):
//   - The Reviews pipeline still reads `<s>` (or, equivalently, the
//     `strike` mark's presence) as "resolved" when wrapping a colour
//     mark. Adding the `revision` attr is purely additive — a strike
//     can have a revision, no revision, or compose with a colour mark
//     and still be resolved. The Cluster 3 destination extractors
//     don't read `data-revision` and don't need to.

import Strike from "@tiptap/extension-strike";
import { mergeAttributes } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";

// ---- ID generator (avoids React-key collisions on rapid open/close) ----

let _idCounter = 0;
function nextBubbleId(): string {
  _idCounter = (_idCounter + 1) | 0;
  // Time-stamped + counter so the React keys stay stable across renders
  // and unique across reopens of the same range.
  return `rb-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// ---- the Strike mark with a revision attr ----

/**
 * Strike that serializes as `<s>…</s>` HTML rather than tiptap-markdown's
 * default `~~…~~` (was HtmlStrike in Editor.tsx pre-Cluster-23).
 *
 * Adds a `revision` attr (string | null). When non-empty the open tag
 * carries `data-revision="…escaped…"`. Empty / null means "no
 * revision attached" and the `<s>` opens with no extra attribute,
 * matching the v1 on-disk shape exactly so files written before
 * Cluster 23 keep parsing unchanged.
 *
 * The Reviews pipeline (Cluster 3 / `extract_marks` on the Rust side)
 * looks for the `<s>` tag and the wrapping colour mark — it doesn't
 * read `data-revision` and isn't affected by its presence.
 */
export const CortexStrikeRevision = Strike.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      revision: {
        default: null as string | null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-revision");
          return v && v.length > 0 ? v : null;
        },
        renderHTML: (attrs: { revision?: string | null }) => {
          if (!attrs.revision) return {};
          return { "data-revision": attrs.revision };
        },
      },
    };
  },

  // Cluster 16 v1.1.4 / v2.1.5 lessons: serialize as HTML so the strike
  // composes losslessly with adjacent <mark class="mark-…"> spans.
  // The data-revision attr is emitted via the standard
  // `mergeAttributes`/`renderHTML` path on save → tiptap-markdown's
  // html:true reads it back on load.
  addStorage() {
    return {
      // Spread the parent (StarterKit's strike) storage so any other
      // properties (e.g. tiptap-markdown's hooks) survive the extend.
      ...this.parent?.(),
      markdown: {
        // Use a function-based serializer so the open tag can carry
        // `data-revision` per-mark instead of a hard-coded "<s>".
        serialize: {
          open(_state: unknown, mark: { attrs: { revision?: string | null } }) {
            const rev = mark.attrs.revision;
            if (!rev) return "<s>";
            // Escape the four characters that have meaning inside an
            // HTML attribute value: & < > ".
            const esc = rev
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;");
            return `<s data-revision="${esc}">`;
          },
          close: "</s>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    };
  },

  parseHTML() {
    // Inherit the default <s> / <strike> / <del> matchers from the
    // parent extension; the `revision` attr's own parseHTML reads
    // `data-revision` off whichever tag matched.
    return this.parent?.() ?? [{ tag: "s" }, { tag: "strike" }, { tag: "del" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["s", mergeAttributes(HTMLAttributes), 0];
  },
});

// ---- helper: find the strike-mark range covering a position ----

/**
 * Walk forward from `pos` while the doc text at that position carries
 * a strike mark; do the same backward. Returns the inclusive-exclusive
 * (from, to) of the contiguous strike run covering `pos`, or `null` if
 * the position isn't inside a strike mark.
 *
 * `pos` is a ProseMirror position (between characters). The strike at
 * pos `p` is "the mark on the character to the right of p" — we read
 * `doc.resolve(p).marks()` for that character (rangeHasMark would
 * over-collapse on zero-length ranges).
 */
export function findStrikeRangeAtPos(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const strikeType = state.schema.marks.strike;
  if (!strikeType) return null;
  const $pos = state.doc.resolve(pos);
  // Marks on the character immediately after pos (TipTap convention).
  const here = $pos.marks();
  if (!here.some((m) => m.type === strikeType)) return null;

  // Walk forward.
  let to = pos;
  while (to < state.doc.content.size) {
    const $t = state.doc.resolve(to);
    if (!$t.marks().some((m) => m.type === strikeType)) break;
    to += 1;
  }
  // Walk backward.
  let from = pos;
  while (from > 0) {
    const $f = state.doc.resolve(from - 1);
    if (!$f.marks().some((m) => m.type === strikeType)) break;
    from -= 1;
  }
  if (to <= from) return null;
  return { from, to };
}

/**
 * Replace the `revision` attr on the strike mark covering (from, to).
 * Implemented as `removeMark + addMark` because TipTap doesn't expose
 * a "patch attr" command for marks (marks are immutable; updating an
 * attr means replacing the mark with a new one carrying the new attrs).
 *
 * Returns the modified transaction. Caller is responsible for
 * dispatching it. We tag the transaction with our plugin meta
 * `{ kind: "ignore" }` so the open-set isn't pruned by the docChanged
 * branch (the doc didn't structurally change — just the strike mark's
 * attrs — but PM still routes us through the docChanged branch).
 */
export function setStrikeRevision(
  state: EditorState,
  from: number,
  to: number,
  revision: string | null,
): Transaction | null {
  const strikeType = state.schema.marks.strike;
  if (!strikeType) return null;
  if (to <= from) return null;
  const newMark = strikeType.create({ revision: revision || null });
  const tr = state.tr
    .removeMark(from, to, strikeType)
    .addMark(from, to, newMark);
  tr.setMeta(strikeRevisionKey, { kind: "ignore" });
  return tr;
}

// ---- plugin state + meta types ----

export interface OpenBubble {
  id: string;
  from: number;
  to: number;
}

type Meta =
  | { kind: "toggle"; from: number; to: number }
  | { kind: "close"; id: string }
  | { kind: "closeAll" }
  | { kind: "ignore" };

export const strikeRevisionKey = new PluginKey<OpenBubble[]>(
  "cortexStrikeRevision",
);

export function getOpenBubbles(state: EditorState): OpenBubble[] {
  return strikeRevisionKey.getState(state) ?? [];
}

// ---- the plugin ----

export function buildStrikeRevisionPlugin(): Plugin<OpenBubble[]> {
  return new Plugin<OpenBubble[]>({
    key: strikeRevisionKey,
    state: {
      init: () => [],
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(strikeRevisionKey) as Meta | undefined;
        if (meta) {
          if (meta.kind === "toggle") {
            // If a bubble already exists for the same range, close it.
            // Otherwise open a new one (replacing any partially
            // overlapping bubble for the same span — duplicates would
            // render two bubbles on top of each other).
            const existing = value.find(
              (b) => b.from === meta.from && b.to === meta.to,
            );
            if (existing) {
              return value.filter((b) => b.id !== existing.id);
            }
            // Drop any bubble whose range overlaps the new one (rare —
            // happens if the user opened a bubble on a substring then
            // extended the strike around it; we'd rather show one
            // bubble on the wider range).
            const filtered = value.filter(
              (b) => b.to <= meta.from || b.from >= meta.to,
            );
            return [
              ...filtered,
              { id: nextBubbleId(), from: meta.from, to: meta.to },
            ];
          }
          if (meta.kind === "close") {
            return value.filter((b) => b.id !== meta.id);
          }
          if (meta.kind === "closeAll") return [];
          // "ignore" → fall through; we still want positions remapped
          // if the doc changed in this same transaction.
        }

        if (!tr.docChanged) return value;

        // Remap stored ranges and prune any that no longer have a
        // strike mark (the user un-struck the text or deleted it).
        const strikeType = newState.schema.marks.strike;
        if (!strikeType) return [];
        const next: OpenBubble[] = [];
        for (const b of value) {
          const from = tr.mapping.map(b.from, 1);
          const to = tr.mapping.map(b.to, -1);
          if (to <= from) continue; // collapsed → bubble's text is gone
          // Verify the range still carries a strike mark on at least
          // its first character. Cheaper than scanning the whole range
          // and adequate for the prune decision.
          const $f = newState.doc.resolve(from);
          const stillStruck = $f.marks().some((m) => m.type === strikeType);
          if (!stillStruck) continue;
          next.push({ id: b.id, from, to });
        }
        return next;
      },
    },
    props: {
      // Cluster 23 v1.0 — Ctrl/Cmd+click on a struck span toggles its
      // bubble. We use handleClick (not handleClickOn) so a click
      // inside text marks (not nodes) is delivered to us; PM's
      // handleClickOn fires for node-typed clicks (atoms, nodes) and
      // wouldn't dispatch on a text-with-strike-mark target.
      handleClick(view, pos, event) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const range = findStrikeRangeAtPos(view.state, pos);
        if (!range) return false;
        // Don't let the editor place a TextSelection from the click;
        // we're hijacking the modifier-click.
        event.preventDefault();
        view.dispatch(
          view.state.tr.setMeta(strikeRevisionKey, {
            kind: "toggle",
            from: range.from,
            to: range.to,
          }),
        );
        return true;
      },
      handleKeyDown(view, event) {
        // Esc closes every open bubble. Other Esc-consumers (modals,
        // shape editor, etc.) take precedence via their own plugins
        // higher in the chain — this fires only when nothing else has.
        if (event.key !== "Escape") return false;
        const open = strikeRevisionKey.getState(view.state);
        if (!open || open.length === 0) return false;
        view.dispatch(
          view.state.tr.setMeta(strikeRevisionKey, { kind: "closeAll" }),
        );
        event.preventDefault();
        return true;
      },
    },
  });
}
