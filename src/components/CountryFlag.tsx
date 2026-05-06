import { useState } from "react";
import { cn } from "@/lib/utils";

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

const SIZE_MAP = {
  xs: { px: 16, w: 20, h: "h-3.5", cdn: "w20" },
  sm: { px: 20, w: 24, h: "h-4",   cdn: "w20" },
  md: { px: 28, w: 40, h: "h-5",   cdn: "w40" },
  lg: { px: 40, w: 60, h: "h-7",   cdn: "w80" },
  xl: { px: 56, w: 80, h: "h-9",   cdn: "w80" },
} as const;

type FlagSize = keyof typeof SIZE_MAP;

/**
 * CountryFlag — renders the real PNG flag from flagcdn.com.
 *
 * Why PNG instead of unicode flag-emoji?  Windows ships with no flag
 * glyphs, so emojis like 🇦🇫 fall back to text "AF". flagcdn.com
 * delivers a 1-2 KB PNG per flag, cached forever, so it works
 * everywhere identically.
 */
export function CountryFlag({
  code,
  size = "md",
  className,
  title,
}: {
  code: string;
  size?: FlagSize;
  className?: string;
  title?: string;
}) {
  const [errored, setErrored] = useState(false);
  const cfg = SIZE_MAP[size];

  let cc = (code || "").toUpperCase().trim();
  if (cc.length === 3 && ISO3_TO_2[cc]) cc = ISO3_TO_2[cc];
  if (cc.length !== 2 || errored) {
    return (
      <span
        title={title || code}
        className={cn(
          "inline-flex items-center justify-center rounded bg-white/[0.06] border border-white/[0.08] text-[10px] font-bold uppercase tracking-tight text-muted-foreground shrink-0",
          cfg.h, className,
        )}
        style={{ width: cfg.w, minWidth: cfg.w }}
      >
        {(code || "??").slice(0, 2).toUpperCase()}
      </span>
    );
  }

  const lower = cc.toLowerCase();
  const src   = `https://flagcdn.com/${cfg.cdn}/${lower}.png`;
  const src2x = `https://flagcdn.com/${cfg.cdn === "w20" ? "w40" : cfg.cdn === "w40" ? "w80" : "w160"}/${lower}.png 2x`;

  return (
    <img
      src={src}
      srcSet={src2x}
      alt={title || cc}
      title={title || cc}
      loading="lazy"
      onError={() => setErrored(true)}
      className={cn(
        "inline-block rounded-[3px] object-cover shrink-0 ring-1 ring-white/[0.06] shadow-sm",
        cfg.h, className,
      )}
      style={{ width: cfg.w, minWidth: cfg.w }}
    />
  );
}

export default CountryFlag;
