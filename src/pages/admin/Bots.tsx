import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BotInfo } from "@/lib/api";
import { GradientMesh, PageHeader } from "@/components/premium";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Play, Square, RotateCw, AlertTriangle, CheckCircle2, Activity, Loader2 } from "lucide-react";
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

const BotCard = ({ info, onAction, busy }: {
  info: BotInfo;
  onAction: (a: "start" | "stop" | "restart") => void;
  busy: string | null;
}) => {
  const s = info.status || {};
  const enabled = !!s.enabled;
  const running = !!s.running;

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 relative">
        <Stat label="Last tick"   value={fmtAgo(s.last_tick_at ?? s.last_fire_at)} />
        <Stat label="Logged in"   value={s.logged_in === undefined ? "—" : (s.logged_in ? "Yes" : "No")}
              tone={s.logged_in === undefined ? undefined : (s.logged_in ? "green" : "amber")} />
        <Stat label="Delivered"   value={String(s.otps_delivered ?? s.total_fired ?? 0)} mono />
        <Stat label="Interval"    value={s.interval_sec ? `${s.interval_sec}s` : (s.min_sec ? `${s.min_sec}-${s.max_sec}s` : "—")} mono />
      </div>

      {/* Last error */}
      {s.last_error || s.error ? (
        <div className="mb-4 p-3 rounded-lg bg-destructive/[0.06] border border-destructive/30 relative">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-destructive/80 font-semibold">Last error</div>
              <div className="text-xs text-foreground/90 mt-0.5 break-words font-mono">{s.last_error || s.error}</div>
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-bots"],
    queryFn: () => api.admin.bots.list(),
    refetchInterval: 5000,
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