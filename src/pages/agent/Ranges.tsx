import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GradientMesh, PageHeader } from "@/components/premium";
import { Globe, ChevronRight, ArrowLeft, Search, Hash, Loader2, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const AgentRanges = () => {
  const [country, setCountry] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: countriesData, isLoading: loadingCountries } = useQuery({
    queryKey: ["agent-v2-countries"],
    queryFn: () => api.v2Countries(),
    enabled: !country,
    refetchInterval: 30_000,
  });

  const { data: rangesData, isLoading: loadingRanges } = useQuery({
    queryKey: ["agent-v2-ranges", country],
    queryFn: () => api.v2Ranges(country!),
    enabled: !!country,
    refetchInterval: 15_000,
  });

  const countries = (countriesData?.countries || []).filter(c =>
    !q || c.country_code.toLowerCase().includes(q.toLowerCase()) ||
    (c.country_name || "").toLowerCase().includes(q.toLowerCase())
  );

  const ranges = rangesData?.ranges || [];

  const allocate = async (provider: string, range_label: string, country_code: string) => {
    try {
      const r = await api.getNumber({ provider, range: range_label, country_code, count: 1 });
      if (r.allocated?.length) {
        toast({ title: "Number allocated", description: r.allocated[0].phone_number });
        navigate("/agent/my-numbers");
      } else {
        toast({ title: "No number available", description: r.errors?.[0] || "Pool is empty for this range", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Allocation failed", description: (e as Error).message, variant: "destructive" });
    }
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
                        <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{c.country_code}</div>
                        <div className="font-display font-semibold text-foreground truncate text-lg">{c.country_name}</div>
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
          <Button variant="outline" onClick={() => setCountry(null)} className="border-white/[0.1]">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> All countries
          </Button>

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
              {ranges.map((r) => (
                <GlassCard key={r.id} className="!p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Hash className="w-4 h-4 text-neon-cyan" />
                        <h3 className="font-display font-semibold text-foreground truncate">{r.range_label}</h3>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Provider: <span className="font-mono uppercase">{r.provider}</span></div>
                        {r.operator && <div>Operator: {r.operator}</div>}
                        {r.range_prefix && <div>Prefix: <span className="font-mono">{r.range_prefix}</span></div>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Earn / OTP</div>
                      <div className="text-lg font-display font-bold text-neon-green font-mono">৳{Number(r.price_bdt).toFixed(2)}</div>
                    </div>
                  </div>
                  <Button
                    onClick={() => allocate(r.provider, r.range_label, r.country_code)}
                    className={cn(
                      "w-full mt-4",
                      "bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0 hover:opacity-90",
                    )}
                  >
                    Get Number
                  </Button>
                </GlassCard>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AgentRanges;
