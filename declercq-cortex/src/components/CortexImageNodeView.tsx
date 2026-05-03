// CortexImageNodeView — Cluster 19 v1.0.
//
// React NodeView for the cortexImage TipTap node. Renders the <img>,
// applies the wrap-mode-specific layout CSS, hosts the three corner
// handles (drag-to-move, rotate, resize), and surfaces Ctrl+Click /
// right-click events to the editor host for the annotation popover
// (Pass 4) and context menu (Pass 5).
//
// Path resolution: the node's `src` attr is stored relative to the
// note's parent dir (so the markdown stays portable). At render time
// we resolve it to an asset:// URL via Tauri's convertFileSrc, using
// the note's absolute path read from the editor's storage namespace
// (`editor.storage.cortexImage.notePath`, populated by Editor.tsx).
//
// State changes go through ProseMirror transactions (updateAttributes
// / setNodeMarkup) so undo/redo works naturally.
//
// CustomEvents emitted on the editor's view.dom:
//   - cortex:edit-image-annotation  → Pass 4 popover
//   - cortex:image-context-menu      → Pass 5 right-click menu
//
// Companion CSS: src/index.css `.cortex-image*` classes.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { CortexImageWrap } from "../editor/CortexImageNode";

/** Dispatched on Ctrl+click — opens the editable annotation popover. */
export const EDIT_IMAGE_ANNOTATION_EVENT = "cortex:edit-image-annotation";
/** Dispatched on plain click of the badge — shows a read-only bubble. */
export const VIEW_IMAGE_ANNOTATION_EVENT = "cortex:view-image-annotation";
/** CustomEvent name dispatched on right-click inside the image. */
export const IMAGE_CONTEXT_MENU_EVENT = "cortex:image-context-menu";

export interface EditImageAnnotationDetail {
  pos: number; // ProseMirror position of the cortexImage node
  anchorRect: DOMRect; // Image's bounding rect for popover positioning
  annotation: string; // Current annotation (URL-decoded)
}

export interface ViewImageAnnotationDetail {
  anchorRect: DOMRect; // Badge / image rect for bubble positioning
  annotation: string; // URL-decoded text
}

export interface ImageContextMenuDetail {
  pos: number;
  x: number; // Right-click coordinates
  y: number;
  attrs: {
    wrapMode: CortexImageWrap;
    rotation: number;
    width: number | null;
    annotation: string;
  };
}

/**
 * Compute the absolute file path for an image given the note's
 * absolute path and the relative src stored on the node. Handles
 * both forward and back slashes on Windows. Returns null if either
 * input is missing.
 */
function resolveAbsoluteImagePath(
  notePath: string | null | undefined,
  relSrc: string,
): string | null {
  if (!notePath || !relSrc) return null;
  // If src is already absolute or a URL, leave it alone.
  if (/^[a-z]+:\/\//i.test(relSrc)) return null; // http:, asset:, etc.
  if (/^[a-zA-Z]:[\\/]/.test(relSrc)) return relSrc; // C:\... or C:/...
  if (relSrc.startsWith("/")) return relSrc;
  // Otherwise: parent-of-note + relSrc. Detect path separator.
  const sep = notePath.includes("\\") ? "\\" : "/";
  const lastSep = notePath.lastIndexOf(sep);
  if (lastSep === -1) return null;
  const parent = notePath.slice(0, lastSep);
  // Normalise relSrc to use the platform's separator.
  const normalised = relSrc.replace(/[\\/]+/g, sep);
  return `${parent}${sep}${normalised}`;
}

/** Throttle helper using requestAnimationFrame. */
function rafThrottle<F extends (...args: any[]) => void>(fn: F): F {
  let scheduled = false;
  let lastArgs: any[] | null = null;
  return ((...args: any[]) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (lastArgs) {
        fn(...lastArgs);
        lastArgs = null;
      }
    });
  }) as F;
}

export function CortexImageNodeView(props: NodeViewProps) {
  const { node, editor, getPos, updateAttributes, selected } = props;
  const wrapMode = (node.attrs.wrapMode as CortexImageWrap) ?? "break";
  const freeX = node.attrs.freeX as number | null;
  const freeY = node.attrs.freeY as number | null;
  const rotation = (node.attrs.rotation as number) ?? 0;
  const width = node.attrs.width as number | null;
  const annotation = (node.attrs.annotation as string) ?? "";
  const src = node.attrs.src as string;

  // The note path is published into storage by Editor.tsx whenever the
  // open file changes. We resolve via convertFileSrc each render so
  // the asset:// URL stays in sync with edits to the node's src attr.
  const storage =
    (editor.storage as Record<string, unknown>)["cortexImage"] ?? {};
  const notePath = (storage as { notePath?: string }).notePath ?? "";
  const absolute = resolveAbsoluteImagePath(notePath, src);
  const resolvedSrc = (() => {
    if (!absolute) return "";
    try {
      return convertFileSrc(absolute);
    } catch {
      return "";
    }
  })();

  // ---- handle refs / drag state -------------------------------------------
  const wrapRef = useRef<HTMLSpanElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState<"move" | "rotate" | "resize" | null>(
    null,
  );

  // Pointer-down tracking for each handle. Stored as refs so the
  // rafThrottle move handler always reads the latest snapshot.
  const moveStateRef = useRef<{
    startMouse: { x: number; y: number };
    startFree: { x: number; y: number };
    parentRect: DOMRect | null;
  } | null>(null);

  const rotateStateRef = useRef<{
    centre: { x: number; y: number };
    startAngle: number;
    startRotation: number;
  } | null>(null);

  const resizeStateRef = useRef<{
    startMouse: { x: number; y: number };
    startWidth: number;
    aspect: number;
  } | null>(null);

  // ---- DRAG-TO-MOVE -------------------------------------------------------
  // First drag from the move handle switches wrapMode to "free" and
  // captures the image's current rendered offset as the seed
  // (freeX, freeY). Subsequent moves just adjust those numbers.

  const onMoveDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = wrapRef.current;
      if (!wrap) return;
      const parent = wrap.parentElement?.closest(
        ".ProseMirror",
      ) as HTMLElement | null;
      const parentRect = parent?.getBoundingClientRect() ?? null;
      // Seed freeX/freeY from the image's current rendered position
      // if we're entering free mode for the first time.
      const wrapRect = wrap.getBoundingClientRect();
      let seedX = freeX;
      let seedY = freeY;
      if (wrapMode !== "free" || seedX == null || seedY == null) {
        if (parentRect) {
          seedX = wrapRect.left - parentRect.left + (parent?.scrollLeft ?? 0);
          seedY = wrapRect.top - parentRect.top + (parent?.scrollTop ?? 0);
        } else {
          seedX = 0;
          seedY = 0;
        }
        updateAttributes({
          wrapMode: "free",
          freeX: Math.round(seedX),
          freeY: Math.round(seedY),
        });
      }
      moveStateRef.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startFree: { x: seedX ?? 0, y: seedY ?? 0 },
        parentRect,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging("move");
    },
    [freeX, freeY, wrapMode, updateAttributes],
  );

  const onMoveMove = useCallback(
    rafThrottle((e: PointerEvent) => {
      const s = moveStateRef.current;
      if (!s) return;
      const dx = e.clientX - s.startMouse.x;
      const dy = e.clientY - s.startMouse.y;
      updateAttributes({
        freeX: Math.round(s.startFree.x + dx),
        freeY: Math.round(s.startFree.y + dy),
      });
    }),
    [updateAttributes],
  );

  // ---- ROTATE -------------------------------------------------------------
  const onRotateDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      rotateStateRef.current = {
        centre: { x: cx, y: cy },
        startAngle,
        startRotation: rotation,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging("rotate");
    },
    [rotation],
  );

  const onRotateMove = useCallback(
    rafThrottle((e: PointerEvent) => {
      const s = rotateStateRef.current;
      if (!s) return;
      const angle = Math.atan2(e.clientY - s.centre.y, e.clientX - s.centre.x);
      const deltaDeg = ((angle - s.startAngle) * 180) / Math.PI;
      let next = s.startRotation + deltaDeg;
      // Snap to 5° steps when Shift is held.
      if (e.shiftKey) next = Math.round(next / 5) * 5;
      // Normalise to [-180, 180] for compactness.
      while (next > 180) next -= 360;
      while (next < -180) next += 360;
      updateAttributes({ rotation: next });
    }),
    [updateAttributes],
  );

  // ---- RESIZE -------------------------------------------------------------
  const onResizeDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const aspect = rect.height > 0 ? rect.width / rect.height : 1;
    resizeStateRef.current = {
      startMouse: { x: e.clientX, y: e.clientY },
      startWidth: rect.width,
      aspect,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging("resize");
  }, []);

  const onResizeMove = useCallback(
    rafThrottle((e: PointerEvent) => {
      const s = resizeStateRef.current;
      if (!s) return;
      const dx = e.clientX - s.startMouse.x;
      const next = Math.max(48, Math.round(s.startWidth + dx));
      updateAttributes({ width: next });
    }),
    [updateAttributes],
  );

  // ---- shared up + window listeners --------------------------------------
  const onUp = useCallback(() => {
    setDragging(null);
    moveStateRef.current = null;
    rotateStateRef.current = null;
    resizeStateRef.current = null;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move =
      dragging === "move"
        ? onMoveMove
        : dragging === "rotate"
          ? onRotateMove
          : onResizeMove;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, onMoveMove, onRotateMove, onResizeMove, onUp]);

  // ---- click on the image: Ctrl+click → edit annotation ----------------
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const wrap = wrapRef.current;
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        let decoded = annotation;
        try {
          decoded = decodeURIComponent(annotation);
        } catch {
          /* leave as-is */
        }
        const pos = typeof getPos === "function" ? getPos() : 0;
        const evt = new CustomEvent<EditImageAnnotationDetail>(
          EDIT_IMAGE_ANNOTATION_EVENT,
          {
            detail: { pos, anchorRect: rect, annotation: decoded },
            bubbles: true,
          },
        );
        editor.view.dom.dispatchEvent(evt);
      }
    },
    [annotation, editor, getPos],
  );

  // ---- click on the annotation badge ------------------------------------
  // Plain click → read-only bubble (view).
  // Ctrl+click  → edit popover (same as Ctrl+click on the image).
  const onBadgeClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!annotation) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      let decoded = annotation;
      try {
        decoded = decodeURIComponent(annotation);
      } catch {
        /* leave as-is */
      }
      const pos = typeof getPos === "function" ? getPos() : 0;
      if (e.ctrlKey || e.metaKey) {
        const evt = new CustomEvent<EditImageAnnotationDetail>(
          EDIT_IMAGE_ANNOTATION_EVENT,
          {
            detail: { pos, anchorRect: rect, annotation: decoded },
            bubbles: true,
          },
        );
        editor.view.dom.dispatchEvent(evt);
      } else {
        const evt = new CustomEvent<ViewImageAnnotationDetail>(
          VIEW_IMAGE_ANNOTATION_EVENT,
          {
            detail: { anchorRect: rect, annotation: decoded },
            bubbles: true,
          },
        );
        editor.view.dom.dispatchEvent(evt);
      }
    },
    [annotation, editor, getPos],
  );

  // ---- right-click → context menu ----------------------------------------
  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof getPos === "function" ? getPos() : 0;
      const evt = new CustomEvent<ImageContextMenuDetail>(
        IMAGE_CONTEXT_MENU_EVENT,
        {
          detail: {
            pos,
            x: e.clientX,
            y: e.clientY,
            attrs: { wrapMode, rotation, width, annotation },
          },
          bubbles: true,
        },
      );
      editor.view.dom.dispatchEvent(evt);
    },
    [editor, getPos, wrapMode, rotation, width, annotation],
  );

  // ---- styles -------------------------------------------------------------
  const wrapClass =
    "cortex-image-wrap " +
    `cortex-image-wrap-${wrapMode}` +
    (selected ? " cortex-image-selected" : "") +
    (annotation ? " cortex-image-has-annotation" : "");

  const wrapStyle: React.CSSProperties = {};
  if (wrapMode === "free" && freeX != null && freeY != null) {
    wrapStyle.left = `${freeX}px`;
    wrapStyle.top = `${freeY}px`;
  }

  const imgStyle: React.CSSProperties = {
    transform: rotation ? `rotate(${rotation.toFixed(2)}deg)` : undefined,
  };
  if (width != null) {
    imgStyle.width = `${width}px`;
  }

  // In wrap modes (left / right / break) the user repositions the image
  // by *dragging the image itself* — ProseMirror handles the doc-level
  // move and the surrounding text reflows naturally. The dedicated move
  // handle therefore only appears in free mode (where it tracks
  // freeX/freeY in 2D). Rotate + resize are universal.
  const showMoveHandle = wrapMode === "free";
  // ProseMirror picks up native HTML5 drag because the node spec has
  // draggable: true. Setting draggable on the wrapper bubbles the drag
  // start to PM correctly.
  const wrapDraggable = wrapMode !== "free";

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapRef as unknown as React.Ref<HTMLElement>}
      className={wrapClass}
      style={wrapStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
      data-cortex-image-wrap=""
      data-drag-handle={wrapDraggable ? "" : undefined}
    >
      {/* Inner anchor — handles position against THIS box (matches the
          image's exact rendered bounds, including post-resize updates). */}
      <span className="cortex-image-anchor">
        <img
          ref={imgRef}
          src={resolvedSrc}
          alt=""
          className="cortex-image"
          draggable={false}
          style={imgStyle}
          onClick={onClick}
        />

        {/* Handles. Rendered inside the anchor so they re-anchor on
            every resize. Visible while hovered or actively dragging. */}
        {(hovered || dragging) && (
          <>
            {showMoveHandle && (
              <span
                className="cortex-image-handle cortex-image-handle-move"
                onPointerDown={onMoveDown}
                title="Drag to move (free position)"
              >
                ⋮⋮
              </span>
            )}
            <span
              className="cortex-image-handle cortex-image-handle-rotate"
              onPointerDown={onRotateDown}
              title="Drag to rotate (Shift = snap to 5°)"
            >
              ↻
            </span>
            <span
              className="cortex-image-handle cortex-image-handle-resize"
              onPointerDown={onResizeDown}
              title="Drag to resize"
            >
              ⤡
            </span>
          </>
        )}

        {annotation && (
          <span
            className="cortex-image-badge"
            role="button"
            tabIndex={0}
            title="Click to view annotation · Ctrl+click to edit"
            onClick={onBadgeClick}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Image annotation"
          >
            {/* Inline SVG: a small comment/note bubble. Crisp at any
                size; no emoji rendering inconsistency across OSes. */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 4 a2 2 0 0 1 2 -2 h8 a2 2 0 0 1 2 2 v6 a2 2 0 0 1 -2 2 H7 l-3 2.5 v-2.5 H4 a2 2 0 0 1 -2 -2 z" />
              <path d="M5.5 6 h5 M5.5 8.5 h3" />
            </svg>
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
