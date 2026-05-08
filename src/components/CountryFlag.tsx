import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { countryName } from "@/lib/countryName";

// ISO-3 → ISO-2 fallback (covers all flagcdn-supported countries used in app).
const ISO3_TO_2: Record<string, string> = {
  AFG:"AF",ALB:"AL",DZA:"DZ",AND:"AD",AGO:"AO",ATG:"AG",ARG:"AR",ARM:"AM",AUS:"AU",AUT:"AT",AZE:"AZ",
  BHS:"BS",BHR:"BH",BGD:"BD",BRB:"BB",BLR:"BY",BEL:"BE",BLZ:"BZ",BEN:"BJ",BTN:"BT",BOL:"BO",BIH:"BA",BWA:"BW",BRA:"BR",BRN:"BN",BGR:"BG",BFA:"BF",BDI:"BI",
  KHM:"KH",CMR:"CM",CAN:"CA",CPV:"CV",CAF:"CF",TCD:"TD",CHL:"CL",CHN:"CN",COL:"CO",COM:"KM",COG:"CG",COD:"CD",CRI:"CR",CIV:"CI",HRV:"HR",CUB:"CU",CYP:"CY",CZE:"CZ",
  DNK:"DK",DJI:"DJ",DMA:"DM",DOM:"DO",ECU:"EC",EGY:"EG",SLV:"SV",GNQ:"GQ",ERI:"ER",EST:"EE",SWZ:"SZ",ETH:"ET",
  FJI:"FJ",FIN:"FI",FRA:"FR",GAB:"GA",GMB:"GM",GEO:"GE",DEU:"DE",GHA:"GH",GRC:"GR",GRD:"GD",GTM:"GT",GIN:"GN",GNB:"GW",GUY:"GY",
  HTI:"HT",HND:"HN",HKG:"HK",HUN:"HU",ISL:"IS",IND:"IN",IDN:"ID",IRN:"IR",IRQ:"IQ",IRL:"IE",ISR:"IL",ITA:"IT",JAM:"JM",JPN:"JP",JOR:"JO",
  KAZ:"KZ",KEN:"KE",KIR:"KI",PRK:"KP",KOR:"KR",KWT:"KW",KGZ:"KG",LAO:"LA",LVA:"LV",LBN:"LB",LSO:"LS",LBR:"LR",LBY:"LY",LIE:"LI",LTU:"LT",LUX:"LU",
  MAC:"MO",MDG:"MG",MWI:"MW",MYS:"MY",MDV:"MV",MLI:"ML",MLT:"MT",MHL:"MH",MRT:"MR",MUS:"MU",MEX:"MX",FSM:"FM",MDA:"MD",MCO:"MC",MNG:"MN",MNE:"ME",MAR:"MA",MOZ:"MZ",MMR:"MM",
  NAM:"NA",NRU:"NR",NPL:"NP",NLD:"NL",NZL:"NZ",NIC:"NI",NER:"NE",NGA:"NG",MKD:"MK",NOR:"NO",OMN:"OM",PAK:"PK",PLW:"PW",PSE:"PS",PAN:"PA",PNG:"PG",PRY:"PY",PER:"PE",PHL:"PH",POL:"PL",PRT:"PT",QAT:"QA",
  ROU:"RO",RUS:"RU",RWA:"RW",KNA:"KN",LCA:"LC",VCT:"VC",WSM:"WS",SMR:"SM",STP:"ST",SAU:"SA",SEN:"SN",SRB:"RS",SYC:"SC",SLE:"SL",SGP:"SG",SVK:"SK",SVN:"SI",SLB:"SB",SOM:"SO",ZAF:"ZA",SSD:"SS",ESP:"ES",LKA:"LK",SDN:"SD",SUR:"SR",SWE:"SE",CHE:"CH",SYR:"SY",
  TWN:"TW",TJK:"TJ",TZA:"TZ",THA:"TH",TLS:"TL",TGO:"TG",TON:"TO",TTO:"TT",TUN:"TN",TUR:"TR",TKM:"TM",TUV:"TV",UGA:"UG",UKR:"UA",ARE:"AE",GBR:"GB",USA:"US",URY:"UY",UZB:"UZ",VUT:"VU",VEN:"VE",VNM:"VN",YEM:"YE",ZMB:"ZM",ZWE:"ZW"
};

// ─── GLOBAL FLAG SIZE SCALE ──────────────────────────────────────────────
// Single source of truth — perfect circles (w === h) at every breakpoint.
// Bump CDN size at lg/xl so retina screens still get crisp pixels.
const SIZE_MAP = {
  xs: { px: 14, cdn: "w40"  },
  sm: { px: 18, cdn: "w40"  },
  md: { px: 22, cdn: "w80"  },
  lg: { px: 30, cdn: "w80"  },
  xl: { px: 40, cdn: "w160" },
} as const;

export type FlagSize = keyof typeof SIZE_MAP;

// ─── Persistent cache: which (cc + size-bucket) flags successfully loaded
// at least once. Survives reloads so flicker-free on repeat visits.
const CACHE_KEY = "nexus_flag_ok_cache_v1";
let CACHE: Record<string, 1> = {};
try {
  if (typeof localStorage !== "undefined") {
    CACHE = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {};
  }
} catch { /* noop */ }
const persistCache = () => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(CACHE)); } catch { /* noop */ }
};
const markOk = (key: string) => {
  if (CACHE[key]) return;
  CACHE[key] = 1;
  clearTimeout((markOk as any)._t);
  (markOk as any)._t = setTimeout(persistCache, 250);
};

/**
 * CountryFlag — round, pixel-perfect country badge.
 *
 * Variants:
 *   - default   → flat circular flag with subtle ring
 *   - premium   → glossy gradient ring + inner highlight (hero/header)
 *   - interactive → wraps trigger in a Popover showing country name,
 *                   ISO code, and supported operations
 */
export function CountryFlag({
  code,
  size = "md",
  className,
  title,
  premium = false,
  interactive = false,
  operations,
  onSelect,
}: {
  code: string;
  size?: FlagSize;
  className?: string;
  title?: string;
  premium?: boolean;
  interactive?: boolean;
  operations?: string[];
  onSelect?: (code: string) => void;
}) {
  const cfg = SIZE_MAP[size];
  const [attempt, setAttempt] = useState(0);
  const [errored, setErrored] = useState(false);
  const cc0 = (code || "").toUpperCase().trim();
  const cc = cc0.length === 3 && ISO3_TO_2[cc0] ? ISO3_TO_2[cc0] : cc0;
  const cacheKey = cc.length === 2 ? `${cc.toLowerCase()}@${cfg.cdn}` : "";
  const wasCached = useRef(!!CACHE[cacheKey]).current;
  const [loaded, setLoaded] = useState(wasCached);
  const retryTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
  }, []);

  const dim = { width: cfg.px, height: cfg.px, minWidth: cfg.px } as const;

  const wrapCls = cn(
    "relative inline-flex items-center justify-center shrink-0 rounded-full",
    premium && "p-[1.5px] bg-gradient-to-br from-white/40 via-white/10 to-white/30 shadow-[0_2px_6px_rgba(0,0,0,0.45)]",
    interactive && "cursor-pointer transition-transform hover:scale-110 hover:z-10",
    className,
  );

  let inner: ReactNode;
  if (cc.length !== 2 || errored) {
    inner = (
      <span
        className="inline-flex items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.08] text-[9px] font-bold uppercase tracking-tight text-muted-foreground"
        style={dim}
      >
        {(code || "??").slice(0, 2).toUpperCase()}
      </span>
    );
  } else {
    const lower = cc.toLowerCase();
    const bust = attempt > 0 ? `?r=${attempt}` : "";
    const hi = cfg.cdn === "w40" ? "w80" : "w160";
    const src   = `https://flagcdn.com/${cfg.cdn}/${lower}.png${bust}`;
    const src2x = `https://flagcdn.com/${hi}/${lower}.png${bust} 2x`;
    inner = (
      <span className="relative inline-block rounded-full overflow-hidden" style={dim}>
        <img
          src={src}
          srcSet={src2x}
          alt={title || cc}
          loading="lazy"
          decoding="async"
          onLoad={() => { markOk(cacheKey); setLoaded(true); }}
          onError={() => {
            if (attempt < 2) {
              const delay = 400 * Math.pow(2, attempt);
              retryTimer.current = window.setTimeout(() => setAttempt(a => a + 1), delay);
            } else {
              setErrored(true);
            }
          }}
          className={cn(
            "absolute inset-0 w-full h-full object-cover rounded-full",
            !premium && "ring-1 ring-white/15 shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
            loaded ? "opacity-100" : "opacity-0 transition-opacity duration-200",
          )}
        />
        {premium && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.12) 35%, transparent 60%)",
            }}
          />
        )}
      </span>
    );
  }

  const tooltipTitle = title || countryName(cc) || cc;

  if (!interactive) {
    return (
      <span title={tooltipTitle} className={wrapCls} style={dim}>
        {inner}
      </span>
    );
  }

  const ops = operations && operations.length > 0 ? operations : ["Number rental", "OTP delivery"];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={tooltipTitle}
          onClick={() => onSelect?.(cc)}
          className={cn(wrapCls, "outline-none focus-visible:ring-2 focus-visible:ring-primary/60")}
          style={dim}
        >
          {inner}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0 overflow-hidden border-white/10 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 p-3 border-b border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-transparent">
          <CountryFlag code={cc} size="lg" premium />
          <div className="min-w-0">
            <div className="text-sm font-display font-semibold text-foreground truncate">
              {countryName(cc) || cc}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              {cc}
            </div>
          </div>
        </div>
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Supported operations
          </div>
          <ul className="space-y-1">
            {ops.map((op) => (
              <li key={op} className="flex items-center gap-2 text-xs text-foreground">
                <span className="w-1 h-1 rounded-full bg-neon-green shrink-0" />
                <span className="truncate">{op}</span>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default CountryFlag;
