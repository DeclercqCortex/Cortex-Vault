// ImageViewer — Cluster 19 v1.0.
//
// Stand-alone view for opening an image file directly in a tab slot
// (mirrors how PDFReader handles .pdf files). Routed by App.tsx's
// selectFileInSlot when the user clicks a .jpg/.jpeg/.png/.gif/.webp/
// .svg in the file tree, and by TabPane's openPath when the active
// view should be `image-viewer`.
//
// Renders the image via Tauri's convertFileSrc + asset:// protocol
// (which we enabled in tauri.conf.json under
// app.security.assetProtocol). Pan / zoom / fit-to-window controls
// are kept simple — Cortex isn't trying to be a full image editor;
// the viewer is for "I dropped this in my notes folder, what's in
// it?" use cases.

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface ImageViewerProps {
  /** Absolute path to the image file. */
  filePath: string;
  /** Click handler for the back / close button. */
  onClose: () => void;
}

const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;

function basename(p: string): string {
  if (!p) return "";
  const sep = p.includes("\\") ? "\\" : "/";
  return p.split(sep).pop() ?? p;
}

export function ImageViewer({ filePath, onClose }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  // Pan offset in pixels (only used when fit=false and the image is
  // larger than its container).
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => {
    if (!filePath) return "";
    try {
      return convertFileSrc(filePath);
    } catch (e) {
      setError(`convertFileSrc failed: ${String(e)}`);
      return "";
    }
  }, [filePath]);

  // Reset state when the path changes.
  useEffect(() => {
    setZoom(1);
    setFit(true);
    setPan({ x: 0, y: 0 });
    setNaturalSize(null);
    setError(null);
  }, [filePath]);

  // Wheel-to-zoom over the canvas (Ctrl+wheel zooms; plain wheel scrolls).
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setFit(false);
      setZoom((z) => {
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      });
    }
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel as EventListener);
  }, []);

  // Drag-to-pan when not in fit mode.
  const dragRef = useRef<{
    start: { x: number; y: number };
    pan: { x: number; y: number };
  } | null>(null);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (fit) return; // pan is meaningless when fit-to-window
    dragRef.current = {
      start: { x: e.clientX, y: e.clientY },
      pan: { ...pan },
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    setPan({
      x: d.pan.x + (e.clientX - d.start.x),
      y: d.pan.y + (e.clientY - d.start.y),
    });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function zoomIn() {
    setFit(false);
    setZoom((z) => Math.min(MAX_ZOOM, z * ZOOM_STEP));
  }
  function zoomOut() {
    setFit(false);
    setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_STEP));
  }
  function zoom100() {
    setFit(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  function fitWindow() {
    setFit(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.8rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elev)",
          flexShrink: 0,
        }}
      >
        <button onClick={onClose} style={ghostBtn} title="Close image viewer">
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {basename(filePath)}
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
            }}
          >
            {filePath}
            {naturalSize && (
              <span style={{ marginLeft: "0.5rem" }}>
                · {naturalSize.w}×{naturalSize.h}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={zoomOut}
          style={ghostBtn}
          title="Zoom out (Ctrl+wheel)"
        >
          −
        </button>
        <button onClick={zoom100} style={ghostBtn} title="Actual size">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={zoomIn} style={ghostBtn} title="Zoom in (Ctrl+wheel)">
          +
        </button>
        <button
          onClick={fitWindow}
          style={fit ? primaryBtn : ghostBtn}
          title="Fit to window"
        >
          Fit
        </button>
      </div>

      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: fit ? "default" : "grab",
          background:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%) 0 0 / 16px 16px," +
            "linear-gradient(-45deg, var(--bg) 25%, transparent 25%) 0 8px / 16px 16px," +
            "linear-gradient(45deg, transparent 75%, var(--bg) 75%) 8px -8px / 16px 16px," +
            "linear-gradient(-45deg, transparent 75%, var(--bg) 75%) 8px 0 / 16px 16px," +
            "var(--bg-elev)",
        }}
      >
        {error && (
          <div
            style={{
              padding: "1rem",
              color: "var(--danger)",
              fontSize: "0.85rem",
            }}
          >
            {error}
          </div>
        )}
        {!error && url && (
          <img
            src={url}
            alt={basename(filePath)}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({
                w: img.naturalWidth,
                h: img.naturalHeight,
              });
            }}
            onError={() =>
              setError(
                "Couldn't load image. Check that the file exists and the asset protocol is enabled in tauri.conf.json.",
              )
            }
            style={
              fit
                ? {
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    display: "block",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  }
                : {
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "center",
                    display: "block",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  }
            }
          />
        )}
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-2)",
  padding: "3px 9px",
  fontSize: "0.78rem",
  borderRadius: "4px",
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  ...ghostBtn,
  background: "var(--accent-bg-2)",
  borderColor: "var(--accent)",
  color: "var(--accent)",
};
