import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GradientMesh, PageHeader } from "@/components/premium";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis,
} from "@/components/ui/pagination";
import { History, Search, RotateCw, Loader2, MessageSquare, X, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageParam } from "@/hooks/usePageParam";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

const fmtDate = (s: string) => {
  if (!s) return "—";
  // Server returns "YYYY-MM-DD HH:mm:ss" — render compact
  return s.replace("T", " ").slice(0, 19);
};

const OtpCopyChip = ({ code }: { code: string }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast({ title: "OTP copied", description: code });
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copy OTP"
      className={cn(
        "inline-flex items-center gap-1 align-middle px-2 py-0.5 rounded-md border font-mono font-bold transition-all",
        "border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20",
        copied && "border-neon-green/40 bg-neon-green/15 text-neon-green",
      )}
    >
      <span>{code}</span>
      {copied
        ? <Check className="w-3 h-3" />
        : <Copy className="w-3 h-3 opacity-70" />}
    </button>
  );
};

const renderMessage = (msg: string | null) => {
  if (!msg) return "—";
  const parts = msg.split(/(\b\d{4,8}\b)/g);
  return parts.map((p, i) =>
    /^\d{4,8}$/.test(p)
      ? <OtpCopyChip key={i} code={p} />
      : <span key={i}>{p}</span>
  );
};

const SMSHadiHistory = () => {
  const [page, setPage] = usePageParam("page", 1);

  // Filters (debounced into "applied" state for query keys)
  const [number, setNumber] = useState("");
  const [cli, setCli] = useState("");
  const [range, setRange] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [applied, setApplied] = useState({ number: "", cli: "", range: "", from: "", to: "" });

  // Push filters → applied with a small debounce
  useEffect(() => {
    const id = setTimeout(() => {
      setApplied({ number, cli, range, from, to });
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, cli, range, from, to]);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-smshadi-cdr", page, applied],
    queryFn: () => api.admin.smshadiCdr({
      page,
      page_size: PAGE_SIZE,
      number: applied.number || undefined,
      cli: applied.cli || undefined,
      range: applied.range || undefined,
      from: applied.from || undefined,
      to: applied.to || undefined,
    }),
    // No 15s portal rate-limit on Hadi → safe to refresh frequently.
    // We still avoid hammering: 8s background refresh, paused when tab hidden.
    refetchInterval: 8_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const rows = data?.rows ?? [];
  const totalPages = data?.total_pages ?? 1;

  const pageWindow = useMemo(() => {
    const cur = page;
    const last = totalPages;
    const out: (number | "…")[] = [];
    const add = (n: number) => out.push(n);
    if (last <= 7) {
      for (let i = 1; i <= last; i++) add(i);
    } else {
      add(1);
      if (cur > 4) out.push("…");
      for (let i = Math.max(2, cur - 1); i <= Math.min(last - 1, cur + 1); i++) add(i);
      if (cur < last - 3) out.push("…");
      add(last);
    }
    return out;
  }, [page, totalPages]);

  const clearFilters = () => {
    setNumber(""); setCli(""); setRange(""); setFrom(""); setTo("");
  };

  return (
    <div className="relative space-y-5">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="SMS Hadi"
        title="OTP History (SMSCDRReports)"
        description="Live OTP delivery report from the SMS Hadi panel — filter by number, CLI, range or date."
        icon={<History className="w-5 h-5 text-neon-cyan" />}
        actions={
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 glass-strong border-neon-green/30 text-neon-green">
            <MessageSquare className="w-3 h-3" />
            {data?.filtered ?? 0} match{(data?.filtered ?? 0) === 1 ? "" : "es"}
          </Badge>
        }
      />

      {/* Filters */}
      <GlassCard className="!p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Number</label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 8801…" className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">CLI / Sender</label>
            <Input value={cli} onChange={(e) => setCli(e.target.value)} placeholder="WhatsApp, Facebook…" className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Range</label>
            <Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="range label" className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value.replace("T", " "))}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value.replace("T", " "))}
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { setApplied({ number, cli, range, from, to }); setPage(1); refetch(); }}>
            <Search className="w-3.5 h-3.5 mr-1.5" /> Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            <X className="w-3.5 h-3.5 mr-1.5" /> Clear
          </Button>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
            {(isFetching || isLoading) && <Loader2 className="w-3 h-3 animate-spin" />}
            page {page} / {totalPages} · {data?.filtered ?? 0}/{data?.total ?? 0} rows
            <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 px-2">
              <RotateCw className="w-3 h-3 mr-1" /> Refresh
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] border-b border-white/[0.06]">
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Range</th>
                <th className="px-4 py-2.5 font-medium">Number</th>
                <th className="px-4 py-2.5 font-medium">CLI</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading SMS Hadi history…
                </td></tr>
              )}
              {!isLoading && error && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-destructive text-xs font-mono">
                  {(error as Error).message}
                </td></tr>
              )}
              {!isLoading && !error && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-xs">
                  No records match the current filters.
                </td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.date}-${r.number}-${i}`} className={cn(
                  "border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors",
                  i % 2 === 1 && "bg-white/[0.015]",
                )}>
                  <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground">{fmtDate(r.date)}</td>
                  <td className="px-4 py-2.5 text-[12px]">{r.range || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-foreground/90">{r.number || "—"}</td>
                  <td className="px-4 py-2.5 text-[12px]">{r.cli || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{r.client || "—"}</td>
                  <td className="px-4 py-2.5 text-[12px] max-w-[480px] break-words leading-relaxed">{renderMessage(r.message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-white/[0.06] py-3">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (page > 1) setPage(page - 1); }}
                    className={cn(page === 1 && "pointer-events-none opacity-40")}
                  />
                </PaginationItem>
                {pageWindow.map((p, i) => p === "…" ? (
                  <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={(e) => { e.preventDefault(); setPage(p); }}
                    >{p}</PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                    className={cn(page === totalPages && "pointer-events-none opacity-40")}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default SMSHadiHistory;