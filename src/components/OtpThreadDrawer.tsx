import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, MessageSquare, Phone, Clock, Inbox } from "lucide-react";
import { BrandIcon } from "@/components/BrandIcon";
import { cn } from "@/lib/utils";

interface Props {
  allocationId: number | null;
  onClose: () => void;
}

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function highlightOtp(text: string, otp: string | null) {
  if (!otp) return text;
  const parts = text.split(otp);
  if (parts.length < 2) return text;
  return parts.flatMap((p, i) =>
    i < parts.length - 1
      ? [p, <mark key={i} className="bg-neon-green/30 text-neon-green font-bold rounded px-1">{otp}</mark>]
      : [p]
  );
}

export function OtpThreadDrawer({ allocationId, onClose }: Props) {
  const open = allocationId !== null;
  const { data, isLoading, error } = useQuery({
    queryKey: ["number-thread", allocationId],
    queryFn: () => api.numberThread(allocationId!),
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto">
        <SheetHeader className="px-5 py-4 border-b border-white/[0.06] sticky top-0 bg-background/95 backdrop-blur z-10">
          <SheetTitle className="flex items-center gap-2 font-display">
            <MessageSquare className="w-5 h-5 text-primary" />
            SMS Thread
          </SheetTitle>
          {data?.allocation && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-mono text-foreground">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                {data.allocation.phone_number}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                {data.allocation.service_slug && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                    style={{ background: `${data.allocation.service_color || '#3b82f6'}25`, color: data.allocation.service_color || '#3b82f6' }}>
                    <BrandIcon slug={data.allocation.service_slug} fallback={data.allocation.service_icon} size={11} />
                    {data.allocation.service_name}
                  </span>
                )}
                {data.allocation.country_code && <span>{data.allocation.country_code}</span>}
                {data.allocation.operator && <span>· {data.allocation.operator}</span>}
                <span className="ml-auto inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {fmtTime(data.allocation.allocated_at)}
                </span>
              </div>
            </div>
          )}
        </SheetHeader>

        <div className="px-5 py-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-sm text-destructive">Failed to load thread.</div>
          ) : !data?.messages.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <div className="text-sm">No SMS received yet.</div>
              <div className="text-xs mt-1">Messages will appear here as they arrive.</div>
            </div>
          ) : (
            data.messages.map((m, idx) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-xl p-3.5 border space-y-2",
                  m.status === "refunded"
                    ? "bg-destructive/[0.05] border-destructive/20 opacity-70"
                    : idx === 0
                      ? "bg-neon-green/[0.06] border-neon-green/25"
                      : "bg-white/[0.03] border-white/[0.08]"
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] text-muted-foreground font-mono">#{idx + 1}</span>
                    {m.cli && (
                      <span className="px-1.5 py-0.5 rounded-md bg-primary/15 text-primary font-semibold">
                        {m.cli}
                      </span>
                    )}
                    {m.status === "refunded" && (
                      <span className="px-1.5 py-0.5 rounded-md bg-destructive/15 text-destructive font-bold uppercase">
                        Refunded
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground font-mono">{fmtTime(m.created_at)}</span>
                </div>
                {m.sms_text ? (
                  <p className="text-sm text-foreground/95 leading-relaxed whitespace-pre-wrap break-words">
                    {highlightOtp(m.sms_text, m.otp_code)}
                  </p>
                ) : m.otp_code ? (
                  <p className="text-base font-mono font-bold text-neon-green tracking-wider">
                    {m.otp_code}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No SMS body stored.</p>
                )}
                {m.otp_code && m.sms_text && (
                  <div className="text-[11px] text-muted-foreground">
                    Code: <span className="font-mono font-bold text-neon-green">{m.otp_code}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default OtpThreadDrawer;