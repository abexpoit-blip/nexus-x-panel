import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Activity, Bot, Clock, GitCommit, RefreshCw, CheckCircle2, XCircle, AlertTriangle, ShieldAlert } from "lucide-react";
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

const fmtMs = (ms: number | undefined | null): string => {
  if (!ms || ms <= 0) return "ready";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const SmsHadiHealthWidget = () => {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["smshadi-health"],
    queryFn: () => api.admin.systemHealth(),
    refetchInterval: 3000,
  });

  // Tick every second so the cooldown countdown updates between fetches
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const bot = data?.smshadi_bot;
  const enabled = !!bot?.enabled;
  const running = !!bot?.running;
  const loggedIn = !!bot?.logged_in;

  // Live cooldown derived from next_cdr_at minus current time
  const nextAtMs = bot?.next_cdr_at || 0;
  const cooldownRemainingMs = Math.max(0, nextAtMs - Date.now());
  const cooldownTone = cooldownRemainingMs > 0 ? "warn" : "good";
  const lastCdrSec = bot?.last_cdr_success_at
    ?? (bot?.last_cdr_request_at ? Math.floor(bot.last_cdr_request_at / 1000) : null);
  const count503 = bot?.provider_503_count ?? 0;
  const last503Sec = bot?.last_503_at ?? null;
  const lastWarmupSec = bot?.last_warmup_at ?? null;

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

  return (
    <div className="glass-strong rounded-2xl p-4 border border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-neon-cyan/10">
            <Bot className="w-4 h-4 text-neon-cyan" />
          </div>
          <div>
            <h3 className="text-sm font-display font-semibold leading-tight">SMS Hadi Bot Health</h3>
            <p className="text-[10px] text-muted-foreground">Live · refreshes every 3s</p>
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
        <p className="text-xs text-muted-foreground py-3 text-center">Loading bot health…</p>
      ) : !bot ? (
        <p className="text-xs text-muted-foreground py-3 text-center">Bot status unavailable</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Cooldown */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <Clock className="w-3 h-3" />
              <span>Cooldown</span>
            </div>
            <div className={cn(
              "text-xl font-display font-bold font-mono",
              cooldownTone === "warn" ? "text-neon-amber" : "text-neon-green"
            )}>
              {fmtMs(cooldownRemainingMs)}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              min gap {bot.min_cdr_gap_ms ? `${Math.round(bot.min_cdr_gap_ms / 1000)}s` : "—"}
            </div>
          </div>

          {/* Last CDR fetch */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <Activity className="w-3 h-3" />
              <span>Last CDR fetch</span>
            </div>
            <div className="text-xl font-display font-bold font-mono text-foreground">
              {fmtAgo(lastCdrSec)}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
              {bot.otps_delivered ?? 0} OTPs · {bot.consec_fail ?? 0} consec fails
            </div>
          </div>

          {/* Provider 503 errors */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <ShieldAlert className="w-3 h-3" />
              <span>Provider 503s</span>
            </div>
            <div className={cn(
              "text-xl font-display font-bold font-mono",
              count503 > 0 ? "text-destructive" : "text-neon-green"
            )}>
              {count503}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
              last {fmtAgo(last503Sec)} · warmup {fmtAgo(lastWarmupSec)}
            </div>
          </div>

          {/* Worker version */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <GitCommit className="w-3 h-3" />
              <span>Worker version</span>
            </div>
            <div
              className="text-xs font-mono text-neon-cyan break-all leading-snug"
              title={bot.worker_version || "unknown"}
            >
              {bot.worker_version || "unknown"}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
              {bot.username || "—"} · interval {bot.interval_sec ?? "—"}s
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

export default SmsHadiHealthWidget;