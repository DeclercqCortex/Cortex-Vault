import { useEffect, useState } from "react";

/**
 * Cluster 26 — Cerebrum splash
 *
 * Pure-CSS-3D startup composition: a luminous brain mark at the centre with
 * seven electron-style rays orbiting on tilted planes. Adopted from the
 * Claude Design system recipe in
 * `design-system/ui_kits/cortex-app/overlays.jsx` and backed by the
 * `.splash-*` rules appended to `src/index.css`.
 *
 * No Three.js / WebGL / Lottie. Every animated element is a CSS transform
 * on a positioned div, GPU-composited by the browser. Honours
 * `prefers-reduced-motion` via the matching `@media` block in
 * `index.css` — the rays freeze in their initial tilt and the captions
 * appear at full opacity instantly.
 *
 * Lifecycle:
 *   visible=true  → mounts, fades in, animations run
 *   visible=false → fade-out animation runs (480 ms), then unmounts;
 *                   `onFadedOut` fires on the unmount tick so the parent
 *                   can free any work it was holding behind the splash.
 *
 * Layering:
 *   The splash uses `position: fixed; inset: 0; z-index: 1`. The welcome
 *   card (when rendered) sits at a higher z-index via App.tsx's baseStyle
 *   so it floats over the rotating brain. After vault selection the
 *   splash unmounts entirely and the app chrome takes over.
 */
export interface CerebrumSplashProps {
  /** Show / hide. Parent controls visibility; on `false`, the component
   *  fades out over 480 ms then unmounts. */
  visible: boolean;
  /** Optional callback fired right after fade-out completes and the
   *  component unmounts. Used by App.tsx to free state once the welcome
   *  card has taken over. */
  onFadedOut?: () => void;
  /** Optional caption override. Pass `null` to suppress the caption
   *  block entirely (e.g. when the splash is reused as a brand badge). */
  caption?: { title: string; subtitle: string } | null;
}

/**
 * Per-orbit parameters cribbed from the Claude Design recipe. Each row:
 *   rx / ry / rz — initial 3D tilt of the orbit plane (degrees)
 *   dur          — seconds per revolution (irrational ratios so the
 *                   pattern never visually repeats)
 *   delay        — negative seconds so each orbit starts at a different
 *                   phase of its revolution on first paint
 *   hue          — `blue` | `violet` | `teal` (maps to a CSS class)
 *   thick        — ray thickness in px
 *   len          — ray length as a % of the orbit plane's diameter
 */
const ORBITS = [
  { rx: 14, ry: 22, rz: 8, dur: 7.2, delay: 0, hue: "blue", thick: 3, len: 78 },
  {
    rx: -38,
    ry: 56,
    rz: -22,
    dur: 9.4,
    delay: -1.1,
    hue: "violet",
    thick: 2,
    len: 72,
  },
  {
    rx: 62,
    ry: -18,
    rz: 44,
    dur: 11.8,
    delay: -3.4,
    hue: "teal",
    thick: 4,
    len: 84,
  },
  {
    rx: -72,
    ry: -8,
    rz: 18,
    dur: 8.6,
    delay: -2.0,
    hue: "blue",
    thick: 2,
    len: 66,
  },
  {
    rx: 28,
    ry: 84,
    rz: -36,
    dur: 13.2,
    delay: -5.1,
    hue: "violet",
    thick: 3,
    len: 80,
  },
  {
    rx: -16,
    ry: -54,
    rz: 72,
    dur: 10.0,
    delay: -0.6,
    hue: "teal",
    thick: 2,
    len: 70,
  },
  {
    rx: 88,
    ry: 32,
    rz: -52,
    dur: 14.6,
    delay: -4.2,
    hue: "blue",
    thick: 4,
    len: 88,
  },
] as const;

const DEFAULT_CAPTION = {
  title: "Cortex",
  subtitle: "local-first research notebook",
};

export function CerebrumSplash({
  visible,
  onFadedOut,
  caption = DEFAULT_CAPTION,
}: CerebrumSplashProps) {
  // `mounted` decouples the React lifecycle from the visibility prop so
  // the fade-out has a chance to play before the DOM is removed.
  const [mounted, setMounted] = useState<boolean>(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    // Fade-out is 480 ms; unmount one tick after to let the transition
    // finish painting.
    const id = window.setTimeout(() => {
      setMounted(false);
      onFadedOut?.();
    }, 520);
    return () => window.clearTimeout(id);
  }, [visible, mounted, onFadedOut]);

  if (!mounted) return null;

  return (
    <div
      className={`splash${visible ? "" : " splash--out"}`}
      aria-hidden="true"
    >
      <div className="splash-vignette" />

      <div className="splash-scene">
        <div className="splash-stage">
          {ORBITS.map((o, i) => (
            <div
              key={i}
              className={`splash-orbit hue-${o.hue}`}
              style={
                {
                  "--rx": `${o.rx}deg`,
                  "--ry": `${o.ry}deg`,
                  "--rz": `${o.rz}deg`,
                  "--dur": `${o.dur}s`,
                  "--delay": `${o.delay}s`,
                } as React.CSSProperties
              }
            >
              <div
                className="splash-ray"
                style={
                  {
                    "--thick": `${o.thick}px`,
                    "--len": `${o.len}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          ))}

          <div className="splash-core">
            <div className="splash-core-glow" />
            <div className="splash-core-ring" />
            {/* Cortex brand mark — the SVG is now self-contained: the
             *  PNG bytes are embedded as a base64 data URI directly
             *  inside the SVG file, so there are no external resource
             *  references for Chromium's <img> sandbox to block. Same
             *  brain image as before, just standardized on the
             *  canonical /cortex-mark.svg asset path. */}
            <img src="/cortex-mark.svg" alt="" />
          </div>
        </div>
      </div>

      {caption && (
        <>
          <div className="splash-word">{caption.title}</div>
          <div className="splash-tag">{caption.subtitle}</div>
        </>
      )}
    </div>
  );
}

export default CerebrumSplash;
