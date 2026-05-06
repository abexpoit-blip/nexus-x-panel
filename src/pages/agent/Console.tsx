import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/GlassCard";
import { Input } from "@/components/ui/input";
import { Search, RefreshCw, Inbox, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { cliBadgeClass } from "@/lib/cliBadge";
import { usePagination } from "@/components/Pagination";
import { BrandIcon } from "@/components/BrandIcon";
import { countryName } from "@/lib/countryName";

// Shorten provider range names like "Peru Bitel TF04" → "TF04"
const shortRange = (operator?: string | null) => {
  if (!operator) return "";
  const parts = operator.trim().split(/\s+/);
  return parts[parts.length - 1] || operator;
};

// PUBLIC OTP activity feed — every agent sees the same masked stream so they
// can spot which ranges are actively receiving OTPs and pick winners in Get
// Number. Phone digits and OTP codes are masked server-side; nobody can see
// another agent's actual code from here.
const AgentConsole = () => {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["public-otp-feed"],
    queryFn: () => api.cdr.feed(),
    refetchInterval: 5000,
  });
  const [search, setSearch] = useState("");

  const items = useMemo(() => {
    const feed = data?.feed || [];
    if (!search) return feed;
    const q = search.toLowerCase();
    return feed.filter((c) =>
      c.phone_masked.toLowerCase().includes(q) ||
      (c.operator || "").toLowerCase().includes(q) ||
      (c.country_code || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  // Count OTPs per country in the last 1 hour — agents instantly see which
  // country is hottest right now. Sorted desc, top 8 shown as chips.
  const hotCountries = useMemo(() => {
    const feed = data?.feed || [];
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    const counts = new Map<string, { count: number; name: string }>();
    for (const c of feed) {
      if (c.created_at < cutoff) continue;
      const cc = (c.country_code || "").trim().toUpperCase();
      if (!cc) continue;
      const cur = counts.get(cc) || { count: 0, name: countryName(cc) || cc };
      cur.count += 1;
      counts.set(cc, cur);
    }
    return Array.from(counts.entries())
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [data]);

  // Per-row hot-count keyed by country code (used for the "🔥 N in 1h" chip).
  const countForCountry = (cc: string) =>
    hotCountries.find((r) => r.code === cc)?.count || 0;

  const { items: pagedItems, controls: pagedControls } = usePagination(items, 25);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" /> Live OTP Activity
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Public feed of every OTP delivered across the platform. Numbers and codes are masked —
            use this to spot which ranges are <span className="text-neon-green">hot</span> right now.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 glass rounded-lg text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by range, operator, or country..."
          className="pl-10 bg-white/[0.04] border-white/[0.1] h-11"
        />
      </div>

      {hotCountries.length > 0 && (
        <GlassCard className="!p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">🔥 Hot countries · last 1h</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {hotCountries.map((r, idx) => (
              <button
                key={r.code}
                onClick={() => setSearch(r.code)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                  idx === 0
                    ? "bg-neon-green/15 text-neon-green border border-neon-green/40"
                    : "bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20"
                )}
                title={`Filter feed by ${r.name}`}
              >
                <span>{r.name}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-background/40 font-mono">{r.count}</span>
              </button>
            ))}
          </div>
        </GlassCard>
      )}

      <div className="space-y-3">
        {pagedItems.map((c) => {
          const isSeven1Tel = c.provider === "seven1tel";
          const label = isSeven1Tel ? shortRange(c.operator) : (c.operator || c.country_code || "—");
          const fullDetail = isSeven1Tel
            ? (c.operator || label)
            : [c.operator, c.country_code].filter(Boolean).join(" · ");
          const labelStyle = isSeven1Tel
            ? "bg-neon-magenta/10 text-neon-magenta"
            : "bg-neon-cyan/10 text-neon-cyan";
          const hotCount = countForCountry((c.country_code || "").toUpperCase());
          // Slug guess from CLI for brand icon (e.g. "WhatsApp" → "whatsapp").
          const cliSlug = (c.cli || "").toLowerCase();
          return (
            <GlassCard key={c.id} className="!p-4 hover:neon-border-cyan transition-all">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-primary">{c.phone_masked}</span>
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", labelStyle)}>
                      {label}
                    </span>
                    {c.cli && (
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold", cliBadgeClass(c.cli))}>
                        <BrandIcon slug={cliSlug} fallback={null} size={12} />
                        {c.cli}
                      </span>
                    )}
                    {hotCount >= 2 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neon-green/10 text-neon-green">
                        🔥 {hotCount} in 1h
                      </span>
                    )}
                  </div>
                  {fullDetail && (
                    <p className="mt-1 text-xs text-muted-foreground truncate">{fullDetail}</p>
                  )}
                  {c.sms_text ? (
                    <p className="mt-2 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                      {c.sms_text}
                    </p>
                  ) : c.otp_code ? (
                    <p className="mt-2 text-base text-foreground leading-relaxed font-mono tracking-wider">
                      OTP: <span className="font-bold text-neon-green">{c.otp_code}</span>
                    </p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">{new Date(c.created_at * 1000).toLocaleTimeString()}</p>
                  <p className="text-[10px] text-muted-foreground/70">{new Date(c.created_at * 1000).toLocaleDateString()}</p>
                </div>
              </div>
            </GlassCard>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No OTP activity yet — once any agent receives an OTP it will appear here.</p>
          </div>
        )}
        {pagedControls}
      </div>
    </div>
  );
};

export default AgentConsole;
