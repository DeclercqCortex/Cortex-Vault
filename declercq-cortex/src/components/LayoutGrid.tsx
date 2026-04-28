// LayoutGrid — renders N tab slots in the requested layout, with
// draggable dividers between panes that resize them live.
//
// Layouts:
//   single      → 1 cell.
//   dual        → 2 cols, 1 row.        Vertical divider between cols.
//   tri-bottom  → 2 rows. Top row has 2 cols, bottom row spans full width.
//                  Vertical divider in top row, horizontal divider between rows.
//   tri-top     → 2 rows. Top row spans full width, bottom row has 2 cols.
//                  Vertical divider in bottom row, horizontal divider between rows.
//   quad        → 2 rows × 2 cols. Vertical + horizontal dividers.
//
// Slot numbering is top-to-bottom, left-to-right (matches the cluster spec).
//
// Resize state lives in the parent — we receive col/row fractions and
// notify on drag. Fractions are clamped to [0.15, 0.85] so a slot can
// never collapse to zero by accident.

import { useEffect, useRef } from "react";
import type { LayoutMode } from "./LayoutPicker";

const MIN_FRAC = 0.15;
const MAX_FRAC = 0.85;
const HANDLE_PX = 6; // visible width/height of the divider strip

type Props = {
  mode: LayoutMode;
  /** colFrac and rowFrac are values in [0,1]. */
  colFrac: number;
  rowFrac: number;
  onColFracChange: (next: number) => void;
  onRowFracChange: (next: number) => void;
  /** One child per slot, in slot order (slot 0 first). */
  children: React.ReactNode[];
};

export function LayoutGrid(props: Props) {
  const { mode, colFrac, rowFrac, onColFracChange, onRowFracChange, children } =
    props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // For tri-bottom and tri-top there is one logical column-divider but
  // it only spans one of the two rows. We render it as a small strip
  // in the appropriate row, positioned via gridArea overlap with the
  // adjacent panes.
  switch (mode) {
    case "single": {
      return (
        <div ref={containerRef} style={{ ...gridBase }}>
          <div style={cellStyle()}>{children[0]}</div>
        </div>
      );
    }
    case "dual": {
      // 2 cols, 1 row, draggable vertical divider in the middle.
      return (
        <div
          ref={containerRef}
          style={{
            ...gridBase,
            gridTemplate: `1fr / ${colFrac}fr ${HANDLE_PX}px ${1 - colFrac}fr`,
          }}
        >
          <div style={cellStyle()}>{children[0]}</div>
          <VDivider
            containerRef={containerRef}
            onChange={onColFracChange}
            // colFrac for dual takes the two non-handle tracks; the
            // handle is in the middle column.
            getCurrent={() => colFrac}
          />
          <div style={cellStyle()}>{children[1]}</div>
        </div>
      );
    }
    case "tri-bottom": {
      // 2 rows: top row has [a, vdiv, b]; bottom row is c spanning all 3 cols.
      // Horizontal divider between the two rows spans full width.
      return (
        <div
          ref={containerRef}
          style={{
            ...gridBase,
            gridTemplateColumns: `${colFrac}fr ${HANDLE_PX}px ${1 - colFrac}fr`,
            gridTemplateRows: `${rowFrac}fr ${HANDLE_PX}px ${1 - rowFrac}fr`,
            gridTemplateAreas: `
              "a v b"
              "h h h"
              "c c c"
            `,
          }}
        >
          <div style={{ ...cellStyle(), gridArea: "a" }}>{children[0]}</div>
          <VDivider
            containerRef={containerRef}
            onChange={onColFracChange}
            getCurrent={() => colFrac}
            gridArea="v"
          />
          <div style={{ ...cellStyle(), gridArea: "b" }}>{children[1]}</div>
          <HDivider
            containerRef={containerRef}
            onChange={onRowFracChange}
            getCurrent={() => rowFrac}
            gridArea="h"
          />
          <div style={{ ...cellStyle(), gridArea: "c" }}>{children[2]}</div>
        </div>
      );
    }
    case "tri-top": {
      // 2 rows: top row is a spanning all 3 cols; bottom row has [b, vdiv, c].
      return (
        <div
          ref={containerRef}
          style={{
            ...gridBase,
            gridTemplateColumns: `${colFrac}fr ${HANDLE_PX}px ${1 - colFrac}fr`,
            gridTemplateRows: `${rowFrac}fr ${HANDLE_PX}px ${1 - rowFrac}fr`,
            gridTemplateAreas: `
              "a a a"
              "h h h"
              "b v c"
            `,
          }}
        >
          <div style={{ ...cellStyle(), gridArea: "a" }}>{children[0]}</div>
          <HDivider
            containerRef={containerRef}
            onChange={onRowFracChange}
            getCurrent={() => rowFrac}
            gridArea="h"
          />
          <div style={{ ...cellStyle(), gridArea: "b" }}>{children[1]}</div>
          <VDivider
            containerRef={containerRef}
            onChange={onColFracChange}
            getCurrent={() => colFrac}
            gridArea="v"
          />
          <div style={{ ...cellStyle(), gridArea: "c" }}>{children[2]}</div>
        </div>
      );
    }
    case "quad": {
      // 2x2 with both dividers. CSS Grid requires every named area to
      // be rectangular, so we can't have a single "v" spanning rows 1
      // and 3 with "x" between them. Use four distinct shards (v1,
      // v2, h1, h2) — each rectangular — and have all of them share
      // the same colFrac / rowFrac state, so dragging any one moves
      // its counterparts together.
      return (
        <div
          ref={containerRef}
          style={{
            ...gridBase,
            gridTemplateColumns: `${colFrac}fr ${HANDLE_PX}px ${1 - colFrac}fr`,
            gridTemplateRows: `${rowFrac}fr ${HANDLE_PX}px ${1 - rowFrac}fr`,
            gridTemplateAreas: `
              "a  v1 b"
              "h1 x  h2"
              "c  v2 d"
            `,
          }}
        >
          <div style={{ ...cellStyle(), gridArea: "a" }}>{children[0]}</div>
          <div style={{ ...cellStyle(), gridArea: "b" }}>{children[1]}</div>
          <div style={{ ...cellStyle(), gridArea: "c" }}>{children[2]}</div>
          <div style={{ ...cellStyle(), gridArea: "d" }}>{children[3]}</div>
          <VDivider
            containerRef={containerRef}
            onChange={onColFracChange}
            getCurrent={() => colFrac}
            gridArea="v1"
          />
          <VDivider
            containerRef={containerRef}
            onChange={onColFracChange}
            getCurrent={() => colFrac}
            gridArea="v2"
          />
          <HDivider
            containerRef={containerRef}
            onChange={onRowFracChange}
            getCurrent={() => rowFrac}
            gridArea="h1"
          />
          <HDivider
            containerRef={containerRef}
            onChange={onRowFracChange}
            getCurrent={() => rowFrac}
            gridArea="h2"
          />
          <CornerCap gridArea="x" />
        </div>
      );
    }
  }
}

const gridBase: React.CSSProperties = {
  display: "grid",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "var(--border)",
};

function cellStyle(): React.CSSProperties {
  return {
    background: "var(--bg)",
    overflow: "hidden",
    position: "relative",
    minWidth: 0,
    minHeight: 0,
  };
}

/** Draggable vertical strip (resizes column tracks). */
function VDivider({
  containerRef,
  onChange,
  getCurrent,
  gridArea,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  onChange: (next: number) => void;
  getCurrent: () => number;
  gridArea?: string;
}) {
  const draggingRef = useRef(false);

  useEffect(() => {
    return () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Subtract the handle width so the fraction maps to actual content area.
      const usable = Math.max(1, rect.width - HANDLE_PX);
      const x = ev.clientX - rect.left - HANDLE_PX / 2;
      let frac = x / usable;
      if (frac < MIN_FRAC) frac = MIN_FRAC;
      if (frac > MAX_FRAC) frac = MAX_FRAC;
      onChange(frac);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      onMouseDown={startDrag}
      onDoubleClick={(e) => {
        // Equalize the two columns this divider straddles.
        e.preventDefault();
        onChange(0.5);
      }}
      style={{
        gridArea,
        cursor: "col-resize",
        background: "var(--border)",
        position: "relative",
        userSelect: "none",
      }}
      aria-label="Resize columns (double-click to equalize)"
      title="Drag to resize · double-click to equalize"
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "2px",
          height: "30px",
          background: "var(--text-muted)",
          opacity: 0.4,
          borderRadius: "1px",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/** Draggable horizontal strip (resizes row tracks). */
function HDivider({
  containerRef,
  onChange,
  getCurrent,
  gridArea,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  onChange: (next: number) => void;
  getCurrent: () => number;
  gridArea?: string;
}) {
  const draggingRef = useRef(false);

  useEffect(() => {
    return () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const usable = Math.max(1, rect.height - HANDLE_PX);
      const y = ev.clientY - rect.top - HANDLE_PX / 2;
      let frac = y / usable;
      if (frac < MIN_FRAC) frac = MIN_FRAC;
      if (frac > MAX_FRAC) frac = MAX_FRAC;
      onChange(frac);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      onMouseDown={startDrag}
      onDoubleClick={(e) => {
        // Equalize the two rows this divider straddles.
        e.preventDefault();
        onChange(0.5);
      }}
      style={{
        gridArea,
        cursor: "row-resize",
        background: "var(--border)",
        position: "relative",
        userSelect: "none",
      }}
      aria-label="Resize rows (double-click to equalize)"
      title="Drag to resize · double-click to equalize"
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "30px",
          height: "2px",
          background: "var(--text-muted)",
          opacity: 0.4,
          borderRadius: "1px",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/** The intersection of the H and V dividers in the quad layout — purely visual. */
function CornerCap({ gridArea }: { gridArea: string }) {
  return (
    <div
      style={{
        gridArea,
        background: "var(--border)",
        pointerEvents: "none",
      }}
    />
  );
}
