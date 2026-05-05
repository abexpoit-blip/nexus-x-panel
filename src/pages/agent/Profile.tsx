import { useEffect, useState } from "react";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { User, Lock, Mail, Phone, Shield, Save, Eye, EyeOff, BellRing, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { loadOtpPrefs, saveOtpPrefs, requestPushPermission, type OtpAlertPrefs } from "@/hooks/useOtpAlerts";

const AgentProfile = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<"info" | "password" | "security">("info");
  const [name, setName] = useState(user?.username || "");
  const [email, setEmail] = useState("agent1@nexusx.io");
  const [phone, setPhone] = useState("+8801711XXXXXX");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // OTP alert preferences (sound + browser push) — stored in localStorage
  const [otpPrefs, setOtpPrefs] = useState<OtpAlertPrefs>(() => loadOtpPrefs());
  const [pushPerm, setPushPerm] = useState<string>(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  useEffect(() => { saveOtpPrefs(otpPrefs); }, [otpPrefs]);
  const togglePush = async (v: boolean) => {
    if (v && pushPerm !== "granted") {
      const r = await requestPushPermission();
      setPushPerm(r);
      if (r !== "granted") {
        toast.error("Browser denied notifications. Enable them in browser settings.");
        return;
      }
    }
    setOtpPrefs(p => ({ ...p, push: v }));
  };

  const submitPasswordChange = async () => {
    if (!currentPw || !newPw) {
      toast.error("Fill in current and new password");
      return;
    }
    if (newPw.length < 5) {
      toast.error("New password must be at least 5 characters");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPw === currentPw) {
      toast.error("New password must differ from current");
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword(currentPw, newPw);
      toast.success("Password updated. Use the new password next time you log in.");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  const tabs = [
    { key: "info" as const, label: "Profile Info", icon: User },
    { key: "password" as const, label: "Change Password", icon: Lock },
    { key: "security" as const, label: "Security", icon: Shield },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and security settings</p>
      </div>

      {/* Profile Header */}
      <GlassCard glow="cyan" className="flex flex-col sm:flex-row items-center gap-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center text-3xl font-display font-bold text-foreground border border-white/[0.1]">
          {user?.username?.[0]?.toUpperCase()}
        </div>
        <div className="text-center sm:text-left">
          <h2 className="text-xl font-display font-bold text-foreground">{user?.username}</h2>
          <p className="text-sm text-muted-foreground capitalize">{user?.role} Account</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neon-green/10 text-neon-green">Active</span>
            <span className="text-xs text-muted-foreground">Member since March 2025</span>
          </div>
        </div>
      </GlassCard>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.key
                ? "bg-primary/10 text-primary neon-border-cyan border"
                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <GlassCard>
          <h3 className="font-display font-semibold text-foreground mb-6">Personal Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <User className="w-3.5 h-3.5" /> Display Name
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white/[0.04] border-white/[0.1] h-11" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Mail className="w-3.5 h-3.5" /> Email
              </label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} className="bg-white/[0.04] border-white/[0.1] h-11" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Phone className="w-3.5 h-3.5" /> Phone
              </label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="bg-white/[0.04] border-white/[0.1] h-11" />
            </div>
          </div>
          <Button className="mt-6 bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground font-semibold hover:opacity-90 border-0">
            <Save className="w-4 h-4 mr-2" /> Save Changes
          </Button>
        </GlassCard>
      )}

      {tab === "password" && (
        <GlassCard>
          <h3 className="font-display font-semibold text-foreground mb-6">Change Password</h3>
          <div className="space-y-4 max-w-md">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Current Password</label>
              <div className="relative">
                <Input type={showPw ? "text" : "password"} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="bg-white/[0.04] border-white/[0.1] h-11 pr-10" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">New Password</label>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="bg-white/[0.04] border-white/[0.1] h-11" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Confirm Password</label>
              <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="bg-white/[0.04] border-white/[0.1] h-11" />
            </div>
            <Button
              onClick={submitPasswordChange}
              disabled={pwLoading}
              className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground font-semibold hover:opacity-90 border-0"
            >
              <Lock className="w-4 h-4 mr-2" />
              {pwLoading ? "Updating…" : "Update Password"}
            </Button>
            <p className="text-[11px] text-muted-foreground pt-1">
              Minimum 5 characters. New password takes effect immediately — your current session stays logged in.
            </p>
          </div>
        </GlassCard>
      )}

      {tab === "security" && (
        <GlassCard>
          <h3 className="font-display font-semibold text-foreground mb-6">Security Settings</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div>
                <p className="text-sm font-medium text-foreground">Two-Factor Authentication</p>
                <p className="text-xs text-muted-foreground mt-1">Add an extra layer of security</p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neon-red/10 text-neon-red">Disabled</span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div>
                <p className="text-sm font-medium text-foreground">Login Notifications</p>
                <p className="text-xs text-muted-foreground mt-1">Get notified of suspicious logins</p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neon-green/10 text-neon-green">Enabled</span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div>
                <p className="text-sm font-medium text-foreground">Last Login</p>
                <p className="text-xs text-muted-foreground mt-1">192.168.1.xxx • Chrome on Windows</p>
              </div>
              <span className="text-xs text-muted-foreground">2 min ago</span>
            </div>

            {/* OTP Alerts */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-neon-cyan/[0.04] to-neon-magenta/[0.04] border border-white/[0.08] space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                  <BellRing className="w-4 h-4 text-neon-cyan" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">OTP Alerts</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Get notified the instant an OTP arrives — even when this tab isn't focused.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Volume2 className="w-4 h-4 text-muted-foreground" /> Sound chime
                </div>
                <Switch checked={otpPrefs.sound} onCheckedChange={(v) => setOtpPrefs(p => ({ ...p, sound: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <BellRing className="w-4 h-4 text-muted-foreground" /> Browser push
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">({pushPerm})</span>
                </div>
                <Switch checked={otpPrefs.push && pushPerm === "granted"} onCheckedChange={togglePush} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Volume — {otpPrefs.volume}%</label>
                <input type="range" min={0} max={100} value={otpPrefs.volume}
                  onChange={(e) => setOtpPrefs(p => ({ ...p, volume: +e.target.value }))}
                  className="w-full accent-primary" />
              </div>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
};

export default AgentProfile;
