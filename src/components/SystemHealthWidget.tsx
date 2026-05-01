import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Activity, Database, HardDrive, Bot, Server, CheckCircle2, XCircle, Clock, Save, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtUptime = (sec: number): string => {
  if (!sec) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const fmtAgo = (ts: number | null | undefined): string => {
  if (!ts) return "never";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const fmtBytes = (b: number): string => {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
};

const Tile = ({
  icon, label, value, hint, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) => {
  const valueColor = {
    default: "text-foreground",
    good: "text-neon-green",
    warn: "text-neon-amber",
    bad: "text-destructive",
  }[tone];
  return (
    <div className="glass p-3 rounded-xl border border-white/[0.04] hover:border-white/[0.08] transition-colors">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {icon}<span>{label}</span>
      </div>
      <div className={cn("text-base font-display font-bold font-mono", valueColor)}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{hint}</div>}
    </div>
  );
};

const StatusPill = ({ ok, label }: { ok: boolean; label: string }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
      ok ? "bg-neon-green/15 text-neon-green" : "bg-destructive/15 text-destructive"
    )}
  >
    {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
    {label}
  </span>
);

type BotSnapshot = {
  enabled?: boolean;
  running?: boolean;
  logged_in?: boolean;
  base_url?: string;
  username?: string | null;
  last_tick_at?: number | null;
  last_error?: string | null;
  consec_fail?: number;
  otps_delivered?: number;
  interval_sec?: number;
} | null;

const BotCard = ({ name, snap }: { name: string; snap: BotSnapshot }) => {
  if (!snap) {
    return (
      <div className="glass p-3 rounded-xl border border-white/[0.04]">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{name}</div>
        <div className="text-xs text-muted-foreground/60">not initialized</div>
      </div>
    );
  }
  return (
    <div className="glass p-3 rounded-xl border border-white/[0.04] space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{name}</span>
        <StatusPill ok={!!snap.running && !!snap.logged_in} label={snap.running ? (snap.logged_in ? "up" : "no auth") : "down"} />
      </div>
      <div className="text-xs text-muted-foreground/80">
        Last tick: <span className="font-mono text-foreground">{fmtAgo(snap.last_tick_at)}</span>
        {typeof snap.interval_sec === "number" && <span className="text-muted-foreground/50"> · every {snap.interval_sec}s</span>}
      </div>
      {typeof snap.otps_delivered === "number" && (
        <div className="text-xs text-muted-foreground/80">
          OTPs delivered: <span className="font-mono font-semibold text-neon-green">{snap.otps_delivered}</span>
        </div>
      )}
      {snap.last_error && (
        <div className="text-[10px] text-destructive/80 font-mono break-words pt-1 border-t border-white/[0.04]">
          {snap.last_error}
        </div>
      )}
    </div>
  );
};

export const SystemHealthWidget = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api.admin.systemHealth(),
    refetchInterval: 15000,
  });

  if (isLoading || !data) {
    return (
      <div className="glass-card border border-white/[0.06] rounded-xl p-5">
        <p className="text-sm text-muted-foreground text-center py-6">Loading system health…</p>
      </div>
    );
  }

  const { server, database, seven1tel_bot, counts } = data;

  const backupAge = database.last_backup
    ? Math.floor(Date.now() / 1000) - database.last_backup.mtime
    : null;
  const backupTone: "good" | "warn" | "bad" =
    !database.last_backup ? "bad" :
    backupAge! < 26 * 3600 ? "good" :
    backupAge! < 50 * 3600 ? "warn" : "bad";

  const anyBotUp = !!seven1tel_bot?.running;

  return (
    <div className="glass-card border border-white/[0.06] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            System Health
          </h3>
          <span className="text-[10px] text-muted-foreground/50 normal-case font-normal">
            (refreshes every 15s)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill ok={anyBotUp} label={anyBotUp ? "Bots running" : "No bots running"} />
          <StatusPill ok={backupTone !== "bad"} label="Backup" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Tile
          icon={<Server className="w-3 h-3" />}
          label="Backend uptime"
          value={fmtUptime(server.uptime_sec)}
          hint={`${server.env} · ${server.node_version}`}
          tone="good"
        />
        <Tile
          icon={<HardDrive className="w-3 h-3" />}
          label="Memory (RSS)"
          value={`${server.memory_mb.rss} MB`}
          hint={`heap ${server.memory_mb.heap_used} / ${server.memory_mb.heap_total} MB`}
          tone={server.memory_mb.rss > 800 ? "warn" : "good"}
        />
        <Tile
          icon={<Database className="w-3 h-3" />}
          label="DB size"
          value={`${database.size_mb} MB`}
          hint={database.path}
        />
        <Tile
          icon={<Save className="w-3 h-3" />}
          label="Last backup"
          value={database.last_backup ? fmtAgo(database.last_backup.mtime) : "never"}
          hint={
            database.last_backup
              ? `${fmtBytes(database.last_backup.size)} · ${database.last_backup.name}`
              : "no backups in " + database.backup_dir
          }
          tone={backupTone}
        />
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <BotCard name="Seven1Tel bot" snap={seven1tel_bot} />
      </div>

      <div className="flex flex-wrap gap-3 text-xs pt-3 border-t border-white/[0.04]">
        <span className="text-muted-foreground">
          Active sessions:
          <span className="ml-1.5 font-mono font-semibold text-foreground">{counts.active_sessions}</span>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground">
          Pending withdrawals:
          <span className={cn(
            "ml-1.5 font-mono font-semibold",
            counts.pending_withdrawals > 0 ? "text-neon-amber" : "text-neon-green"
          )}>
            {counts.pending_withdrawals}
          </span>
        </span>
      </div>
    </div>
  );
};
