import { Hash, MessageSquare, TrendingUp, Wallet, Activity, Clock, Target, BellRing, Timer, Copy, CheckCircle2, History } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { GlassCard } from "@/components/GlassCard";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { OtpLine, SuccessGauge } from "@/components/charts/Charts";
import { AvgOtpWaitTime } from "@/components/AvgOtpWaitTime";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const AgentDashboard = () => {
  const { user } = useAuth();
  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: () => api.numberSummary(), refetchInterval: 30000 });
  const { data: nums } = useQuery({ queryKey: ["my-numbers"], queryFn: () => api.myNumbers(), refetchInterval: 5000 });

  // Tick every second for countdown timers within the 30-minute window
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const s = summary || { today: { c: 0, s: 0 }, week: { c: 0, s: 0 }, month: { c: 0, s: 0 }, active: 0 };
  const recent = (nums?.numbers || []).slice(0, 8);
  const allNums = nums?.numbers || [];

  // Active window = allocations not yet expired and within 30-minute window
  const WINDOW_SEC = 30 * 60;
  const activeWindow = useMemo(() => {
    return allNums
      .filter((n: any) => {
        if (n.status === "expired") return false;
        const elapsed = now - (n.allocated_at || 0);
        return elapsed >= 0 && elapsed < WINDOW_SEC;
      })
      .sort((a: any, b: any) => (b.allocated_at || 0) - (a.allocated_at || 0));
  }, [allNums, now]);
  const arrivedCount = activeWindow.filter((n: any) => n.otp).length;
  const waitingCount = activeWindow.length - arrivedCount;

  // Delivered history (last 24h) — arrived OTPs only
  const DAY_SEC = 24 * 60 * 60;
  const delivered24h = useMemo(() => {
    return allNums
      .filter((n: any) => {
        if (!n.otp) return false;
        const ts = n.otp_received_at || n.allocated_at || 0;
        return now - ts < DAY_SEC;
      })
      .sort((a: any, b: any) => (b.otp_received_at || b.allocated_at || 0) - (a.otp_received_at || a.allocated_at || 0));
  }, [allNums, now]);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyPair = async (item: any) => {
    const text = item.otp ? `${item.phone_number}|${item.otp}` : item.phone_number;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      toast.success(item.otp ? "Copied number|OTP" : "Copied number");
      setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  // Build 7-day OTP delivery series from my numbers
  const otpSeries = useMemo(() => {
    const days = 7;
    const buckets: Record<string, number> = {};
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      buckets[d.toISOString().slice(5, 10)] = 0;
    }
    allNums.forEach((n: any) => {
      if (!n.otp_received_at) return;
      const key = new Date(n.otp_received_at * 1000).toISOString().slice(5, 10);
      if (buckets[key] !== undefined) buckets[key] += 1;
    });
    return Object.entries(buckets).map(([label, value]) => ({ label, value }));
  }, [allNums]);

  // OTP success rate = received / total allocations (capped to 100)
  const totalAllocations = allNums.length;
  const receivedCount = allNums.filter((n: any) => n.otp).length;
  const successRate = totalAllocations > 0 ? (receivedCount / totalAllocations) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <motion.h1 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="text-3xl font-display font-bold text-foreground">
            Welcome, <span className="text-glow-cyan text-primary">{user?.username}</span>
          </motion.h1>
          <p className="text-sm text-muted-foreground mt-1">Live performance — auto refreshes every 15 seconds</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 glass rounded-xl">
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          <span className="text-xs text-muted-foreground">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active Numbers" value={s.active} icon={Hash} color="cyan" />
        <StatCard label="Today OTP" value={s.today.c} icon={MessageSquare} color="magenta" />
        <StatCard label="7-Day OTP" value={s.week.c} icon={TrendingUp} color="green" />
        <StatCard label="Earnings (Withdrawable)" value={`৳${user?.balance.toFixed(2) || "0.00"}`} icon={Wallet} color="amber" />
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        💡 Numbers are <span className="text-neon-green font-semibold">100% free</span> — you only earn when an OTP is successfully received. No balance is deducted to get a number.
      </p>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard glow="magenta" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-magenta" /> OTP delivery (last 7 days)
            </h3>
            <span className="text-xs text-muted-foreground">count</span>
          </div>
          <OtpLine data={otpSeries} height={240} />
        </GlassCard>

        <GlassCard glow="cyan">
          <h3 className="font-display font-semibold text-foreground mb-2 flex items-center gap-2">
            <Target className="w-4 h-4 text-neon-green" /> Success Rate
          </h3>
          <SuccessGauge value={successRate} label="OTP Received" />
          <div className="mt-3 pt-3 border-t border-white/[0.04] text-xs grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Received</span><p className="font-mono text-neon-green text-base">{receivedCount}</p></div>
            <div><span className="text-muted-foreground">Total</span><p className="font-mono text-foreground text-base">{totalAllocations}</p></div>
          </div>
        </GlassCard>
      </div>

      {/* Avg OTP Wait Time + Earnings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AvgOtpWaitTime data={summary?.wait_time} />
        <GlassCard className="p-6">
          <h3 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-amber" /> Earnings This Period
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Today earned</span><span className="font-bold text-neon-green">+৳{s.today.s.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">7-day earned</span><span className="font-bold text-neon-green">+৳{s.week.s.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">30-day earned</span><span className="font-bold text-neon-green">+৳{s.month.s.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">30-day OTPs</span><span className="font-bold">{s.month.c}</span></div>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-6">
        <h3 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
          <BellRing className="w-4 h-4 text-neon-green" /> OTP Status — 30-min Window
          <span className="ml-auto flex items-center gap-2 text-xs">
            <Badge variant="outline" className="border-neon-green/40 text-neon-green">
              {arrivedCount} arrived
            </Badge>
            <Badge variant="outline" className="border-neon-amber/40 text-neon-amber">
              {waitingCount} waiting
            </Badge>
          </span>
        </h3>
        {!activeWindow.length && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No active numbers in the 30-minute window
          </p>
        )}
        <div className="space-y-2">
          {activeWindow.map((item: any) => {
            const remaining = Math.max(0, WINDOW_SEC - (now - item.allocated_at));
            const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
            const ss = String(remaining % 60).padStart(2, "0");
            const arrived = !!item.otp;
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center justify-between py-2.5 px-3 rounded-lg border transition-colors",
                  arrived
                    ? "bg-neon-green/[0.06] border-neon-green/30"
                    : "bg-white/[0.02] border-white/[0.05]"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      arrived ? "bg-neon-green" : "bg-neon-amber animate-pulse"
                    )}
                  />
                  <div>
                    <p className="text-sm font-mono text-foreground">{item.phone_number}</p>
                    <p className="text-xs text-muted-foreground">{item.operator || "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {arrived ? (
                    <Badge className="bg-neon-green/20 text-neon-green border border-neon-green/40 hover:bg-neon-green/20">
                      OTP {item.otp}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-neon-amber/40 text-neon-amber">
                      Waiting…
                    </Badge>
                  )}
                  <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground min-w-[56px] justify-end">
                    <Timer className="w-3 h-3" />
                    {mm}:{ss}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => copyPair(item)}
                    title={arrived ? "Copy number|OTP" : "Copy number"}
                  >
                    {copiedId === item.id ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h3 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-neon-green" /> Delivered OTPs — Last 24h
          <Badge variant="outline" className="ml-auto border-neon-green/40 text-neon-green text-xs">
            {delivered24h.length} delivered
          </Badge>
        </h3>
        {!delivered24h.length && (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No OTPs delivered in the last 24 hours
          </p>
        )}
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {delivered24h.map((item: any) => {
            const ts = (item.otp_received_at || item.allocated_at) * 1000;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-neon-green" />
                  <div>
                    <p className="text-sm font-mono text-foreground">{item.phone_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.operator || "—"} · {new Date(ts).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-neon-green/20 text-neon-green border border-neon-green/40 hover:bg-neon-green/20 font-mono">
                    {item.otp}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => copyPair(item)}
                    title="Copy number|OTP"
                  >
                    {copiedId === item.id ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h3 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Recent Numbers
        </h3>
        {!recent.length && <p className="text-sm text-muted-foreground/60 text-center py-12">No activity yet — go to Get Number to start</p>}
        <div className="space-y-2">
          {recent.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-white/[0.02] border-b border-white/[0.04] last:border-0">
              <div className="flex items-center gap-3">
                <span className={cn("w-2 h-2 rounded-full",
                  item.status === "received" ? "bg-neon-green" : item.status === "active" ? "bg-neon-amber animate-pulse" : "bg-muted-foreground"
                )} />
                <div>
                  <p className="text-sm font-mono text-foreground">{item.phone_number}</p>
                  <p className="text-xs text-muted-foreground">{item.operator || "—"}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={cn("text-sm font-mono",
                  item.otp ? "text-neon-green" : "text-muted-foreground"
                )}>{item.otp || "waiting…"}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.allocated_at * 1000).toLocaleTimeString()}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
};

export default AgentDashboard;
