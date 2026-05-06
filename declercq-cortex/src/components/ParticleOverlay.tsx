// Cluster 21 v1.0 — Particle overlay manager.
//
// Scans the document for `[data-particle]` spans, mounts an
// absolutely-positioned canvas sibling per visible span, runs a
// per-type particle render function via a single shared
// requestAnimationFrame loop. IntersectionObserver pauses offscreen
// hosts; a `body.cortex-anim-paused` class freezes the entire loop;
// `prefers-reduced-motion` defaults the global pause ON.
//
// One global `<ParticleOverlay rootRef={editorWrapperRef} />` mounts
// inside the editor wrapper. It rescans on doc changes (debounced)
// and on resize.

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { ParticleType } from "../editor/CortexParticleHost";

interface ParticleOverlayProps {
  /** The editor wrapper to scan for particle hosts. */
  rootRef: RefObject<HTMLElement | null>;
  /** A version number that bumps on every doc change so the
   *  overlay rescans the DOM. */
  rescanKey: number;
  /** Global pause toggle from the toolbar prefs. */
  paused: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // remaining frames (decremented each tick)
  maxLife: number;
  size: number;
  hue?: number;
  rot?: number;
  vrot?: number;
}

interface HostState {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  type: ParticleType;
  color: string | null;
  particles: Particle[];
  visible: boolean;
  /** Last rect (for resize-detection without a per-host RO). */
  lastW: number;
  lastH: number;
}

// ---- per-type render functions ----

type Renderer = (
  ctx: CanvasRenderingContext2D,
  state: HostState,
  t: number,
) => void;

const RENDERERS: Record<ParticleType, Renderer> = {
  sparkle: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 12) {
      s.particles.push(spawnSparkle(w, h));
    }
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((s.color ? 0 : 0) + (p.rot ?? 0)) * (Math.PI / 180));
      ctx.fillStyle = s.color ?? `hsla(${p.hue ?? 50}, 95%, 65%, ${a})`;
      drawStar(ctx, 0, 0, p.size * a, 4, 0.5);
      ctx.fill();
      ctx.restore();
      if (p.rot != null) p.rot += p.vrot ?? 0;
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  star: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 8) s.particles.push(spawnStar(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot ?? 0) * (Math.PI / 180));
      ctx.fillStyle = s.color ?? `rgba(255, 220, 100, ${a})`;
      drawStar(ctx, 0, 0, p.size, 5, 0.45);
      ctx.fill();
      ctx.restore();
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  confetti: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 18) s.particles.push(spawnConfetti(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06; // gravity
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(
        ((p.rot ?? 0) + (s.particles.indexOf(p) % 6) * 30) * (Math.PI / 180),
      );
      ctx.fillStyle = `hsl(${p.hue}, 90%, 60%)`;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
      if (p.rot != null) p.rot += p.vrot ?? 0;
    }
    s.particles = s.particles.filter((p) => p.life > 0 && p.y < h + 12);
  },
  snow: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 14) s.particles.push(spawnSnow(w));
    for (const p of s.particles) {
      p.x += p.vx + Math.sin((p.y + (p.life ?? 0)) * 0.05) * 0.2;
      p.y += p.vy;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, 0.85)`;
      ctx.fill();
    }
    s.particles = s.particles.filter((p) => p.y < h + 6);
  },
  heart: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 8) s.particles.push(spawnHeart(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.size / 12, p.size / 12);
      ctx.fillStyle = s.color ?? `rgba(239, 71, 111, ${a})`;
      drawHeart(ctx);
      ctx.fill();
      ctx.restore();
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  ember: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 14) s.particles.push(spawnEmber(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx + (Math.random() - 0.5) * 0.4;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      const hue = p.hue ?? 30;
      ctx.fillStyle = s.color ?? `hsla(${hue}, 95%, ${50 + a * 30}%, ${a})`;
      ctx.fill();
    }
    s.particles = s.particles.filter((p) => p.life > 0 && p.y > -8);
  },
  smoke: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 8) s.particles.push(spawnSmoke(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      p.size += 0.2;
      const a = Math.max(0, p.life / p.maxLife) * 0.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 180, 180, ${a})`;
      ctx.fill();
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  bubble: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 8) s.particles.push(spawnBubble(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180, 220, 255, ${a})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x - p.size / 3, p.y - p.size / 3, p.size / 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.6})`;
      ctx.fill();
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  lightning: (ctx, s, t) => {
    // Occasional flash; not a continuous stream.
    if (t % 90 === 0) {
      const w = s.canvas.width;
      const h = s.canvas.height;
      ctx.strokeStyle = `rgba(255, 240, 100, 0.9)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let x = Math.random() * w;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < h) {
        x += (Math.random() - 0.5) * 8;
        y += 6 + Math.random() * 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  pixie: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 14) s.particles.push(spawnPixie(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      const hue = p.hue ?? 280;
      ctx.fillStyle = s.color ?? `hsla(${hue}, 95%, 75%, ${a})`;
      ctx.fill();
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  petal: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 10) s.particles.push(spawnPetal(w));
    for (const p of s.particles) {
      p.x += p.vx + Math.sin((p.y + p.life) * 0.05) * 0.8;
      p.y += p.vy;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((p.rot ?? 0) + p.life * 0.6) * (Math.PI / 180));
      ctx.fillStyle = `hsla(${p.hue}, 70%, 75%, 0.85)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size / 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    s.particles = s.particles.filter((p) => p.y < h + 8);
  },
  comet: (ctx, s, t) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (t % 60 === 0 && s.particles.length < 2) {
      s.particles.push({
        x: -10,
        y: Math.random() * h * 0.6,
        vx: 3 + Math.random() * 2,
        vy: 1.6,
        life: 80,
        maxLife: 80,
        size: 2 + Math.random() * 2,
      });
    }
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const grad = ctx.createLinearGradient(
        p.x - p.vx * 8,
        p.y - p.vy * 8,
        p.x,
        p.y,
      );
      grad.addColorStop(0, "rgba(255, 240, 200, 0)");
      grad.addColorStop(1, s.color ?? "rgba(255, 240, 200, 0.95)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 8, p.y - p.vy * 8);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    s.particles = s.particles.filter((p) => p.life > 0 && p.x < w + 20);
  },
  bokeh: (ctx, s) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (s.particles.length < 6) s.particles.push(spawnBokeh(w, h));
    for (const p of s.particles) {
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      const a = Math.max(0, p.life / p.maxLife) * 0.6;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(255, 220, 180, ${a})`);
      grad.addColorStop(1, `rgba(255, 220, 180, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  },
  coderain: (ctx, s, t) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    // Each "particle" is a column with a current y position. Spawn
    // up to a fixed number of columns based on width.
    const maxCols = Math.max(2, Math.floor(w / 10));
    while (s.particles.length < maxCols) {
      s.particles.push({
        x: s.particles.length * 10 + 4,
        y: -Math.random() * h,
        vx: 0,
        vy: 1 + Math.random() * 2,
        life: 9999,
        maxLife: 9999,
        size: 10,
      });
    }
    ctx.font = "10px monospace";
    for (const p of s.particles) {
      p.y += p.vy;
      if (p.y > h + 10) p.y = -10;
      const ch = String.fromCharCode(0x30a0 + ((t + p.x) % 96));
      ctx.fillStyle = s.color ?? "rgba(0, 230, 120, 0.85)";
      ctx.fillText(ch, p.x, p.y);
      // Tail: redraw three earlier characters at decreasing alpha.
      for (let i = 1; i < 4; i++) {
        ctx.fillStyle = `rgba(0, 200, 100, ${0.7 - i * 0.18})`;
        ctx.fillText(
          String.fromCharCode(0x30a0 + ((t + p.x - i * 7) % 96)),
          p.x,
          p.y - i * 10,
        );
      }
    }
  },
};

// ---- spawn helpers ----

function spawnSparkle(w: number, h: number): Particle {
  const life = 30 + Math.floor(Math.random() * 30);
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    life,
    maxLife: life,
    size: 1.5 + Math.random() * 2,
    hue: 40 + Math.random() * 40,
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 6,
  };
}
function spawnStar(w: number, h: number): Particle {
  const life = 80;
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: 0,
    vy: -0.2,
    life,
    maxLife: life,
    size: 4 + Math.random() * 4,
    rot: Math.random() * 72,
  };
}
function spawnConfetti(w: number, _h: number): Particle {
  const life = 120;
  return {
    x: Math.random() * w,
    y: -8,
    vx: (Math.random() - 0.5) * 1.4,
    vy: 0.6 + Math.random() * 0.8,
    life,
    maxLife: life,
    size: 5 + Math.random() * 4,
    hue: Math.floor(Math.random() * 360),
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 10,
  };
}
function spawnSnow(w: number): Particle {
  return {
    x: Math.random() * w,
    y: -4,
    vx: (Math.random() - 0.5) * 0.4,
    vy: 0.3 + Math.random() * 0.6,
    life: 9999,
    maxLife: 9999,
    size: 1 + Math.random() * 2,
  };
}
function spawnHeart(w: number, h: number): Particle {
  const life = 60;
  return {
    x: Math.random() * w,
    y: h,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -0.6 - Math.random() * 0.8,
    life,
    maxLife: life,
    size: 6 + Math.random() * 4,
  };
}
function spawnEmber(w: number, h: number): Particle {
  const life = 40 + Math.floor(Math.random() * 30);
  return {
    x: Math.random() * w,
    y: h,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -0.6 - Math.random() * 0.8,
    life,
    maxLife: life,
    size: 1.5 + Math.random() * 2,
    hue: 18 + Math.random() * 30,
  };
}
function spawnSmoke(w: number, h: number): Particle {
  const life = 80;
  return {
    x: Math.random() * w,
    y: h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.3 - Math.random() * 0.4,
    life,
    maxLife: life,
    size: 4 + Math.random() * 3,
  };
}
function spawnBubble(w: number, h: number): Particle {
  const life = 80;
  return {
    x: Math.random() * w,
    y: h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.5 - Math.random() * 0.5,
    life,
    maxLife: life,
    size: 4 + Math.random() * 5,
  };
}
function spawnPixie(w: number, h: number): Particle {
  const life = 50;
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.6,
    vy: (Math.random() - 0.5) * 0.6,
    life,
    maxLife: life,
    size: 1.2 + Math.random() * 1.5,
    hue: 270 + Math.random() * 60,
  };
}
function spawnPetal(w: number): Particle {
  return {
    x: Math.random() * w,
    y: -8,
    vx: 0,
    vy: 0.4 + Math.random() * 0.5,
    life: 9999,
    maxLife: 9999,
    size: 4 + Math.random() * 3,
    hue: 320 + Math.random() * 40,
    rot: Math.random() * 360,
  };
}
function spawnBokeh(w: number, h: number): Particle {
  const life = 90;
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2,
    life,
    maxLife: life,
    size: 6 + Math.random() * 6,
  };
}

// ---- shape helpers ----

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  points: number,
  innerRatio: number,
) {
  const inner = r * innerRatio;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? r : inner;
    const ang = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(ang) * radius;
    const y = cy + Math.sin(ang) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.bezierCurveTo(-12, -6, -6, -14, 0, -6);
  ctx.bezierCurveTo(6, -14, 12, -6, 0, 6);
  ctx.closePath();
}

// ---- main component ----

export function ParticleOverlay({
  rootRef,
  rescanKey,
  paused,
}: ParticleOverlayProps) {
  const hostsRef = useRef<Map<HTMLElement, HostState>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const rafRef = useRef<number>(0);
  const tickRef = useRef(0);

  const cleanupHost = useCallback((el: HTMLElement) => {
    const state = hostsRef.current.get(el);
    if (state) {
      state.canvas.remove();
      hostsRef.current.delete(el);
    }
  }, []);

  const ensureHost = useCallback((el: HTMLElement) => {
    if (hostsRef.current.has(el)) return;
    const type = el.getAttribute("data-particle") as ParticleType | null;
    if (!type) return;
    const color = el.getAttribute("data-particle-color");
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.className = "cortex-particle-canvas";
    el.appendChild(canvas);
    hostsRef.current.set(el, {
      host: el,
      canvas,
      type,
      color,
      particles: [],
      // Cluster 21 v1.0.4 — start visible. Without this, when the
      // rescan effect runs BEFORE the IntersectionObserver effect
      // (React fires effects in definition order), the host is
      // never observed and `visible` stays false → particles never
      // render. With `visible: true` as the default, particles
      // start animating immediately; the IO can still set false
      // when actually offscreen, restoring the perf optimization.
      visible: true,
      lastW: 0,
      lastH: 0,
    });
    if (observerRef.current) observerRef.current.observe(el);
  }, []);

  // Rescan effect — runs on `rescanKey` change.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const present = new Set<HTMLElement>();
    const found = root.querySelectorAll<HTMLElement>("[data-particle]");
    found.forEach((el) => {
      present.add(el);
      ensureHost(el);
    });
    // Cleanup removed hosts.
    for (const el of Array.from(hostsRef.current.keys())) {
      if (!present.has(el)) cleanupHost(el);
    }
  }, [rescanKey, rootRef, ensureHost, cleanupHost]);

  // IntersectionObserver setup once.
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const state = hostsRef.current.get(e.target as HTMLElement);
          if (state) state.visible = e.isIntersecting;
        }
      },
      { rootMargin: "100px" },
    );
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Animation loop.
  useEffect(() => {
    if (paused) return;
    function frame() {
      tickRef.current++;
      const t = tickRef.current;
      hostsRef.current.forEach((state) => {
        if (!state.visible) return;
        const rect = state.host.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        if (w !== state.lastW || h !== state.lastH) {
          state.canvas.width = w;
          state.canvas.height = h;
          state.lastW = w;
          state.lastH = h;
        }
        const ctx = state.canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);
        const r = RENDERERS[state.type];
        if (r) r(ctx, state, t);
      });
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused]);

  return null;
}
