import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Withdrawal } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Wallet, Check, X, Clock, CheckCircle2, XCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { GradientMesh, PageHeader, PremiumKpiCard } from "@/components/premium";

const statusBadge = (s: string) => cn(
  "px-2 py-0.5 rounded text-xs font-semibold uppercase",
  s === "pending" && "bg-neon-amber/15 text-neon-amber animate-pulse",
  s === "approved" && "bg-neon-green/15 text-neon-green",
  s === "rejected" && "bg-destructive/15 text-destructive",
);

const AdminWithdrawals = () => {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [q, setQ] = useState("");
  const [reject, setReject] = useState<Withdrawal | null>(null);
  const [approve, setApprove] = useState<Withdrawal | null>(null);
  const [adminNote, setAdminNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-withdrawals", statusFilter],
    queryFn: () => api.withdrawals.all(statusFilter === "all" ? undefined : statusFilter),
    refetchInterval: 15000,
  });

  // Pull live fee % from admin payment config so the UI always matches what the backend will charge.
  const { data: cfg } = useQuery({
    queryKey: ["payment-config"],
    queryFn: () => api.withdrawals.config(),
    staleTime: 30_000,
  });
  const FEE_PERCENT = cfg?.fee_percent ?? 2;

  const all = data?.withdrawals || [];
  const stats = useMemo(() => {
    const pending = all.filter((w) => w.status === "pending");
    return {
      pending: pending.length,
      pendingAmount: pending.reduce((s, w) => s + w.amount_bdt, 0),
      approved: all.filter((w) => w.status === "approved").length,
      rejected: all.filter((w) => w.status === "rejected").length,
    };
  }, [all]);

  const rows = all.filter((w) => !q ||
    w.username?.toLowerCase().includes(q.toLowerCase()) ||
    w.account_number?.toLowerCase().includes(q.toLowerCase()),
  );

  const approveMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => api.withdrawals.approve(id, note),
    onSuccess: () => {
      toast.success("Withdrawal approved & user balance debited");
      qc.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      setApprove(null); setAdminNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => api.withdrawals.reject(id, note),
    onSuccess: () => {
      toast.success("Withdrawal rejected");
      qc.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      setReject(null); setAdminNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Finance"
        title="Withdrawals"
        description="Review, approve and process agent payout requests"
        icon={<Wallet className="w-5 h-5 text-neon-magenta" />}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <PremiumKpiCard label="Pending" value={stats.pending} icon={Clock} tone="magenta" />
        <PremiumKpiCard label="Pending Amount" value={`৳${stats.pendingAmount.toFixed(0)}`} icon={Wallet} tone="cyan" />
        <PremiumKpiCard label="Approved" value={stats.approved} icon={CheckCircle2} tone="green" />
        <PremiumKpiCard label="Rejected" value={stats.rejected} icon={XCircle} tone="magenta" />
      </div>

      <GlassCard className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search username or account…" className="pl-9 bg-white/[0.04] border-white/[0.08]" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 px-3 rounded-md bg-white/[0.04] border border-white/[0.08] text-sm text-foreground"
          >
            <option value="pending">Pending only</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </GlassCard>

      <DataTable
        columns={[
          { key: "created_at", header: "Requested", render: (r) => new Date(r.created_at * 1000).toLocaleString() },
          { key: "username", header: "Agent", render: (r) => <span className="font-semibold">{r.username || `#${r.user_id}`}</span> },
          { key: "method", header: "Method", render: (r) => <span className="capitalize">{r.method}</span> },
          { key: "account_number", header: "Account", render: (r) => (
            <div className="text-xs">
              <div className="font-mono">{r.account_number}</div>
              {r.account_name && <div className="text-muted-foreground">{r.account_name}</div>}
            </div>
          )},
          { key: "amount_bdt", header: "Gross", render: (r) => <span className="font-mono font-bold">৳{r.amount_bdt.toFixed(2)}</span> },
          { key: "net", header: "Net (after 2%)", render: (r) => <span className="font-mono text-neon-green font-bold">৳{(r.amount_bdt * (1 - FEE_PERCENT/100)).toFixed(2)}</span> },
          { key: "status", header: "Status", render: (r) => <span className={statusBadge(r.status)}>{r.status}</span> },
          { key: "note", header: "Note", render: (r) => <span className="text-xs text-muted-foreground">{r.note || "—"}</span> },
          {
            key: "actions",
            header: "",
            render: (r) => r.status === "pending" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => { setApprove(r); setAdminNote(""); }}
                  className="text-neon-green hover:underline text-xs flex items-center gap-1 font-semibold"
                  title="Approve & mark as paid"
                >
                  <Check className="w-3 h-3" /> Approve & Pay
                </button>
                <button
                  onClick={() => { setReject(r); setAdminNote(""); }}
                  className="text-destructive hover:underline text-xs flex items-center gap-1 font-semibold"
                >
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                {r.admin_note || (r.processed_at ? new Date(r.processed_at * 1000).toLocaleDateString() : "—")}
              </span>
            ),
          },
        ]}
        data={rows}
      />
      {isLoading && <p className="text-center text-muted-foreground text-sm">Loading…</p>}

      {/* Approve confirm dialog */}
      <Dialog open={!!approve} onOpenChange={(v) => !v && setApprove(null)}>
        <DialogContent className="glass-card border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neon-green">
              <CheckCircle2 className="w-5 h-5" /> Approve Withdrawal
            </DialogTitle>
          </DialogHeader>
          {approve && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Agent</span><span className="font-semibold">{approve.username}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Method</span><span className="capitalize">{approve.method}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span className="font-mono text-xs">{approve.account_number}</span></div>
                <div className="flex justify-between border-t border-white/[0.06] pt-1 mt-1"><span className="text-muted-foreground">Gross amount</span><span className="font-mono font-bold">৳{approve.amount_bdt.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Service fee ({FEE_PERCENT}%)</span><span className="font-mono text-neon-amber">−৳{(approve.amount_bdt * FEE_PERCENT/100).toFixed(2)}</span></div>
                <div className="flex justify-between text-base"><span className="text-foreground font-semibold">Pay agent</span><span className="font-mono text-neon-green font-bold">৳{(approve.amount_bdt * (1-FEE_PERCENT/100)).toFixed(2)}</span></div>
              </div>
              <p className="text-xs text-muted-foreground">⚠ Send the net amount via {approve.method.toUpperCase()} to the account above, then click confirm to debit balance.</p>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Admin note / Transaction ID (optional)</label>
                <Input value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="bKash TrxID 9A8B7C…" autoFocus />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprove(null)}>Cancel</Button>
            <Button
              onClick={() => approve && approveMut.mutate({ id: approve.id, note: adminNote || undefined })}
              disabled={approveMut.isPending}
              className="bg-neon-green text-background hover:opacity-90"
            >
              {approveMut.isPending ? "Processing…" : "Confirm & Debit Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!reject} onOpenChange={(v) => !v && setReject(null)}>
        <DialogContent className="glass-card border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="w-5 h-5" /> Reject Withdrawal
            </DialogTitle>
          </DialogHeader>
          {reject && (
            <div className="space-y-3 text-sm">
              <p>Reject ৳{reject.amount_bdt.toFixed(2)} request from <span className="font-semibold">{reject.username}</span>? Their balance will <strong>not</strong> be debited.</p>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Reason (shown to agent)</label>
                <Input value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="e.g. Invalid bKash number" autoFocus />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => reject && rejectMut.mutate({ id: reject.id, note: adminNote || undefined })}
              disabled={rejectMut.isPending}
            >
              {rejectMut.isPending ? "Rejecting…" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminWithdrawals;
