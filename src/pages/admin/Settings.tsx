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
import { Settings as SettingsIcon, Save, Loader2, Wrench, UserPlus, Clock, Eye, Bot, Trash2, Zap } from "lucide-react";
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
      </Tabs>
    </div>
  );
};

export default AdminSettings;