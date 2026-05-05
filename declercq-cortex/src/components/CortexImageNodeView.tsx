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
import { imageMultiSelectKey } from "../editor/imageMultiSelect";

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
    /** Cluster 19 v1.1 — flip state, surfaced in the context menu so
     *  the active dot reflects whether the toggle is currently on. */
    flipH: boolean;
    flipV: boolean;
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
  // Cluster 19 v1.1 — flip composes with rotation in the CSS transform.
  // scaleX(-1) horizontally mirrors; scaleY(-1) vertically mirrors.
  // Both true = effectively a 180° rotation visually, but kept on the
  // flip axes so user-set rotation is preserved as its own attr.
  const flipH = !!node.attrs.flipH;
  const flipV = !!node.attrs.flipV;
  // Cluster 19 v1.2 — non-destructive crop. Stored in NATURAL pixels.
  // All four must be present for the crop to apply (defensive
  // partial-set fallback).
  const cropX = node.attrs.cropX as number | null;
  const cropY = node.attrs.cropY as number | null;
  const cropW = node.attrs.cropW as number | null;
  const cropH = node.attrs.cropH as number | null;
  // Natural dimensions are known only after the img loads. Until
  // then we render uncropped (full image) so there's no flash of
  // mis-sized box; once the load resolves the wrapper sizes pick up.
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const cropActive =
    cropX != null &&
    cropY != null &&
    cropW != null &&
    cropH != null &&
    cropW > 0 &&
    cropH > 0 &&
    naturalSize != null;
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

  // ---- click on the image: Alt+click → multi-select toggle,
  //                          Ctrl+click → edit annotation -----------------
  // Cluster 19 v1.2 — Alt+click is handled HERE (in the NodeView's React
  // onClick) rather than in the imageMultiSelect ProseMirror plugin's
  // handleClickOn. Why: the NodeViewWrapper carries data-drag-handle in
  // left/right/break wrap modes, which puts the wrapper into HTML5
  // drag-prep on mousedown. With Alt held that prep can intercept the
  // click before PM's click pipeline runs, so handleClickOn never fires
  // on the cortexImage node and the toggle is silently dropped. The
  // React onClick on the inner <img> is a plain DOM click and fires
  // reliably regardless of drag-handle wiring, so we dispatch the
  // toggle transaction directly from here. The PM plugin's
  // handleClickOn is kept as a fallback path AND for the off-image
  // clear case (clicks on text / other nodes that should drop the set).
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        editor.view.dispatch(
          editor.view.state.tr.setMeta(imageMultiSelectKey, {
            kind: "toggle",
            pos,
          }),
        );
        return;
      }
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
            attrs: { wrapMode, rotation, width, annotation, flipH, flipV },
          },
          bubbles: true,
        },
      );
      editor.view.dom.dispatchEvent(evt);
    },
    [editor, getPos, wrapMode, rotation, width, annotation, flipH, flipV],
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

  // Cluster 19 v1.1 — compose rotation + flip in a single transform
  // string. Order: rotate first, then scale, so a rotated-then-flipped
  // image mirrors across the rotated axes (matches how Photoshop /
  // Figma compose these). Identity (no rotation, no flip) emits no
  // transform so the simple case stays clean.
  // Cluster 19 v1.2 — when crop is active the transform moves from
  // the <img> to the crop-wrapper so rotation rotates the CROPPED
  // result (matches the user's mental model: "rotate this photo I
  // just cropped"), not the full natural image inside the clip
  // window.
  const flipScaleX = flipH ? -1 : 1;
  const flipScaleY = flipV ? -1 : 1;
  const transformParts: string[] = [];
  if (rotation) transformParts.push(`rotate(${rotation.toFixed(2)}deg)`);
  if (flipH || flipV)
    transformParts.push(`scale(${flipScaleX}, ${flipScaleY})`);
  const composedTransform =
    transformParts.length > 0 ? transformParts.join(" ") : undefined;

  // Cluster 19 v1.2 — crop math. When crop is active, the user-set
  // `width` attr applies to the CROPPED result (so a 200-px-wide
  // user-set width displays a 200-px-wide cropped image regardless
  // of where the crop landed in the source). When unset, fall back
  // to the cropped region's natural dimensions (cropW × cropH at 1:1).
  // We only need cropDisplayedW directly — height auto-derives from
  // the wrapper's aspect-ratio, and the inner img positions itself
  // proportionally via percentages.
  const cropDisplayedW =
    cropActive && cropW != null ? (width != null ? width : cropW) : null;

  const imgStyle: React.CSSProperties = cropActive
    ? {
        // Inside the crop-wrapper: position the FULL natural image so
        // overflow:hidden on the wrapper clips to the crop region.
        // Sizes + offsets are expressed as PERCENTAGES of the wrapper
        // so the inner image scales proportionally when the wrapper
        // hits its parent's right edge and shrinks via max-width:100%.
        // Math: wrapper width = cropW * scale, img target width =
        // naturalW * scale → img width as % of wrapper = naturalW /
        // cropW × 100. Likewise for the negative offsets.
        position: "absolute",
        left: `${(-((cropX as number) / (cropW as number)) * 100).toFixed(3)}%`,
        top: `${(-((cropY as number) / (cropH as number)) * 100).toFixed(3)}%`,
        width: `${((naturalSize!.w / (cropW as number)) * 100).toFixed(3)}%`,
        height: "auto",
        // .cortex-image CSS has max-width: 100% which would cap the
        // inner img to the wrapper's width and squash the image to
        // fit (turning the crop into a resize). Override here so the
        // percentage-based width can exceed 100% of the wrapper.
        maxWidth: "none",
        // Transform is on the wrapper; img stays untransformed.
        transform: undefined,
        // The drop-shadow filter on the img would extend past the
        // wrapper edges and get clipped, leaving a partial shadow on
        // the cropped image. Move shadow responsibility to the wrapper
        // (set there via .cortex-image-crop-wrapper) so it rings the
        // cropped result cleanly.
        filter: "none",
      }
    : {
        transform: composedTransform,
        ...(width != null ? { width: `${width}px` } : null),
      };

  // Crop-wrapper style applied only when crop is active.
  // Cluster 19 v1.2 — the wrapper has NO explicit width. Its
  // intrinsic dimensions come from a hidden inline <svg> placeholder
  // rendered inside (see the JSX below). The SVG behaves like an
  // <img> for sizing — `max-width: 100%` lets it scale down, and
  // `min-content` is 1 px (replaceable element). That makes the
  // absolute-positioning shrink-to-fit chain at
  // .cortex-image-wrap-free actually compress when freeX runs the
  // image past the editor's right edge:
  //
  //   final-width = min(max-content, max(min-content, available-width))
  //
  // With an explicit `width: cropDisplayedW px` on the wrapper,
  // min-content gets set to that declared width, the formula
  // returns cropDisplayedW regardless of available-width, and the
  // wrapper never compresses. The SVG-placeholder pattern restores
  // the natural <img>-style flexibility.
  //
  // Aspect ratio is preserved by the SVG's own intrinsic ratio
  // (declared via `width` and `height` HTML attrs), so we don't
  // need a separate aspect-ratio CSS prop here.
  const cropWrapperStyle: React.CSSProperties | undefined = cropActive
    ? {
        display: "inline-block",
        position: "relative",
        verticalAlign: "top",
        overflow: "hidden",
        // Hard line-height: 0 so the SVG doesn't introduce a
        // descender gap below it (the wrapper would otherwise be a
        // few px taller than the crop region).
        lineHeight: 0,
        fontSize: 0,
        transform: composedTransform,
        // Cluster 19 v1.2 — drop-shadow moved here from the inner
        // img so the shadow rings the visible cropped result. The
        // values mirror the .cortex-image filter (light theme); a
        // companion CSS rule themes it for dark mode without
        // having to read theme state in JS.
        filter: "drop-shadow(1px 2px 4px rgba(0, 0, 0, 0.28))",
      }
    : undefined;

  // SVG placeholder style. `max-width: 100%` is what gives the
  // chain its compression. `height: auto` derives height from the
  // capped width. visibility: hidden keeps the SVG present in flow
  // (so it drives layout) but invisible.
  const cropSvgStyle: React.CSSProperties | undefined = cropActive
    ? {
        display: "block",
        maxWidth: "100%",
        height: "auto",
        visibility: "hidden",
      }
    : undefined;

  // Cluster 19 v1.2 — onLoad reads natural dimensions out of the
  // loaded <img>. The crop wrapper math depends on these. On src
  // change (e.g. user replaces the image) we re-read so coords stay
  // consistent.
  const handleImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const i = e.currentTarget;
      if (i.naturalWidth > 0 && i.naturalHeight > 0) {
        setNaturalSize({ w: i.naturalWidth, h: i.naturalHeight });
      }
    },
    [],
  );

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
          image's exact rendered bounds, including post-resize updates).
          Cluster 19 v1.2 — when crop is active, the <img> sits inside
          a crop-wrapper that has overflow:hidden + crop dimensions, and
          the rotation/flip transform moves to that wrapper so it
          rotates the cropped result (not the full natural image inside
          the clip window). The anchor's box still tracks the visible
          rendered bounds, so the corner handles stay anchored
          correctly. */}
      <span className="cortex-image-anchor">
        {cropActive && cropWrapperStyle && cropDisplayedW != null ? (
          <span className="cortex-image-crop-wrapper" style={cropWrapperStyle}>
            {/* Cluster 19 v1.2 — invisible SVG placeholder. Drives
                the wrapper's intrinsic dimensions so the chain
                shrink-to-fit at .cortex-image-wrap-free can compress
                the wrapper when freeX pushes it past the parent's
                right edge. The SVG's intrinsic aspect ratio
                (cropW × cropH expressed via width / height attrs)
                also means the wrapper's height auto-derives from
                whatever width the browser settles on. */}
            <svg
              width={Math.max(1, Math.round(cropDisplayedW))}
              height={Math.max(
                1,
                Math.round(
                  cropDisplayedW * ((cropH as number) / (cropW as number)),
                ),
              )}
              style={cropSvgStyle}
              aria-hidden="true"
            />
            <img
              ref={imgRef}
              src={resolvedSrc}
              alt=""
              className="cortex-image"
              draggable={false}
              style={imgStyle}
              onClick={onClick}
              onLoad={handleImgLoad}
            />
          </span>
        ) : (
          <img
            ref={imgRef}
            src={resolvedSrc}
            alt=""
            className="cortex-image"
            draggable={false}
            style={imgStyle}
            onClick={onClick}
            onLoad={handleImgLoad}
          />
        )}

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
