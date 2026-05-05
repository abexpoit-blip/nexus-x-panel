import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Service } from "@/lib/api";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { GradientMesh, PageHeader } from "@/components/premium";
import { AppWindow, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Form = Partial<Service> & { id?: number };
const empty: Form = { slug: "", name: "", icon: "📱", color: "#3b82f6", enabled: 1, sort_order: 100 };

const PRESET_COLORS = ["#1877f2", "#25d366", "#229ED9", "#EA4335", "#E4405F", "#FF6B35", "#7C3AED", "#06B6D4"];
const PRESET_ICONS = ["📘", "💬", "✈️", "🔍", "📷", "🎵", "🎮", "🛒", "📱", "🔐"];

const AdminServices = () => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["admin-services"], queryFn: () => api.admin.servicesList() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);

  const startCreate = () => { setForm(empty); setOpen(true); };
  const startEdit = (s: Service) => { setForm({ ...s }); setOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      const body: Partial<Service> = {
        slug: form.slug, name: form.name, icon: form.icon || "📱",
        color: form.color || "#3b82f6", enabled: form.enabled ? 1 : 0,
        sort_order: Number(form.sort_order) || 100,
      };
      if (form.id) await api.admin.serviceUpdate(form.id, body);
      else await api.admin.serviceCreate(body);
      toast({ title: form.id ? "Service updated" : "Service created" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-services"] });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const remove = async (s: Service) => {
    if (!confirm(`Delete "${s.name}"? Ranges using it will lose the service tag.`)) return;
    try {
      await api.admin.serviceDelete(s.id, true);
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["admin-services"] });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const toggle = async (s: Service) => {
    await api.admin.serviceUpdate(s.id, { enabled: s.enabled ? 0 : 1 });
    qc.invalidateQueries({ queryKey: ["admin-services"] });
  };

  const rows = data?.rows || [];

  return (
    <div className="relative space-y-6">
      <GradientMesh variant="default" />
      <PageHeader
        eyebrow="Catalog"
        title="Services"
        description="Manage the destination platforms (Facebook, WhatsApp, Telegram…) agents can choose from."
        icon={<AppWindow className="w-5 h-5 text-neon-cyan" />}
      />

      <div className="flex justify-end">
        <Button onClick={startCreate} className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
          <Plus className="w-4 h-4 mr-1.5" /> Add Service
        </Button>
      </div>

      {isLoading ? (
        <GlassCard><div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(s => (
            <GlassCard key={s.id} className={cn("relative overflow-hidden", !s.enabled && "opacity-60")}>
              <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
                   style={{ background: `radial-gradient(circle at top right, ${s.color}, transparent 60%)` }} />
              <div className="relative flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl border"
                     style={{ background: `${s.color}1a`, borderColor: `${s.color}55` }}>
                  {s.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg leading-tight">{s.name}</h3>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{s.slug}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.range_count ?? 0} range{(s.range_count ?? 0) === 1 ? "" : "s"}</p>
                </div>
                <Switch checked={!!s.enabled} onCheckedChange={() => toggle(s)} />
              </div>
              <div className="relative flex justify-end gap-1 mt-3">
                <Button size="sm" variant="ghost" onClick={() => startEdit(s)} className="h-8 w-8 p-0">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form.id ? "Edit Service" : "Add Service"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-white/10"
                 style={{ background: `${form.color}10` }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl border"
                   style={{ background: `${form.color}1a`, borderColor: `${form.color}55` }}>
                {form.icon || "📱"}
              </div>
              <div>
                <div className="font-semibold">{form.name || "Service name"}</div>
                <div className="text-xs text-muted-foreground font-mono">{form.slug || "slug"}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Slug *</Label>
                <Input value={form.slug || ""} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                  placeholder="facebook" disabled={!!form.id} className="bg-white/[0.04] border-white/[0.1] font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Name *</Label>
                <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Facebook" className="bg-white/[0.04] border-white/[0.1]" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Icon</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_ICONS.map(ic => (
                  <button key={ic} type="button" onClick={() => setForm({ ...form, icon: ic })}
                    className={cn("w-9 h-9 rounded-lg border flex items-center justify-center text-lg",
                      form.icon === ic ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/30")}>
                    {ic}
                  </button>
                ))}
                <Input value={form.icon || ""} onChange={(e) => setForm({ ...form, icon: e.target.value.slice(0, 4) })}
                  className="w-16 h-9 bg-white/[0.04] border-white/[0.1] text-center" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Accent color</Label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    className={cn("w-8 h-8 rounded-lg border-2",
                      form.color === c ? "border-foreground" : "border-white/10")}
                    style={{ background: c }} />
                ))}
                <Input value={form.color || "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-28 h-9 bg-white/[0.04] border-white/[0.1] font-mono text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Sort order</Label>
                <Input type="number" value={form.sort_order ?? 100}
                  onChange={(e) => setForm({ ...form, sort_order: +e.target.value })}
                  className="bg-white/[0.04] border-white/[0.1]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Enabled</Label>
                <div className="h-10 flex items-center">
                  <Switch checked={!!form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v ? 1 : 0 })} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.slug || !form.name}
              className="bg-gradient-to-r from-primary to-neon-magenta text-primary-foreground border-0">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {form.id ? "Save changes" : "Create service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminServices;