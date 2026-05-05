import { cn } from "@/lib/utils";

interface NexusLogoProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showVersion?: boolean;
  /** Render only the iridescent X glyph (great for favicons, avatars, loaders) */
  glyphOnly?: boolean;
  /** Visual variant. `auto` follows theme, `dark` = on dark bg, `light` = on light bg, `contrast` = high-contrast accessible */
  variant?: "auto" | "dark" | "light" | "contrast";
  /** Disable the ambient pulse / hover glow animation */
  static?: boolean;
}

const APP_VERSION = "v2.0";

const sizes = {
  // Mobile-safe: xs/sm use tighter tracking + smaller v2.0 so wordmark never overflows narrow rails (≤320px).
  xs: { wrap: "gap-[3px]",  nexus: "text-[10px]", x: "text-[12px]", ver: "text-[9px]",  track: "tracking-[0.22em]" },
  sm: { wrap: "gap-[5px]",  nexus: "text-[13px]", x: "text-[16px]", ver: "text-[11px]", track: "tracking-[0.26em]" },
  md: { wrap: "gap-2",      nexus: "text-[18px]", x: "text-[22px]", ver: "text-[15px]", track: "tracking-[0.32em]" },
  lg: { wrap: "gap-2.5",    nexus: "text-[30px]", x: "text-[36px]", ver: "text-[24px]", track: "tracking-[0.36em]" },
  xl: { wrap: "gap-3",      nexus: "text-[50px]", x: "text-[60px]", ver: "text-[40px]", track: "tracking-[0.4em]"  },
};

type Palette = {
  word: string;        // color or gradient for "NEXUS"
  wordShadow: string;  // text-shadow for "NEXUS"
  xGradient: string;   // background gradient for X
  verGradient: string; // background gradient for v2.0
};

const palettes: Record<Exclude<NexusLogoProps["variant"], undefined | "auto">, Palette> = {
  dark: {
    word: "hsl(210 40% 98%)",
    wordShadow: "0 0 12px hsl(0 0% 100% / 0.25)",
    xGradient:
      "linear-gradient(135deg, hsl(188 100% 55%) 0%, hsl(220 90% 70%) 30%, hsl(258 90% 70%) 60%, hsl(320 95% 65%) 100%)",
    // Brighter cyan→violet→magenta tuned so each stop hits ≥4.5:1 against #07070b
    verGradient:
      "linear-gradient(135deg, hsl(188 100% 80%), hsl(258 95% 85%) 55%, hsl(320 100% 82%))",
  },
  light: {
    word: "hsl(230 20% 12%)",
    wordShadow: "0 0 0 transparent",
    xGradient:
      "linear-gradient(135deg, hsl(200 100% 38%) 0%, hsl(230 90% 50%) 30%, hsl(258 90% 52%) 60%, hsl(320 95% 48%) 100%)",
    // Darkened so v2.0 hits ≥4.5:1 against white/near-white backgrounds
    verGradient:
      "linear-gradient(135deg, hsl(200 100% 30%), hsl(258 90% 38%) 60%, hsl(320 95% 36%))",
  },
  contrast: {
    word: "hsl(0 0% 100%)",
    wordShadow:
      "0 0 0 transparent, 0 0 1px hsl(0 0% 0%), 0 0 6px hsl(0 0% 0% / 0.85)",
    xGradient:
      "linear-gradient(135deg, hsl(55 100% 72%) 0%, hsl(48 100% 68%) 50%, hsl(42 100% 65%) 100%)",
    verGradient:
      "linear-gradient(135deg, hsl(55 100% 80%), hsl(48 100% 75%) 60%, hsl(42 100% 72%))",
  },
};

/**
 * NEXUS X — V2.0 Wordmark
 * Tesla-style stretched wordmark with iridescent glowing X and prominent v2.0.
 */
export const NexusLogo = ({
  size = "md",
  className,
  showVersion = false,
  glyphOnly = false,
  variant = "auto",
  static: isStatic = false,
}: NexusLogoProps) => {
  const s = sizes[size];

  // Resolve "auto" variant. App is dark-themed by default → use dark palette.
  // Light variant can be opted into by callers explicitly.
  const resolved = variant === "auto" ? "dark" : variant;
  const p = palettes[resolved];

  const xAnim = isStatic ? "" : "nexus-x-glow";
  const verAnim = isStatic ? "" : "nexus-ver-glow";

  if (glyphOnly) {
    return (
      <span
        aria-label="Nexus X"
        className={cn("nexus-logo-wrap inline-block select-none leading-none", s.x, className)}
      >
        <span
          className={cn("inline-block", xAnim)}
          style={{
            fontFamily: "'Michroma', 'Geist', sans-serif",
            fontWeight: 900,
            background: p.xGradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          X
        </span>
      </span>
    );
  }

  return (
    <div
      className={cn("nexus-logo-wrap inline-flex items-baseline select-none cursor-default", s.wrap, className)}
      aria-label="Nexus X v2.0"
      role="img"
    >
      <span
        className={cn("nexus-word uppercase leading-none", s.nexus, s.track)}
        style={{
          fontFamily: "'Michroma', 'Geist', sans-serif",
          fontWeight: 400,
          color: p.word,
          textShadow: p.wordShadow,
        }}
      >
        Nexus
      </span>
      <span
        className={cn("uppercase relative leading-none", s.x, xAnim)}
        style={{
          fontFamily: "'Michroma', 'Geist', sans-serif",
          fontWeight: 900,
          background: p.xGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        X
      </span>
      {showVersion && (
        <span
          className={cn("ml-1.5 leading-none lowercase", s.ver, verAnim)}
          style={{
            fontFamily: "'Michroma', 'Geist', sans-serif",
            fontWeight: 400,
            letterSpacing: "0.08em",
            background: p.verGradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {APP_VERSION}
        </span>
      )}
    </div>
  );
};

export { APP_VERSION };
