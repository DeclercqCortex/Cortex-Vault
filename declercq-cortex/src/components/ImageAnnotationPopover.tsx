// ImageAnnotationPopover — Cluster 19 v1.0.
//
// Floating popover that opens on Ctrl+Click of a CortexImage. Hosts
// an auto-sizing textarea for descriptive notes about the image.
// Commits on blur or Esc; closes on outside click.
//
// Mounted by Editor.tsx in response to the
// `cortex:edit-image-annotation` CustomEvent dispatched from the
// CortexImage NodeView. The annotation is stored URL-encoded in the
// node's `annotation` attr (so it round-trips through the markdown
// data-annotation HTML attribute even with newlines / quotes /
// unicode).

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface ImageAnnotationPopoverProps {
  /** Initial annotation text (already URL-decoded by the caller). */
  initialText: string;
  /** Bounding rect of the image, for positioning. */
  anchorRect: DOMRect;
  /** Commit a new annotation. Caller is responsible for encoding +
   *  dispatching the ProseMirror transaction. Pass empty string to
   *  clear the annotation. */
  onSave: (text: string) => void;
  /** Close without saving. Esc / outside click. */
  onClose: () => void;
}

const POPOVER_WIDTH = 320;
const GAP = 8;

export function ImageAnnotationPopover({
  initialText,
  anchorRect,
  onSave,
  onClose,
}: ImageAnnotationPopoverProps) {
  const [text, setText] = useState(initialText);
  const popRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-size the textarea on input.
  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(320, ta.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    autosize();
    // Focus the textarea on mount + put cursor at end.
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      const len = ta.value.length;
      try {
        ta.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    }
  }, [autosize]);

  // Commit on blur (unless the blur is going to one of our own children
  // — e.g. clicking the Save button). Esc closes without committing.
  const commitAndClose = useCallback(() => {
    onSave(text);
    onClose();
  }, [onSave, text, onClose]);

  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      const next = e.relatedTarget as Node | null;
      const pop = popRef.current;
      if (next && pop && pop.contains(next)) {
        // Focus moved to a button inside the popover — not a real blur.
        return;
      }
      commitAndClose();
    },
    [commitAndClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Ctrl+Enter commits without an explicit blur.
      if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) === true) {
        e.preventDefault();
        commitAndClose();
      }
    },
    [commitAndClose, onClose],
  );

  // Outside-click closes (commits the current text).
  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      const pop = popRef.current;
      if (!pop) return;
      if (e.target instanceof Node && pop.contains(e.target)) return;
      commitAndClose();
    }
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }, [commitAndClose]);

  // Position: prefer below the image, flip above if it would clip the
  // viewport bottom. Horizontally clamp to keep on-screen.
  const top0 = anchorRect.bottom + GAP;
  const bottomFlip = top0 + 200 > window.innerHeight; // rough estimate
  const top = bottomFlip ? Math.max(GAP, anchorRect.top - GAP - 200) : top0;
  const left = Math.min(
    Math.max(GAP, anchorRect.left),
    Math.max(GAP, window.innerWidth - POPOVER_WIDTH - GAP),
  );

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Image annotation"
      style={{
        position: "fixed",
        top,
        left,
        width: `${POPOVER_WIDTH}px`,
        zIndex: 800,
        background: "var(--bg-card)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        padding: "0.6rem 0.7rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        fontSize: "0.85rem",
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
        }}
      >
        Image annotation
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autosize();
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder="Describe this image…"
        rows={3}
        style={{
          minHeight: "60px",
          maxHeight: "320px",
          resize: "vertical",
          padding: "0.4rem 0.5rem",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          lineHeight: 1.4,
        }}
      />
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          Esc to discard · Ctrl+Enter to save
        </span>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          {initialText && (
            <button
              type="button"
              onClick={() => {
                onSave("");
                onClose();
              }}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                padding: "3px 8px",
                fontSize: "0.78rem",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={commitAndClose}
            style={{
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              color: "var(--bg)",
              padding: "3px 10px",
              fontSize: "0.78rem",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
