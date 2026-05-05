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
  xs: { wrap: "gap-[4px]",  nexus: "text-[11px]", x: "text-[13px]", ver: "text-[10px]", track: "tracking-[0.32em]" },
  sm: { wrap: "gap-1.5",    nexus: "text-[15px]", x: "text-[18px]", ver: "text-[13px]", track: "tracking-[0.36em]" },
  md: { wrap: "gap-2",      nexus: "text-[20px]", x: "text-[24px]", ver: "text-[17px]", track: "tracking-[0.38em]" },
  lg: { wrap: "gap-2.5",    nexus: "text-[32px]", x: "text-[38px]", ver: "text-[26px]", track: "tracking-[0.4em]"  },
  xl: { wrap: "gap-3",      nexus: "text-[52px]", x: "text-[62px]", ver: "text-[42px]", track: "tracking-[0.42em]" },
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
    verGradient:
      "linear-gradient(135deg, hsl(188 100% 70%), hsl(258 90% 78%) 60%, hsl(320 95% 72%))",
  },
  light: {
    word: "hsl(230 20% 12%)",
    wordShadow: "0 0 0 transparent",
    xGradient:
      "linear-gradient(135deg, hsl(200 100% 38%) 0%, hsl(230 90% 50%) 30%, hsl(258 90% 52%) 60%, hsl(320 95% 48%) 100%)",
    verGradient:
      "linear-gradient(135deg, hsl(200 100% 42%), hsl(258 90% 50%) 60%, hsl(320 95% 50%))",
  },
  contrast: {
    word: "hsl(0 0% 100%)",
    wordShadow:
      "0 0 0 transparent, 0 0 1px hsl(0 0% 0%), 0 0 6px hsl(0 0% 0% / 0.85)",
    xGradient:
      "linear-gradient(135deg, hsl(58 100% 65%) 0%, hsl(48 100% 60%) 50%, hsl(38 100% 55%) 100%)",
    verGradient:
      "linear-gradient(135deg, hsl(58 100% 75%), hsl(48 100% 65%) 60%, hsl(38 100% 60%))",
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
