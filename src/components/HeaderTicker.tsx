import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Activity, Flame, Trophy, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/**
 * HeaderTicker — fills the empty space in the top header with rotating
 * live stats (latest OTP, top agent today, your-OTPs-today / balance).
 * Hidden on <md, replaced by a compact mobile chip.
 */
type Slide = { icon: JSX.Element; label: string; value: string; tone: "green" | "cyan" | "amber" | "violet" };

export const HeaderTicker = () => {
  const { user } = useAuth();
  const isAgent = user?.role === "agent";

  const { data: feed } = useQuery({
    queryKey: ["header-ticker-feed"],
    queryFn: () => api.cdr.feed(),
    refetchInterval: 8000,
    staleTime: 4000,
  });
  const { data: lb } = useQuery({
    queryKey: ["header-ticker-lb"],
    queryFn: () => api.leaderboard("today").catch(() => ({ leaderboard: [] as any[] })),
    refetchInterval: 30000,
  });
  const { data: mine } = useQuery({
    queryKey: ["header-ticker-mine"],
    enabled: isAgent,
    queryFn: () => api.cdr.mine(),
    refetchInterval: 15000,
  });

  const latest = feed?.feed?.[0];
  const top = (lb as any)?.leaderboard?.[0];
  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return Math.floor(d.getTime()/1000); })();
  const myOtpsToday = (mine?.cdr || []).filter((r: any) => r.created_at >= todayStart && r.status === "billed").length;

  const slides: Slide[] = [];
  if (latest) {
    slides.push({
      icon: <Zap className="w-3.5 h-3.5" />,
      label: "Latest OTP",
      value: `${latest.cli || latest.provider || "SMS"} → ${latest.phone_masked}`,
      tone: "cyan",
    });
  }
  if (top?.username) {
    slides.push({
      icon: <Trophy className="w-3.5 h-3.5" />,
      label: "Top agent today",
      value: `${top.username} · ${top.otp_count ?? 0} OTPs`,
      tone: "amber",
    });
  }
  if (isAgent) {
    slides.push({
      icon: <Activity className="w-3.5 h-3.5" />,
      label: "Your OTPs today",
      value: String(myOtpsToday),
      tone: "green",
    });
    if (user) {
      slides.push({
        icon: <Flame className="w-3.5 h-3.5" />,
        label: "Balance",
        value: `৳${user.balance.toFixed(2)}`,
        tone: "violet",
      });
    }
  }

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!slides.length) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 4500);
    return () => clearInterval(t);
  }, [slides.length]);

  if (!slides.length) return null;
  const s = slides[idx % slides.length];
  const toneCls = {
    green:  "text-neon-green border-neon-green/25 bg-neon-green/[0.06]",
    cyan:   "text-neon-cyan border-neon-cyan/25 bg-neon-cyan/[0.06]",
    amber:  "text-neon-amber border-neon-amber/25 bg-neon-amber/[0.06]",
    violet: "text-neon-violet border-neon-violet/25 bg-neon-violet/[0.06]",
  }[s.tone];

  return (
    <>
      {/* Desktop / tablet — full ticker pill */}
      <div className="hidden md:flex items-center justify-center flex-1 min-w-0 px-4">
        <div
          key={idx}
          className={cn(
            "flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border max-w-full",
            "animate-fade-in transition-colors backdrop-blur-md",
            toneCls,
          )}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-50 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          {s.icon}
          <span className="text-[10px] uppercase tracking-wider opacity-80">{s.label}</span>
          <span className="text-xs font-semibold text-foreground truncate">{s.value}</span>
        </div>
      </div>

      {/* Mobile — compact chip with just icon + value */}
      <div className="md:hidden flex items-center flex-1 min-w-0 justify-center">
        <div
          key={idx}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] truncate max-w-[60vw]",
            "animate-fade-in",
            toneCls,
          )}
        >
          {s.icon}
          <span className="font-semibold text-foreground truncate">{s.value}</span>
        </div>
      </div>
    </>
  );
};
