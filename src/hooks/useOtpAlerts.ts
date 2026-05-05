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

export type OtpAlertPrefs = { sound: boolean; push: boolean; volume: number };

export const loadOtpPrefs = (): OtpAlertPrefs => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { sound: true, push: true, volume: 70, ...JSON.parse(raw) };
  } catch { /* noop */ }
  return { sound: true, push: true, volume: 70 };
};

export const saveOtpPrefs = (p: OtpAlertPrefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* noop */ }
};

function chime(volume: number) {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, volume / 100)) * 0.35;
    [
      [880, 0.0],
      [1320, 0.12],
      [1760, 0.24],
    ].forEach(([freq, t]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(vol, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.22);
    });
    setTimeout(() => ctx.close(), 800);
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
      if (prefs.sound) chime(prefs.volume);
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
