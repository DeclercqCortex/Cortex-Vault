// CropModal — Cluster 19 v1.2; live preview thumbnail added v1.3.
//
// Modal opened from ImageContextMenu's "Crop image…" entry. Renders
// the source image inside a fixed-aspect frame with a draggable rect
// overlay, plus (v1.3) a small live preview thumbnail next to the
// status row showing what the cropped output will look like. On
// Apply, the host writes the four cropX/Y/W/H attrs onto the
// cortexImage node — non-destructive; no file is written.
//
// Interaction model:
//   - Body drag inside the rect = move the rect (clamped to image bounds)
//   - 4 corner handles = resize from that corner (rect stays inside image)
//   - Pixel coordinates internally; rendered into a CSS-scaled preview
//   - Live preview canvas (v1.3) redraws on every rect / natural change
//
// Cancel and Esc close without writing. Apply is the only commit path.
//
// Implementation note: the preview <img> uses the SAME asset:// URL the
// NodeView resolves (passed in from the host), so we read from the
// same file the user is editing. We don't pre-load via fetch — the
// browser caches the image, and canvas.drawImage works directly from
// an HTMLImageElement.

import { useCallback, useEffect, useRef, useState } from "react";

export interface CropModalProps {
  isOpen: boolean;
  /** asset:// URL the NodeView already uses to render this image. */
  imageUrl: string;
  /** Cluster 19 v1.2 — existing crop coords on the node, if any. When
   *  all four are non-null the modal opens with the saved rect already
   *  applied so the user is editing-an-existing-crop rather than
   *  starting from scratch. The displayed image is always the ORIGINAL
   *  (non-destructive crop), so re-cropping can expand outward as well
   *  as shrink inward. */
  initialCrop: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  /** Called on Apply with the new crop rect (or null when the user
   *  picks "Reset crop", reverting to the un-cropped natural image).
   *  The host writes these onto the cortexImage node's cropX/Y/W/H
   *  attrs. No file is written; the crop is purely display state. */
  onApplied: (
    rect: { x: number; y: number; w: number; h: number } | null,
  ) => void;
  onClose: () => void;
}

/** Crop rectangle in NATURAL image-pixel coordinates. */
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode =
  | { kind: "none" }
  | { kind: "move"; startMouse: { x: number; y: number }; startRect: CropRect }
  | {
      kind: "resize";
      corner: "nw" | "ne" | "sw" | "se";
      startMouse: { x: number; y: number };
      startRect: CropRect;
    };

/** Maximum preview width / height in viewport pixels. The image is
 *  scaled down to fit within these bounds while preserving aspect. */
const MAX_PREVIEW_W = 720;
const MAX_PREVIEW_H = 520;

/** Cluster 19 v1.3 — Maximum thumbnail width / height for the live
 *  cropped-output preview. The thumbnail aspect matches the rect's
 *  aspect, fit within these bounds. Small enough to sit in the
 *  status row without bloating modal width. */
const MAX_THUMB_W = 160;
const MAX_THUMB_H = 120;

export function CropModal({
  isOpen,
  imageUrl,
  initialCrop,
  onApplied,
  onClose,
}: CropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Cluster 19 v1.3 — live preview thumbnail of the current crop rect.
  // Kept as a ref so we can imperatively drawImage on every rect
  // change without going through React's render path.
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [drag, setDrag] = useState<DragMode>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on open / image change.
  useEffect(() => {
    if (!isOpen) return;
    setNatural(null);
    setRect(null);
    setDrag({ kind: "none" });
    setBusy(false);
    setError(null);
  }, [isOpen, imageUrl]);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNatural({ w, h });
    // Cluster 19 v1.2 — seed the rect from the existing crop attrs
    // when present; the user is editing an existing crop, and the
    // initial state should reflect what they currently have. When
    // there's no existing crop, default to a 10%-inset rect so
    // there's something visible to drag.
    if (
      initialCrop &&
      initialCrop.w > 0 &&
      initialCrop.h > 0 &&
      initialCrop.x >= 0 &&
      initialCrop.y >= 0 &&
      initialCrop.x + initialCrop.w <= w &&
      initialCrop.y + initialCrop.h <= h
    ) {
      setRect({
        x: initialCrop.x,
        y: initialCrop.y,
        w: initialCrop.w,
        h: initialCrop.h,
      });
    } else {
      const insetX = Math.round(w * 0.1);
      const insetY = Math.round(h * 0.1);
      setRect({
        x: insetX,
        y: insetY,
        w: Math.max(1, w - 2 * insetX),
        h: Math.max(1, h - 2 * insetY),
      });
    }
  }, [initialCrop]);

  // Compute scale so the preview fits within MAX_PREVIEW_W x MAX_PREVIEW_H.
  const scale = (() => {
    if (!natural) return 1;
    const sx = MAX_PREVIEW_W / natural.w;
    const sy = MAX_PREVIEW_H / natural.h;
    return Math.min(1, sx, sy);
  })();
  const previewW = natural ? Math.round(natural.w * scale) : 0;
  const previewH = natural ? Math.round(natural.h * scale) : 0;

  // Cluster 19 v1.3 — live preview thumbnail dimensions. Match the
  // current rect's aspect, scaled to fit within MAX_THUMB_W ×
  // MAX_THUMB_H. Falls back to MAX_THUMB_W × (MAX_THUMB_W * 0.75)
  // before the rect arrives so the layout stays stable.
  const thumbDims = (() => {
    if (!rect || rect.w <= 0 || rect.h <= 0) {
      return { w: MAX_THUMB_W, h: Math.round(MAX_THUMB_W * 0.75) };
    }
    const sx = MAX_THUMB_W / rect.w;
    const sy = MAX_THUMB_H / rect.h;
    const s = Math.min(sx, sy);
    return {
      w: Math.max(1, Math.round(rect.w * s)),
      h: Math.max(1, Math.round(rect.h * s)),
    };
  })();

  // Cluster 19 v1.3 — redraw the preview canvas whenever the rect or
  // natural dimensions change. Uses drawImage(img, sx, sy, sw, sh,
  // 0, 0, dw, dh) so we sample directly from the loaded <img> at
  // native resolution and let the canvas handle the downscale to
  // thumbnail dimensions.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !natural || !rect) return;
    canvas.width = thumbDims.w;
    canvas.height = thumbDims.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Clear (canvas resize already does this, but be explicit so a
    // 0×0-rect edge case still leaves a clean canvas).
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // ImageBitmapRenderingContext-free path: drawImage from an
    // HTMLImageElement is universally supported.
    try {
      ctx.drawImage(
        img,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        0,
        0,
        thumbDims.w,
        thumbDims.h,
      );
    } catch {
      // Cross-origin guard. Local file:// → asset:// shouldn't trip
      // this, but be defensive: clear the canvas so the user sees a
      // blank instead of stale pixels from a previous rect.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [rect, natural, thumbDims.w, thumbDims.h]);

  // ---- pointer handlers (overlay-relative, then mapped to natural px) ----

  const startDrag = useCallback(
    (
      e: React.PointerEvent,
      mode: "move" | "resize",
      corner?: "nw" | "ne" | "sw" | "se",
    ) => {
      if (!rect || !natural) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      const startMouse = { x: e.clientX, y: e.clientY };
      if (mode === "move") {
        setDrag({ kind: "move", startMouse, startRect: { ...rect } });
      } else {
        setDrag({
          kind: "resize",
          corner: corner!,
          startMouse,
          startRect: { ...rect },
        });
      }
    },
    [rect, natural],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag.kind === "none" || !natural || !rect) return;
      const dxScreen = e.clientX - drag.startMouse.x;
      const dyScreen = e.clientY - drag.startMouse.y;
      // Map screen-px delta into image-natural-px delta.
      const dxNat = dxScreen / scale;
      const dyNat = dyScreen / scale;
      const r = drag.startRect;
      let next: CropRect = { ...r };
      if (drag.kind === "move") {
        next.x = clamp(r.x + dxNat, 0, natural.w - r.w);
        next.y = clamp(r.y + dyNat, 0, natural.h - r.h);
      } else if (drag.kind === "resize") {
        const minSize = 4;
        switch (drag.corner) {
          case "nw": {
            const newX = clamp(r.x + dxNat, 0, r.x + r.w - minSize);
            const newY = clamp(r.y + dyNat, 0, r.y + r.h - minSize);
            next = {
              x: newX,
              y: newY,
              w: r.x + r.w - newX,
              h: r.y + r.h - newY,
            };
            break;
          }
          case "ne": {
            const newY = clamp(r.y + dyNat, 0, r.y + r.h - minSize);
            const newW = clamp(r.w + dxNat, minSize, natural.w - r.x);
            next = { x: r.x, y: newY, w: newW, h: r.y + r.h - newY };
            break;
          }
          case "sw": {
            const newX = clamp(r.x + dxNat, 0, r.x + r.w - minSize);
            const newH = clamp(r.h + dyNat, minSize, natural.h - r.y);
            next = { x: newX, y: r.y, w: r.x + r.w - newX, h: newH };
            break;
          }
          case "se": {
            const newW = clamp(r.w + dxNat, minSize, natural.w - r.x);
            const newH = clamp(r.h + dyNat, minSize, natural.h - r.y);
            next = { x: r.x, y: r.y, w: newW, h: newH };
            break;
          }
        }
      }
      next.x = Math.round(next.x);
      next.y = Math.round(next.y);
      next.w = Math.round(next.w);
      next.h = Math.round(next.h);
      setRect(next);
    },
    [drag, natural, rect, scale],
  );

  const onPointerUp = useCallback(() => {
    if (drag.kind !== "none") setDrag({ kind: "none" });
  }, [drag]);

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // ---- Apply: pass back the crop rect; host writes attrs ----
  // Cluster 19 v1.2 — non-destructive. No bytes encoded, no file
  // written. The cortexImage node's src never changes; the crop is
  // purely display state stored as cropX/Y/W/H attrs. Re-cropping
  // opens the modal seeded with the saved rect so the user can
  // expand back outward, not just shrink further.
  function applyCrop() {
    if (!natural || !rect) return;
    setBusy(true);
    setError(null);
    try {
      onApplied({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        w: Math.max(1, Math.round(rect.w)),
        h: Math.max(1, Math.round(rect.h)),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Cluster 19 v1.2 — Reset crop. Clears the four attrs on the host
  // node so the image renders un-cropped. Available only when an
  // existing crop is in place (no point clearing nothing).
  function resetCrop() {
    onApplied(null);
  }

  if (!isOpen) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Crop image</h2>
          <button onClick={onClose} style={styles.closeBtn} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <div
            style={{
              position: "relative",
              width: previewW || MAX_PREVIEW_W,
              height: previewH || MAX_PREVIEW_H,
              userSelect: "none",
            }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              style={{
                width: previewW || "auto",
                height: previewH || "auto",
                display: "block",
                background: "#222",
              }}
            />
            {natural && rect && (
              <div
                ref={overlayRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
              >
                {/* Dark mask outside the crop rect — four edge bands. */}
                <div
                  style={{
                    ...maskStyle,
                    top: 0,
                    left: 0,
                    width: previewW,
                    height: rect.y * scale,
                  }}
                />
                <div
                  style={{
                    ...maskStyle,
                    top: (rect.y + rect.h) * scale,
                    left: 0,
                    width: previewW,
                    height: previewH - (rect.y + rect.h) * scale,
                  }}
                />
                <div
                  style={{
                    ...maskStyle,
                    top: rect.y * scale,
                    left: 0,
                    width: rect.x * scale,
                    height: rect.h * scale,
                  }}
                />
                <div
                  style={{
                    ...maskStyle,
                    top: rect.y * scale,
                    left: (rect.x + rect.w) * scale,
                    width: previewW - (rect.x + rect.w) * scale,
                    height: rect.h * scale,
                  }}
                />
                {/* Crop rect — pointer events ON for body + handles. */}
                <div
                  style={{
                    position: "absolute",
                    left: rect.x * scale,
                    top: rect.y * scale,
                    width: rect.w * scale,
                    height: rect.h * scale,
                    border: "1.5px solid var(--accent)",
                    pointerEvents: "auto",
                    cursor: drag.kind === "move" ? "grabbing" : "grab",
                  }}
                  onPointerDown={(e) => startDrag(e, "move")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {(["nw", "ne", "sw", "se"] as const).map((c) => (
                    <div
                      key={c}
                      style={{
                        ...handleStyle,
                        left: c === "nw" || c === "sw" ? -5 : "auto",
                        right: c === "ne" || c === "se" ? -5 : "auto",
                        top: c === "nw" || c === "ne" ? -5 : "auto",
                        bottom: c === "sw" || c === "se" ? -5 : "auto",
                        cursor:
                          c === "nw" || c === "se"
                            ? "nwse-resize"
                            : "nesw-resize",
                      }}
                      onPointerDown={(e) => startDrag(e, "resize", c)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={styles.statusRow}>
          {natural && rect ? (
            <span style={styles.dim}>
              {rect.w} × {rect.h} px (from {natural.w} × {natural.h})
            </span>
          ) : (
            <span style={styles.dim}>Loading image…</span>
          )}
          <div style={{ flex: 1 }} />
          {/* Cluster 19 v1.3 — live preview thumbnail. Sits to the
              right of the dimension status so the user can see what
              the cropped output will look like as they drag. */}
          <div style={styles.thumbWrap}>
            <span style={styles.thumbLabel}>Preview</span>
            <canvas
              ref={previewCanvasRef}
              style={{
                width: thumbDims.w,
                height: thumbDims.h,
                background: "#222",
                border: "1px solid var(--border)",
                borderRadius: "3px",
                display: "block",
              }}
              aria-label="Preview of the cropped image"
            />
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.btnGhost} disabled={busy}>
            Cancel
          </button>
          {/* Cluster 19 v1.2 — Reset crop only meaningful when an
              existing crop is in place. Clears the four crop attrs
              on the host node, reverting to the un-cropped image. */}
          {initialCrop && (
            <button
              onClick={resetCrop}
              style={styles.btnGhost}
              disabled={busy}
              title="Clear the crop on this image (revert to the full original)"
            >
              Reset crop
            </button>
          )}
          <button
            onClick={applyCrop}
            style={styles.btnPrimary}
            disabled={busy || !natural || !rect}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const maskStyle: React.CSSProperties = {
  position: "absolute",
  background: "rgba(0,0,0,0.5)",
  pointerEvents: "none",
};

const handleStyle: React.CSSProperties = {
  position: "absolute",
  width: 10,
  height: 10,
  background: "var(--accent)",
  borderRadius: "50%",
  border: "1px solid white",
  zIndex: 1,
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
    padding: "1rem 1.25rem 0.9rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    maxWidth: "95vw",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "1rem",
  },
  title: { margin: 0, fontSize: "1.05rem", fontWeight: 600 },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-2)",
    fontSize: "1.05rem",
    cursor: "pointer",
  },
  body: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "var(--bg)",
    padding: "0.5rem",
    borderRadius: "4px",
    overflow: "hidden",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.8rem",
  },
  dim: { color: "var(--text-2)" },
  // Cluster 19 v1.3 — preview thumbnail container. Sits at the right
  // end of the status row above the footer.
  thumbWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  thumbLabel: {
    fontSize: "0.72rem",
    color: "var(--text-2)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  error: {
    background: "var(--danger-bg, #ffe6e6)",
    color: "var(--danger)",
    padding: "0.4rem 0.7rem",
    borderRadius: "4px",
    fontSize: "0.82rem",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
    paddingTop: "0.4rem",
    borderTop: "1px solid var(--border)",
  },
  btnGhost: {
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "5px 14px",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  btnPrimary: {
    background: "var(--accent)",
    color: "white",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    padding: "5px 16px",
    fontSize: "0.85rem",
    cursor: "pointer",
    fontWeight: 600,
  },
};
