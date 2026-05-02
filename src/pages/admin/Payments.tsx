import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type PaymentConfig } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Plus, Check, X, Clock, Settings as SettingsIcon, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const METHOD_LABELS: Record<string, string> = {
  bkash: "bKash", nagad: "Nagad", rocket: "Rocket", bank: "Bank Transfer", crypto: "Crypto (USDT)",
};

const statusBadge = (s: string) => cn(
  "px-2 py-0.5 rounded text-xs font-semibold uppercase",
  s === "pending" && "bg-neon-amber/15 text-neon-amber",
  s === "approved" && "bg-neon-green/15 text-neon-green",
  s === "rejected" && "bg-destructive/15 text-destructive",
);

const AdminPayments = () => {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState("manual");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => api.admin.agents() });
  const { data: payData, isLoading } = useQuery({
    queryKey: ["payments-all"], queryFn: () => api.payments.all(), refetchInterval: 30000,
  });
  const { data: pendingData } = useQuery({
    queryKey: ["withdrawals-pending"], queryFn: () => api.withdrawals.pending(), refetchInterval: 15000,
  });
  const { data: allWdData } = useQuery({
    queryKey: ["withdrawals-all"], queryFn: () => api.withdrawals.all(), refetchInterval: 30000,
  });

  const topup = useMutation({
    mutationFn: () => api.payments.topup({
      user_id: Number(userId), amount_bdt: Number(amount),
      method, reference: reference || undefined, note: note || undefined,
    }),
    onSuccess: () => {
      toast.success("Top-up applied");
      setUserId(""); setAmount(""); setReference(""); setNote("");
      qc.invalidateQueries({ queryKey: ["payments-all"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => api.withdrawals.approve(id, note),
    onSuccess: () => {
      toast.success("Withdrawal approved & balance debited");
      qc.invalidateQueries({ queryKey: ["withdrawals-pending"] });
      qc.invalidateQueries({ queryKey: ["withdrawals-all"] });
      qc.invalidateQueries({ queryKey: ["payments-all"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => api.withdrawals.reject(id, note),
    onSuccess: () => {
      toast.success("Withdrawal rejected");
      qc.invalidateQueries({ queryKey: ["withdrawals-pending"] });
      qc.invalidateQueries({ queryKey: ["withdrawals-all"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pending = pendingData?.withdrawals || [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-2">
            <Wallet className="w-7 h-7 text-neon-amber" /> Payments & Withdrawals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Top-up agents, review withdrawal requests and audit transactions</p>
        </div>
        {pending.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neon-amber/10 border border-neon-amber/30">
            <Clock className="w-4 h-4 text-neon-amber animate-pulse" />
            <span className="text-sm font-semibold text-neon-amber">{pending.length} pending withdrawal{pending.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="approvals" className="w-full">
        <TabsList className="bg-white/[0.04] flex-wrap h-auto">
          <TabsTrigger value="approvals">
            Approval Queue {pending.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-neon-amber/20 text-neon-amber">{pending.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="withdrawals">All Withdrawals</TabsTrigger>
          <TabsTrigger value="topup">Top-up Agent</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="config">
            <SettingsIcon className="w-3.5 h-3.5 mr-1.5" /> Config
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approvals" className="mt-4">
          <DataTable
            columns={[
              { key: "created_at", header: "Requested", render: (r) => new Date(r.created_at * 1000).toLocaleString() },
              { key: "username", header: "Agent", render: (r) => <span className="font-semibold">{r.username || `#${r.user_id}`}</span> },
              { key: "method", header: "Method", render: (r) => <span className="capitalize">{r.method}</span> },
              { key: "account_number", header: "Account", render: (r) => (
                <div className="text-xs">
                  {r.account_name && <div className="text-muted-foreground">{r.account_name}</div>}
                  <div className="font-mono">{r.account_number}</div>
                </div>
              )},
              { key: "amount_bdt", header: "Amount", render: (r) => <span className="font-bold font-mono text-neon-amber">৳{r.amount_bdt.toFixed(2)}</span> },
              { key: "note", header: "Note", render: (r) => <span className="text-xs text-muted-foreground">{r.note || "—"}</span> },
              {
                key: "actions", header: "Actions",
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => approve.mutate({ id: r.id })}
                      className="bg-neon-green/20 text-neon-green hover:bg-neon-green/30 h-8">
                      <Check className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      const reason = window.prompt("Reject reason (optional)") || undefined;
                      reject.mutate({ id: r.id, note: reason });
                    }} className="bg-destructive/20 text-destructive hover:bg-destructive/30 h-8">
                      <X className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                ),
              },
            ]}
            data={pending}
          />
          {pending.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-8">No pending withdrawal requests 🎉</p>
          )}
        </TabsContent>

        <TabsContent value="withdrawals" className="mt-4">
          <DataTable
            columns={[
              { key: "created_at", header: "Date", render: (r) => new Date(r.created_at * 1000).toLocaleString() },
              { key: "username", header: "Agent", render: (r) => r.username || `#${r.user_id}` },
              { key: "method", header: "Method", render: (r) => <span className="capitalize">{r.method}</span> },
              { key: "account_number", header: "Account", render: (r) => <span className="font-mono text-xs">{r.account_number}</span> },
              { key: "amount_bdt", header: "Amount", render: (r) => <span className="font-bold font-mono">৳{r.amount_bdt.toFixed(2)}</span> },
              { key: "status", header: "Status", render: (r) => <span className={statusBadge(r.status)}>{r.status}</span> },
              { key: "admin_note", header: "Admin Note", render: (r) => <span className="text-xs text-muted-foreground">{r.admin_note || "—"}</span> },
            ]}
            data={allWdData?.withdrawals || []}
          />
        </TabsContent>

        <TabsContent value="topup" className="mt-4">
          <GlassCard>
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-neon-green" /> New Top-up</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Agent</label>
                <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full h-10 px-3 rounded-md bg-white/[0.04] border border-white/[0.08]">
                  <option value="">— select —</option>
                  {(agents?.agents || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.username} (৳{a.balance.toFixed(2)})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Amount (৳)</label>
                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full h-10 px-3 rounded-md bg-white/[0.04] border border-white/[0.08]">
                  <option value="manual">Manual</option>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="bank">Bank</option>
                  <option value="crypto">Crypto</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Reference</label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="TX ID" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Note</label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={() => topup.mutate()} disabled={!userId || !amount || topup.isPending} className="bg-primary text-primary-foreground">
                {topup.isPending ? "Applying…" : "Apply Top-up"}
              </Button>
            </div>
          </GlassCard>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <DataTable
            columns={[
              { key: "created_at", header: "Date", render: (r) => new Date(r.created_at * 1000).toLocaleString() },
              { key: "username", header: "Agent", render: (r) => r.username || `#${r.user_id}` },
              {
                key: "type", header: "Type",
                render: (r) => (
                  <span className={cn("px-2 py-0.5 rounded text-xs font-semibold uppercase",
                    r.type === "topup" && "bg-neon-green/15 text-neon-green",
                    r.type === "debit" && "bg-destructive/15 text-destructive",
                    r.type === "refund" && "bg-neon-amber/15 text-neon-amber",
                    r.type === "withdrawal" && "bg-neon-magenta/15 text-neon-magenta",
                    r.type === "credit" && "bg-neon-cyan/15 text-neon-cyan",
                  )}>{r.type}</span>
                ),
              },
              { key: "method", header: "Method", render: (r) => r.method || "—" },
              { key: "reference", header: "Ref", render: (r) => <span className="font-mono text-xs">{r.reference || "—"}</span> },
              {
                key: "amount_bdt", header: "Amount",
                render: (r) => (
                  <span className={cn("font-bold font-mono", r.amount_bdt >= 0 ? "text-neon-green" : "text-destructive")}>
                    {r.amount_bdt >= 0 ? "+" : ""}৳{r.amount_bdt.toFixed(2)}
                  </span>
                ),
              },
              { key: "note", header: "Note", render: (r) => <span className="text-xs text-muted-foreground">{r.note || "—"}</span> },
            ]}
            data={payData?.payments || []}
          />
          {isLoading && <p className="text-center text-muted-foreground text-sm">Loading…</p>}
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <PaymentConfigCard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const PaymentConfigCard = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["payment-config"], queryFn: () => api.withdrawals.config() });
  const [draft, setDraft] = useState<PaymentConfig | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (body: Partial<PaymentConfig>) => api.withdrawals.saveConfig(body),
    onSuccess: (cfg) => {
      toast.success("Payment config saved");
      setDraft(cfg);
      qc.invalidateQueries({ queryKey: ["payment-config"] });
      qc.invalidateQueries({ queryKey: ["wd-policy"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !draft) {
    return <p className="text-center text-muted-foreground text-sm py-8">Loading config…</p>;
  }

  const setMethod = (m: string, on: boolean) =>
    setDraft({ ...draft, methods: { ...draft.methods, [m]: on } });

  const allMethods = draft.all_methods?.length ? draft.all_methods : Object.keys(draft.methods);
  const enabledCount = allMethods.filter((m) => draft.methods[m]).length;

  return (
    <div className="space-y-4">
      <GlassCard>
        <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-neon-amber" /> Withdrawal Policy
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          These limits apply to every agent withdrawal request.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Minimum Amount (৳)
            </label>
            <Input
              type="number" min={1} step={1}
              value={draft.min_amount}
              onChange={(e) => setDraft({ ...draft, min_amount: Number(e.target.value) || 0 })}
            />
            <p className="text-[10px] text-muted-foreground">Smallest withdrawal an agent can request.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Service Fee (%)
            </label>
            <Input
              type="number" min={0} max={50} step="0.1"
              value={draft.fee_percent}
              onChange={(e) => setDraft({ ...draft, fee_percent: Number(e.target.value) || 0 })}
            />
            <p className="text-[10px] text-muted-foreground">Deducted from agent payout. 0-50%.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              SLA (hours)
            </label>
            <Input
              type="number" min={1} max={168} step={1}
              value={draft.sla_hours}
              onChange={(e) => setDraft({ ...draft, sla_hours: Number(e.target.value) || 0 })}
            />
            <p className="text-[10px] text-muted-foreground">Promised processing time shown to agents.</p>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-primary" /> Payment Methods
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Toggle which methods agents can choose when requesting withdrawal.
          {" "}<span className="text-foreground font-semibold">{enabledCount}</span> enabled.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {allMethods.map((m) => (
            <label
              key={m}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                draft.methods[m]
                  ? "bg-neon-green/5 border-neon-green/30"
                  : "bg-white/[0.02] border-white/[0.06] opacity-60"
              )}
            >
              <span className="text-sm font-semibold">{METHOD_LABELS[m] || m}</span>
              <Switch
                checked={!!draft.methods[m]}
                onCheckedChange={(on) => setMethod(m, on)}
              />
            </label>
          ))}
        </div>
      </GlassCard>

      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Changes apply right away to agent withdrawal forms.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => data && setDraft(data)} disabled={save.isPending}>
            Reset
          </Button>
          <Button
            onClick={() => save.mutate({
              min_amount: draft.min_amount,
              fee_percent: draft.fee_percent,
              sla_hours: draft.sla_hours,
              methods: draft.methods,
            })}
            disabled={save.isPending}
            className="bg-primary text-primary-foreground"
          >
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? "Saving…" : "Save Config"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminPayments;
