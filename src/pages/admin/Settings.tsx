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
import { Settings as SettingsIcon, Save, Loader2, Wrench, UserPlus, Clock, Eye, Bot, Trash2, Zap, KeyRound, Cookie, ExternalLink, HeartPulse, CheckCircle2, AlertTriangle, Link2, Gauge, Music, Play } from "lucide-react";
import { SOUND_OPTIONS, playOtpSound, type OtpSoundId } from "@/hooks/useOtpAlerts";
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
  const {
    data: rangesData,
    isLoading: rangesLoading,
    isError: rangesError,
    refetch: refetchRanges,
  } = useQuery({
    queryKey: ["admin-fake-otp-ranges"],
    queryFn: () => api.admin.rangesList({}),
    staleTime: 60_000,
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
  const [otpMin, setOtpMin] = useState<number>(10);
  const [recentHrs, setRecentHrs] = useState<number>(24);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [rlPerMin, setRlPerMin] = useState<number>(12);
  const [rlConcurrent, setRlConcurrent] = useState<number>(5);
  const [otpSound, setOtpSound] = useState<OtpSoundId>("faaaah");

  // Agent policy: daily-limit + min-withdrawal enforcement
  const [dailyLimitOn, setDailyLimitOn] = useState(true);
  const [dailyLimitDefault, setDailyLimitDefault] = useState<number>(500);
  const [wdMinOn, setWdMinOn] = useState(true);
  const [wdMin, setWdMin] = useState<number>(300);

  const [fakeForm, setFakeForm] = useState<{
    enabled: boolean; min_sec: number; max_sec: number; burst: number;
    services: string[];     // empty = all services
    range_ids: number[];    // empty = all enabled ranges
  }>({
    enabled: false, min_sec: 30, max_sec: 90, burst: 1,
    services: [], range_ids: [],
  });

  // ---- Bot credentials (mirror keys read by backend/workers/*.js) ----
  const [seven1Url, setSeven1Url] = useState("");
  const [seven1User, setSeven1User] = useState("");
  const [seven1Pass, setSeven1Pass] = useState("");
  const [seven1Cookie, setSeven1Cookie] = useState("");
  const [seven1Interval, setSeven1Interval] = useState<number>(4);
  const [xisoraUrl, setXisoraUrl] = useState("");
  const [xisoraToken, setXisoraToken] = useState("");
  const [xisoraPortalUrl, setXisoraPortalUrl] = useState("");
  const [xisoraUser, setXisoraUser] = useState("");
  const [xisoraPass, setXisoraPass] = useState("");
  const [xisoraCookie, setXisoraCookie] = useState("");
  const [xisoraInterval, setXisoraInterval] = useState<number>(10);
  const [imsUrl, setImsUrl] = useState("");
  const [imsUser, setImsUser] = useState("");
  const [imsPass, setImsPass] = useState("");
  const [imsCookie, setImsCookie] = useState("");
  const [imsInterval, setImsInterval] = useState<number>(18);
  // IMS CDR cooldown / rate-limit backoff (admin-tunable)
  const [imsMinInterval, setImsMinInterval] = useState<number>(16);
  const [imsRlBase, setImsRlBase] = useState<number>(20);
  const [imsRlMax, setImsRlMax] = useState<number>(90);
  const [imsRlSteps, setImsRlSteps] = useState<number>(4);
  const [imsRlReloginThreshold, setImsRlReloginThreshold] = useState<number>(6);
  // IMS Bot #2 — second imssms.org account, fully independent settings.
  const [ims2Url, setIms2Url] = useState("");
  const [ims2User, setIms2User] = useState("");
  const [ims2Pass, setIms2Pass] = useState("");
  const [ims2Cookie, setIms2Cookie] = useState("");
  const [ims2Interval, setIms2Interval] = useState<number>(18);
  // SMS Hadi (2.59.169.96/ints)
  const [hadiUrl, setHadiUrl] = useState("");
  const [hadiUser, setHadiUser] = useState("");
  const [hadiPass, setHadiPass] = useState("");
  const [hadiCookie, setHadiCookie] = useState("");
  const [hadiInterval, setHadiInterval] = useState<number>(4);
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
    setXisoraPortalUrl(str(s, "xisora_portal_url", "http://94.23.31.29/sms"));
    setXisoraUser(str(s, "xisora_username", "mamun33"));
    setXisoraPass(str(s, "xisora_password", "mamun@12aa"));
    setXisoraCookie(str(s, "xisora_cookie_header"));
    setXisoraInterval(Number(str(s, "xisora_otp_interval", "10")) || 10);
    setImsUrl(str(s, "ims_base_url", "https://www.imssms.org"));
    setImsUser(str(s, "ims_username"));
    setImsPass(str(s, "ims_password"));
    setImsCookie(str(s, "ims_cookie_header"));
    setImsInterval(Number(str(s, "ims_otp_interval", "18")) || 18);
    setImsMinInterval(Number(str(s, "ims_cdr_min_interval_sec", "16")) || 16);
    setImsRlBase(Number(str(s, "ims_rl_penalty_base_sec", "20")) || 20);
    setImsRlMax(Number(str(s, "ims_rl_penalty_max_sec", "90")) || 90);
    setImsRlSteps(Number(str(s, "ims_rl_penalty_steps", "4")) || 4);
    setImsRlReloginThreshold(Number(str(s, "ims_rl_relogin_threshold", "6")) || 6);
    setIms2Url(str(s, "ims2_base_url", "https://www.imssms.org"));
    setIms2User(str(s, "ims2_username", "Nexusx0"));
    setIms2Pass(str(s, "ims2_password", "Nexusx0"));
    setIms2Cookie(str(s, "ims2_cookie_header"));
    setIms2Interval(Number(str(s, "ims2_otp_interval", "18")) || 18);
    setHadiUrl(str(s, "smshadi_base_url", "http://2.59.169.96/ints"));
    setHadiUser(str(s, "smshadi_username", "mamun999"));
    setHadiPass(str(s, "smshadi_password", "mamun999"));
    setHadiCookie(str(s, "smshadi_cookie_header"));
    setHadiInterval(Math.max(22, Number(str(s, "smshadi_otp_interval", "24")) || 24));
    setRlPerMin(Number(str(s, "rl_per_min_default", "12")) || 12);
    setRlConcurrent(Number(str(s, "rl_concurrent_default", "5")) || 5);
    setDailyLimitOn(str(s, "daily_limit_enabled", "true") !== "false");
    setDailyLimitDefault(Number(str(s, "daily_limit_default", "500")) || 500);
    setWdMinOn(str(s, "wd_min_enabled", "true") !== "false");
    setWdMin(Number(str(s, "wd_min_bdt", "300")) || 300);
    // Sound is now a single premium "Faaaah" — legacy stored values collapse.
    setOtpSound("faaaah");
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
      services: Array.isArray(fake.services) ? fake.services : [],
      range_ids: Array.isArray(fake.range_ids) ? fake.range_ids : [],
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

          <GlassCard>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-neon-amber/10 border border-neon-amber/20 mt-0.5">
                <Gauge className="w-4 h-4 text-neon-amber" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Agent Rate Limits (global default)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Applies to every agent unless overridden per-agent in the Agents page. Protects pools from abuse and runaway scripts.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Max numbers / minute</Label>
                <Input type="number" min={1} max={500} value={rlPerMin}
                  onChange={(e) => setRlPerMin(+e.target.value)}
                  className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max concurrent active</Label>
                <Input type="number" min={1} max={500} value={rlConcurrent}
                  onChange={(e) => setRlConcurrent(+e.target.value)}
                  className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button onClick={async () => {
                setSavingKey("rl_defaults");
                try {
                  await api.settings.set("rl_per_min_default", String(rlPerMin));
                  await api.settings.set("rl_concurrent_default", String(rlConcurrent));
                  toast({ title: "Rate limits saved" });
                  qc.invalidateQueries({ queryKey: ["admin-settings"] });
                } catch (e) {
                  toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
                } finally { setSavingKey(null); }
              }} disabled={savingKey === "rl_defaults"}
                className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
                {savingKey === "rl_defaults" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save defaults
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 mt-0.5">
                <Gauge className="w-4 h-4 text-neon-cyan" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Agent Policy</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daily OTP cap (counts received OTPs, not allocations) and the minimum agent withdrawal amount. Flip a switch off to disable enforcement entirely.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">Daily OTP limit</div>
                  <div className="text-xs text-muted-foreground">Caps every agent at N successful OTPs per day.</div>
                </div>
                <Switch
                  checked={dailyLimitOn}
                  onCheckedChange={(v) => { setDailyLimitOn(v); setSetting("daily_limit_enabled", v); }}
                  disabled={savingKey === "daily_limit_enabled"}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Default OTP / day per agent</Label>
                  <Input type="number" min={1} max={100000} value={dailyLimitDefault}
                    onChange={(e) => setDailyLimitDefault(+e.target.value)}
                    disabled={!dailyLimitOn}
                    className="bg-white/[0.04] border-white/[0.1] font-mono" />
                </div>
                <Button size="sm" variant="outline"
                  onClick={() => setSetting("daily_limit_default", String(Math.max(1, dailyLimitDefault | 0)))}
                  disabled={savingKey === "daily_limit_default"}
                  className="border-white/[0.1]">
                  {savingKey === "daily_limit_default" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                  Save
                </Button>
              </div>

              <div className="h-px bg-white/[0.06]" />

              <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">Minimum withdrawal</div>
                  <div className="text-xs text-muted-foreground">Blocks payout requests below the floor.</div>
                </div>
                <Switch
                  checked={wdMinOn}
                  onCheckedChange={(v) => { setWdMinOn(v); setSetting("wd_min_enabled", v); }}
                  disabled={savingKey === "wd_min_enabled"}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum withdrawal (৳ BDT)</Label>
                  <Input type="number" min={1} max={1000000} value={wdMin}
                    onChange={(e) => setWdMin(+e.target.value)}
                    disabled={!wdMinOn}
                    className="bg-white/[0.04] border-white/[0.1] font-mono" />
                </div>
                <Button size="sm" variant="outline"
                  onClick={() => setSetting("wd_min_bdt", String(Math.max(1, wdMin | 0)))}
                  disabled={savingKey === "wd_min_bdt"}
                  className="border-white/[0.1]">
                  {savingKey === "wd_min_bdt" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                  Save
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-neon-magenta/10 border border-neon-magenta/20 mt-0.5">
                <Music className="w-4 h-4 text-neon-magenta" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">OTP Notification Sound (default)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Suggested sound for new agents. Each agent can override in their Profile → Security.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {SOUND_OPTIONS.map((s) => {
                const active = otpSound === s.id;
                return (
                  <button key={s.id} type="button" onClick={() => setOtpSound(s.id)}
                    className={cn(
                      "flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-all text-left",
                      active
                        ? "bg-primary/10 border-primary/40 text-foreground shadow-[0_0_18px_-6px_hsl(var(--primary)/0.7)]"
                        : "bg-white/[0.02] border-white/[0.08] text-muted-foreground hover:text-foreground"
                    )}>
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {s.label}
                      {s.tag === "popular" && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-neon-magenta/15 text-neon-magenta border border-neon-magenta/30">NEW</span>
                      )}
                      {s.tag === "default" && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30">default</span>
                      )}
                    </div>
                    <span role="button" onClick={(e) => { e.stopPropagation(); playOtpSound(s.id, 70); }}
                      className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.04] hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors">
                      <Play className="w-3.5 h-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-3">
              <Button onClick={async () => {
                setSavingKey("otp_sound_default");
                try {
                  await api.settings.set("otp_sound_default", otpSound);
                  toast({ title: "Default sound saved" });
                  qc.invalidateQueries({ queryKey: ["admin-settings"] });
                } catch (e) {
                  toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
                } finally { setSavingKey(null); }
              }} disabled={savingKey === "otp_sound_default"}
                className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
                {savingKey === "otp_sound_default" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save default sound
              </Button>
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

            {/* Service mix */}
            <div className="mt-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Services to broadcast</Label>
                <button
                  type="button"
                  onClick={() => setFakeForm({ ...fakeForm, services: [] })}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded-md border",
                    fakeForm.services.length === 0
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                  )}
                >
                  All mix
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/80 mb-2">
                Pick which services the fake feed will simulate. Empty = all mix.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["WhatsApp","Telegram","Facebook","Google","Instagram","TikTok","Apple","Microsoft","Amazon","Discord","Twitter","PayPal","Uber","Signal"].map((svc) => {
                  const lower = svc.toLowerCase();
                  const active = fakeForm.services.some(x => x.toLowerCase() === lower);
                  return (
                    <button key={svc} type="button"
                      onClick={() => {
                        const cur = [...fakeForm.services];
                        const i = cur.findIndex(x => x.toLowerCase() === lower);
                        if (i >= 0) cur.splice(i, 1); else cur.push(lower);
                        setFakeForm({ ...fakeForm, services: cur });
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-medium border",
                        active
                          ? "bg-neon-magenta/15 border-neon-magenta/40 text-neon-magenta"
                          : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {svc}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Range targeting */}
            <div className="mt-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Target ranges</Label>
                <button
                  type="button"
                  onClick={() => setFakeForm({ ...fakeForm, range_ids: [] })}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded-md border",
                    fakeForm.range_ids.length === 0
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                  )}
                >
                  Any enabled range
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/80 mb-2">
                Restrict fakes to specific ranges (e.g. push fakes only into your "hot" ranges). Empty = any enabled.
              </p>
              <div className="max-h-44 overflow-auto pr-1 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {rangesLoading && (
                  <div className="col-span-full flex items-center gap-2 text-[11px] text-muted-foreground py-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading ranges…
                  </div>
                )}
                {rangesError && !rangesLoading && (
                  <div className="col-span-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-[11px] text-destructive">
                    <span>Couldn't load ranges.</span>
                    <button
                      type="button"
                      onClick={() => refetchRanges()}
                      className="px-2 py-0.5 rounded border border-destructive/40 hover:bg-destructive/20"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!rangesLoading && !rangesError && (rangesData?.rows || []).filter((r: any) => r.enabled).map((r: any) => {
                  const active = fakeForm.range_ids.includes(r.id);
                  return (
                    <button key={r.id} type="button"
                      onClick={() => {
                        const cur = [...fakeForm.range_ids];
                        const i = cur.indexOf(r.id);
                        if (i >= 0) cur.splice(i, 1); else cur.push(r.id);
                        setFakeForm({ ...fakeForm, range_ids: cur });
                      }}
                      className={cn(
                        "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[11px] border text-left",
                        active
                          ? "bg-neon-cyan/10 border-neon-cyan/40 text-neon-cyan"
                          : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="truncate">
                        <span className="font-mono">{r.country_code}</span> · {r.range_label || r.operator || r.range_prefix}
                      </span>
                      <span className="text-[10px] opacity-60">{r.provider}</span>
                    </button>
                  );
                })}
                {!rangesLoading && !rangesError && !(rangesData?.rows || []).filter((r: any) => r.enabled).length && (
                  <p className="col-span-full text-[11px] text-muted-foreground/60 py-2">No enabled ranges yet — add one in Provider Ranges first.</p>
                )}
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
            subtitle="Uses API token when available; otherwise uses portal cookie fallback."
            url={xisoraUrl} setUrl={setXisoraUrl}
            token={xisoraToken} setToken={setXisoraToken}
            portalUrl={xisoraPortalUrl} setPortalUrl={setXisoraPortalUrl}
            user={xisoraUser} setUser={setXisoraUser}
            pass={xisoraPass} setPass={setXisoraPass}
            cookie={xisoraCookie} setCookie={setXisoraCookie}
            interval={xisoraInterval} setInterval={setXisoraInterval}
            showPw={showPw}
            health={healthState["xisora"]}
            onSave={async () => {
              await setSetting("xisora_base_url", xisoraUrl);
              await setSetting("xisora_token", xisoraToken);
              await setSetting("xisora_portal_url", xisoraPortalUrl);
              await setSetting("xisora_username", xisoraUser);
              await setSetting("xisora_password", xisoraPass);
              await setSetting("xisora_cookie_header", xisoraCookie);
              await setSetting("xisora_otp_interval", String(xisoraInterval));
            }}
            onHealth={() => runHealth("xisora")}
            onClearCookies={async () => {
              if (!confirm("Clear saved XISORA portal session cookie?")) return;
              await setSetting("xisora_session_cookie", "");
              toast({ title: "XISORA session cleared" });
            }}
            saving={savingKey?.startsWith("xisora_") || false}
          />

          {/* ─── IMS (imssms.org — 15s rate-limit aware) ─── */}
          <BotConfigCard
            tone="magenta"
            title="IMS Bot (imssms.org)"
            urlKey="ims_base_url"
            url={imsUrl} setUrl={setImsUrl}
            user={imsUser} setUser={setImsUser} userKey="ims_username"
            pass={imsPass} setPass={setImsPass} passKey="ims_password"
            cookie={imsCookie} setCookie={setImsCookie} cookieKey="ims_cookie_header"
            cookiePlaceholder="PHPSESSID=..."
            cookieHint="Optional. If set, bot uses this cookie instead of running the captcha login. Min poll interval is 16s — IMS portal warns at <15s."
            interval={imsInterval} setInterval={setImsInterval} intervalKey="ims_otp_interval"
            showPw={showPw}
            health={healthState["ims"]}
            onSave={async () => {
              await setSetting("ims_base_url", imsUrl);
              await setSetting("ims_username", imsUser);
              await setSetting("ims_password", imsPass);
              await setSetting("ims_cookie_header", imsCookie);
              await setSetting("ims_otp_interval", String(Math.max(16, imsInterval)));
            }}
            onHealth={() => runHealth("ims")}
            onClearCookies={async () => {
              if (!confirm("Clear saved IMS session cookie? Next tick re-logs in via captcha.")) return;
              await setSetting("ims_session_cookie", "");
              toast({ title: "IMS session cleared" });
            }}
            saving={savingKey?.startsWith("ims_") || false}
          />

          {/* ─── IMS Bot #2 (second imssms.org account — fully independent) ─── */}
          <BotConfigCard
            tone="magenta"
            title="IMS Bot 2 (imssms.org — 2nd account)"
            urlKey="ims2_base_url"
            url={ims2Url} setUrl={setIms2Url}
            user={ims2User} setUser={setIms2User} userKey="ims2_username"
            pass={ims2Pass} setPass={setIms2Pass} passKey="ims2_password"
            cookie={ims2Cookie} setCookie={setIms2Cookie} cookieKey="ims2_cookie_header"
            cookiePlaceholder="PHPSESSID=..."
            cookieHint="Second imssms.org account. Independent session — won't conflict with IMS Bot #1. Min interval 16s."
            interval={ims2Interval} setInterval={setIms2Interval} intervalKey="ims2_otp_interval"
            showPw={showPw}
            health={healthState["ims2"]}
            onSave={async () => {
              await setSetting("ims2_base_url", ims2Url);
              await setSetting("ims2_username", ims2User);
              await setSetting("ims2_password", ims2Pass);
              await setSetting("ims2_cookie_header", ims2Cookie);
              await setSetting("ims2_otp_interval", String(Math.max(16, ims2Interval)));
            }}
            onHealth={() => runHealth("ims2")}
            onClearCookies={async () => {
              if (!confirm("Clear saved IMS Bot 2 session cookie? Next tick re-logs in via captcha.")) return;
              await setSetting("ims2_session_cookie", "");
              toast({ title: "IMS 2 session cleared" });
            }}
            saving={savingKey?.startsWith("ims2_") || false}
          />

          {/* ─── SMS Hadi (2.59.169.96/ints — provider enforces 15s+ CDR refresh gap) ─── */}
          <BotConfigCard
            tone="cyan"
            title="SMS Hadi Bot (2.59.169.96/ints)"
            urlKey="smshadi_base_url"
            url={hadiUrl} setUrl={setHadiUrl}
            user={hadiUser} setUser={setHadiUser} userKey="smshadi_username"
            pass={hadiPass} setPass={setHadiPass} passKey="smshadi_password"
            cookie={hadiCookie} setCookie={setHadiCookie} cookieKey="smshadi_cookie_header"
            cookiePlaceholder="PHPSESSID=..."
            cookieHint="Optional. If set, bot uses this cookie instead of running the captcha login. Provider requires a safe 22s+ CDR interval."
            interval={hadiInterval} setInterval={setHadiInterval} intervalKey="smshadi_otp_interval"
            showPw={showPw}
            health={healthState["smshadi"]}
            onSave={async () => {
              await setSetting("smshadi_base_url", hadiUrl);
              await setSetting("smshadi_username", hadiUser);
              await setSetting("smshadi_password", hadiPass);
              await setSetting("smshadi_cookie_header", hadiCookie);
              await setSetting("smshadi_otp_interval", String(Math.max(22, hadiInterval)));
            }}
            onHealth={() => runHealth("smshadi")}
            onClearCookies={async () => {
              if (!confirm("Clear saved SMS Hadi session cookie + sesskey? Next tick re-logs in.")) return;
              await setSetting("smshadi_session_cookie", "");
              await setSetting("smshadi_sesskey", "");
              toast({ title: "SMS Hadi session cleared" });
            }}
            saving={savingKey?.startsWith("smshadi_") || false}
          />

          {/* ─── IMS CDR cooldown / backoff (no redeploy needed) ─── */}
          <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-bold tracking-wide text-foreground">IMS CDR Cooldown & Backoff</h4>
              <p className="text-[11px] text-muted-foreground mt-1">
                Tune how the IMS bot paces CDR refreshes and recovers from <span className="text-neon-magenta">rate_limited</span> errors.
                Floor is 15s — IMS portal warns at &lt;15s. Changes apply on the next tick (no restart needed).
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Min interval (sec)</span>
                <input type="number" min={15} max={120}
                  className="w-full bg-background/60 border border-border/60 rounded-md px-2 py-1.5 text-sm"
                  value={imsMinInterval}
                  onChange={(e) => setImsMinInterval(Number(e.target.value) || 16)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Penalty base (sec)</span>
                <input type="number" min={5} max={300}
                  className="w-full bg-background/60 border border-border/60 rounded-md px-2 py-1.5 text-sm"
                  value={imsRlBase}
                  onChange={(e) => setImsRlBase(Number(e.target.value) || 20)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Penalty max (sec)</span>
                <input type="number" min={10} max={600}
                  className="w-full bg-background/60 border border-border/60 rounded-md px-2 py-1.5 text-sm"
                  value={imsRlMax}
                  onChange={(e) => setImsRlMax(Number(e.target.value) || 90)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Penalty steps</span>
                <input type="number" min={1} max={10}
                  className="w-full bg-background/60 border border-border/60 rounded-md px-2 py-1.5 text-sm"
                  value={imsRlSteps}
                  onChange={(e) => setImsRlSteps(Number(e.target.value) || 4)}
                />
              </label>
              <label className="space-y-1 text-xs col-span-2 md:col-span-4">
                <span className="text-muted-foreground">
                  Auto re-login after N consecutive rate-limit hits
                  <span className="ml-1 text-[10px] text-neon-magenta">(clears stale PHPSESSID, runs captcha login)</span>
                </span>
                <input type="number" min={2} max={30}
                  className="w-full bg-background/60 border border-border/60 rounded-md px-2 py-1.5 text-sm"
                  value={imsRlReloginThreshold}
                  onChange={(e) => setImsRlReloginThreshold(Number(e.target.value) || 6)}
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={savingKey?.startsWith("ims_cdr_") || savingKey?.startsWith("ims_rl_")}
                className="px-3 py-1.5 rounded-md bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan text-xs font-bold hover:bg-neon-cyan/20 disabled:opacity-50"
                onClick={async () => {
                  await setSetting("ims_cdr_min_interval_sec", String(Math.max(15, imsMinInterval)));
                  await setSetting("ims_rl_penalty_base_sec", String(Math.max(1, imsRlBase)));
                  await setSetting("ims_rl_penalty_max_sec", String(Math.max(imsRlBase, imsRlMax)));
                  await setSetting("ims_rl_penalty_steps", String(Math.max(1, Math.floor(imsRlSteps))));
                  await setSetting("ims_rl_relogin_threshold", String(Math.max(2, Math.floor(imsRlReloginThreshold))));
                  toast({ title: "IMS cooldown updated" });
                }}
              >
                Save cooldown
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-border/60 text-xs hover:bg-card/60"
                onClick={() => {
                  setImsMinInterval(16); setImsRlBase(20); setImsRlMax(90); setImsRlSteps(4); setImsRlReloginThreshold(6);
                }}
              >
                Reset defaults
              </button>
            </div>
          </div>

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

// ───────────────────────────────────────────────────────────────────────
// BotTokenCard — XISORA config for API token plus portal-cookie fallback.
// ───────────────────────────────────────────────────────────────────────
type BotTokenCardProps = {
  tone: "cyan" | "magenta";
  title: string;
  subtitle?: string;
  url: string; setUrl: (v: string) => void;
  token: string; setToken: (v: string) => void;
  portalUrl: string; setPortalUrl: (v: string) => void;
  user: string; setUser: (v: string) => void;
  pass: string; setPass: (v: string) => void;
  cookie: string; setCookie: (v: string) => void;
  interval: number; setInterval: (v: number) => void;
  showPw: boolean;
  health?: { ok: boolean; ms: number; error?: string } | "checking";
  saving: boolean;
  onSave: () => Promise<void> | void;
  onHealth: () => void;
  onClearCookies: () => Promise<void> | void;
};

function BotTokenCard(p: BotTokenCardProps) {
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
            {p.subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{p.subtitle}</p>
            )}
          </div>
        </div>

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
          <Label className="text-xs flex items-center gap-1.5"><Link2 className="w-3 h-3" /> API endpoint</Label>
          <Input value={p.url} onChange={(e) => p.setUrl(e.target.value)}
            placeholder="http://host/crapi/reseller/mdr.php"
            className="bg-white/[0.04] border-white/[0.1] font-mono text-xs" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5"><KeyRound className="w-3 h-3" /> API token</Label>
            <Input
              type={p.showPw ? "text" : "password"}
              value={p.token}
              onChange={(e) => p.setToken(e.target.value)}
              placeholder="QlBUQUNSfkJYUUYQS…"
              className="bg-white/[0.04] border-white/[0.1] font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Optional. If empty, the bot uses the portal cookie fallback below.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Poll interval (sec)</Label>
            <Input type="number" min={5} max={120} value={p.interval}
              onChange={(e) => p.setInterval(Math.max(5, Math.min(120, +e.target.value || 0)))}
              className="bg-white/[0.04] border-white/[0.1] font-mono" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5"><Link2 className="w-3 h-3" /> Portal URL</Label>
            <Input value={p.portalUrl} onChange={(e) => p.setPortalUrl(e.target.value)}
              placeholder="http://94.23.31.29/sms"
              className="bg-white/[0.04] border-white/[0.1] font-mono text-xs" />
          </div>
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
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5"><Cookie className="w-3 h-3" /> Portal cookie header</Label>
          <Textarea value={p.cookie} onChange={(e) => p.setCookie(e.target.value)}
            placeholder="PHPSESSID=..."
            className="bg-white/[0.04] border-white/[0.1] min-h-20 font-mono text-xs" />
          <p className="text-[11px] text-muted-foreground">Paste the cookie from a logged-in XISORA portal session when no API token is available.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button onClick={() => p.onSave()} disabled={p.saving}
          className="bg-gradient-to-r from-primary to-neon-cyan text-primary-foreground border-0">
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