// RevisionBubbleOverlay — Cluster 23 v1.0.
//
// Renders one rectangular, single-line, contenteditable bubble per
// open strike-revision in the active editor. The list of "open"
// bubbles is owned by the strikeRevisionPlugin (PM plugin state);
// this component:
//
//   1. subscribes to the editor's transactions and re-renders when
//      either the open-set changes or the doc changes (so positions
//      stay glued to their underlying strike runs)
//   2. for each open bubble, computes screen position via
//      view.coordsAtPos(to) and renders an absolutely-positioned
//      div in the editor wrapper coordinate system
//   3. on bubble input, dispatches a transaction that updates the
//      strike mark's `revision` attr via setStrikeRevision()
//
// The bubble is rendered as a `contentEditable` div (not an <input>)
// so the user can move the cursor with arrow keys without losing
// focus to the underlying ProseMirror surface, and so the future
// "rich text inside the revision" path (italic, link, etc.) only
// requires teaching the bubble to accept marks rather than swapping
// out the element type. v1.0 keeps the content as plain text — the
// `onInput` handler reads `el.textContent` and stores it in the
// mark's revision attr verbatim.
//
// Focus / re-entrance:
//   - the bubble is "uncontrolled": React mounts it once with the
//     current revision text as `defaultValue`, then never replaces
//     its DOM. PM transactions that update the same mark's revision
//     attr DON'T cause a remount (the bubble's React key is the
//     bubble's stable id, not the revision text).
//   - if the underlying revision changes from outside the bubble
//     (currently impossible — only the bubble writes to it — but
//     reserved for a future "external revision sync" feature), the
//     bubble syncs from PM only when it isn't focused. Focused
//     bubble = source of truth for the revision text.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  getOpenBubbles,
  setStrikeRevision,
  strikeRevisionKey,
  type OpenBubble,
} from "../editor/CortexStrikeRevision";

interface RevisionBubbleOverlayProps {
  editor: Editor | null;
  /** Wrapper element whose top-left is the (0,0) for the bubble's
   *  absolute-positioning coordinate system. Pass the same ref the
   *  TabPane uses for ParticleOverlay (the editor wrapper). */
  rootRef: React.RefObject<HTMLDivElement | null>;
}

interface PositionedBubble extends OpenBubble {
  top: number;
  left: number;
  /** Width in CSS px — matches the strike's bounding-box width on the
   *  first line, so the bubble visually spans the cross-out exactly
   *  (lab-notebook gesture). For multi-line wrapped strikes we extend
   *  to the wrapper's right edge as a safe fallback. */
  width: number;
  /** Current revision text snapshot (read from the mark at render time). */
  revision: string;
}

export function RevisionBubbleOverlay({
  editor,
  rootRef,
}: RevisionBubbleOverlayProps) {
  // We don't store the bubble list in React state directly; we re-read
  // from PM on every transaction tick. `tick` forces a re-render in
  // sync with the editor.
  const [tick, setTick] = useState(0);

  // Subscribe to editor transactions so we re-render in lockstep with
  // doc / state changes (open-set toggles, text edits inside a struck
  // range, etc.).
  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => setTick((n) => (n + 1) | 0);
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  // Compute the positioned bubble list each render. Cheap (≤ a handful
  // of open bubbles in practice) and inherently correct because it
  // reads PM state at render-time.
  const bubbles: PositionedBubble[] = [];
  if (editor && rootRef.current) {
    const view = editor.view;
    const root = rootRef.current;
    const rootRect = root.getBoundingClientRect();
    const open = getOpenBubbles(view.state);
    const strikeType = view.state.schema.marks.strike;
    for (const b of open) {
      // Defensive: PM could be transitioning; skip silently rather
      // than crash if coordsAtPos throws on a stale position.
      try {
        const startCoords = view.coordsAtPos(b.from);
        const endCoords = view.coordsAtPos(b.to);
        // Lab-notebook positioning — the bubble is the SAME WIDTH as
        // the cross-out and sits directly above it, left edge aligned
        // with the strike's left edge. The bubble component applies
        // `transform: translateY(calc(-100% - 4px))` (translateY only,
        // no horizontal shift) so the values we emit here are the
        // strike's top-edge + left-edge in wrapper-local coords plus
        // the strike's bbox width.
        //
        // SINGLE-LINE strike: width = endCoords.right - startCoords.left.
        //
        // MULTI-LINE wrapped strike: startCoords.top !== endCoords.top.
        // The bbox `endCoords.right - startCoords.left` may be small or
        // even negative (line N ends to the LEFT of where line 1 began).
        // Fall back to "stretch from start.left to the wrapper's right
        // edge" so the bubble at least occupies line 1 from the strike's
        // start to the right margin. Proper "first-line end-of-line"
        // detection (e.g. binary-searching coordsAtPos for the position
        // where coords.top jumps) is deferred to v1.1+.
        const sameLine = Math.abs(startCoords.top - endCoords.top) < 4;
        const top = startCoords.top - rootRect.top;
        const left = startCoords.left - rootRect.left;
        const rawWidth = sameLine
          ? endCoords.right - startCoords.left
          : rootRect.right - startCoords.left;
        // Floor at 16 px so a 1- or 2-character strike still produces
        // a bubble big enough to click into. Anything narrower than
        // a finger-tip is unusable and the strike's logical width is
        // less interesting than the affordance.
        const width = Math.max(rawWidth, 16);
        // Pull the current revision text off the strike mark itself
        // (the mark at the START of the range — every char in the
        // range carries the same mark, so reading the start is
        // sufficient).
        let revisionText = "";
        const $f = view.state.doc.resolve(b.from);
        const marks = $f.marks();
        const struck = marks.find((m) => m.type === strikeType);
        if (struck && typeof struck.attrs.revision === "string") {
          revisionText = struck.attrs.revision;
        }
        bubbles.push({ ...b, top, left, width, revision: revisionText });
      } catch {
        // ignore stale-pos cases
      }
    }
  }

  // Force a relayout when scroll happens within the editor wrapper —
  // the bubble's absolute position is derived from view.coordsAtPos
  // which reports viewport-relative coords. The wrapper coordinate
  // system shifts with scroll, so we need to re-render. The transaction
  // listener above doesn't fire on scroll-only events.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = () => setTick((n) => (n + 1) | 0);
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rootRef]);

  // Suppress the unused `tick` warning — we read it implicitly by
  // having React re-call the function each setTick.
  void tick;

  if (!editor) return null;

  return (
    <>
      {bubbles.map((b) => (
        <RevisionBubble key={b.id} editor={editor} bubble={b} />
      ))}
    </>
  );
}

// ---- per-bubble component ----

interface RevisionBubbleProps {
  editor: Editor;
  bubble: PositionedBubble;
}

function RevisionBubble({ editor, bubble }: RevisionBubbleProps) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Mount initialization: write the saved revision into the
  // contenteditable BEFORE focusing, then place the caret at end so
  // the user appends rather than overwrites.
  //
  // Why this matters (v1.0.1 fix): in the first cut, the bubble was
  // never seeded with `bubble.revision` on mount — it relied on the
  // "external sync" useEffect below to write it. But that effect
  // early-returns when `document.activeElement === el`, which it is
  // by the time the effect commits (we just focused inside the
  // useLayoutEffect). Result: reopening a bubble on a strike that
  // already had a saved revision showed the bubble empty, and the
  // first keystroke wiped the saved value via setStrikeRevision.
  // The text was always persisted on disk (data-revision survives
  // save/reload); the bubble just refused to display it on reopen.
  // Seeding textContent before the focus call closes the gap.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (el.textContent !== bubble.revision) {
      el.textContent = bubble.revision;
    }
    el.focus({ preventScroll: true });
    if (bubble.revision.length > 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    // Only run on first mount per bubble id — the parent passes the
    // bubble's stable id as the React key, so this effect runs once
    // per "bubble open" lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External-update sync: if the underlying revision text changes
  // while the bubble is NOT focused, reflect that in the DOM. When
  // focused, the bubble is the source of truth. (No external writer
  // exists in v1.0; this is defensive scaffolding for v1.1+.)
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== bubble.revision) {
      el.textContent = bubble.revision;
    }
  }, [bubble.revision]);

  function commit(text: string) {
    // Empty text → null on disk so the strike opens as a plain `<s>`
    // tag (matches v0 / pre-Cluster-23 format exactly when the user
    // erases the bubble back to empty).
    const next = text.length === 0 ? null : text;
    const tr = setStrikeRevision(editor.state, bubble.from, bubble.to, next);
    if (tr) editor.view.dispatch(tr);
  }

  return (
    <div
      ref={elRef}
      className="cortex-revision-bubble"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-label="Revision"
      style={{
        position: "absolute",
        // (top, left, width) match the strike's bounding box on its
        // first line in wrapper-local coords. translateY(calc(-100%
        // - 4px)) pulls the bubble UP by its own height plus a 4-px
        // gap so its bottom edge sits 4 px above the strike's top.
        // No horizontal transform — left + width already place the
        // bubble exactly over the strike.
        top: `${bubble.top}px`,
        left: `${bubble.left}px`,
        width: `${bubble.width}px`,
        transform: "translateY(calc(-100% - 4px))",
      }}
      onInput={(e) => {
        const text = (e.target as HTMLDivElement).textContent ?? "";
        commit(text);
      }}
      onKeyDown={(e) => {
        // Stop ALL keys from bubbling into the editor's prosemirror
        // surface — without this Ctrl+S / Ctrl+1-7 / Ctrl+Shift+X
        // would still hit the editor while the bubble has focus.
        e.stopPropagation();
        if (e.key === "Escape") {
          // Close THIS bubble. The PM plugin's plugin-level Esc handler
          // closes every bubble; per-bubble Esc only closes one.
          editor.view.dispatch(
            editor.state.tr.setMeta(strikeRevisionKey, {
              kind: "close",
              id: bubble.id,
            }),
          );
          // Return focus to the editor so the user keeps writing.
          editor.view.focus();
          e.preventDefault();
        } else if (e.key === "Enter") {
          // Enter commits and closes (no multi-line in v1.0 — bubble
          // is single-line by spec).
          editor.view.dispatch(
            editor.state.tr.setMeta(strikeRevisionKey, {
              kind: "close",
              id: bubble.id,
            }),
          );
          editor.view.focus();
          e.preventDefault();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
