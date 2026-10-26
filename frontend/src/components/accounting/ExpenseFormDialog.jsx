import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Paperclip, X, Repeat } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createExpense, updateExpense } from "@/lib/api";
import { iconFor } from "./categoryIcons";

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const empty = () => ({ amount: "", category: "", description: "", date: today(), bank_account_id: "none", repeat: false, day: "" });

export const ExpenseFormDialog = ({ open, onOpenChange, categories, accounts, editing, onSaved }) => {
  const [form, setForm] = useState(empty());
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setForm(editing ? { amount: String(editing.amount), category: editing.category, description: editing.description || "", date: editing.date, bank_account_id: editing.bank_account_id || "none" } : empty());
  }, [open, editing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!(parseFloat(form.amount) > 0)) return toast.error("Ingresa el monto");
    if (!form.category) return toast.error("Elige una categoría");
    setSaving(true);
    try {
      const bank = form.bank_account_id === "none" ? "" : form.bank_account_id;
      if (editing) {
        await updateExpense(editing.id, { amount: parseFloat(form.amount), category: form.category, description: form.description, date: form.date, bank_account_id: bank });
      } else {
        const fd = new FormData();
        fd.append("amount", form.amount);
        fd.append("category", form.category);
        fd.append("description", form.description);
        fd.append("date", form.date);
        if (bank) fd.append("bank_account_id", bank);
        if (form.repeat) {
          fd.append("repeat_monthly", "true");
          fd.append("day_of_month", String(parseInt(form.day, 10) || Number(form.date.slice(8, 10))));
        }
        if (file) fd.append("receipt", file);
        await createExpense(fd);
      }
      toast.success(editing ? "Gasto actualizado" : "Gasto registrado");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-0 overflow-hidden" data-testid="expense-form-dialog">
        <div className="bg-gradient-to-br from-rose-500 to-orange-400 px-6 pt-6 pb-8 text-white">
          <DialogHeader><DialogTitle className="text-white text-base font-semibold">{editing ? "Editar gasto" : "Nuevo gasto"}</DialogTitle></DialogHeader>
          <div className="flex items-center justify-center gap-1 mt-4">
            <span className="text-3xl font-light opacity-80">$</span>
            <input type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={form.amount} autoFocus
              onChange={(e) => set("amount", e.target.value)} onWheel={(e) => e.target.blur()}
              className="bg-transparent text-5xl font-bold w-48 text-center placeholder-white/50 outline-none" data-testid="expense-amount-input" />
          </div>
        </div>
        <div className="p-5 space-y-4 -mt-4 bg-white rounded-t-3xl relative">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">Categoría</p>
            <div className="grid grid-cols-4 gap-2">
              {categories.map((c) => {
                const Icon = iconFor(c.icon);
                const active = form.category === c.key;
                return (
                  <button key={c.key} type="button" onClick={() => set("category", c.key)} data-testid={`expense-cat-${c.key}`}
                    className={`flex flex-col items-center gap-1 rounded-2xl p-2 border transition-colors duration-150 ${active ? "border-transparent text-white" : "border-slate-100 hover:bg-slate-50 text-slate-600"}`}
                    style={active ? { backgroundColor: c.color } : {}}>
                    <span className="h-8 w-8 rounded-full flex items-center justify-center" style={{ backgroundColor: active ? "rgba(255,255,255,.2)" : `${c.color}1a`, color: active ? "#fff" : c.color }}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[10px] leading-tight text-center line-clamp-2">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Input placeholder="Descripción (opcional)" value={form.description} onChange={(e) => set("description", e.target.value)} className="rounded-xl" data-testid="expense-description-input" />
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="rounded-xl" data-testid="expense-date-input" />
            <Select value={form.bank_account_id} onValueChange={(v) => set("bank_account_id", v)}>
              <SelectTrigger className="rounded-xl" data-testid="expense-account-select"><SelectValue placeholder="Cuenta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin cuenta (efectivo)</SelectItem>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.bank_name} · {a.owner_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!editing && (
            <div className={`rounded-2xl border p-3 transition-colors duration-150 ${form.repeat ? "border-indigo-200 bg-indigo-50" : "border-slate-100"}`} data-testid="expense-repeat-box">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700"><Repeat className="h-4 w-4 text-indigo-500" />Repetir cada mes (gasto fijo)</span>
                <Switch className="data-[state=checked]:bg-indigo-500 data-[state=unchecked]:bg-slate-300" checked={form.repeat} onCheckedChange={(v) => setForm((f) => ({ ...f, repeat: v, day: f.day || String(Number(f.date.slice(8, 10))) }))} data-testid="expense-repeat-switch" />
              </label>
              {form.repeat && (
                <div className="flex items-center gap-2 mt-3 text-sm text-slate-600">
                  Día de pago
                  <Input type="number" min="1" max="31" value={form.day} onChange={(e) => set("day", e.target.value)} onWheel={(e) => e.target.blur()} className="h-8 w-16 rounded-lg text-center" data-testid="expense-repeat-day" />
                  <span className="text-xs text-slate-400">de cada mes · se crea pendiente para que lo confirmes</span>
                </div>
              )}
            </div>
          )}
          {!editing && (
            file ? (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm" data-testid="expense-file-chip">
                <span className="truncate flex items-center gap-2"><Paperclip className="h-4 w-4 text-slate-400" />{file.name}</span>
                <button type="button" onClick={() => setFile(null)}><X className="h-4 w-4 text-slate-400" /></button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-3 text-sm text-slate-500 cursor-pointer hover:bg-slate-50" data-testid="expense-file-label">
                <Paperclip className="h-4 w-4" /> Adjuntar comprobante (opcional)
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="expense-file-input" />
              </label>
            )
          )}
          <Button onClick={save} disabled={saving} className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-base" data-testid="expense-save-btn">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{editing ? "Guardar cambios" : "Registrar gasto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
