import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, ProviderRange } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Server, Loader2, Power, CheckSquare, Square, Layers, RotateCw, Activity } from "lucide-react";
import { GradientMesh, PageHeader } from "@/components/premium";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PoolDialog } from "@/components/admin/PoolDialog";

const PROVIDERS = [
  { id: "mediatel", name: "Mediatel" },
  { id: "seven1tel", name: "Seven1Tel" },
];

type Form = Partial<ProviderRange> & { id?: number };

const empty: Form = {
  provider: "mediatel",
  country_code: "",
  country_name: "",
  range_label: "",
  range_prefix: "",
  operator: "",
  price_bdt: 0,
  enabled: 1,
  notes: "",
};

const AdminProviderRanges = () => {
  const [params, setParams] = useSearchParams();
  const providerFilter = params.get("provider") || "";
  const countryFilter = params.get("country") || "";
  const enabledFilter = params.get("enabled") || ""; // "", "1", "0"

  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["provider-ranges", providerFilter, countryFilter, enabledFilter],
    queryFn: () =>
      api.admin.rangesList({
        provider: providerFilter || undefined,
        country_code: countryFilter || undefined,
        enabled: enabledFilter === "1" ? 1 : enabledFilter === "0" ? 0 : undefined,
      }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [poolRangeId, setPoolRangeId] = useState<number | null>(null);

  // Per-range stats (stock + last activity)
  const { data: statsData } = useQuery({
    queryKey: ["provider-ranges-stats"],
    queryFn: () => api.admin.rangesStats(),
    refetchInterval: 15_000,
  });
  const stats = statsData?.stats || {};

  // Bot status (for the Bot column / quick restart)
  const { data: botsData } = useQuery({
    queryKey: ["admin-bots-status-mini"],
    queryFn: () => api.admin.bots.list(),
    refetchInterval: 10_000,
  });
  const bots = botsData?.bots || {};

  const restartBot = async (provider: string) => {
    try {
      await api.admin.bots.action(`${provider}Bot`, "restart");
      toast({ title: "Restart sent", description: `${provider}Bot` });
    } catch (e) {
      toast({ title: "Restart failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const fmtAgo = (ts: number | null | undefined) => {
    if (!ts) return "—";
    const s = Math.floor(Date.now() / 1000) - ts;
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const startCreate = () => {
    const fallback = PROVIDERS[0].id; // "mediatel"
    const provider = PROVIDERS.some(p => p.id === providerFilter) ? providerFilter : fallback;
    setForm({ ...empty, provider });
    setOpen(true);
  };
  const startEdit = (r: ProviderRange) => { setForm({ ...r, enabled: r.enabled ? 1 : 0 }); setOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      const body: Partial<ProviderRange> = {
        provider: form.provider, country_code: form.country_code,
        country_name: form.country_name || null,
        range_label: form.range_label, range_prefix: form.range_prefix || null,
        operator: form.operator || null,
        price_bdt: Number(form.price_bdt) || 0,
        enabled: form.enabled ? 1 : 0,
        notes: form.notes || null,
      };
      if (form.id) await api.admin.rangeUpdate(form.id, body);
      else await api.admin.rangeCreate(body);
      toast({ title: form.id ? "Range updated" : "Range created" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["provider-ranges"] });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const toggle = async (r: ProviderRange) => {
    await api.admin.rangeUpdate(r.id, { enabled: r.enabled ? 0 : 1 });
    qc.invalidateQueries({ queryKey: ["provider-ranges"] });
  };

  const remove = async (r: ProviderRange) => {
    if (!confirm(`Delete range "${r.range_label}" (${r.country_code})?`)) return;
    await api.admin.rangeDelete(r.id);
    toast({ title: "Deleted" });
    setSelected(s => { const n = new Set(s); n.delete(r.id); return n; });
    qc.invalidateQueries({ queryKey: ["provider-ranges"] });
  };

  const rows = data?.rows || [];

  const toggleSelect = (id: number) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleSelectAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };
  const bulkToggle = async (enabled: boolean) => {
    if (!selected.size) return;
    try {
      const r = await api.admin.rangeBulkToggle(Array.from(selected), enabled);
      toast({ title: `${enabled ? "Enabled" : "Disabled"} ${r.updated} range${r.updated === 1 ? "" : "s"}` });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["provider-ranges"] });
    } catch (e) {
      toast({ title: "Bulk toggle failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Pool Management"
        title="Provider Ranges"
        description="Add countries & ranges per provider. Toggle on/off to control what agents see."
        icon={<Server className="w-5 h-5 text-neon-cyan" />}
      />

      <GlassCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Provider</Label>
            <Select value={providerFilter || "all"} onValueChange={(v) => {
              const next = new URLSearchParams(params);
              if (v === "all") next.delete("provider"); else next.set("provider", v);
              setParams(next);
            }}>
              <SelectTrigger className="w-44 bg-white/[0.04] border-white/[0.1]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {PROVIDERS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Country code</Label>
            <Input
              value={countryFilter}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                const v = e.target.value.toUpperCase();
                if (v) next.set("country", v); else next.delete("country");
                setParams(next);
              }}
              placeholder="e.g. BD, US, IN"
              className="w-32 bg-white/[0.04] border-white/[0.1] uppercase"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={enabledFilter || "all"}
              onValueChange={(v) => {
                const next = new URLSearchParams(params);
                if (v === "all") next.delete("enabled"); else next.set("enabled", v);
                setParams(next);
              }}
            >
              <SelectTrigger className="w-36 bg-white/[0.04] border-white/[0.1]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="1">Enabled only</SelectItem>
                <SelectItem value="0">Disabled only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto">
            <Button onClick={startCreate} className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
              <Plus className="w-4 h-4 mr-1.5" /> Add Range
            </Button>
          </div>
        </div>
      </GlassCard>

      {selected.size > 0 && (
        <GlassCard className="!py-3 flex items-center gap-3 border-primary/30">
          <span className="text-sm">
            <span className="font-semibold text-foreground">{selected.size}</span>{" "}
            <span className="text-muted-foreground">selected</span>
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkToggle(true)} className="border-neon-green/30 text-neon-green hover:bg-neon-green/10">
              <Power className="w-3.5 h-3.5 mr-1.5" /> Enable
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkToggle(false)} className="border-neon-amber/30 text-neon-amber hover:bg-neon-amber/10">
              <Power className="w-3.5 h-3.5 mr-1.5" /> Disable
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No ranges yet. Click <span className="text-foreground">Add Range</span> to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.06] bg-white/[0.02]">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-3 w-10">
                    <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground" aria-label="Select all">
                      {selected.size > 0 && selected.size === rows.length
                        ? <CheckSquare className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Range</th>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3 text-right">Price (BDT)</th>
                  <th className="px-4 py-3 text-center">Enabled</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn(
                    "border-b border-white/[0.03] hover:bg-white/[0.02]",
                    !r.enabled && "opacity-60"
                  )}>
                    <td className="px-3 py-3">
                      <button onClick={() => toggleSelect(r.id)} className="text-muted-foreground hover:text-foreground" aria-label={`Select ${r.range_label}`}>
                        {selected.has(r.id)
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs uppercase">{r.provider}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold">{r.country_code}</span>
                      {r.country_name && <span className="text-muted-foreground ml-1.5">{r.country_name}</span>}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {r.range_label}
                      {r.range_prefix && <span className="text-muted-foreground ml-2 font-mono text-xs">{r.range_prefix}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.operator || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{Number(r.price_bdt).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={!!r.enabled} onCheckedChange={() => toggle(r)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(r)} className="h-8 w-8 p-0">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(r)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Range" : "Add Range"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Provider *</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger className="bg-white/[0.04] border-white/[0.1]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Country code *</Label>
              <Input
                value={form.country_code || ""}
                onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })}
                placeholder="BD"
                className="bg-white/[0.04] border-white/[0.1] uppercase"
                maxLength={4}
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Country name</Label>
              <Input
                value={form.country_name || ""}
                onChange={(e) => setForm({ ...form, country_name: e.target.value })}
                placeholder="Bangladesh"
                className="bg-white/[0.04] border-white/[0.1]"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Range label *</Label>
              <Input
                value={form.range_label || ""}
                onChange={(e) => setForm({ ...form, range_label: e.target.value })}
                placeholder="GP-01 / Robi-Pre / 880-1700"
                className="bg-white/[0.04] border-white/[0.1]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Prefix</Label>
              <Input
                value={form.range_prefix || ""}
                onChange={(e) => setForm({ ...form, range_prefix: e.target.value })}
                placeholder="8801700"
                className="bg-white/[0.04] border-white/[0.1] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Operator</Label>
              <Input
                value={form.operator || ""}
                onChange={(e) => setForm({ ...form, operator: e.target.value })}
                placeholder="Grameenphone"
                className="bg-white/[0.04] border-white/[0.1]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Price (BDT) per OTP</Label>
              <Input
                type="number" step="0.01" min={0}
                value={form.price_bdt ?? 0}
                onChange={(e) => setForm({ ...form, price_bdt: Number(e.target.value) })}
                className="bg-white/[0.04] border-white/[0.1] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Enabled (visible to agents)</Label>
              <div className="h-10 flex items-center gap-2 px-3 rounded-md bg-white/[0.04] border border-white/[0.1]">
                <Power className={cn("w-4 h-4", form.enabled ? "text-neon-green" : "text-muted-foreground")} />
                <Switch checked={!!form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v ? 1 : 0 })} />
                <span className="text-xs text-muted-foreground ml-auto">{form.enabled ? "ON" : "OFF"}</span>
              </div>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Notes</Label>
              <Input
                value={form.notes || ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Internal note (not shown to agents)"
                className="bg-white/[0.04] border-white/[0.1]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.provider || !form.country_code || !form.range_label}
              className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {form.id ? "Save changes" : "Create range"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminProviderRanges;
