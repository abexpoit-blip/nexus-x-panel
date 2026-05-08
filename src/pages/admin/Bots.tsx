import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BotInfo } from "@/lib/api";
import { GradientMesh, PageHeader } from "@/components/premium";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Play, Square, RotateCw, AlertTriangle, CheckCircle2, Activity, Loader2,
  Stethoscope, ShieldCheck, ShieldAlert, History, Clock, Radar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useState } from "react";

const fmtAgo = (ts?: number | null) => {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

const StatusPill = ({ running, enabled }: { running?: boolean; enabled?: boolean }) => {
  if (!enabled) {
    return (
      <Badge variant="outline" className="gap-1.5 border-white/[0.12] text-muted-foreground">
        <Square className="w-3 h-3" /> Disabled
      </Badge>
    );
  }
  if (running) {
    return (
      <Badge variant="outline" className="gap-1.5 border-neon-green/30 text-neon-green">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-green opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-green" />
        </span>
        Running
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 border-neon-amber/30 text-neon-amber">
      <AlertTriangle className="w-3 h-3" /> Stopped
    </Badge>
  );
};

type PingResult = { ok: boolean; ms: number; error?: string; delivered?: number | null; last_otp_at?: number | null };

const BotCard = ({ info, onAction, onHealth, onPing, busy, healthResult, pingResult }: {
  info: BotInfo;
  onAction: (a: "start" | "stop" | "restart") => void;
  onHealth: () => void;
  onPing: () => void;
  busy: string | null;
  healthResult: { ok: boolean; ms: number; error?: string } | null;
  pingResult: PingResult | null;
}) => {
  const s = info.status || {};
  const enabled = !!s.enabled;
  const running = !!s.running;
  const errors = Array.isArray(s.errors) ? s.errors : [];

  return (
    <GlassCard className="!p-5 relative overflow-hidden">
      {/* glow accent */}
      <div className={cn(
        "absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl pointer-events-none",
        running ? "bg-neon-green/20" : enabled ? "bg-neon-amber/15" : "bg-white/5"
      )} />

      <div className="flex items-start justify-between gap-3 mb-4 relative">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn(
            "p-2.5 rounded-xl border shrink-0",
            running ? "bg-neon-green/10 border-neon-green/30" : "bg-white/[0.04] border-white/[0.08]"
          )}>
            <Bot className={cn("w-5 h-5", running ? "text-neon-green" : "text-muted-foreground")} />
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-foreground truncate">{info.label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{info.description}</p>
          </div>
        </div>
        <StatusPill running={running} enabled={enabled} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 relative">
        <Stat label="Last tick"   value={fmtAgo(s.last_tick_at ?? s.last_fire_at)} />
        <Stat label="Logged in"   value={s.logged_in === undefined ? "—" : (s.logged_in ? "Yes" : "No")}
              tone={s.logged_in === undefined ? undefined : (s.logged_in ? "green" : "amber")} />
        <Stat label="Delivered"   value={String(s.otps_delivered ?? s.total_fired ?? 0)} mono />
        <Stat label="Interval"    value={s.interval_sec ? `${s.interval_sec}s` : (s.min_sec ? `${s.min_sec}-${s.max_sec}s` : "—")} mono />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 relative">
        <Stat label="Last login" value={fmtAgo(s.last_login_at)} />
        <Stat label="Last OTP"   value={fmtAgo(s.last_otp_at ?? s.last_fire_at)}
              tone={s.last_otp_at && (Date.now()/1000 - s.last_otp_at) < 600 ? "green" : undefined} />
        <Stat label="Login OK"   value={`${s.total_login_successes ?? 0}/${s.total_login_attempts ?? 0}`} mono />
        <Stat label="Ticks"      value={String(s.total_ticks ?? 0)} mono />
      </div>

      {/* Health probe result */}
      {healthResult && (
        <div className={cn(
          "mb-3 p-2.5 rounded-lg border flex items-start gap-2 text-xs relative",
          healthResult.ok ? "bg-neon-green/[0.06] border-neon-green/30" : "bg-destructive/[0.06] border-destructive/30",
        )}>
          <Stethoscope className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", healthResult.ok ? "text-neon-green" : "text-destructive")} />
          <div className="min-w-0">
            <div className={cn("font-semibold", healthResult.ok ? "text-neon-green" : "text-destructive")}>
              {healthResult.ok ? `Connection OK · ${healthResult.ms}ms` : `Connection failed · ${healthResult.ms}ms`}
            </div>
            {healthResult.error && (
              <div className="text-[11px] font-mono text-foreground/80 mt-0.5 break-words">{healthResult.error}</div>
            )}
          </div>
        </div>
      )}

      {/* Scrape ping result */}
      {pingResult && (
        <div className={cn(
          "mb-3 p-2.5 rounded-lg border flex items-start gap-2 text-xs relative",
          pingResult.ok ? "bg-neon-cyan/[0.06] border-neon-cyan/30" : "bg-destructive/[0.06] border-destructive/30",
        )}>
          <Radar className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", pingResult.ok ? "text-neon-cyan" : "text-destructive")} />
          <div className="min-w-0">
            <div className={cn("font-semibold", pingResult.ok ? "text-neon-cyan" : "text-destructive")}>
              {pingResult.ok
                ? `Scrape OK · ${pingResult.ms}ms · ${pingResult.delivered ?? 0} delivered`
                : `Scrape failed · ${pingResult.ms}ms`}
            </div>
            {pingResult.ok && pingResult.last_otp_at != null && (
              <div className="text-[11px] text-foreground/70 mt-0.5">Last OTP: {fmtAgo(pingResult.last_otp_at)}</div>
            )}
            {pingResult.error && (
              <div className="text-[11px] font-mono text-foreground/80 mt-0.5 break-words">{pingResult.error}</div>
            )}
          </div>
        </div>
      )}

      {/* Last error / skip reason */}
      {s.last_error || s.error || s.last_skip_reason ? (
        <div className="mb-4 p-3 rounded-lg bg-destructive/[0.06] border border-destructive/30 relative">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-destructive/80 font-semibold">{s.last_skip_reason && !s.last_error && !s.error ? "Last skip" : "Last error"}</div>
              <div className="text-xs text-foreground/90 mt-0.5 break-words font-mono">{s.last_error || s.error || s.last_skip_reason}</div>
              {typeof s.consec_fail === "number" && s.consec_fail > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">Consecutive failures: {s.consec_fail}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 p-2.5 rounded-lg bg-neon-green/[0.04] border border-neon-green/20 flex items-center gap-2 relative">
          <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" />
          <span className="text-xs text-foreground/80">No recent errors</span>
        </div>
      )}

      {/* Recent error timeline */}
      {errors.length > 0 && (
        <details className="mb-3 group relative">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground/80 flex items-center gap-1.5 select-none">
            <History className="w-3 h-3" />
            Recent errors ({errors.length})
            <span className="text-foreground/40 group-open:hidden">▸ show</span>
            <span className="text-foreground/40 hidden group-open:inline">▾ hide</span>
          </summary>
          <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 text-[11px] font-mono">
            {errors.map((e, i) => (
              <li key={i} className="flex gap-2 px-2 py-1 rounded bg-white/[0.02] border border-white/[0.04]">
                <Clock className="w-3 h-3 text-muted-foreground/60 mt-0.5 shrink-0" />
                <span className="text-muted-foreground shrink-0 w-16">{fmtAgo(e.at)}</span>
                <span className="text-destructive/90 break-words min-w-0">{e.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 relative">
        <Button
          size="sm"
          onClick={() => onAction("start")}
          disabled={busy !== null || running}
          className="bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 disabled:opacity-40"
        >
          {busy === "start" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
          Start
        </Button>
        <Button
          size="sm"
          onClick={() => onAction("stop")}
          disabled={busy !== null || !running}
          className="bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 disabled:opacity-40"
        >
          {busy === "stop" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Square className="w-3.5 h-3.5 mr-1.5" />}
          Stop
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAction("restart")}
          disabled={busy !== null}
          className="border-white/[0.1] hover:border-primary/40"
        >
          {busy === "restart" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5 mr-1.5" />}
          Restart
        </Button>
        {info.key !== "fake_otp" && (
          <Button
            size="sm"
            variant="outline"
            onClick={onHealth}
            disabled={busy !== null}
            className="border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10"
          >
            {busy === "health" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5 mr-1.5" />}
            Test
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onPing}
          disabled={busy !== null}
          className="border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10"
        >
          {busy === "ping" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Radar className="w-3.5 h-3.5 mr-1.5" />}
          {info.key === "fake_otp" ? "Fire one" : "Ping scrape"}
        </Button>
        {s.base_url && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/60 self-center truncate max-w-[200px]">
            {s.base_url}
          </span>
        )}
      </div>
    </GlassCard>
  );
};

const Stat = ({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "green" | "amber" }) => (
  <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn(
      "text-sm font-semibold mt-0.5 truncate",
      mono && "font-mono",
      tone === "green" && "text-neon-green",
      tone === "amber" && "text-neon-amber",
    )}>
      {value}
    </div>
  </div>
);

const AdminBots = () => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<{ key: string; action: string } | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, { ok: boolean; ms: number; error?: string }>>({});
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-bots"],
    queryFn: () => api.admin.bots.list(),
    refetchInterval: 10_000,
  });

  const { data: sysHealth } = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: () => api.admin.systemHealth(),
    refetchInterval: 15000,
  });

  const run = async (key: string, action: "start" | "stop" | "restart") => {
    setBusy({ key, action });
    try {
      await api.admin.bots.action(key, action);
      toast({ title: `${action} sent`, description: data?.bots[key]?.label });
      // Give the worker a moment to update its status flag, then refresh
      setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-bots"] }), 800);
    } catch (e) {
      toast({ title: `${action} failed`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setTimeout(() => setBusy(null), 800);
    }
  };

  const runHealth = async (key: string) => {
    setBusy({ key, action: "health" });
    try {
      const r = await api.admin.bots.health(key);
      setHealthResults((prev) => ({ ...prev, [key]: { ok: r.ok, ms: r.ms, error: r.error } }));
      toast({
        title: r.ok ? "Connection OK" : "Connection failed",
        description: r.ok ? `${data?.bots[key]?.label} · ${r.ms}ms` : (r.error || "unknown"),
        variant: r.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as Error).message;
      setHealthResults((prev) => ({ ...prev, [key]: { ok: false, ms: 0, error: msg } }));
      toast({ title: "Health check failed", description: msg, variant: "destructive" });
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  const runPing = async (key: string) => {
    setBusy({ key, action: "ping" });
    try {
      const r = await api.admin.bots.ping(key);
      setPingResults((prev) => ({ ...prev, [key]: { ok: r.ok, ms: r.ms, error: r.error, delivered: r.delivered ?? null, last_otp_at: r.last_otp_at ?? null } }));
      toast({
        title: r.ok ? "Scrape OK" : "Scrape failed",
        description: r.ok
          ? `${data?.bots[key]?.label} · ${r.ms}ms · ${r.delivered ?? 0} delivered`
          : (r.error || "unknown"),
        variant: r.ok ? "default" : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["admin-bots"] });
    } catch (e) {
      const msg = (e as Error).message;
      setPingResults((prev) => ({ ...prev, [key]: { ok: false, ms: 0, error: msg } }));
      toast({ title: "Scrape ping failed", description: msg, variant: "destructive" });
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  const bots = data?.bots ? Object.values(data.bots) : [];
  const runningCount = bots.filter(b => b.status?.running).length;

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Workers"
        title="Bots Control"
        description="Live status for every background worker. Start, stop, or restart instantly."
        icon={<Bot className="w-5 h-5 text-neon-cyan" />}
        actions={
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 glass-strong border-neon-green/30">
            <Activity className="w-3 h-3 text-neon-green" />
            <span className="text-xs">{runningCount} / {bots.length} running</span>
          </Badge>
        }
      />

      {/* System health strip */}
      {sysHealth && (
        <GlassCard className="!p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex items-center gap-2.5">
              {sysHealth.server.jwt?.strong ? (
                <ShieldCheck className="w-4 h-4 text-neon-green shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">JWT secret</div>
                <div className={cn("text-sm font-semibold", sysHealth.server.jwt?.strong ? "text-neon-green" : "text-destructive")}>
                  {sysHealth.server.jwt?.strong
                    ? `Strong (${sysHealth.server.jwt.source})`
                    : "Weak — needs rotation"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 text-neon-cyan shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last real OTP</div>
                <div className="text-sm font-semibold text-foreground">
                  {fmtAgo(sysHealth.cdr_pulse?.last_real_at ?? null)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-neon-green shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">OTPs today</div>
                <div className="text-sm font-semibold text-foreground font-mono">
                  {sysHealth.cdr_pulse?.total_today ?? 0}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Backend uptime</div>
                <div className="text-sm font-semibold text-foreground font-mono">
                  {Math.floor(sysHealth.server.uptime_sec / 3600)}h {Math.floor((sysHealth.server.uptime_sec % 3600) / 60)}m
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading bot status…
        </div>
      ) : bots.length === 0 ? (
        <GlassCard>
          <div className="text-center py-12 text-muted-foreground">
            No workers detected. Check that the backend has loaded seven1telBot and fakeOtpBroadcaster.
          </div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bots.map((b) => (
            <BotCard
              key={b.key}
              info={b}
              busy={busy?.key === b.key ? busy.action : null}
              onAction={(a) => run(b.key, a)}
              onHealth={() => runHealth(b.key)}
              onPing={() => runPing(b.key)}
              healthResult={healthResults[b.key] || null}
              pingResult={pingResults[b.key] || null}
            />
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center font-mono">
        Auto-refreshes every 5 seconds · {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
};

export default AdminBots;