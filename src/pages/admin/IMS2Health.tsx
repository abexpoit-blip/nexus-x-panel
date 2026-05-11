import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GradientMesh, PageHeader } from "@/components/premium";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Cookie, Gauge, Hourglass,
  KeyRound, Loader2, Network, Play, RotateCw, Square, Stethoscope, Timer,
  TrendingUp, History, ShieldAlert,
} from "lucide-react";

const fmtAgo = (ts?: number | null) => {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

const fmtAbs = (ts?: number | null) => {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString();
};

const Tile = ({
  icon: Icon, label, value, sub, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "green" | "amber" | "red" | "cyan";
}) => (
  <div className={cn(
    "p-4 rounded-xl bg-white/[0.03] border",
    tone === "green" && "border-neon-green/30 bg-neon-green/[0.04]",
    tone === "amber" && "border-neon-amber/30 bg-neon-amber/[0.04]",
    tone === "red"   && "border-destructive/40 bg-destructive/[0.05]",
    tone === "cyan"  && "border-neon-cyan/30 bg-neon-cyan/[0.04]",
    !tone && "border-white/[0.06]",
  )}>
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
      <Icon className={cn(
        "w-3.5 h-3.5",
        tone === "green" && "text-neon-green",
        tone === "amber" && "text-neon-amber",
        tone === "red"   && "text-destructive",
        tone === "cyan"  && "text-neon-cyan",
      )} />
      {label}
    </div>
    <div className={cn(
      "mt-1.5 text-xl font-display font-semibold truncate",
      tone === "green" && "text-neon-green",
      tone === "amber" && "text-neon-amber",
      tone === "red"   && "text-destructive",
      tone === "cyan"  && "text-neon-cyan",
    )}>
      {value}
    </div>
    {sub && <div className="mt-0.5 text-[11px] text-muted-foreground font-mono truncate">{sub}</div>}
  </div>
);

const Row = ({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) => (
  <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
    <span className="text-xs text-muted-foreground">{k}</span>
    <span className={cn("text-xs text-foreground/90 truncate", mono && "font-mono")}>{v}</span>
  </div>
);

const IMS2Health = () => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [healthMs, setHealthMs] = useState<{ ok: boolean; ms: number; error?: string } | null>(null);

  // Tick once a second so cooldown countdown is live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin-bots-ims2"],
    queryFn: () => api.admin.bots.list(),
    refetchInterval: 5_000,
  });

  const { data: logs } = useQuery({
    queryKey: ["admin-bots-ims2-logs"],
    queryFn: () => api.admin.bots.logs("ims2", "all", 60),
    refetchInterval: 8_000,
  });

  const ims = data?.bots?.ims2;
  const s = (ims?.status || {}) as Record<string, unknown> & {
    enabled?: boolean; running?: boolean; logged_in?: boolean; base_url?: string;
    username?: string | null;
    last_tick_at?: number | null; last_error?: string | null;
    consec_fail?: number; otps_delivered?: number; interval_sec?: number;
    min_interval_sec?: number; min_interval_floor?: number;
    rl_penalty_base_sec?: number; rl_penalty_max_sec?: number; rl_penalty_steps?: number;
    rl_streak?: number; rl_relogin_threshold?: number; rl_relogin_stale_sec?: number;
    last_rate_limit_at?: number | null; last_cdr_success_at?: number | null;
    relogin_count?: number; last_relogin_at?: number | null;
    next_cdr_allowed_at?: number | null; sesskey_loaded?: boolean;
    last_login_at?: number | null; last_otp_at?: number | null;
    total_ticks?: number; total_login_attempts?: number; total_login_successes?: number;
    errors?: Array<{ at: number; message: string }>;
  };

  const cooldownMs = Math.max(0, (s.next_cdr_allowed_at || 0) - now);
  const cooldownSec = Math.ceil(cooldownMs / 1000);
  const inCooldown = cooldownMs > 0;

  const sinceSuccess = s.last_cdr_success_at
    ? Math.round(now / 1000 - s.last_cdr_success_at)
    : null;
  const stale = s.rl_relogin_stale_sec || 300;
  const successHealthy = sinceSuccess !== null && sinceSuccess < stale;

  const sinceRL = s.last_rate_limit_at
    ? Math.round(now / 1000 - s.last_rate_limit_at)
    : null;
  const recentlyRateLimited = sinceRL !== null && sinceRL < 60;

  const action = async (a: "start" | "stop" | "restart") => {
    setBusy(a);
    try {
      await api.admin.bots.action("ims2", a);
      toast({ title: `${a} sent`, description: "IMS Bot 2" });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-bots-ims2"] }), 700);
    } catch (e) {
      toast({ title: `${a} failed`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setTimeout(() => setBusy(null), 700);
    }
  };

  const probe = async () => {
    setBusy("health");
    try {
      const r = await api.admin.bots.health("ims2");
      setHealthMs({ ok: r.ok, ms: r.ms, error: r.error });
      toast({
        title: r.ok ? "Connection OK" : "Connection failed",
        description: r.ok ? `${r.ms}ms` : (r.error || "unknown"),
        variant: r.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as Error).message;
      setHealthMs({ ok: false, ms: 0, error: msg });
      toast({ title: "Probe failed", description: msg, variant: "destructive" });
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading IMS Bot 2 health…
      </div>
    );
  }

  if (!ims) {
    return (
      <GlassCard className="!p-8 text-center text-muted-foreground">
        IMS Bot 2 module not detected on backend.
      </GlassCard>
    );
  }

  const lifeOk = !!s.running && !!s.logged_in && !s.last_error;

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Diagnostics"
        title="IMS Bot 2 — Health & Debug"
        description="Live cooldown, rate-limit telemetry, session state and recent errors for the IMS scraper (2nd account)."
        icon={<Stethoscope className="w-5 h-5 text-neon-cyan" />}
        actions={
          <Badge variant="outline" className={cn(
            "gap-1.5 px-3 py-1.5 glass-strong",
            lifeOk ? "border-neon-green/30 text-neon-green"
                   : s.running ? "border-neon-amber/30 text-neon-amber"
                   : "border-destructive/40 text-destructive",
          )}>
            <Activity className="w-3 h-3" />
            {s.running ? (s.logged_in ? "Healthy" : "Running · not logged in") : "Stopped"}
          </Badge>
        }
      />

      {/* Top tile grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile
          icon={Hourglass}
          label="Cooldown"
          value={inCooldown ? `${cooldownSec}s` : "Ready"}
          sub={inCooldown ? `until ${fmtAbs(s.next_cdr_allowed_at ? Math.floor(s.next_cdr_allowed_at / 1000) : null)}` : "next CDR allowed"}
          tone={inCooldown ? "amber" : "green"}
        />
        <Tile
          icon={CheckCircle2}
          label="Last CDR success"
          value={fmtAgo(s.last_cdr_success_at)}
          sub={fmtAbs(s.last_cdr_success_at)}
          tone={successHealthy ? "green" : sinceSuccess === null ? undefined : "amber"}
        />
        <Tile
          icon={ShieldAlert}
          label="Last rate-limit"
          value={fmtAgo(s.last_rate_limit_at)}
          sub={fmtAbs(s.last_rate_limit_at)}
          tone={recentlyRateLimited ? "red" : s.last_rate_limit_at ? "amber" : undefined}
        />
        <Tile
          icon={TrendingUp}
          label="RL streak"
          value={String(s.rl_streak ?? 0)}
          sub={`re-login ≥ ${s.rl_relogin_threshold ?? "?"}`}
          tone={(s.rl_streak ?? 0) >= (s.rl_relogin_threshold ?? 99) ? "red" : (s.rl_streak ?? 0) > 0 ? "amber" : undefined}
        />
        <Tile
          icon={RotateCw}
          label="Re-logins"
          value={String(s.relogin_count ?? 0)}
          sub={s.last_relogin_at ? `last ${fmtAgo(s.last_relogin_at)}` : "none yet"}
          tone={(s.relogin_count ?? 0) > 0 ? "cyan" : undefined}
        />
        <Tile
          icon={Gauge}
          label="OTPs delivered"
          value={String(s.otps_delivered ?? 0)}
          sub={`${s.total_login_successes ?? 0}/${s.total_login_attempts ?? 0} logins · ${s.total_ticks ?? 0} ticks`}
        />
      </div>

      {/* Cooldown progress strip */}
      <GlassCard className="!p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="w-3.5 h-3.5 text-neon-cyan" />
            CDR gate · min {s.min_interval_sec ?? "?"}s (floor {s.min_interval_floor ?? "?"}s)
          </div>
          <div className="text-xs font-mono">
            {inCooldown ? <span className="text-neon-amber">⏳ {cooldownSec}s remaining</span> : <span className="text-neon-green">✓ ready</span>}
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-500",
              inCooldown ? "bg-gradient-to-r from-neon-amber/70 to-neon-amber" : "bg-gradient-to-r from-neon-green/70 to-neon-green",
            )}
            style={{
              width: inCooldown
                ? `${Math.max(2, Math.min(100, (cooldownSec / Math.max(1, s.min_interval_sec ?? 15)) * 100))}%`
                : "100%",
            }}
          />
        </div>
      </GlassCard>

      {/* Two-column debug detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard className="!p-5">
          <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-neon-cyan" /> Session & Identity
          </h3>
          <Row k="Enabled" v={s.enabled ? "Yes" : "No"} />
          <Row k="Running" v={s.running ? "Yes" : "No"} />
          <Row k="Logged in" v={s.logged_in ? "Yes" : "No"} />
          <Row k="Sesskey loaded" v={s.sesskey_loaded ? "Yes" : "No"} />
          <Row k="Username" v={s.username || "—"} mono />
          <Row k="Base URL" v={s.base_url || "—"} mono />
          <Row k="Last login" v={`${fmtAgo(s.last_login_at)} (${fmtAbs(s.last_login_at)})`} />
          <Row k="Last tick" v={`${fmtAgo(s.last_tick_at)} (${fmtAbs(s.last_tick_at)})`} />
          <Row k="Last OTP" v={`${fmtAgo(s.last_otp_at)} (${fmtAbs(s.last_otp_at)})`} />
        </GlassCard>

        <GlassCard className="!p-5">
          <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
            <Network className="w-4 h-4 text-neon-cyan" /> Cooldown & Penalties
          </h3>
          <Row k="Interval" v={`${s.interval_sec ?? "?"}s`} mono />
          <Row k="Min interval" v={`${s.min_interval_sec ?? "?"}s (floor ${s.min_interval_floor ?? "?"}s)`} mono />
          <Row k="Penalty base/max" v={`${s.rl_penalty_base_sec ?? "?"}s → ${s.rl_penalty_max_sec ?? "?"}s × ${s.rl_penalty_steps ?? "?"} steps`} mono />
          <Row k="RL streak" v={`${s.rl_streak ?? 0} / ${s.rl_relogin_threshold ?? "?"}`} mono />
          <Row k="Re-login stale gate" v={`${s.rl_relogin_stale_sec ?? "?"}s without success`} mono />
          <Row k="Next CDR allowed" v={inCooldown ? `in ${cooldownSec}s` : "now"} mono />
          <Row k="Consec fail" v={String(s.consec_fail ?? 0)} mono />
          <Row k="Last error" v={s.last_error || "—"} mono />
        </GlassCard>
      </div>

      {/* Health probe + actions */}
      <GlassCard className="!p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => action("start")}
            disabled={busy !== null || !!s.running}
            className="bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 disabled:opacity-40"
          >
            {busy === "start" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
            Start
          </Button>
          <Button
            size="sm"
            onClick={() => action("stop")}
            disabled={busy !== null || !s.running}
            className="bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 disabled:opacity-40"
          >
            {busy === "stop" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Square className="w-3.5 h-3.5 mr-1.5" />}
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => action("restart")}
            disabled={busy !== null}
            className="border-white/[0.1] hover:border-primary/40"
          >
            {busy === "restart" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5 mr-1.5" />}
            Restart
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={probe}
            disabled={busy !== null}
            className="border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10"
          >
            {busy === "health" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5 mr-1.5" />}
            Run probe
          </Button>
          <div className="ml-auto flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <Cookie className="w-3 h-3" />
            {s.sesskey_loaded ? "sesskey ready" : "no sesskey"}
            <span className="opacity-50">·</span>
            updated {fmtAgo(Math.floor(dataUpdatedAt / 1000))}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
        </div>
        {healthMs && (
          <div className={cn(
            "mt-3 p-2.5 rounded-lg border flex items-start gap-2 text-xs",
            healthMs.ok ? "bg-neon-green/[0.06] border-neon-green/30" : "bg-destructive/[0.06] border-destructive/30",
          )}>
            <Stethoscope className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", healthMs.ok ? "text-neon-green" : "text-destructive")} />
            <div className="min-w-0">
              <div className={cn("font-semibold", healthMs.ok ? "text-neon-green" : "text-destructive")}>
                {healthMs.ok ? `Probe OK · ${healthMs.ms}ms` : `Probe failed · ${healthMs.ms}ms`}
              </div>
              {healthMs.error && (
                <div className="text-[11px] font-mono text-foreground/80 mt-0.5 break-words">{healthMs.error}</div>
              )}
            </div>
          </div>
        )}
      </GlassCard>

      {/* Recent errors */}
      <GlassCard className="!p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" /> Recent events
          </h3>
          <span className="text-[11px] text-muted-foreground font-mono">
            {logs?.events?.length ?? 0} entries · {logs?.counters?.total_misses ?? 0} misses · {logs?.counters?.total_delivered ?? 0} delivered
          </span>
        </div>
        {!logs?.events?.length ? (
          <div className="text-xs text-muted-foreground py-6 text-center">No recent events.</div>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto space-y-1 text-[11px] font-mono">
            {logs.events.map((e, i) => (
              <li key={i} className={cn(
                "flex gap-2 px-2 py-1.5 rounded border",
                e.level === "error" ? "bg-destructive/[0.06] border-destructive/20"
                  : e.level === "warn" ? "bg-neon-amber/[0.06] border-neon-amber/20"
                  : "bg-white/[0.02] border-white/[0.04]",
              )}>
                <Clock className="w-3 h-3 text-muted-foreground/60 mt-0.5 shrink-0" />
                <span className="text-muted-foreground shrink-0 w-20">{fmtAgo(e.at)}</span>
                <span className={cn(
                  "shrink-0 uppercase tracking-wider w-12",
                  e.level === "error" ? "text-destructive"
                    : e.level === "warn" ? "text-neon-amber"
                    : "text-muted-foreground",
                )}>{e.level}</span>
                <span className="text-muted-foreground/80 shrink-0 w-24 truncate">{e.type}</span>
                <span className="text-foreground/90 break-words min-w-0">{e.message}{e.phone ? ` · ${e.phone}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Raw debug JSON */}
      <GlassCard className="!p-5">
        <details>
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground/80 flex items-center gap-1.5 select-none">
            <History className="w-3 h-3" /> Raw status JSON
          </summary>
          <pre className="mt-3 text-[11px] font-mono text-foreground/80 bg-black/30 p-3 rounded-lg border border-white/[0.04] overflow-x-auto max-h-[400px]">
{JSON.stringify(s, null, 2)}
          </pre>
        </details>
      </GlassCard>

      <p className="text-[10px] text-muted-foreground/60 text-center font-mono">
        Auto-refreshes every 5s · cooldown ticks every 1s
      </p>
    </div>
  );
};

export default IMS2Health;