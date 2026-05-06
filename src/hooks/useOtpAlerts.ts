import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import faaahMp3 from "@/assets/sounds/faaah.mp3";

/**
 * useOtpAlerts — agent-side ambient watcher.
 *
 * Polls /api/numbers/my every 5s and fires:
 *   • A two-tone chime (Web Audio — no asset needed)
 *   • A browser Notification (if permission granted)
 *   • A toast as fallback
 * whenever a NEW OTP arrives on one of the agent's allocations.
 *
 * Preferences are stored in localStorage under nexus_otp_alert_prefs:
 *   { sound: boolean, push: boolean, volume: 0..100 }
 */

const PREFS_KEY = "nexus_otp_alert_prefs";

// Premium single-sound mode: every OTP plays the viral "Faaaah" fanfare
// (the TikTok/Facebook horn-stab that became a meme in early 2026).
// We keep the OtpSoundId union as a single literal for backward-compat
// with stored prefs, but every value collapses to the same player.
export type OtpSoundId = "faaaah" | "chime" | "pop";
export type OtpAlertPrefs = { sound: boolean; push: boolean; volume: number; soundId?: OtpSoundId };

export const SOUND_OPTIONS: { id: OtpSoundId; label: string; tag?: string }[] = [
  { id: "faaaah", label: "Faaaah (viral)", tag: "premium" },
  { id: "chime",  label: "Smooth Chime",   tag: "smart" },
  { id: "pop",    label: "Soft Pop",       tag: "subtle" },
];

const VALID_IDS: OtpSoundId[] = ["faaaah", "chime", "pop"];
const isValidId = (v: any): v is OtpSoundId => VALID_IDS.includes(v);

export const loadOtpPrefs = (): OtpAlertPrefs => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const soundId: OtpSoundId = isValidId(parsed?.soundId) ? parsed.soundId : "faaaah";
      return { sound: true, push: true, volume: 70, ...parsed, soundId };
    }
  } catch { /* noop */ }
  return { sound: true, push: true, volume: 70, soundId: "faaaah" };
};

export const saveOtpPrefs = (p: OtpAlertPrefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* noop */ }
};

/**
 * Play the premium "Faaaah" viral horn — a brassy 2-stab + sustained
 * fall, synthesised in pure Web Audio (no asset, ~0 KB).
 * `_id` kept for back-compat with old call sites.
 */
/** Smooth two-note chime — rounded sine bell. */
function playChime(volume: number) {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const v = Math.max(0, Math.min(1, volume / 100));
    const tone = (freq: number, start: number, dur: number, peak = 0.28) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(peak * v, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + start); osc.stop(t0 + start + dur + 0.02);
    };
    tone(880, 0.00, 0.45);     // A5
    tone(1318.5, 0.12, 0.55);  // E6
    tone(1760, 0.18, 0.40, 0.16);
    setTimeout(() => ctx.close(), 900);
  } catch { /* noop */ }
}

/** Subtle, modern "pop" — short blip, perfect for background notifications. */
function playPop(volume: number) {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const v = Math.max(0, Math.min(1, volume / 100));
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(540, t0);
    osc.frequency.exponentialRampToValueAtTime(820, t0 + 0.08);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.32 * v, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.25);
    setTimeout(() => ctx.close(), 400);
  } catch { /* noop */ }
}

/** Plays the uploaded "Faaaah" MP3 (viral horn). */
function playFaaah(volume: number) {
  try {
    const a = new Audio(faaahMp3);
    a.volume = Math.max(0, Math.min(1, volume / 100));
    void a.play().catch(() => { /* autoplay-blocked, ignore */ });
  } catch { /* noop */ }
}

export function playOtpSound(id: OtpSoundId | string, volume: number) {
  const sid: OtpSoundId = isValidId(id) ? id : "faaaah";
  if (sid === "chime") return playChime(volume);
  if (sid === "pop")   return playPop(volume);
  return playFaaah(volume);
}

export const requestPushPermission = async () => {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
};

export function useOtpAlerts(enabled: boolean) {
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  const { data } = useQuery({
    queryKey: ["my-numbers"],
    queryFn: () => api.myNumbers(),
    refetchInterval: enabled ? 5000 : false,
    enabled,
  });

  useEffect(() => {
    if (!enabled || !data?.numbers) return;
    const prefs = loadOtpPrefs();

    // First load — record existing OTPs without alerting (avoid mass-spam on tab open).
    if (!primed.current) {
      data.numbers.forEach((n: any) => { if (n.otp) seen.current.add(n.id); });
      primed.current = true;
      return;
    }

    const fresh = data.numbers.filter((n: any) => n.otp && !seen.current.has(n.id));
    if (!fresh.length) return;

    fresh.forEach((n: any) => {
      seen.current.add(n.id);
      const masked = String(n.phone_number || "").replace(/(?<=^.{6})\d(?=\d{2})/g, "•");
      const body = `${masked}\nOTP: ${n.otp}`;
      if (prefs.sound) playOtpSound(prefs.soundId || "chime", prefs.volume);
      if (prefs.push && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const notif = new Notification("OTP received", { body, tag: `otp-${n.id}`, silent: true });
          notif.onclick = () => { window.focus(); notif.close(); };
        } catch { /* noop */ }
      }
      toast.success("OTP received", { description: body, duration: 6000 });
    });
  }, [data, enabled]);
}
