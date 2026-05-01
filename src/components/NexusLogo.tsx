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
  // X is sized to match NEXUS cap-height (same font-size, just heavier weight)
  xs: { wrap: "gap-[4px]", nexus: "text-[11px]", x: "text-[12px]", track: "tracking-[0.18em]" },
  sm: { wrap: "gap-1.5",   nexus: "text-base",   x: "text-base",   track: "tracking-[0.2em]"  },
  md: { wrap: "gap-2",     nexus: "text-xl",     x: "text-xl",     track: "tracking-[0.22em]" },
  lg: { wrap: "gap-2.5",   nexus: "text-3xl",    x: "text-3xl",    track: "tracking-[0.24em]" },
  xl: { wrap: "gap-3",     nexus: "text-5xl",    x: "text-5xl",    track: "tracking-[0.26em]" },
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
        className={cn("font-display font-black select-none leading-none", s.x, className)}
        style={{
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
    <div className={cn("inline-flex items-center select-none", s.wrap, className)} aria-label="Nexus X">
      <span
        className={cn(
          "font-display font-semibold uppercase text-foreground leading-none",
          s.nexus,
          s.track
        )}
      >
        Nexus
      </span>
      <span
        className={cn("font-display font-black uppercase relative leading-none", s.x)}
        style={{
          background:
            "linear-gradient(135deg, hsl(188 100% 55%) 0%, hsl(220 90% 70%) 30%, hsl(258 90% 70%) 60%, hsl(320 95% 65%) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter:
            "drop-shadow(0 0 10px hsl(188 100% 50% / 0.45)) drop-shadow(0 0 20px hsl(258 90% 66% / 0.3))",
        }}
      >
        X
      </span>
      {showVersion && (
        <span className="ml-2 self-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-white/[0.06] text-muted-foreground border border-white/[0.08] tracking-wider">
          {APP_VERSION}
        </span>
      )}
    </div>
  );
};

export { APP_VERSION };
