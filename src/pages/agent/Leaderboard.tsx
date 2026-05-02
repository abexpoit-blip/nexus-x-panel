import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy, Medal, Crown, Award, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Tiered badge based on OTPs delivered in the selected period
const tierFor = (otp: number) => {
  if (otp >= 1000) return { label: "Diamond", className: "bg-neon-cyan/15 text-neon-cyan border-neon-cyan/30", icon: Crown };
  if (otp >= 500) return { label: "Platinum", className: "bg-neon-magenta/15 text-neon-magenta border-neon-magenta/30", icon: Award };
  if (otp >= 200) return { label: "Gold", className: "bg-neon-amber/15 text-neon-amber border-neon-amber/30", icon: Star };
  if (otp >= 50) return { label: "Silver", className: "bg-muted-foreground/15 text-muted-foreground border-muted-foreground/30", icon: Star };
  if (otp >= 10) return { label: "Bronze", className: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: Star };
  return { label: "Rookie", className: "bg-white/[0.04] text-muted-foreground/60 border-white/[0.06]", icon: Star };
};

type Period = "today" | "7d" | "all";
const PERIOD_LABEL: Record<Period, string> = { today: "Today", "7d": "Last 7 Days", all: "All Time" };

const AgentLeaderboard = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("7d");

  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", period],
    queryFn: () => api.leaderboard(period),
    refetchInterval: 60000,
  });
  const rows = data?.leaderboard || [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  // Podium display order: 2nd, 1st, 3rd (classic stage layout)
  const podiumOrdered = [podium[1], podium[0], podium[2]].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-7 h-7 text-neon-amber" /> Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Top 10 agents ranked by OTPs delivered · with tier badges
          </p>
        </div>
        <div className="flex gap-2">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider border transition-colors",
                period === p
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-white/[0.02] border-white/[0.08] text-muted-foreground hover:text-foreground"
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* PODIUM — Top 3 */}
      {podium.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:gap-4 items-end">
          {podiumOrdered.map((r) => {
            const realRank = rows.findIndex((x) => x.id === r.id);
            const isFirst = realRank === 0;
            const isSecond = realRank === 1;
            const isMe = r.id === user?.id;
            const tier = tierFor(r.otp_count);
            const TierIcon = tier.icon;
            const heightClass = isFirst ? "h-44 sm:h-56" : isSecond ? "h-36 sm:h-48" : "h-32 sm:h-40";
            const medalColor = isFirst ? "text-neon-amber" : isSecond ? "text-muted-foreground" : "text-orange-400";
            const glowClass = isFirst
              ? "border-neon-amber/40 shadow-[0_0_40px_-10px_hsl(var(--neon-amber)/0.4)]"
              : isSecond
                ? "border-white/15"
                : "border-orange-500/30";
            const RankIcon = isFirst ? Crown : Medal;
            return (
              <div key={r.id} className="flex flex-col items-center">
                <div className="flex flex-col items-center mb-2 text-center px-1 min-w-0 w-full">
                  <RankIcon className={cn("w-7 h-7 sm:w-9 sm:h-9 mb-1", medalColor)} />
                  <p className="font-semibold text-sm sm:text-base text-foreground truncate max-w-full">
                    {r.username}
                    {isMe && <span className="text-[10px] text-primary ml-1">(You)</span>}
                  </p>
                  <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border mt-1", tier.className)}>
                    <TierIcon className="w-2.5 h-2.5" /> {tier.label}
                  </span>
                </div>
                <div
                  className={cn(
                    "w-full rounded-t-xl border-x border-t flex flex-col items-center justify-center gap-1 transition-all",
                    heightClass,
                    glowClass,
                    isMe ? "bg-primary/10" : "bg-white/[0.03]"
                  )}
                >
                  <p className={cn("font-display font-extrabold leading-none", isFirst ? "text-4xl sm:text-5xl text-neon-amber" : "text-3xl sm:text-4xl text-foreground")}>
                    {r.otp_count.toLocaleString()}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">OTPs</p>
                  <div className={cn("mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold", isFirst ? "bg-neon-amber/20 text-neon-amber" : isSecond ? "bg-white/10 text-foreground" : "bg-orange-500/20 text-orange-400")}>
                    #{realRank + 1}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GlassCard className="p-2">
        <div className="space-y-1">
          {rest.map((r, idx) => {
            const i = idx + 3;
            const isMe = r.id === user?.id;
            const tier = tierFor(r.otp_count);
            const TierIcon = tier.icon;
            return (
              <div
                key={r.id}
                className={cn(
                  "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg transition-colors",
                  isMe
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-white/[0.03]"
                )}
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-10 text-center shrink-0">
                    <span className="font-mono text-muted-foreground text-sm">#{i + 1}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground truncate">
                        {r.username} {isMe && <span className="text-xs text-primary ml-1">(You)</span>}
                      </p>
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border", tier.className)}>
                        <TierIcon className="w-3 h-3" /> {tier.label}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 pl-12 sm:pl-0">
                  <p className="text-xl font-display font-bold text-foreground">{r.otp_count.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">OTPs</p>
                </div>
              </div>
            );
          })}
          {!rows.length && !isLoading && (
            <div className="text-center py-12">
              <Trophy className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">No OTP deliveries yet for {PERIOD_LABEL[period].toLowerCase()}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Be the first to climb the ranks 🚀</p>
            </div>
          )}
          {isLoading && rows.length === 0 && (
            <p className="text-center text-muted-foreground py-12 text-sm">Loading rankings…</p>
          )}
          {!isLoading && rows.length > 0 && rest.length === 0 && (
            <p className="text-center text-muted-foreground/60 py-6 text-xs">More agents will appear here as they climb.</p>
          )}
        </div>
      </GlassCard>
    </div>
  );
};

export default AgentLeaderboard;
