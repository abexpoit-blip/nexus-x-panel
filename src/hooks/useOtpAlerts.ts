import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

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

export type OtpSoundId = "chime" | "fanfare" | "ding" | "doublebeep" | "pop";
export type OtpAlertPrefs = { sound: boolean; push: boolean; volume: number; soundId?: OtpSoundId };

export const SOUND_OPTIONS: { id: OtpSoundId; label: string; tag?: string }[] = [
  { id: "chime",      label: "Cyber Chime",   tag: "default" },
  { id: "fanfare",    label: "Fanfare (Faaaah)", tag: "popular" },
  { id: "ding",       label: "Crystal Ding" },
  { id: "doublebeep", label: "Double Beep" },
  { id: "pop",        label: "Soft Pop" },
];

export const loadOtpPrefs = (): OtpAlertPrefs => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { sound: true, push: true, volume: 70, soundId: "chime", ...JSON.parse(raw) };
  } catch { /* noop */ }
  return { sound: true, push: true, volume: 70, soundId: "chime" };
};

export const saveOtpPrefs = (p: OtpAlertPrefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* noop */ }
};

/**
 * Play one of the named OTP sound profiles using the Web Audio API
 * (no audio assets needed, ~0KB cost). Volume 0–100.
 */
export function playOtpSound(id: OtpSoundId, volume: number) {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const masterVol = Math.max(0, Math.min(1, volume / 100));

    const tone = (
      freq: number, start: number, dur: number,
      type: OscillatorType = "sine", peak = 0.35
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(peak * masterVol, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.02);
    };

    let total = 0.5;
    switch (id) {
      case "chime":
        tone(880, 0.00, 0.18);
        tone(1320, 0.12, 0.20);
        tone(1760, 0.24, 0.22);
        total = 0.6;
        break;
      case "fanfare":
        // "Faaaah" — bold rising horn, ~0.9s, square+triangle for brassy timbre.
        tone(523.25, 0.00, 0.18, "square",   0.18); // C5
        tone(659.25, 0.16, 0.20, "square",   0.20); // E5
        tone(783.99, 0.34, 0.55, "triangle", 0.36); // G5 sustain
        tone(1046.5, 0.34, 0.55, "sine",     0.22); // C6 octave shimmer
        total = 1.0;
        break;
      case "ding":
        tone(1568, 0.00, 0.55, "sine", 0.32);   // bell G6
        tone(2349, 0.00, 0.40, "sine", 0.18);   // overtone
        total = 0.65;
        break;
      case "doublebeep":
        tone(1200, 0.00, 0.10, "square", 0.30);
        tone(1200, 0.16, 0.10, "square", 0.30);
        total = 0.35;
        break;
      case "pop":
        tone(440, 0.00, 0.06, "sine", 0.40);
        tone(880, 0.04, 0.08, "sine", 0.32);
        total = 0.2;
        break;
    }
    setTimeout(() => ctx.close(), Math.ceil(total * 1000) + 200);
  } catch { /* noop */ }
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
