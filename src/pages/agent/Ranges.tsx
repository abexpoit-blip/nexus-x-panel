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
import { Globe, ChevronDown, Search, Hash, Loader2, Inbox, Flame, Copy, Check, Download, Zap, Phone, Sparkles } from "lucide-react";
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

  return (
    <div className="relative space-y-3 max-w-5xl mx-auto">
      <GradientMesh variant="default" />
      {/* Compact header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-neon-magenta/20 border border-primary/30 flex items-center justify-center">
            <Globe className="w-4 h-4 text-neon-cyan" />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground leading-none">Get Number</div>
            <h1 className="font-display text-lg font-bold text-foreground leading-tight">Allocate Numbers</h1>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Pick country → range → amount
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* ── Country selector box ── */}
          <GlassCard className="!p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Country</div>
              {selectedCountry && (
                <div className="text-[9px] font-mono text-muted-foreground">{selectedCountry.range_count} range{selectedCountry.range_count === 1 ? "" : "s"}</div>
              )}
            </div>
            <Popover open={countryOpen} onOpenChange={setCountryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={loadingCountries}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.1] hover:border-primary/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedCountry ? (
                      <>
                        <span className="text-xl leading-none">{flagEmoji(selectedCountry.country_code)}</span>
                        <div className="min-w-0">
                          <div className="font-display text-[13px] font-semibold text-foreground truncate leading-tight">{selectedCountry.country_name}</div>
                          <div className="text-[9px] text-muted-foreground font-mono uppercase leading-tight">{selectedCountry.country_code}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Globe className="w-4 h-4 text-muted-foreground" />
                        <div className="text-[13px] text-muted-foreground">{loadingCountries ? "Loading…" : "Select country"}</div>
                      </>
                    )}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
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
          </GlassCard>

          {/* ── Range selector box ── */}
          <GlassCard className={cn("!p-2.5", isHot && "border-orange-500/40 shadow-[0_0_30px_-8px_rgba(251,146,60,0.45)]")}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Range</div>
              {selectedRange && (
                <div className={cn("text-[9px] font-mono", free > 0 ? "text-neon-green" : "text-destructive")}>{free} free</div>
              )}
            </div>
            <Popover open={rangeOpen} onOpenChange={(v) => { if (country) setRangeOpen(v); }}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={!country || loadingRanges}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.1] hover:border-primary/40 transition-colors text-left",
                    !country && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedRange ? (
                      <>
                        <Hash className="w-4 h-4 text-neon-cyan shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <div className="font-display text-[13px] font-semibold text-foreground truncate leading-tight">{selectedRange.range_label}</div>
                            {isHot && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-bold uppercase border border-orange-500/50 bg-orange-500/15 text-orange-400 animate-pulse">
                                <Flame className="w-2.5 h-2.5" /> Hot
                              </span>
                            )}
                          </div>
                          <div className="text-[9px] text-muted-foreground leading-tight">
                            {selectedRange.range_prefix && <span className="font-mono">{selectedRange.range_prefix}</span>}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Hash className="w-4 h-4 text-muted-foreground" />
                        <div className="text-[13px] text-muted-foreground">
                          {!country ? "Pick country first" : loadingRanges ? "Loading…" : "Select range"}
                        </div>
                      </>
                    )}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
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
          </GlassCard>
        </div>
      )}

      {/* ── Get Number action panel ── */}
      {selectedRange && (
        <GlassCard className="!p-4">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">Step 3 — Allocate</div>
              <div className="font-display text-base font-bold text-foreground">How many numbers?</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Per-request limit: <span className="font-mono text-foreground">{perReqLimit}</span> · Stock: <span className={cn("font-mono", free > 0 ? "text-neon-green" : "text-destructive")}>{free}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase text-muted-foreground tracking-wider">Earn / OTP</div>
              <div className="text-lg font-display font-bold text-neon-green font-mono">৳{Number(selectedRange.price_bdt).toFixed(2)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {baseOptions.map(n => {
              const disabled = !canAllocate || allocLoading !== null;
              const isThis = allocLoading === n;
              return (
                <Button
                  key={n}
                  disabled={disabled}
                  onClick={() => allocate(n)}
                  className={cn(
                    "h-11 text-sm font-bold",
                    n === 1 && "bg-white/[0.06] hover:bg-white/[0.12] text-foreground border border-white/10",
                    n === 3 && "bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30",
                    n === 5 && "bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0 hover:opacity-90",
                  )}
                >
                  {isThis ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Zap className="w-3.5 h-3.5 mr-1" /> Get {n}×</>}
                </Button>
              );
            })}
          </div>

          {perReqLimit > 5 && (
            <div className="mt-2 flex gap-2">
              <Input
                type="number"
                min={1}
                max={perReqLimit}
                placeholder={`Custom amount (max ${perReqLimit})`}
                value={customCount || ""}
                onChange={(e) => setCustomCount(Math.max(0, Math.min(perReqLimit, +e.target.value || 0)))}
                className="bg-white/[0.04] border-white/[0.1] h-9 font-mono text-sm"
              />
              <Button
                variant="outline"
                disabled={!customCount || !canAllocate || allocLoading !== null}
                onClick={() => allocate(customCount)}
                className="border-white/[0.1] h-9 px-5 text-sm"
              >
                {allocLoading === customCount ? <Loader2 className="w-4 h-4 animate-spin" /> : "Get"}
              </Button>
            </div>
          )}

          {!canAllocate && (
            <div className="mt-2 text-xs text-destructive text-center">
              {free <= 0 ? "This range is out of stock right now." : ""}
            </div>
          )}
        </GlassCard>
      )}

      {/* Allocation result dialog — copy single, copy all, download as TXT */}
      <Dialog open={!!allocated} onOpenChange={(v) => { if (!v) { setAllocated(null); setCustomCount(0); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hash className="w-5 h-5 text-neon-cyan" />
              {allocated?.length} number{allocated?.length === 1 ? "" : "s"} allocated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {(allocated || []).map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-primary/40 transition-colors"
              >
                <span className="font-mono text-sm text-foreground select-all">{a.phone_number}</span>
                <button
                  onClick={() => copyOne(a.phone_number, i)}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  title="Copy this number"
                >
                  {copiedIdx === i ? <Check className="w-4 h-4 text-neon-green" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
          <DialogFooter className="!flex-col sm:!flex-row gap-2">
            <Button variant="outline" onClick={copyAll} className="border-white/[0.1]">
              {copiedAll ? <Check className="w-4 h-4 mr-1.5 text-neon-green" /> : <Copy className="w-4 h-4 mr-1.5" />}
              Copy all
            </Button>
            <Button variant="outline" onClick={downloadTxt} className="border-white/[0.1]">
              <Download className="w-4 h-4 mr-1.5" /> Download .txt
            </Button>
            <Button
              onClick={() => { setAllocated(null); navigate("/agent/my-numbers"); }}
              className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0 sm:ml-auto"
            >
              Open My Numbers
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentRanges;
