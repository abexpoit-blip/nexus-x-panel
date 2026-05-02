import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { GradientMesh, PageHeader } from "@/components/premium";
import { Globe, ChevronRight, ArrowLeft, Search, Hash, Loader2, Inbox, Flame, Copy, Check, Download } from "lucide-react";
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

const AgentRanges = () => {
  const [country, setCountry] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const perReqLimit = Math.min(500, Math.max(1, Number((user as any)?.per_request_limit) || 5));

  const [allocated, setAllocated] = useState<{ phone_number: string }[] | null>(null);
  const [allocLoading, setAllocLoading] = useState<{ rangeId: number; count: number } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [customCount, setCustomCount] = useState<number>(0);

  const { data: countriesData, isLoading: loadingCountries } = useQuery({
    queryKey: ["agent-v2-countries"],
    queryFn: () => api.v2Countries(),
    enabled: !country,
    refetchInterval: 60_000,
  });

  const { data: rangesData, isLoading: loadingRanges } = useQuery({
    queryKey: ["agent-v2-ranges", country],
    queryFn: () => api.v2Ranges(country!),
    enabled: !!country,
    refetchInterval: 30_000,
  });

  const countries = (countriesData?.countries || []).filter(c =>
    !q || c.country_code.toLowerCase().includes(q.toLowerCase()) ||
    (c.country_name || "").toLowerCase().includes(q.toLowerCase())
  );

  const ranges = rangesData?.ranges || [];

  const allocate = async (rangeId: number, count: number) => {
    setAllocLoading({ rangeId, count });
    try {
      const r = await api.getNumber({ range_id: rangeId, count });
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

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Get Number"
        title={country ? `Ranges — ${country}` : "Browse by Country"}
        description={country ? "Pick a range to allocate a free number." : "Select a country to see available ranges."}
        icon={<Globe className="w-5 h-5 text-neon-cyan" />}
      />

      {!country && (
        <>
          <GlassCard>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search country…"
                className="pl-9 bg-white/[0.04] border-white/[0.1]"
              />
            </div>
          </GlassCard>

          {loadingCountries ? (
            <div className="p-12 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading countries…
            </div>
          ) : countries.length === 0 ? (
            <GlassCard>
              <div className="text-center py-12 text-muted-foreground">
                <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <div className="font-medium text-foreground">No ranges available yet</div>
                <div className="text-sm mt-1">An admin needs to add &amp; enable ranges for your account to see options here.</div>
              </div>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {countries.map((c) => (
                <button
                  key={c.country_code}
                  onClick={() => setCountry(c.country_code)}
                  className="group text-left"
                >
                  <GlassCard className="!p-5 hover:border-primary/40 transition-all hover:-translate-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl leading-none">{flagEmoji(c.country_code)}</span>
                          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{c.country_code}</div>
                        </div>
                        <div className="font-display font-semibold text-foreground truncate text-lg mt-1">{c.country_name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {c.range_count} range{c.range_count === 1 ? "" : "s"} available
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    </div>
                  </GlassCard>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {country && (
        <>
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setCountry(null)} className="border-white/[0.1]">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> All countries
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="text-2xl leading-none">{flagEmoji(country)}</span>
              <span className="font-mono uppercase">{country}</span>
              <span>•</span>
              <span>Per-request limit: <span className="font-mono text-foreground">{perReqLimit}</span></span>
            </div>
          </div>

          {loadingRanges ? (
            <div className="p-12 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading ranges…
            </div>
          ) : ranges.length === 0 ? (
            <GlassCard>
              <div className="text-center py-12 text-muted-foreground">
                <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <div>No enabled ranges for this country.</div>
              </div>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ranges.map((r) => {
                const isHot = !!(r as any).hot;
                const free = Number((r as any).free_count ?? 0);
                // Default offers: 1x, 3x, 5x — capped to perReqLimit AND available stock.
                const baseOptions = [1, 3, 5].filter(n => n <= perReqLimit);
                const isLoadingThis = allocLoading?.rangeId === r.id;
                return (
                  <GlassCard
                    key={r.id}
                    className={cn(
                      "!p-5",
                      isHot && "border-orange-500/40 shadow-[0_0_30px_-8px_rgba(251,146,60,0.45)]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Hash className="w-4 h-4 text-neon-cyan" />
                          <h3 className="font-display font-semibold text-foreground truncate">{r.range_label}</h3>
                          {isHot && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-orange-500/50 bg-orange-500/15 text-orange-400 animate-pulse">
                              <Flame className="w-3 h-3" /> Hot
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>Provider: <span className="font-mono uppercase">{r.provider}</span></div>
                          {r.operator && <div>Operator: {r.operator}</div>}
                          {r.range_prefix && <div>Prefix: <span className="font-mono">{r.range_prefix}</span></div>}
                          <div>Stock: <span className={cn("font-mono", free > 0 ? "text-neon-green" : "text-destructive")}>{free} free</span></div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Earn / OTP</div>
                        <div className="text-lg font-display font-bold text-neon-green font-mono">৳{Number(r.price_bdt).toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {baseOptions.map(n => (
                        <Button
                          key={n}
                          disabled={free <= 0 || isLoadingThis}
                          onClick={() => allocate(r.id, n)}
                          className={cn(
                            "font-bold",
                            n === 1 && "bg-white/[0.06] hover:bg-white/[0.12] text-foreground border border-white/10",
                            n === 3 && "bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30",
                            n === 5 && "bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0 hover:opacity-90",
                          )}
                        >
                          {isLoadingThis && allocLoading?.count === n
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : `${n}×`}
                        </Button>
                      ))}
                    </div>
                    {perReqLimit > 5 && (
                      <div className="mt-2 flex gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={perReqLimit}
                          placeholder={`Custom (max ${perReqLimit})`}
                          value={customCount || ""}
                          onChange={(e) => setCustomCount(Math.max(0, Math.min(perReqLimit, +e.target.value || 0)))}
                          className="bg-white/[0.04] border-white/[0.1] h-9 font-mono"
                        />
                        <Button
                          variant="outline"
                          disabled={!customCount || free <= 0 || isLoadingThis}
                          onClick={() => allocate(r.id, customCount)}
                          className="border-white/[0.1] h-9"
                        >
                          Get
                        </Button>
                      </div>
                    )}
                  </GlassCard>
                );
              })}
            </div>
          )}
        </>
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
