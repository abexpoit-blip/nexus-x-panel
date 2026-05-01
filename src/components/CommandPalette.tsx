import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard, Hash, MessageSquare, List, BarChart3, Bell, Inbox,
  Users, Server, DollarSign, FileText, LogOut, Layers,
  Wallet, Shield, User, CreditCard, Trophy, Sparkles
} from "lucide-react";

interface NavItem {
  label: string;
  path: string;
  icon: any;
  hint?: string;
}

const agentItems: NavItem[] = [
  { label: "Dashboard", path: "/agent/dashboard", icon: LayoutDashboard },
  { label: "Browse Ranges", path: "/agent/ranges", icon: Hash, hint: "Country → Range → Get Number" },
  { label: "Console", path: "/agent/console", icon: MessageSquare },
  { label: "My Numbers", path: "/agent/my-numbers", icon: List },
  { label: "Summary", path: "/agent/summary", icon: BarChart3 },
  { label: "Leaderboard", path: "/agent/leaderboard", icon: Trophy },
  { label: "Payments", path: "/agent/payments", icon: Wallet },
  { label: "Inbox", path: "/agent/inbox", icon: Inbox },
  { label: "Profile", path: "/agent/profile", icon: User },
];

const adminItems: NavItem[] = [
  { label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Provider Ranges", path: "/admin/provider-ranges", icon: Server },
  { label: "Agents", path: "/admin/agents", icon: Users },
  { label: "Rate Card", path: "/admin/rates", icon: DollarSign },
  { label: "Allocation", path: "/admin/allocation", icon: Layers },
  { label: "Payments", path: "/admin/payments", icon: CreditCard },
  { label: "Security", path: "/admin/security", icon: Shield },
  { label: "SMS CDR", path: "/admin/cdr", icon: FileText },
  { label: "Notifications", path: "/admin/notifications", icon: Bell },
];

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const items = useMemo(() => (user?.role === "admin" ? adminItems : agentItems), [user?.role]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, actions, settings…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {items.map((item) => (
            <CommandItem
              key={item.path}
              value={item.label + " " + (item.hint || "")}
              onSelect={() => go(item.path)}
            >
              <item.icon className="w-4 h-4 mr-2 text-primary" />
              <span>{item.label}</span>
              {item.hint && <span className="ml-auto text-xs text-muted-foreground">{item.hint}</span>}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          {user?.role === "agent" && (
            <CommandItem value="get number new request" onSelect={() => go("/agent/ranges")}>
              <Sparkles className="w-4 h-4 mr-2 text-neon-magenta" />
              <span>Browse Ranges</span>
            </CommandItem>
          )}
          {user?.role === "admin" && (
            <>
              <CommandItem value="create new agent" onSelect={() => go("/admin/agents")}>
                <Users className="w-4 h-4 mr-2 text-primary" />
                <span>Manage agents</span>
              </CommandItem>
              <CommandItem value="broadcast notification" onSelect={() => go("/admin/notifications")}>
                <Bell className="w-4 h-4 mr-2 text-neon-amber" />
                <span>Broadcast notification</span>
              </CommandItem>
            </>
          )}
          <CommandItem value="sign out logout" onSelect={() => { setOpen(false); logout(); }}>
            <LogOut className="w-4 h-4 mr-2 text-neon-red" />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
