import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GradientMesh } from "@/components/premium";
import { Globe, ChevronDown, Search, Hash, Loader2, Inbox, Flame, Copy, Check, Download, Layers, TrendingUp, X, RefreshCw, Timer, MessageSquare, History } from "lucide-react";
import { BrandIcon } from "@/components/BrandIcon";
import { OtpThreadDrawer } from "@/components/OtpThreadDrawer";
import { CountryFlag } from "@/components/CountryFlag";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

// Most-common ISO-3 → ISO-2 fallback (so "AFG", "USA", "MDG"… still render flags).
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

/**
 * Auto-detect → flag emoji.
 * Handles ISO-2 ("AF"), ISO-3 ("AFG"), and lowercase. Falls back to globe.
 */
function flagEmoji(code: string): string {
  if (!code) return "🌐";
  let cc = code.toUpperCase().trim();
  if (cc.length === 3 && ISO3_TO_2[cc]) cc = ISO3_TO_2[cc];
  if (cc.length !== 2) return "🌐";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65);
}

// Robust clipboard write — falls back to a hidden textarea + execCommand when
// the async Clipboard API is unavailable or blocked (insecure context, focus
// issues, certain browsers / extensions).
async function safeCopy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const LS_COUNTRY = "nx.getnum.country";
const LS_RANGE = "nx.getnum.rangeId";
const LS_SERVICE = "nx.getnum.serviceId";
const LS_RECENT = "nx.getnum.recent"; // last-used [{serviceId, country, rangeId, label, country_name, ts}]
const RECENT_MAX = 5;

type RecentChip = {
  serviceId: number | null;
  country: string;
  rangeId: number;
  label: string;
  country_name: string;
  ts: number;
};

function loadRecent(): RecentChip[] {
  try { return JSON.parse(localStorage.getItem(LS_RECENT) || "[]"); } catch { return []; }
}
function pushRecent(chip: RecentChip) {
  try {
    const cur = loadRecent().filter(c => !(c.rangeId === chip.rangeId && c.serviceId === chip.serviceId));
    cur.unshift(chip);
    localStorage.setItem(LS_RECENT, JSON.stringify(cur.slice(0, RECENT_MAX)));
  } catch { /* ignore */ }
}

// Heatmap dot color from free count (relative to range stock).
function heatColor(free: number): string {
  if (free <= 0) return "bg-destructive/70";
  if (free < 5)  return "bg-neon-amber/80";
  if (free < 20) return "bg-neon-cyan/80";
  return "bg-neon-green/80";
}

const AgentRanges = () => {
  const qc = useQueryClient();
  // Persisted selections — survive reload until user changes them.
  const [country, setCountry] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_COUNTRY) || null; } catch { return null; }
  });
  const [rangeId, setRangeId] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(LS_RANGE);
      return v ? Number(v) : null;
    } catch { return null; }
  });
  const [serviceId, setServiceId] = useState<number | null>(() => {
    try { const v = localStorage.getItem(LS_SERVICE); return v ? Number(v) : null; } catch { return null; }
  });
  useEffect(() => {
    try {
      if (serviceId) localStorage.setItem(LS_SERVICE, String(serviceId));
      else localStorage.removeItem(LS_SERVICE);
    } catch { /* ignore */ }
  }, [serviceId]);

  const { data: servicesData } = useQuery({
    queryKey: ["agent-services"],
    queryFn: () => api.services(),
    refetchInterval: 120_000,
  });
  const services = servicesData?.services || [];

  // Auto-select first service on load when none chosen
  useEffect(() => {
    if (!serviceId && services.length) setServiceId(services[0].id);
  }, [services, serviceId]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [countryQ, setCountryQ] = useState("");
  const [rangeQ, setRangeQ] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const perReqLimit = Math.min(500, Math.max(1, Number((user as any)?.per_request_limit) || 5));

  const [allocLoading, setAllocLoading] = useState<number | null>(null); // count being loaded
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [customCount, setCustomCount] = useState<number>(0);
  // Quantity selector for the main "Get Number" button.
  // Defaults to 1×; clicking 3×/5× only changes the selection — the actual
  // allocation runs when the user presses "Get Number".
  const [qty, setQty] = useState<number>(1);
  // Highlight numbers from the most recent allocation batch.
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "received" | "released" | "expired">("all");
  const [searchQ, setSearchQ] = useState("");
  // OTP thread drawer state
  const [threadAllocId, setThreadAllocId] = useState<number | null>(null);
  // last-used chips (re-read on mount + after each successful allocation)
  const [recentChips, setRecentChips] = useState<RecentChip[]>(() => loadRecent());

  useEffect(() => {
    try {
      if (country) localStorage.setItem(LS_COUNTRY, country);
      else localStorage.removeItem(LS_COUNTRY);
    } catch { /* ignore */ }
  }, [country]);
  useEffect(() => {
    try {
      if (rangeId != null) localStorage.setItem(LS_RANGE, String(rangeId));
      else localStorage.removeItem(LS_RANGE);
    } catch { /* ignore */ }
  }, [rangeId]);

  const { data: countriesData, isLoading: loadingCountries } = useQuery({
    queryKey: ["agent-v2-countries", serviceId],
    queryFn: () => api.v2Countries(serviceId || undefined),
    enabled: !!serviceId,
    refetchInterval: 60_000,
  });

  const { data: rangesData, isLoading: loadingRanges, error: rangesError } = useQuery({
    queryKey: ["agent-v2-ranges", country, serviceId],
    queryFn: () => api.v2Ranges(country!, serviceId || undefined),
    enabled: !!country && !!serviceId,
    refetchInterval: 30_000,
  });

  const allCountries = countriesData?.countries || [];
  const filteredCountries = useMemo(() => allCountries.filter(c =>
    !countryQ || c.country_code.toLowerCase().includes(countryQ.toLowerCase()) ||
    (c.country_name || "").toLowerCase().includes(countryQ.toLowerCase())
  ), [allCountries, countryQ]);

  const ranges = rangesData?.ranges || [];
  const filteredRanges = useMemo(() => ranges.filter(r =>
    !rangeQ ||
    (r.range_label || "").toLowerCase().includes(rangeQ.toLowerCase()) ||
    (r.range_prefix || "").toLowerCase().includes(rangeQ.toLowerCase()) ||
    (r.operator || "").toLowerCase().includes(rangeQ.toLowerCase())
  ), [ranges, rangeQ]);

  const selectedCountry = allCountries.find(c => c.country_code === country);
  const selectedRange = ranges.find(r => r.id === rangeId);

  // If persisted range no longer matches current country's available ranges, clear it.
  useEffect(() => {
    if (rangeId != null && ranges.length > 0 && !ranges.some(r => r.id === rangeId)) {
      setRangeId(null);
    }
  }, [rangeId, ranges]);

  const free = Number((selectedRange as any)?.free_count ?? 0);
  const isHot = !!(selectedRange as any)?.hot;

  const allocate = async (count: number) => {
    if (!selectedRange) return;
    setAllocLoading(count);
    try {
      const r = await api.getNumber({ range_id: selectedRange.id, count });
      if (r.allocated?.length) {
        bumpDaily(r.allocated.length);
        // Remember this country+range for one-click reuse next time.
        if (selectedCountry && selectedRange) {
          pushRecent({
            serviceId: serviceId || null,
            country: selectedCountry.country_code,
            rangeId: selectedRange.id,
            label: selectedRange.range_label,
            country_name: selectedCountry.country_name || selectedCountry.country_code,
            ts: Math.floor(Date.now() / 1000),
          });
          setRecentChips(loadRecent());
        }
        // Mark these as fresh (yellow flash) for ~30s
        const ids = new Set<number>((r.allocated as any[]).map(a => a.id).filter(Boolean));
        if (ids.size) {
          setFreshIds(prev => new Set([...prev, ...ids]));
          setTimeout(() => {
            setFreshIds(prev => {
              const next = new Set(prev);
              ids.forEach(id => next.delete(id));
              return next;
            });
          }, 30000);
        }
        // Auto-copy allocated number(s) to clipboard (with fallback)
        const phones = (r.allocated as any[]).map(a => a.phone_number).filter(Boolean);
        const copied = phones.length ? await safeCopy(phones.join("\n")) : false;
        // Refresh allocated list immediately so they appear inline
        qc.invalidateQueries({ queryKey: ["my-numbers-inline"] });
        toast({
          title: `${r.allocated.length} number${r.allocated.length === 1 ? "" : "s"} allocated`,
          description: r.errors?.length
            ? r.errors[0]
            : copied
              ? `Copied ${phones.length === 1 ? phones[0] : `${phones.length} numbers`} to clipboard — waiting for OTP.`
              : "Numbers ready below — waiting for OTP.",
        });
      } else {
        toast({ title: "No number available", description: r.errors?.[0] || "Pool is empty for this range", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Allocation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAllocLoading(null);
    }
  };

  const copyOne = async (text: string, idx: number) => {
    const ok = await safeCopy(text);
    if (ok) {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1200);
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  const copyOtp = async (text: string, idx: number) => {
    const ok = await safeCopy(text);
    if (ok) {
      setCopiedOtp(idx);
      setTimeout(() => setCopiedOtp(null), 1200);
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  const copyAll = async (rows: { phone_number: string }[]) => {
    if (!rows.length) return;
    const ok = await safeCopy(rows.map(a => a.phone_number).join("\n"));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  // Download as `Number|OTP` (one row per line). Rows without OTP yet are
  // included with an empty OTP so the file structure stays consistent.
  const downloadTxt = (rows: { phone_number: string; otp?: string | null }[]) => {
    if (!rows.length) return;
    const lines = rows.map(a => `${a.phone_number}|${a.otp || ""}`);
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `numbers-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const baseOptions = [1, 3, 5].filter(n => n <= perReqLimit);
  const canAllocate = !!selectedRange && free > 0;

  // Keep `qty` valid if the per-request limit drops below it (e.g. agent
  // settings change while page is open).
  useEffect(() => {
    if (qty > perReqLimit) setQty(1);
  }, [perReqLimit, qty]);

  // Today's allocation count (best-effort from localStorage; resets on day change).
  const todayKey = `nx.alloc.${new Date().toISOString().slice(0,10)}`;
  const dailyCap = Math.min(1000, Math.max(perReqLimit, Number((user as any)?.daily_limit) || 100));
  const [dailyCount, setDailyCount] = useState<number>(() => {
    try { return Number(localStorage.getItem(todayKey)) || 0; } catch { return 0; }
  });
  const bumpDaily = (n: number) => {
    const next = dailyCount + n;
    setDailyCount(next);
    try { localStorage.setItem(todayKey, String(next)); } catch { /* ignore */ }
  };

  // ── Live allocated numbers list ──
  const { data: myData, refetch: refetchMy } = useQuery({
    queryKey: ["my-numbers-inline"],
    queryFn: () => api.myNumbers(),
    refetchInterval: 5000, // poll every 5s for inbound OTPs
  });
  const release = useMutation({
    mutationFn: (id: number) => api.releaseNumber(id),
    onSuccess: () => {
      toast({ title: "Number released" });
      qc.invalidateQueries({ queryKey: ["my-numbers-inline"] });
    },
    onError: (e: Error) => toast({ title: "Release failed", description: e.message, variant: "destructive" }),
  });
  const sync = useMutation({
    mutationFn: () => api.syncOtp(),
    onSuccess: (r: { updated: number }) => {
      toast({ title: `Synced — ${r.updated || 0} updated` });
      qc.invalidateQueries({ queryKey: ["my-numbers-inline"] });
    },
  });

  // Tick every second so the 30-min countdown for active rows updates live.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const WINDOW_SEC = 30 * 60;

  const allRows = (myData?.numbers || []) as any[];
  const visibleRows = useMemo(() => {
    return allRows
      .filter(n => {
        if (statusFilter !== "all" && n.status !== statusFilter) return false;
        if (searchQ && !String(n.phone_number).toLowerCase().includes(searchQ.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = a.otp_received_at || a.allocated_at || 0;
        const tb = b.otp_received_at || b.allocated_at || 0;
        return tb - ta;
      });
  }, [allRows, statusFilter, searchQ]);

  const activeCount = allRows.filter(r => r.status === "active").length;
  const otpCount = allRows.filter(r => r.status === "received").length;

  return (
    <>
    <div className="relative space-y-5 w-full">
      <GradientMesh variant="default" />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl md:text-3xl font-bold text-foreground leading-tight tracking-tight">Get Number</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Pick a country and range — your number and OTP appear right below.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] sm:text-xs">
          <div className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-muted-foreground whitespace-nowrap">
            Active: <span className="font-mono font-bold text-foreground">{activeCount}</span>
          </div>
          <div className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-neon-green/10 border border-neon-green/20 text-neon-green whitespace-nowrap">
            OTPs: <span className="font-mono font-bold">{otpCount}</span>
          </div>
        </div>
      </div>

      {/* ── Empty state when no countries at all ── */}
      {/* Premium segmented service switcher — top of page, sticky feel.
          Choosing a service resets country/range so stock stays consistent. */}
      {services.length > 0 && (
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-x-auto">
          {services.map(s => {
            const isActive = serviceId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  if (serviceId === s.id) return;
                  setServiceId(s.id);
                  setCountry(null);
                  setRangeId(null);
                  try { localStorage.removeItem(LS_COUNTRY); localStorage.removeItem(LS_RANGE); } catch {}
                }}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                  isActive
                    ? "text-foreground shadow-lg"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                )}
                style={isActive ? {
                  background: `linear-gradient(135deg, ${s.color}25, ${s.color}10)`,
                  border: `1px solid ${s.color}55`,
                  boxShadow: `0 4px 20px -8px ${s.color}80`,
                } : undefined}
              >
                <BrandIcon slug={s.slug} fallback={s.icon} size={18} color={s.color} />
                <span>{s.name}</span>
                {(s.free_count ?? 0) > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold"
                    style={{ background: `${s.color}30`, color: s.color }}>
                    {s.free_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loadingCountries && allCountries.length === 0 ? (
        <GlassCard>
          <div className="text-center py-12 text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <div className="font-medium text-foreground">No ranges available yet</div>
            <div className="text-sm mt-1">An admin needs to add &amp; enable ranges for your account.</div>
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="!p-5 md:!p-6">
        {/* Last-used quick-pick chips — 1-click reload of recent country+range */}
        {recentChips.filter(c => !serviceId || c.serviceId === serviceId).length > 0 && (
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <History className="w-3 h-3" /> Recent
            </span>
            {recentChips
              .filter(c => !serviceId || c.serviceId === serviceId)
              .slice(0, RECENT_MAX)
              .map(c => {
                const isActive = country === c.country && rangeId === c.rangeId;
                return (
                  <button
                    key={`${c.serviceId}-${c.rangeId}`}
                    onClick={() => { setCountry(c.country); setRangeId(c.rangeId); }}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all inline-flex items-center gap-1.5",
                      isActive
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/20"
                    )}
                    title={`${c.country_name} · ${c.label}`}
                  >
                    <CountryFlag code={c.country} size="sm" />
                    <span className="font-mono">{c.label}</span>
                  </button>
                );
              })}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* ── Country selector box ── */}
          <div className="md:col-span-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-foreground/80">Country</label>
              {allCountries.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {allCountries.length} available
                </span>
              )}
            </div>
            <Popover open={countryOpen} onOpenChange={setCountryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={loadingCountries}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-lg bg-white/[0.04] border border-white/[0.1] hover:border-primary/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedCountry ? (
                      <>
                        <CountryFlag code={selectedCountry.country_code} size="lg" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-display text-sm font-semibold text-foreground truncate leading-tight">{selectedCountry.country_name}</div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-green/10 text-neon-green font-mono">
                              {selectedCountry.range_count} range{selectedCountry.range_count === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Globe className="w-5 h-5 text-muted-foreground" />
                        <div className="text-sm text-muted-foreground">{loadingCountries ? "Loading…" : "Select country"}</div>
                      </>
                    )}
                  </div>
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width] max-h-80 overflow-hidden" align="start">
                <div className="p-2 border-b border-white/[0.08]">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={countryQ}
                      onChange={(e) => setCountryQ(e.target.value)}
                      placeholder="Search country…"
                      className="pl-9 h-9 bg-white/[0.04] border-white/[0.1]"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {filteredCountries.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">No matches</div>
                  ) : filteredCountries.map(c => (
                    <button
                      key={c.country_code}
                      onClick={() => {
                        if (c.country_code !== country) setRangeId(null);
                        setCountry(c.country_code);
                        setCountryOpen(false);
                        setCountryQ("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.05] transition-colors text-left",
                        country === c.country_code && "bg-primary/10"
                      )}
                    >
                      <CountryFlag code={c.country_code} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{c.country_name}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{c.range_count}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* ── Range selector box ── */}
          <div className={cn("md:col-span-5", isHot && "rounded-lg")}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-foreground/80">Range</label>
              {ranges.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {ranges.length} range{ranges.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <Popover open={rangeOpen} onOpenChange={(v) => { if (country) setRangeOpen(v); }}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={!country || loadingRanges}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-lg bg-white/[0.04] border border-white/[0.1] hover:border-primary/40 transition-colors text-left",
                    !country && "opacity-50 cursor-not-allowed",
                    isHot && "border-orange-500/40 shadow-[0_0_30px_-8px_rgba(251,146,60,0.45)]"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedRange ? (
                      <>
                        {isHot ? <Flame className="w-5 h-5 text-orange-400 shrink-0" /> : <Hash className="w-5 h-5 text-neon-cyan shrink-0" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <div className="font-display text-sm font-semibold text-foreground truncate leading-tight">{selectedRange.range_label}</div>
                            {isHot && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border border-orange-500/50 bg-orange-500/15 text-orange-400 animate-pulse">
                                <Flame className="w-2.5 h-2.5" /> Hot
                              </span>
                            )}
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono", free > 0 ? "bg-neon-green/10 text-neon-green" : "bg-destructive/10 text-destructive")}>
                              {free} avail
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground leading-tight">
                            {selectedRange.range_prefix && <span className="font-mono mr-2">{selectedRange.range_prefix}</span>}
                            {selectedRange.operator && <span>{selectedRange.operator}</span>}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Hash className="w-5 h-5 text-muted-foreground" />
                        <div className="text-sm text-muted-foreground">
                          {!country ? "Pick country first" : loadingRanges ? "Loading…" : "Select range"}
                        </div>
                      </>
                    )}
                  </div>
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width] max-h-80 overflow-hidden" align="start">
                <div className="p-2 border-b border-white/[0.08]">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={rangeQ}
                      onChange={(e) => setRangeQ(e.target.value)}
                      placeholder="Search range…"
                      className="pl-9 h-9 bg-white/[0.04] border-white/[0.1]"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {rangesError ? (
                    <div className="p-6 text-center text-sm text-destructive">
                      Error loading ranges: {(rangesError as Error).message}
                    </div>
                  ) : filteredRanges.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      {ranges.length === 0 ? "No enabled ranges for this country" : "No matches"}
                    </div>
                  ) : filteredRanges.map(r => {
                    const rHot = !!(r as any).hot;
                    const rFree = Number((r as any).free_count ?? 0);
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setRangeId(r.id);
                          setRangeOpen(false);
                          setRangeQ("");
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.05] transition-colors text-left",
                          rangeId === r.id && "bg-primary/10"
                        )}
                      >
                        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", heatColor(rFree))} title={`${rFree} free`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-medium text-foreground truncate">{r.range_label}</div>
                            {rHot && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border border-orange-500/50 bg-orange-500/15 text-orange-400">
                                <Flame className="w-2.5 h-2.5" /> Hot
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {r.range_prefix && <span className="font-mono mr-2">{r.range_prefix}</span>}
                            {r.operator && <span className="mr-2">{r.operator}</span>}
                          </div>
                        </div>
                        <span className={cn("text-xs font-mono shrink-0", rFree > 0 ? "text-neon-green" : "text-destructive")}>{rFree}</span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* ── Inline Get Number CTA (3rd column on desktop) ── */}
          <div className="md:col-span-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-foreground/80 hidden md:block">Action</label>
              {selectedRange && (
                <span className="text-[10px] font-mono text-neon-green">
                  ৳{Number(selectedRange.price_bdt).toFixed(2)} / OTP
                </span>
              )}
            </div>
            <Button
              disabled={!canAllocate || allocLoading !== null}
              onClick={() => {
                if (qty > 1) setConfirmOpen(true);
                else allocate(qty);
              }}
              className={cn(
                "w-full flex-1 min-h-[52px] h-auto text-base font-bold rounded-lg border-0",
                "bg-gradient-to-r from-neon-cyan via-primary to-neon-magenta text-primary-foreground",
                "hover:opacity-95 hover:shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.6)] transition-all",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {allocLoading !== null ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Hash className="w-5 h-5 mr-2" />
                  Get {qty > 1 ? `${qty} Numbers` : "Number"}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ── Quantity selector row ── */}
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Layers className="w-4 h-4 text-neon-cyan" />
            <span className="uppercase tracking-wider font-semibold text-foreground/80">Quantity</span>
            {selectedRange && qty > 0 && (
              <span className="ml-2 text-[11px] text-muted-foreground">
                Max charge:{" "}
                <span className="font-mono font-bold text-neon-green">
                  ৳{(Number(selectedRange.price_bdt) * qty).toFixed(2)}
                </span>
                <span className="text-muted-foreground/60"> · only billed if OTP arrives</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {baseOptions.map(n => {
              const disabled = allocLoading !== null;
              const selected = qty === n;
              return (
                <Button
                  key={n}
                  size="sm"
                  disabled={disabled}
                  onClick={() => setQty(n)}
                  type="button"
                  className={cn(
                    "h-8 px-4 text-xs font-bold rounded-md border",
                    selected
                      ? "bg-gradient-to-r from-primary/30 to-neon-magenta/30 border-primary/50 text-foreground shadow-[0_0_18px_-6px_hsl(var(--primary)/0.7)]"
                      : "bg-white/[0.04] border-white/10 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
                  )}
                >
                  {`${n}×`}
                </Button>
              );
            })}
            {perReqLimit > 5 && (
              <>
                <span className="mx-1 h-4 w-px bg-white/[0.08]" />
                <Input
                  type="number"
                  min={1}
                  max={perReqLimit}
                  placeholder={`max ${perReqLimit}`}
                  value={customCount || ""}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(perReqLimit, +e.target.value || 0));
                    setCustomCount(v);
                    if (v >= 1) setQty(v); // sync selection so big button uses it
                  }}
                  className="bg-white/[0.04] border-white/[0.1] h-8 w-24 font-mono text-xs"
                />
              </>
            )}
          </div>
        </div>

        {/* ── Footer meta strip ── */}
        <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-5 flex-wrap">
            <div className="text-muted-foreground">
              Per request: <span className="font-mono font-semibold text-foreground">{perReqLimit}</span>
            </div>
            <div className="text-muted-foreground">
              Daily: <span className="font-mono font-semibold text-foreground">{dailyCount}</span>
              <span className="text-muted-foreground/60"> / {dailyCap}</span>
            </div>
            {selectedRange && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="w-3.5 h-3.5 text-neon-green" />
                Earn <span className="font-mono font-bold text-neon-green">৳{Number(selectedRange.price_bdt).toFixed(2)}</span> per OTP
              </div>
            )}
          </div>
          {!canAllocate && selectedRange && (
            <div className="text-destructive font-medium">
              {free <= 0 ? "Out of stock" : ""}
            </div>
          )}
        </div>
        </GlassCard>
      )}

      {/* ── Inline allocated numbers + OTPs panel (full page) ── */}
      <GlassCard className="!p-0 overflow-hidden">
        {/* Sticky live-active bar — visible when ≥1 number is still ticking */}
        {(() => {
          const liveRows = allRows.filter(r => r.status === "active");
          if (!liveRows.length) return null;
          return (
            <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-2.5 border-b border-white/[0.06] bg-background/95 backdrop-blur-md overflow-x-auto">
              <span className="text-[10px] uppercase tracking-wider font-bold text-neon-amber shrink-0 flex items-center gap-1">
                <Timer className="w-3 h-3" /> Live
              </span>
              {liveRows.slice(0, 8).map(r => {
                const remaining = Math.max(0, WINDOW_SEC - (now - (r.allocated_at as number)));
                const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
                const ss = String(remaining % 60).padStart(2, "0");
                const low = remaining < 5 * 60;
                return (
                  <button
                    key={r.id}
                    onClick={() => copyOne(r.phone_number, r.id)}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-mono transition-colors",
                      low ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-neon-amber/30 bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20"
                    )}
                    title={`Copy ${r.phone_number}`}
                  >
                    <span className="font-semibold">{r.phone_number.slice(-6)}</span>
                    <span className="opacity-80">{mm}:{ss}</span>
                  </button>
                );
              })}
              {liveRows.length > 8 && (
                <span className="shrink-0 text-[11px] text-muted-foreground font-mono">+{liveRows.length - 8}</span>
              )}
            </div>
          );
        })()}
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-3 sm:px-5 py-3 border-b border-white/[0.06] bg-white/[0.02] flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-neon-cyan" />
            <h2 className="font-display text-[11px] sm:text-sm font-bold text-foreground uppercase tracking-wider">
              <span className="hidden sm:inline">Allocated Numbers &amp; OTPs</span>
              <span className="sm:hidden">Numbers &amp; OTPs</span>
            </h2>
            <span className="text-[10px] font-mono text-muted-foreground">
              {allRows.length} total
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search number…"
                className="pl-8 h-8 w-full sm:w-44 text-xs bg-white/[0.04] border-white/[0.08]"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto -mx-1 px-1 max-w-full">
              {(["all", "active", "received", "released", "expired"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-colors",
                    statusFilter === s
                      ? "bg-primary/20 border-primary/40 text-primary"
                      : "bg-white/[0.02] border-white/[0.08] text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="border-white/[0.1] h-8 px-3 text-[11px] flex-1 sm:flex-none"
            >
              <RefreshCw className={cn("w-3 h-3 mr-1", sync.isPending && "animate-spin")} /> Sync
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyAll(visibleRows)}
              disabled={!visibleRows.length}
              className="border-white/[0.1] h-8 px-3 text-[11px] flex-1 sm:flex-none"
            >
              {copiedAll ? <Check className="w-3 h-3 mr-1 text-neon-green" /> : <Copy className="w-3 h-3 mr-1" />}
              Copy all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadTxt(visibleRows)}
              disabled={!visibleRows.length}
              className="border-white/[0.1] h-8 px-3 text-[11px] flex-1 sm:flex-none"
            >
              <Download className="w-3 h-3 mr-1" /> .txt
            </Button>
          </div>
        </div>

        {/* Table */}
        {visibleRows.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <div className="text-sm font-medium text-foreground">No numbers yet</div>
            <div className="text-xs mt-1">Use Get Number above to allocate — your OTPs arrive here automatically.</div>
          </div>
        ) : (
          <>
          {/* Mobile card list — < sm */}
          <div className="sm:hidden divide-y divide-white/[0.05]">
            {visibleRows.map((r) => {
              const recv = r.otp_received_at as number | undefined;
              const isFresh = (!!recv && now - recv < 60) || freshIds.has(r.id);
              const allocAt = r.allocated_at as number;
              const remaining = allocAt ? Math.max(0, WINDOW_SEC - (now - allocAt)) : 0;
              const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
              const ss = String(remaining % 60).padStart(2, "0");
              const low = remaining < 5 * 60;
              return (
                <div key={r.id} className={cn("p-3 space-y-2", isFresh && "bg-neon-green/[0.04]")}>
                  {/* Top row: number + status */}
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => copyOne(r.phone_number, r.id)}
                      className="flex items-center gap-2 min-w-0 text-left"
                    >
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        r.status === "received" ? "bg-neon-green" :
                        r.status === "active" ? "bg-neon-amber animate-pulse" :
                        "bg-muted-foreground/40"
                      )} />
                      <span className="font-mono text-[13px] text-foreground truncate">{r.phone_number}</span>
                      {copiedIdx === r.id
                        ? <Check className="w-3.5 h-3.5 text-neon-green shrink-0" />
                        : <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    </button>
                    <span className={cn(
                      "shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                      r.status === "received" && "bg-neon-green/15 text-neon-green",
                      r.status === "active" && "bg-neon-amber/15 text-neon-amber",
                      r.status === "released" && "bg-muted text-muted-foreground",
                      r.status === "expired" && "bg-destructive/15 text-destructive"
                    )}>
                      {r.status}
                    </span>
                  </div>

                  {/* Country / operator */}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {r.country_code && <CountryFlag code={r.country_code} size="sm" />}
                    <span className="truncate">{r.operator || "—"}</span>
                  </div>

                  {/* OTP + countdown */}
                  <div className="flex items-center justify-between gap-2">
                    {r.otp ? (
                      <button
                        onClick={() => copyOtp(r.otp, r.id)}
                        className={cn(
                          "font-mono font-bold text-[13px] inline-flex items-center gap-1.5 px-2 py-1 rounded",
                          "bg-neon-green/10 text-neon-green border border-neon-green/30 transition-all",
                          isFresh && "bg-neon-green/20 border-neon-green/60 otp-glow animate-otp-arrive"
                        )}
                      >
                        OTP: {r.otp}
                        {copiedOtp === r.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-70" />}
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> waiting…
                      </span>
                    )}
                    {r.status === "active" && allocAt && (
                      <span className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-mono",
                        low ? "text-destructive" : "text-neon-amber"
                      )}>
                        <Timer className="w-3 h-3" /> {mm}:{ss}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-1 border-t border-white/[0.04]">
                    <button
                      onClick={() => setThreadAllocId(r.id)}
                      className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                    >
                      <MessageSquare className="w-3 h-3" /> Thread
                    </button>
                    {r.status === "active" && (
                      <button
                        onClick={() => release.mutate(r.id)}
                        disabled={release.isPending}
                        className="text-[11px] text-destructive inline-flex items-center gap-1 ml-auto"
                      >
                        <X className="w-3 h-3" /> Release
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table — sm and up */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/[0.06]">
                  <th className="text-left px-5 py-2.5 font-semibold w-10">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Number</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Country / Operator</th>
                  <th className="text-left px-3 py-2.5 font-semibold">OTP</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Time</th>
                  <th className="text-right px-5 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, idx) => {
                  const recv = r.otp_received_at as number | undefined;
                  const isFresh = (!!recv && now - recv < 60) || freshIds.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors",
                        isFresh && "bg-neon-green/[0.04]"
                      )}
                    >
                      <td className="px-5 py-3 text-[11px] font-mono text-muted-foreground">{idx + 1}</td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => copyOne(r.phone_number, r.id)}
                          className="font-mono text-[13px] text-foreground hover:text-primary inline-flex items-center gap-2 group"
                        >
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            r.status === "received" ? "bg-neon-green" :
                            r.status === "active" ? "bg-neon-amber animate-pulse" :
                            "bg-muted-foreground/40"
                          )} />
                          {r.phone_number}
                          {copiedIdx === r.id
                            ? <Check className="w-3 h-3 text-neon-green" />
                            : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 text-muted-foreground" />}
                          {isFresh && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-neon-green/15 text-neon-green border border-neon-green/30 animate-pulse">
                              NEW
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 text-[12px]">
                          {r.country_code && <CountryFlag code={r.country_code} size="md" />}
                          <div className="min-w-0">
                            <div className="text-foreground truncate">{r.operator || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {r.otp ? (
                          <button
                            onClick={() => copyOtp(r.otp, r.id)}
                            className={cn(
                              "font-mono font-bold text-[13px] inline-flex items-center gap-1.5 px-2 py-1 rounded",
                              "bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 transition-colors",
                            isFresh && "bg-neon-green/20 border-neon-green/70 otp-glow animate-otp-arrive scale-[1.02]"
                            )}
                          >
                            {r.otp}
                            {copiedOtp === r.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-70" />}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> waiting…
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                          r.status === "received" && "bg-neon-green/15 text-neon-green",
                          r.status === "active" && "bg-neon-amber/15 text-neon-amber",
                          r.status === "released" && "bg-muted text-muted-foreground",
                          r.status === "expired" && "bg-destructive/15 text-destructive"
                        )}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                        {(() => {
                          const allocAt = r.allocated_at as number;
                          const timeStr = new Date(((recv || allocAt) as number) * 1000).toLocaleTimeString();
                          if (r.status === "active" && allocAt) {
                            const remaining = Math.max(0, WINDOW_SEC - (now - allocAt));
                            const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
                            const ss = String(remaining % 60).padStart(2, "0");
                            const low = remaining < 5 * 60;
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span>{timeStr}</span>
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-[10px]",
                                  low ? "text-destructive" : "text-neon-amber"
                                )}>
                                  <Timer className="w-3 h-3" /> {mm}:{ss} left
                                </span>
                              </div>
                            );
                          }
                          return timeStr;
                        })()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-3 justify-end">
                          <button
                            onClick={() => setThreadAllocId(r.id)}
                            className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                            title="View full SMS thread"
                          >
                            <MessageSquare className="w-3 h-3" /> Thread
                          </button>
                          {r.status === "active" && (
                            <button
                              onClick={() => release.mutate(r.id)}
                              disabled={release.isPending}
                              className="text-[11px] text-destructive hover:underline inline-flex items-center gap-1"
                              title="Release this number"
                            >
                              <X className="w-3 h-3" /> Release
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </GlassCard>
    </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allocate {qty} numbers?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to request <span className="font-semibold text-foreground">{qty} numbers</span>
              {selectedRange ? (
                <>
                  {" "}from <span className="font-mono text-foreground">{(selectedRange as any).label || selectedRange.country_code}</span>
                  {" "}at <span className="text-neon-green font-mono">৳{Number(selectedRange.price_bdt).toFixed(2)}</span> per OTP.
                  {" "}Estimated total: <span className="text-neon-green font-mono">৳{(Number(selectedRange.price_bdt) * qty).toFixed(2)}</span>.
                </>
              ) : "."}
              {" "}You will only be charged for OTPs that arrive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmOpen(false); allocate(qty); }}
              className="bg-gradient-to-r from-neon-cyan via-primary to-neon-magenta text-primary-foreground"
            >
              Yes, get {qty} numbers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <OtpThreadDrawer allocationId={threadAllocId} onClose={() => setThreadAllocId(null)} />
    </>
  );
};

export default AgentRanges;
