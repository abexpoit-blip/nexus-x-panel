import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { GradientMesh, PageHeader } from "@/components/premium";
import { Globe, ChevronDown, Search, Hash, Loader2, Inbox, Flame, Copy, Check, Download, Zap, Phone, Sparkles, Layers, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

// Convert ISO 3166-1 alpha-2 country code → flag emoji.
// For non-2-letter codes (e.g. "TZ" works, "USA" falls back to globe).
function flagEmoji(code: string): string {
  if (!code) return "🌐";
  const cc = code.toUpperCase();
  if (cc.length !== 2) return "🌐";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65);
}

const LS_COUNTRY = "nx.getnum.country";
const LS_RANGE = "nx.getnum.rangeId";

const AgentRanges = () => {
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
  const [countryOpen, setCountryOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [countryQ, setCountryQ] = useState("");
  const [rangeQ, setRangeQ] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const perReqLimit = Math.min(500, Math.max(1, Number((user as any)?.per_request_limit) || 5));

  const [allocated, setAllocated] = useState<{ phone_number: string }[] | null>(null);
  const [allocLoading, setAllocLoading] = useState<number | null>(null); // count being loaded
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [customCount, setCustomCount] = useState<number>(0);

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
    queryKey: ["agent-v2-countries"],
    queryFn: () => api.v2Countries(),
    refetchInterval: 60_000,
  });

  const { data: rangesData, isLoading: loadingRanges, error: rangesError } = useQuery({
    queryKey: ["agent-v2-ranges", country],
    queryFn: () => api.v2Ranges(country!),
    enabled: !!country,
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
        setAllocated(r.allocated);
        toast({
          title: `${r.allocated.length} number${r.allocated.length === 1 ? "" : "s"} allocated`,
          description: r.errors?.length ? r.errors[0] : "Numbers ready below.",
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
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1200);
    } catch { toast({ title: "Copy failed", variant: "destructive" }); }
  };
  const copyAll = async () => {
    if (!allocated) return;
    try {
      await navigator.clipboard.writeText(allocated.map(a => a.phone_number).join("\n"));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch { toast({ title: "Copy failed", variant: "destructive" }); }
  };
  const downloadTxt = () => {
    if (!allocated) return;
    const blob = new Blob([allocated.map(a => a.phone_number).join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `numbers-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const baseOptions = [1, 3, 5].filter(n => n <= perReqLimit);
  const canAllocate = !!selectedRange && free > 0;

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

  return (
    <div className="relative space-y-5 max-w-6xl mx-auto">
      <GradientMesh variant="default" />
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground leading-tight tracking-tight">Get Number</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a country and range — we'll grab the next available number from the pool.
          </p>
        </div>
      </div>

      {/* ── Empty state when no countries at all ── */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── Country selector box ── */}
          <div>
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
                        <span className="text-2xl leading-none">{flagEmoji(selectedCountry.country_code)}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-display text-sm font-semibold text-foreground truncate leading-tight">{selectedCountry.country_name}</div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-green/10 text-neon-green font-mono">
                              {selectedCountry.range_count} range{selectedCountry.range_count === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono uppercase leading-tight">{selectedCountry.country_code}</div>
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
                      <span className="text-2xl leading-none">{flagEmoji(c.country_code)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{c.country_name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono uppercase">{c.country_code}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{c.range_count}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* ── Range selector box ── */}
          <div className={cn(isHot && "rounded-lg")}>
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
                        <Hash className="w-4 h-4 text-neon-cyan shrink-0" />
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
        </div>

        {/* ── Big "Get Number" CTA ── */}
        <div className="mt-5">
          <Button
            disabled={!canAllocate || allocLoading !== null}
            onClick={() => allocate(1)}
            className={cn(
              "w-full h-14 text-base font-bold rounded-xl border-0",
              "bg-gradient-to-r from-neon-cyan via-primary to-neon-magenta text-primary-foreground",
              "hover:opacity-95 hover:shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.6)] transition-all",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {allocLoading === 1 ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Hash className="w-5 h-5 mr-2" />
                Get Number
              </>
            )}
          </Button>
        </div>

        {/* ── Bulk request row ── */}
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Layers className="w-4 h-4 text-neon-cyan" />
            <span className="uppercase tracking-wider font-semibold text-foreground/80">Bulk request</span>
          </div>
          <div className="flex items-center gap-1.5">
            {baseOptions.filter(n => n > 1).map(n => {
              const disabled = !canAllocate || allocLoading !== null;
              const isThis = allocLoading === n;
              return (
                <Button
                  key={n}
                  size="sm"
                  disabled={disabled}
                  onClick={() => allocate(n)}
                  className={cn(
                    "h-8 px-4 text-xs font-bold rounded-md border",
                    n === 5
                      ? "bg-gradient-to-r from-primary/20 to-neon-magenta/20 border-primary/40 text-foreground hover:from-primary/30 hover:to-neon-magenta/30"
                      : "bg-white/[0.04] border-white/10 text-foreground hover:bg-white/[0.08]",
                  )}
                >
                  {isThis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `${n}×`}
                </Button>
              );
            })}
            {perReqLimit > 5 && (
              <>
                <Input
                  type="number"
                  min={1}
                  max={perReqLimit}
                  placeholder={`max ${perReqLimit}`}
                  value={customCount || ""}
                  onChange={(e) => setCustomCount(Math.max(0, Math.min(perReqLimit, +e.target.value || 0)))}
                  className="bg-white/[0.04] border-white/[0.1] h-8 w-24 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!customCount || !canAllocate || allocLoading !== null}
                  onClick={() => allocate(customCount)}
                  className="border-white/[0.1] h-8 px-3 text-xs"
                >
                  {allocLoading === customCount ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Go"}
                </Button>
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

      {/* Allocation result dialog — copy single, copy all, download as TXT */}
      <Dialog open={!!allocated} onOpenChange={(v) => { if (!v) { setAllocated(null); setCustomCount(0); } }}>
        <DialogContent className="max-w-lg p-0 overflow-hidden border-white/[0.08] bg-card">
          {/* Gradient header */}
          <div className="relative px-5 py-4 border-b border-white/[0.08] bg-gradient-to-br from-primary/15 via-transparent to-neon-magenta/15">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-neon-magenta flex items-center justify-center shadow-lg shadow-primary/30">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="font-display text-base font-bold text-foreground">
                  {allocated?.length} number{allocated?.length === 1 ? "" : "s"} ready
                </DialogTitle>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  {selectedCountry && <span className="text-base leading-none">{flagEmoji(selectedCountry.country_code)}</span>}
                  <span>{selectedCountry?.country_name || ""}</span>
                  {selectedRange && <span className="text-muted-foreground/60">·</span>}
                  {selectedRange && <span className="truncate">{selectedRange.range_label}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Numbers list */}
          <div className="px-5 py-3">
            <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
              {(allocated || []).map((a, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-3 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06] hover:border-primary/40 hover:bg-white/[0.05] transition-all"
                >
                  <div className="w-6 h-6 rounded bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <Phone className="w-3 h-3 text-primary" />
                  </div>
                  <span className="font-mono text-[13px] text-foreground select-all flex-1 truncate">{a.phone_number}</span>
                  <button
                    onClick={() => copyOne(a.phone_number, i)}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      copiedIdx === i ? "text-neon-green bg-neon-green/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                    )}
                    title="Copy this number"
                  >
                    {copiedIdx === i ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer actions */}
          <DialogFooter className="!flex-row gap-1.5 px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] !justify-between">
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={copyAll} className="border-white/[0.1] h-8 text-[12px]">
                {copiedAll ? <Check className="w-3.5 h-3.5 mr-1 text-neon-green" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                Copy all
              </Button>
              <Button size="sm" variant="outline" onClick={downloadTxt} className="border-white/[0.1] h-8 text-[12px]">
                <Download className="w-3.5 h-3.5 mr-1" /> .txt
              </Button>
            </div>
            <Button
              size="sm"
              onClick={() => { setAllocated(null); navigate("/agent/my-numbers"); }}
              className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0 h-8 text-[12px]"
            >
              My Numbers →
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentRanges;
