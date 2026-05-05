import { cn } from "@/lib/utils";

interface NexusLogoProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showVersion?: boolean;
  /** Render only the iridescent X glyph (great for favicons, avatars, loaders) */
  glyphOnly?: boolean;
}

const APP_VERSION = "v2.0";

const sizes = {
  // Tesla-style stretched wordmark: NEXUS thin & wide, X bold highlighted, v2.0 prominent
  xs: { wrap: "gap-[4px]",  nexus: "text-[11px]", x: "text-[13px]", ver: "text-[10px]", track: "tracking-[0.32em]" },
  sm: { wrap: "gap-1.5",    nexus: "text-[15px]", x: "text-[18px]", ver: "text-[13px]", track: "tracking-[0.36em]" },
  md: { wrap: "gap-2",      nexus: "text-[20px]", x: "text-[24px]", ver: "text-[17px]", track: "tracking-[0.38em]" },
  lg: { wrap: "gap-2.5",    nexus: "text-[32px]", x: "text-[38px]", ver: "text-[26px]", track: "tracking-[0.4em]"  },
  xl: { wrap: "gap-3",      nexus: "text-[52px]", x: "text-[62px]", ver: "text-[42px]", track: "tracking-[0.42em]" },
};

/**
 * NEXUS X — V2.0 Wordmark
 * "NEXUS" in ice-white Geist + iridescent gradient "X" with soft halo.
 * Geometric, sharp, premium. Scales from xs (header rail) → xl (login hero).
 */
export const NexusLogo = ({ size = "md", className, showVersion = false, glyphOnly = false }: NexusLogoProps) => {
  const s = sizes[size];

  if (glyphOnly) {
    return (
      <span
        aria-label="Nexus X"
        className={cn("select-none leading-none", s.x, className)}
        style={{
          fontFamily: "'Michroma', 'Geist', sans-serif",
          fontWeight: 900,
          background: "linear-gradient(135deg, hsl(188 100% 55%), hsl(258 90% 70%) 50%, hsl(320 95% 65%))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter:
            "drop-shadow(0 0 18px hsl(188 100% 50% / 0.55)) drop-shadow(0 0 36px hsl(258 90% 66% / 0.35))",
        }}
      >
        X
      </span>
    );
  }

  return (
    <div className={cn("inline-flex items-baseline select-none", s.wrap, className)} aria-label="Nexus X v2.0">
      <span
        className={cn(
          "uppercase text-foreground leading-none",
          s.nexus,
          s.track
        )}
        style={{
          fontFamily: "'Michroma', 'Geist', sans-serif",
          fontWeight: 400,
          textShadow: "0 0 12px hsl(0 0% 100% / 0.25)",
        }}
      >
        Nexus
      </span>
      <span
        className={cn("uppercase relative leading-none", s.x)}
        style={{
          fontFamily: "'Michroma', 'Geist', sans-serif",
          fontWeight: 900,
          background:
            "linear-gradient(135deg, hsl(188 100% 55%) 0%, hsl(220 90% 70%) 30%, hsl(258 90% 70%) 60%, hsl(320 95% 65%) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter:
            "drop-shadow(0 0 12px hsl(188 100% 55% / 0.65)) drop-shadow(0 0 28px hsl(258 90% 66% / 0.45)) drop-shadow(0 0 48px hsl(320 95% 65% / 0.25))",
        }}
      >
        X
      </span>
      {showVersion && (
        <span
          className={cn("ml-1.5 leading-none lowercase", s.ver)}
          style={{
            fontFamily: "'Michroma', 'Geist', sans-serif",
            fontWeight: 400,
            letterSpacing: "0.08em",
            background:
              "linear-gradient(135deg, hsl(188 100% 70%), hsl(258 90% 78%) 60%, hsl(320 95% 72%))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter:
              "drop-shadow(0 0 10px hsl(188 100% 55% / 0.55)) drop-shadow(0 0 22px hsl(258 90% 66% / 0.35))",
          }}
        >
          {APP_VERSION}
        </span>
      )}
    </div>
  );
};

export { APP_VERSION };
