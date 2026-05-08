import { useEffect, useRef } from "react";

interface PlexusBackgroundProps {
  /** Number of points; auto-scaled by viewport area. Default 80. */
  density?: number;
  /** Max distance (px) between two points before a line stops being drawn. */
  linkDistance?: number;
  /** Base hue color in HSL — defaults to project neon-cyan. */
  hue?: number;
  className?: string;
}

/**
 * Animated plexus / network background.
 * Glowing dots drift slowly; nearby points are linked by lines whose
 * opacity fades with distance. Pure canvas — zero dependencies, ~6KB.
 * Honors prefers-reduced-motion (renders a static frame instead).
 */
export const PlexusBackground = ({
  density = 50,
  linkDistance = 130,
  hue = 188, // matches --primary (neon cyan)
  className,
}: PlexusBackgroundProps) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Cap DPR to 1.5 — the canvas is decorative; full DPR doubles GPU cost.
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0;

    type P = { x: number; y: number; vx: number; vy: number; r: number; pulse: number };
    let pts: P[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scales gently with viewport area
      const area = W * H;
      const target = Math.round(density * Math.min(1.1, Math.max(0.4, area / (1280 * 720))));
      pts = Array.from({ length: target }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 0.7 + Math.random() * 1.6,
        pulse: Math.random() * Math.PI * 2,
      }));
    };

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Move points
      for (const p of pts) {
        if (!reduceMotion) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -20) p.x = W + 20;
          if (p.x > W + 20) p.x = -20;
          if (p.y < -20) p.y = H + 20;
          if (p.y > H + 20) p.y = -20;
          p.pulse += 0.012;
        }
      }

      // Lines first (so dots sit on top)
      const maxSq = linkDistance * linkDistance;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dsq = dx * dx + dy * dy;
          if (dsq > maxSq) continue;
          const t = 1 - dsq / maxSq;        // 0..1, 1 = closest
          const alpha = 0.12 * t * t;       // softer falloff
          ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${alpha})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Dots with glow
      for (const p of pts) {
        const breathe = 0.75 + Math.sin(p.pulse) * 0.25;
        const r = p.r * breathe;

        // Outer glow
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6);
        grd.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.55 * breathe})`);
        grd.addColorStop(1, `hsla(${hue}, 100%, 70%, 0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 6, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `hsla(${hue}, 100%, 92%, 0.95)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [density, linkDistance, hue]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className ?? "pointer-events-none absolute inset-0 w-full h-full"}
    />
  );
};

export default PlexusBackground;