import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Activity, Clock, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtAgo = (ts: number | null | undefined): string => {
  if (!ts) return "never";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const fmtAbs = (ts: number | null | undefined): string => {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString();
};

const fmtMs = (ms: number | undefined | null): string => {
  if (!ms || ms <= 0) return "ready now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const ImsScrapeWidget = () => {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ims-scrape-health"],
    queryFn: () => api.admin.systemHealth(),
    refetchInterval: 3000,
  });

  // Tick every second so the countdown updates between fetches
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const bot = data?.ims_bot;
  const enabled = !!bot?.enabled;
  const running = !!bot?.running;
  const loggedIn = !!bot?.logged_in;

  const nextAtMs = bot?.next_cdr_allowed_at || 0;
  const cooldownMs = Math.max(0, nextAtMs - Date.now());
  const lastSuccessSec = bot?.last_cdr_success_at ?? null;
  const sinceSuccessSec = lastSuccessSec ? Math.floor(Date.now() / 1000) - lastSuccessSec : null;

  const statusTone = !enabled
    ? "off"
    : bot?.last_error
      ? "bad"
      : loggedIn && running
        ? "good"
        : "warn";

  const statusLabel = !enabled
    ? "Disabled"
    : !running
      ? "Stopped"
      : !loggedIn
        ? "Logging in…"
        : bot?.last_error
          ? "Errors"
          : "Healthy";

  const toneClass = {
    good: "text-neon-green border-neon-green/30 bg-neon-green/10",
    warn: "text-neon-amber border-neon-amber/30 bg-neon-amber/10",
    bad: "text-destructive border-destructive/30 bg-destructive/10",
    off: "text-muted-foreground border-white/10 bg-white/[0.03]",
  }[statusTone];

  // Highlight in red if no successful scrape for >2× the configured interval
  const intervalSec = bot?.interval_sec || 20;
  const successStale = sinceSuccessSec !== null && sinceSuccessSec > intervalSec * 2;

  return (
    <div className="glass-strong rounded-2xl p-4 border border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-neon-magenta/10">
            <Radar className="w-4 h-4 text-neon-magenta" />
          </div>
          <div>
            <h3 className="text-sm font-display font-semibold leading-tight">IMS Scrape Schedule</h3>
            <p className="text-[10px] text-muted-foreground">Live · refreshes every 3s · interval {intervalSec}s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider", toneClass)}>
            {statusTone === "good" && <CheckCircle2 className="w-3 h-3" />}
            {statusTone === "bad" && <XCircle className="w-3 h-3" />}
            {statusTone === "warn" && <AlertTriangle className="w-3 h-3" />}
            {statusLabel}
          </span>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-md hover:bg-white/[0.05] transition-colors text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground py-3 text-center">Loading IMS scrape status…</p>
      ) : !bot ? (
        <p className="text-xs text-muted-foreground py-3 text-center">IMS bot status unavailable</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Next scrape countdown */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <Clock className="w-3 h-3" />
              <span>Next scrape in</span>
            </div>
            <div className={cn(
              "text-xl font-display font-bold font-mono",
              cooldownMs > 0 ? "text-neon-amber" : "text-neon-green"
            )}>
              {fmtMs(cooldownMs)}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              at {fmtAbs(nextAtMs ? Math.floor(nextAtMs / 1000) : null)}
            </div>
          </div>

          {/* Last successful scrape */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <CheckCircle2 className="w-3 h-3" />
              <span>Last successful scrape</span>
            </div>
            <div className={cn(
              "text-xl font-display font-bold font-mono",
              successStale ? "text-destructive" : "text-foreground"
            )}>
              {fmtAgo(lastSuccessSec)}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              {fmtAbs(lastSuccessSec)}
            </div>
          </div>

          {/* Activity summary */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <Activity className="w-3 h-3" />
              <span>Activity</span>
            </div>
            <div className="text-xl font-display font-bold font-mono text-neon-cyan">
              {bot.otps_delivered ?? 0}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
              OTPs · last tick {fmtAgo(bot.last_tick_at)} · rl {bot.rl_streak ?? 0}
            </div>
          </div>
        </div>
      )}

      {bot?.last_error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive font-mono break-all leading-snug">{bot.last_error}</p>
        </div>
      )}
    </div>
  );
};

export default ImsScrapeWidget;