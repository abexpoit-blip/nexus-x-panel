import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Upload, RefreshCw, Eraser } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Props = {
  rangeId: number | null;
  onClose: () => void;
};

const fmtAgo = (ts: number | null | undefined) => {
  if (!ts) return "—";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export const PoolDialog = ({ rangeId, onClose }: Props) => {
  const open = rangeId !== null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["pool", rangeId],
    queryFn: () => api.admin.poolList(rangeId as number),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  const range = data?.range;
  const rows = data?.rows || [];
  const free = rows.filter(r => r.status === "free").length;
  const alloc = rows.filter(r => r.status === "allocated").length;
  const used = rows.filter(r => r.status === "used").length;

  const submitPaste = async () => {
    if (!rangeId || !paste.trim()) return;
    setBusy(true);
    try {
      const r = await api.admin.poolBulkAdd(rangeId, paste);
      toast({
        title: `Added ${r.added} number${r.added === 1 ? "" : "s"}`,
        description: r.duplicates ? `${r.duplicates} duplicate(s) skipped` : `${r.total_tokens} tokens parsed`,
      });
      setPaste("");
      refetch();
    } catch (e) {
      toast({ title: "Bulk add failed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const deleteOne = async (id: number, force = false) => {
    try {
      await api.admin.poolDelete(id, force);
      refetch();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("allocated") && !force && confirm("Number is allocated. Force delete?")) {
        return deleteOne(id, true);
      }
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    }
  };

  const releaseOne = async (id: number) => {
    try { await api.admin.poolRelease(id); refetch(); }
    catch (e) { toast({ title: "Release failed", description: (e as Error).message, variant: "destructive" }); }
  };

  const purge = async (status: "free" | "used") => {
    if (!rangeId) return;
    if (!confirm(`Purge ALL ${status} numbers from this range? This cannot be undone.`)) return;
    try {
      const r = await api.admin.poolPurge(rangeId, status);
      toast({ title: `Purged ${r.removed} ${status} numbers` });
      refetch();
    } catch (e) {
      toast({ title: "Purge failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Number Pool
            {range && (
              <span className="text-xs font-mono text-muted-foreground">
                · {range.provider} / {range.country_code} / {range.range_label}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge className="bg-neon-green/10 border-neon-green/30 text-neon-green">{free} free</Badge>
          <Badge className="bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan">{alloc} allocated</Badge>
          <Badge className="bg-white/[0.04] border-white/10 text-muted-foreground">{used} used</Badge>
          <Badge className="bg-white/[0.04] border-white/10 text-muted-foreground">{rows.length} total</Badge>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} className="h-7">
              <RefreshCw className="w-3 h-3 mr-1" /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => purge("used")}
              className="h-7 border-neon-amber/30 text-neon-amber hover:bg-neon-amber/10">
              <Eraser className="w-3 h-3 mr-1" /> Purge used
            </Button>
            <Button size="sm" variant="outline" onClick={() => purge("free")}
              className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10">
              <Eraser className="w-3 h-3 mr-1" /> Purge free
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Paste numbers (one per line, or comma/space separated). Format: digits with optional <code className="text-foreground">+</code>.
          </label>
          <Textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"+8801700123456\n+8801700123457\n+8801700123458"}
            rows={4}
            className="bg-white/[0.04] border-white/[0.1] font-mono text-xs"
          />
          <Button onClick={submitPaste} disabled={busy || !paste.trim()}
            className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
            Add to pool
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-white/[0.06] bg-white/[0.02]">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No numbers yet. Paste some above to get started.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/95 backdrop-blur border-b border-white/[0.06]">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">MSISDN</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Allocated to</th>
                  <th className="px-3 py-2">OTPs</th>
                  <th className="px-3 py-2">Last OTP</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-mono text-xs">{n.msisdn}</td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border font-medium",
                        n.status === "free" && "border-neon-green/30 bg-neon-green/10 text-neon-green",
                        n.status === "allocated" && "border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan",
                        n.status === "used" && "border-white/10 bg-white/[0.04] text-muted-foreground",
                      )}>{n.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {n.allocated_username || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{n.otp_count}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtAgo(n.last_otp_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {n.status === "allocated" && (
                          <Button size="sm" variant="ghost" onClick={() => releaseOne(n.id)}
                            className="h-7 px-2 text-xs">Release</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => deleteOne(n.id)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};