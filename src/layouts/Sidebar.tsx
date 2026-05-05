import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { NexusLogo, APP_VERSION } from "@/components/NexusLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { prefetchPage } from "@/lib/lazyPages";
import {
  LayoutDashboard, Hash, MessageSquare, List, BarChart3, Bell, Inbox,
  Users, Server, DollarSign, FileText, LogOut, X, Layers,
  Wallet, Shield, User, CreditCard, Trophy, Bot, ArrowDownToLine, History, Settings, AppWindow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const agentNav: NavItem[] = [
  { label: "Dashboard", path: "/agent/dashboard", icon: LayoutDashboard },
  { label: "Get Number", path: "/agent/ranges", icon: Layers },
  { label: "Console", path: "/agent/console", icon: MessageSquare },
  { label: "OTP History", path: "/agent/history", icon: History },
  { label: "Summary", path: "/agent/summary", icon: BarChart3 },
  { label: "Leaderboard", path: "/agent/leaderboard", icon: Trophy },
  { label: "Payments", path: "/agent/payments", icon: Wallet },
  { label: "Inbox", path: "/agent/inbox", icon: Inbox },
  { label: "Profile", path: "/agent/profile", icon: User },
];

const adminNav: NavItem[] = [
  { label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Provider Ranges", path: "/admin/provider-ranges", icon: Layers },
  { label: "Services", path: "/admin/services", icon: AppWindow },
  { label: "Agents", path: "/admin/agents", icon: Users },
  { label: "Rate Card", path: "/admin/rates", icon: DollarSign },
  { label: "Allocation", path: "/admin/allocation", icon: Layers },
  { label: "Payments", path: "/admin/payments", icon: CreditCard },
  { label: "Withdrawals", path: "/admin/withdrawals", icon: ArrowDownToLine },
  { label: "Security", path: "/admin/security", icon: Shield },
  { label: "SMS CDR", path: "/admin/cdr", icon: FileText },
  { label: "Notifications", path: "/admin/notifications", icon: Bell },
  { label: "Bots Control", path: "/admin/bots", icon: Bot },
  { label: "Settings", path: "/admin/settings", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export const AppSidebar = ({ open, onClose }: SidebarProps) => {
  const { user, logout } = useAuth();
  const { announcements } = useNotifications();
  const location = useLocation();
  const nav = user?.role === "admin" ? adminNav : agentNav;
  const unreadAnnouncements = announcements.filter((a) => !a.read).length;

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-72 z-50 flex flex-col transition-transform duration-300 ease-out",
          "bg-sidebar/80 backdrop-blur-2xl border-r border-white/[0.06]",
          "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-primary/30 before:to-transparent before:opacity-60",
          "lg:translate-x-0 lg:static lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="relative flex items-center justify-between px-5 h-[72px] border-b border-white/[0.06]">
          <NexusLogo size="md" showVersion />
          <button onClick={onClose} className="lg:hidden p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
          <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        </div>

        <div className="px-5 pt-5 pb-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/60 font-semibold">
            {user?.role === "admin" ? "Operations" : "Workspace"}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-none px-3 pb-4 space-y-1">
          {nav.map((item) => {
            const active = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                onMouseEnter={() => prefetchPage(item.path)}
                onFocus={() => prefetchPage(item.path)}
                onTouchStart={() => prefetchPage(item.path)}
                className={cn(
                  "group relative flex items-center gap-3 px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all duration-300",
                  active
                    ? "text-foreground bg-gradient-to-r from-primary/[0.18] via-secondary/[0.10] to-transparent border border-white/[0.06] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08),0_8px_24px_-12px_hsl(188_100%_50%/0.4)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-gradient-to-b from-primary to-secondary shadow-[0_0_10px_hsl(188_100%_50%/0.7)]" />
                )}
                <item.icon
                  className={cn(
                    "w-[18px] h-[18px] transition-all duration-300 shrink-0",
                    active
                      ? "text-primary drop-shadow-[0_0_8px_hsl(188_100%_50%/0.8)]"
                      : "group-hover:text-foreground/80 group-hover:scale-105"
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.path === "/agent/inbox" && unreadAnnouncements > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-neon-magenta/20 text-neon-magenta border border-neon-magenta/30 min-w-[18px] text-center">
                    {unreadAnnouncements > 9 ? "9+" : unreadAnnouncements}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/[0.06] bg-gradient-to-b from-transparent to-black/30">
          <div className="flex items-center gap-3 mb-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="w-10 h-10 rounded-lg bg-gradient-brand flex items-center justify-center text-base font-bold text-primary-foreground shadow-glow-cyan shrink-0">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-foreground truncate">{user?.username}</p>
              <p className="text-[11px] text-muted-foreground capitalize tracking-wider uppercase">
                {user?.role}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-[14px] text-muted-foreground hover:text-neon-red hover:bg-neon-red/10 transition-colors group"
          >
            <LogOut className="w-[18px] h-[18px] group-hover:-translate-x-0.5 transition-transform" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
};
