import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GradientMesh, PageHeader } from "@/components/premium";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Settings as SettingsIcon, Save, Loader2, Wrench, UserPlus, Clock, Eye, Bot, Trash2, Zap, KeyRound, Cookie, ExternalLink, HeartPulse, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Read a string setting with fallback. Settings are stored as plain strings. */
const str = (m: Record<string, string> | undefined, k: string, fb = "") => m?.[k] ?? fb;
const bool = (m: Record<string, string> | undefined, k: string) => m?.[k] === "true";

const AdminSettings = () => {
  const qc = useQueryClient();
  const { toast } = useToast();

  // ---- All raw settings (key/value strings) ----
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.settings.getAll(),
  });
  const s = settingsData?.settings;

  // ---- OTP timing (typed endpoints) ----
  const { data: otpExpiry } = useQuery({
    queryKey: ["admin-otp-expiry"],
    queryFn: () => api.admin.otpExpiry(),
  });
  const { data: recentWindow } = useQuery({
    queryKey: ["admin-recent-otp-window"],
    queryFn: () => api.admin.recentOtpWindow(),
  });

  // ---- Fake OTP broadcaster ----
  const { data: fake } = useQuery({
    queryKey: ["admin-fake-otp"],
    queryFn: () => api.fakeOtp.get(),
    refetchInterval: 10_000,
  });

  // Local form state
  const [signupOpen, setSignupOpen] = useState(false);
  const [maintOn, setMaintOn] = useState(false);
  const [maintMsg, setMaintMsg] = useState("");
  const [tgChannel, setTgChannel] = useState("");
  const [tgGroup, setTgGroup] = useState("");
  const [tgGroupChat, setTgGroupChat] = useState("");
  const [tgOtpGroup, setTgOtpGroup] = useState("");
  const [tgOtpGroupChat, setTgOtpGroupChat] = useState("");
  const [otpMin, setOtpMin] = useState<number>(8);
  const [recentHrs, setRecentHrs] = useState<number>(24);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [fakeForm, setFakeForm] = useState({ enabled: false, min_sec: 30, max_sec: 90, burst: 1 });

  // ---- Bot credentials (mirror keys read by backend/workers/*.js) ----
  const [seven1Url, setSeven1Url] = useState("");
  const [seven1User, setSeven1User] = useState("");
  const [seven1Pass, setSeven1Pass] = useState("");
  const [seven1Cookie, setSeven1Cookie] = useState("");
  const [seven1Interval, setSeven1Interval] = useState<number>(4);
  const [xisoraUrl, setXisoraUrl] = useState("");
  const [xisoraToken, setXisoraToken] = useState("");
  const [xisoraInterval, setXisoraInterval] = useState<number>(10);
  const [showPw, setShowPw] = useState(false);
  const [healthState, setHealthState] = useState<Record<string, { ok: boolean; ms: number; error?: string } | "checking">>({});

  useEffect(() => {
    if (!s) return;
    setSignupOpen(bool(s, "signup_enabled"));
    setMaintOn(bool(s, "maintenance_mode"));
    setMaintMsg(str(s, "maintenance_message"));
    setTgChannel(str(s, "tg_public_channel"));
    setTgGroup(str(s, "tg_required_group"));
    setTgGroupChat(str(s, "tg_required_group_chat"));
    setTgOtpGroup(str(s, "tg_required_otp_group"));
    setTgOtpGroupChat(str(s, "tg_required_otp_group_chat"));
    setSeven1Url(str(s, "seven1tel_base_url", "http://94.23.120.156/ints"));
    setSeven1User(str(s, "seven1tel_username"));
    setSeven1Pass(str(s, "seven1tel_password"));
    setSeven1Cookie(str(s, "seven1tel_cookie_header"));
    setSeven1Interval(Number(str(s, "seven1tel_otp_interval", "4")) || 4);
    setXisoraUrl(str(s, "xisora_base_url", "http://51.38.148.122/crapi/reseller/mdr.php"));
    setXisoraToken(str(s, "xisora_token"));
    setXisoraInterval(Number(str(s, "xisora_otp_interval", "10")) || 10);
  }, [s]);

  useEffect(() => {
    if (otpExpiry) setOtpMin(Math.round(otpExpiry.expiry_min));
  }, [otpExpiry]);
  useEffect(() => {
    if (recentWindow) setRecentHrs(recentWindow.hours);
  }, [recentWindow]);
  useEffect(() => {
    if (fake) setFakeForm({
      enabled: !!fake.enabled, min_sec: fake.min_sec, max_sec: fake.max_sec, burst: fake.burst,
    });
  }, [fake]);

  // Generic key setter
  const setSetting = async (key: string, value: string | boolean) => {
    setSavingKey(key);
    try {
      await api.settings.set(key, typeof value === "boolean" ? String(value) : value);
      toast({ title: "Saved", description: key });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally { setSavingKey(null); }
  };

  const saveOtpExpiry = async () => {
    setSavingKey("otp_expiry");
    try {
      await api.admin.otpExpirySave(otpMin);
      toast({ title: "OTP expiry updated", description: `${otpMin} min` });
      qc.invalidateQueries({ queryKey: ["admin-otp-expiry"] });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally { setSavingKey(null); }
  };

  const saveRecentWindow = async () => {
    setSavingKey("recent_otp");
    try {
      await api.admin.recentOtpWindowSave(recentHrs);
      toast({ title: "Recent OTP window updated", description: `${recentHrs} h` });
      qc.invalidateQueries({ queryKey: ["admin-recent-otp-window"] });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally { setSavingKey(null); }
  };

  const saveFake = async (overrides?: Partial<typeof fakeForm>) => {
    const body = { ...fakeForm, ...overrides };
    setSavingKey("fake_otp");
    try {
      await api.fakeOtp.save(body);
      setFakeForm(body);
      toast({ title: "Fake OTP settings saved" });
      qc.invalidateQueries({ queryKey: ["admin-fake-otp"] });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally { setSavingKey(null); }
  };

  const runHealth = async (bot: string) => {
    setHealthState((p) => ({ ...p, [bot]: "checking" }));
    try {
      const r = await api.admin.bots.health(bot);
      setHealthState((p) => ({ ...p, [bot]: { ok: !!r.ok, ms: r.ms, error: r.error } }));
      toast({
        title: r.ok ? `✓ ${bot} login OK` : `✗ ${bot} login failed`,
        description: r.ok ? `Logged in in ${r.ms}ms` : (r.error || "Unknown error"),
        variant: r.ok ? "default" : "destructive",
      });
    } catch (e) {
      setHealthState((p) => ({ ...p, [bot]: { ok: false, ms: 0, error: (e as Error).message } }));
      toast({ title: "Health check failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Configuration"
        title="System Settings"
        description="Global controls for signup, maintenance, OTP timings, Telegram links, and the fake OTP broadcaster."
        icon={<SettingsIcon className="w-5 h-5 text-neon-cyan" />}
      />

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="bg-white/[0.04] border border-white/[0.08]">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="otp">OTP Timing</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
          <TabsTrigger value="fake-otp">Fake OTP</TabsTrigger>
          <TabsTrigger value="bots">Bots</TabsTrigger>
        </TabsList>

        {/* ============ GENERAL ============ */}
        <TabsContent value="general" className="space-y-4 mt-4">
          <GlassCard>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-neon-green/10 border border-neon-green/20 mt-0.5">
                  <UserPlus className="w-4 h-4 text-neon-green" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Signups Open</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When off, the public Register page is hidden and signup API rejects new accounts.
                  </p>
                </div>
              </div>
              <Switch
                checked={signupOpen}
                onCheckedChange={(v) => { setSignupOpen(v); setSetting("signup_enabled", v); }}
                disabled={savingKey === "signup_enabled"}
              />
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "p-2 rounded-lg border mt-0.5",
                  maintOn ? "bg-neon-amber/10 border-neon-amber/30" : "bg-white/[0.04] border-white/[0.08]"
                )}>
                  <Wrench className={cn("w-4 h-4", maintOn ? "text-neon-amber" : "text-muted-foreground")} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Maintenance Mode</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Locks agents out of the app and shows a banner. Admins keep access.
                  </p>
                </div>
              </div>
              <Switch
                checked={maintOn}
                onCheckedChange={(v) => { setMaintOn(v); setSetting("maintenance_mode", v); }}
                disabled={savingKey === "maintenance_mode"}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Banner message</Label>
              <Textarea
                value={maintMsg}
                onChange={(e) => setMaintMsg(e.target.value)}
                placeholder="We'll be back shortly. Scheduled maintenance in progress."
                className="bg-white/[0.04] border-white/[0.1] min-h-20"
                maxLength={500}
              />
              <div className="flex justify-end">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setSetting("maintenance_message", maintMsg)}
                  disabled={savingKey === "maintenance_message"}
                  className="border-white/[0.1]"
                >
                  {savingKey === "maintenance_message" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                  Save message
                </Button>
              </div>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ============ OTP TIMING ============ */}
        <TabsContent value="otp" className="space-y-4 mt-4">
          <GlassCard>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                <Clock className="w-4 h-4 text-neon-cyan" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Allocation Expiry</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How long an allocated number stays "active" before auto-releasing if no OTP arrives.
                </p>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Expiry (minutes)</Label>
                <Select value={String(otpMin)} onValueChange={(v) => setOtpMin(+v)}>
                  <SelectTrigger className="bg-white/[0.04] border-white/[0.1]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(otpExpiry?.options_min || [5, 8, 10, 15, 20, 30]).map(m => (
                      <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={saveOtpExpiry} disabled={savingKey === "otp_expiry"}
                className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
                {savingKey === "otp_expiry" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-neon-violet/10 border border-neon-violet/20">
                <Eye className="w-4 h-4 text-neon-violet" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Recent OTP Window</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Hours that delivered OTPs remain on the agent's "My Numbers" live page before moving to history.
                </p>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Window (hours)</Label>
                <Select value={String(recentHrs)} onValueChange={(v) => setRecentHrs(+v)}>
                  <SelectTrigger className="bg-white/[0.04] border-white/[0.1]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(recentWindow?.options_hours || [1, 6, 12, 24, 48, 72, 168]).map(h => (
                      <SelectItem key={h} value={String(h)}>{h}h{h >= 24 ? ` (${Math.round(h/24)}d)` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={saveRecentWindow} disabled={savingKey === "recent_otp"}
                className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
                {savingKey === "recent_otp" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save
              </Button>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ============ TELEGRAM ============ */}
        <TabsContent value="telegram" className="space-y-4 mt-4">
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-1">Public Channel</h3>
            <p className="text-xs text-muted-foreground mb-3">Linked from agent UI as the announcements channel.</p>
            <div className="flex gap-2">
              <Input value={tgChannel} onChange={(e) => setTgChannel(e.target.value)}
                placeholder="https://t.me/your_channel" className="bg-white/[0.04] border-white/[0.1] flex-1" />
              <Button variant="outline" onClick={() => setSetting("tg_public_channel", tgChannel)}
                disabled={savingKey === "tg_public_channel"} className="border-white/[0.1]">
                <Save className="w-3.5 h-3.5 mr-1.5" /> Save
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="font-semibold text-foreground mb-1">Required Login Group</h3>
            <p className="text-xs text-muted-foreground mb-3">Agents must be members to log in (link + chat ID).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Invite link</Label>
                <Input value={tgGroup} onChange={(e) => setTgGroup(e.target.value)}
                  placeholder="https://t.me/+abcd…" className="bg-white/[0.04] border-white/[0.1]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Chat ID</Label>
                <Input value={tgGroupChat} onChange={(e) => setTgGroupChat(e.target.value)}
                  placeholder="-1001234567890" className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button variant="outline" onClick={async () => {
                await api.settings.set("tg_required_group", tgGroup);
                await api.settings.set("tg_required_group_chat", tgGroupChat);
                toast({ title: "Login group saved" });
                qc.invalidateQueries({ queryKey: ["admin-settings"] });
              }} className="border-white/[0.1]">
                <Save className="w-3.5 h-3.5 mr-1.5" /> Save
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="font-semibold text-foreground mb-1">Required OTP Group</h3>
            <p className="text-xs text-muted-foreground mb-3">Members of this group can request numbers.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Invite link</Label>
                <Input value={tgOtpGroup} onChange={(e) => setTgOtpGroup(e.target.value)}
                  placeholder="https://t.me/+xyz…" className="bg-white/[0.04] border-white/[0.1]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Chat ID</Label>
                <Input value={tgOtpGroupChat} onChange={(e) => setTgOtpGroupChat(e.target.value)}
                  placeholder="-1009876543210" className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button variant="outline" onClick={async () => {
                await api.settings.set("tg_required_otp_group", tgOtpGroup);
                await api.settings.set("tg_required_otp_group_chat", tgOtpGroupChat);
                toast({ title: "OTP group saved" });
                qc.invalidateQueries({ queryKey: ["admin-settings"] });
              }} className="border-white/[0.1]">
                <Save className="w-3.5 h-3.5 mr-1.5" /> Save
              </Button>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ============ FAKE OTP ============ */}
        <TabsContent value="fake-otp" className="space-y-4 mt-4">
          <GlassCard>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "p-2 rounded-lg border mt-0.5",
                  fake?.running ? "bg-neon-magenta/10 border-neon-magenta/30" : "bg-white/[0.04] border-white/[0.08]"
                )}>
                  <Bot className={cn("w-4 h-4", fake?.running ? "text-neon-magenta" : "text-muted-foreground")} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Fake OTP Broadcaster</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Realism layer — periodically inserts synthetic CDR rows so the public feed never looks empty.
                  </p>
                </div>
              </div>
              <Switch
                checked={fakeForm.enabled}
                onCheckedChange={(v) => saveFake({ enabled: v })}
                disabled={savingKey === "fake_otp"}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
                <div className={cn("text-sm font-semibold mt-0.5", fake?.running ? "text-neon-green" : "text-muted-foreground")}>
                  {fake?.running ? "Running" : "Stopped"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fired (session)</div>
                <div className="text-sm font-semibold mt-0.5 font-mono">{fake?.total_fired ?? 0}</div>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total in DB</div>
                <div className="text-sm font-semibold mt-0.5 font-mono">{fake?.total_in_db ?? 0}</div>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last fire</div>
                <div className="text-sm font-semibold mt-0.5">
                  {fake?.last_fire_at ? `${Math.max(0, Math.round(Date.now()/1000 - fake.last_fire_at))}s ago` : "—"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Min interval (sec)</Label>
                <Input type="number" min={5}
                  value={fakeForm.min_sec}
                  onChange={(e) => setFakeForm({ ...fakeForm, min_sec: +e.target.value })}
                  className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max interval (sec)</Label>
                <Input type="number" min={10}
                  value={fakeForm.max_sec}
                  onChange={(e) => setFakeForm({ ...fakeForm, max_sec: +e.target.value })}
                  className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Burst (1–5)</Label>
                <Input type="number" min={1} max={5}
                  value={fakeForm.burst}
                  onChange={(e) => setFakeForm({ ...fakeForm, burst: Math.max(1, Math.min(5, +e.target.value)) })}
                  className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <Button onClick={() => saveFake()} disabled={savingKey === "fake_otp"}
                className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
                {savingKey === "fake_otp" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save settings
              </Button>
              <Button variant="outline" onClick={async () => {
                try {
                  await api.fakeOtp.fireNow();
                  toast({ title: "Fired one fake OTP" });
                  qc.invalidateQueries({ queryKey: ["admin-fake-otp"] });
                } catch (e) { toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }); }
              }} className="border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10">
                <Zap className="w-4 h-4 mr-1.5" /> Fire one now
              </Button>
              <Button variant="outline" onClick={async () => {
                if (!confirm(`Delete ALL ${fake?.total_in_db ?? 0} fake CDR rows? This cannot be undone.`)) return;
                try {
                  const r = await api.fakeOtp.purge();
                  toast({ title: `Purged ${r.removed} rows` });
                  qc.invalidateQueries({ queryKey: ["admin-fake-otp"] });
                } catch (e) { toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }); }
              }} className="border-destructive/30 text-destructive hover:bg-destructive/10 ml-auto">
                <Trash2 className="w-4 h-4 mr-1.5" /> Purge all fake CDR
              </Button>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ============ BOTS — credentials & cookies ============ */}
        <TabsContent value="bots" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Edit credentials, login URL, cookies and poll interval per bot. Use <span className="text-neon-cyan">Health Check</span> to test the login live before saving.
            </p>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Show passwords</Label>
              <Switch checked={showPw} onCheckedChange={setShowPw} />
            </div>
          </div>

          {/* ─── Seven1Tel ─── */}
          <BotConfigCard
            tone="magenta"
            title="Seven1Tel Bot"
            urlKey="seven1tel_base_url"
            url={seven1Url} setUrl={setSeven1Url}
            user={seven1User} setUser={setSeven1User} userKey="seven1tel_username"
            pass={seven1Pass} setPass={setSeven1Pass} passKey="seven1tel_password"
            cookie={seven1Cookie} setCookie={setSeven1Cookie} cookieKey="seven1tel_cookie_header"
            cookiePlaceholder="PHPSESSID=..."
            cookieHint="Optional. If set, bot uses this cookie instead of running the login form (skips captcha entirely)."
            interval={seven1Interval} setInterval={setSeven1Interval} intervalKey="seven1tel_otp_interval"
            showPw={showPw}
            health={healthState["seven1tel"]}
            onSave={async () => {
              await setSetting("seven1tel_base_url", seven1Url);
              await setSetting("seven1tel_username", seven1User);
              await setSetting("seven1tel_password", seven1Pass);
              await setSetting("seven1tel_cookie_header", seven1Cookie);
              await setSetting("seven1tel_otp_interval", String(seven1Interval));
            }}
            onHealth={() => runHealth("seven1tel")}
            onClearCookies={async () => {
              if (!confirm("Clear saved Seven1Tel session cookie? Next tick re-logs in from scratch.")) return;
              await setSetting("seven1tel_session_cookie", "");
              toast({ title: "Seven1Tel session cleared" });
            }}
            saving={savingKey?.startsWith("seven1tel_") || false}
          />

          {/* ─── XISORA (REST API, token-based) ─── */}
          <BotTokenCard
            tone="cyan"
            title="XISORA Bot"
            subtitle="REST API · token-based · no captcha"
            url={xisoraUrl} setUrl={setXisoraUrl}
            token={xisoraToken} setToken={setXisoraToken}
            interval={xisoraInterval} setInterval={setXisoraInterval}
            showPw={showPw}
            health={healthState["xisora"]}
            onSave={async () => {
              await setSetting("xisora_base_url", xisoraUrl);
              await setSetting("xisora_token", xisoraToken);
              await setSetting("xisora_otp_interval", String(xisoraInterval));
            }}
            onHealth={() => runHealth("xisora")}
            saving={savingKey?.startsWith("xisora_") || false}
          />

          <p className="text-[11px] text-muted-foreground">
            After saving, go to <span className="text-foreground">Bots Control</span> → <span className="text-neon-cyan">Restart</span> so changes take effect right away.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminSettings;

// ───────────────────────────────────────────────────────────────────────
// BotConfigCard — full per-bot config (URL / user / pass / cookie / interval)
// with live Health Check + Save + Clear cookies. Used in the Bots tab.
// ───────────────────────────────────────────────────────────────────────
type BotConfigCardProps = {
  tone: "cyan" | "magenta";
  title: string;
  urlKey: string;
  url: string; setUrl: (v: string) => void;
  user: string; setUser: (v: string) => void; userKey: string;
  pass: string; setPass: (v: string) => void; passKey: string;
  cookie: string; setCookie: (v: string) => void; cookieKey: string;
  cookiePlaceholder: string;
  cookieHint: string;
  interval: number; setInterval: (v: number) => void; intervalKey: string;
  showPw: boolean;
  health?: { ok: boolean; ms: number; error?: string } | "checking";
  saving: boolean;
  onSave: () => Promise<void> | void;
  onHealth: () => void;
  onClearCookies: () => Promise<void> | void;
};

function BotConfigCard(p: BotConfigCardProps) {
  const accent = p.tone === "cyan" ? "text-neon-cyan" : "text-neon-magenta";
  const accentBg = p.tone === "cyan" ? "bg-neon-cyan/10 border-neon-cyan/20" : "bg-neon-magenta/10 border-neon-magenta/20";
  const checking = p.health === "checking";
  const result = typeof p.health === "object" ? p.health : null;

  return (
    <GlassCard>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <div className={cn("p-2 rounded-lg border mt-0.5", accentBg)}>
            <Bot className={cn("w-4 h-4", accent)} />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{p.title}</h3>
            <a href={p.url} target="_blank" rel="noreferrer"
              className="text-xs text-neon-cyan hover:underline inline-flex items-center gap-1 mt-0.5">
              {p.url || "—"} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Health pill */}
        {result && (
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border",
            result.ok
              ? "bg-neon-green/10 border-neon-green/30 text-neon-green"
              : "bg-destructive/10 border-destructive/30 text-destructive",
          )}>
            {result.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {result.ok ? `Login OK · ${result.ms}ms` : (result.error || "Failed")}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5"><Link2 className="w-3 h-3" /> Login URL</Label>
          <Input value={p.url} onChange={(e) => p.setUrl(e.target.value)}
            placeholder="https://example.com/portal"
            className="bg-white/[0.04] border-white/[0.1] font-mono text-xs" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Username</Label>
            <Input value={p.user} onChange={(e) => p.setUser(e.target.value)}
              className="bg-white/[0.04] border-white/[0.1] font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input type={p.showPw ? "text" : "password"} value={p.pass}
              onChange={(e) => p.setPass(e.target.value)}
              className="bg-white/[0.04] border-white/[0.1] font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Poll interval (sec)</Label>
            <Input type="number" min={3} max={120} value={p.interval}
              onChange={(e) => p.setInterval(Math.max(3, Math.min(120, +e.target.value || 0)))}
              className="bg-white/[0.04] border-white/[0.1] font-mono" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5"><Cookie className="w-3 h-3" /> Manual Cookie header</Label>
          <Textarea value={p.cookie} onChange={(e) => p.setCookie(e.target.value)}
            placeholder={p.cookiePlaceholder}
            className="bg-white/[0.04] border-white/[0.1] min-h-20 font-mono text-xs" />
          <p className="text-[11px] text-muted-foreground">{p.cookieHint}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button onClick={() => p.onSave()} disabled={p.saving}
          className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
          {p.saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          Save all
        </Button>
        <Button variant="outline" onClick={p.onHealth} disabled={checking}
          className="border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10">
          {checking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <HeartPulse className="w-4 h-4 mr-1.5" />}
          {checking ? "Checking…" : "Health Check"}
        </Button>
        <Button variant="outline" onClick={() => p.onClearCookies()}
          className="border-neon-amber/30 text-neon-amber hover:bg-neon-amber/10 ml-auto">
          <Cookie className="w-4 h-4 mr-1.5" /> Clear saved cookies
        </Button>
      </div>
    </GlassCard>
  );
}