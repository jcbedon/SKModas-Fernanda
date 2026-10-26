import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Trash2, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getRecurringExpenses, updateRecurringExpense, deleteRecurringExpense } from "@/lib/api";
import { iconFor } from "./categoryIcons";

const Row = ({ r, cat, account, onChanged }) => {
  const [amount, setAmount] = useState(String(r.amount));
  const [day, setDay] = useState(String(r.day_of_month));
  const Icon = iconFor(cat?.icon);
  const dirty = parseFloat(amount) !== r.amount || parseInt(day, 10) !== r.day_of_month;
  const call = async (fn, ok) => { try { await fn(); toast.success(ok); onChanged(); } catch (e) { toast.error(e.response?.data?.detail || "Error"); } };
  return (
    <div className={`border rounded-2xl p-3 space-y-2 ${r.active ? "border-slate-100" : "border-dashed border-slate-200 opacity-70"}`} data-testid={`recurring-row-${r.id}`}>
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${cat?.color || "#64748b"}1a`, color: cat?.color || "#64748b" }}><Icon className="h-4 w-4" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{r.description || r.category_label}</p>
          <p className="text-xs text-slate-400 truncate">{r.category_label}{account ? ` · ${account.bank_name}` : " · Efectivo"}{r.active ? "" : " · PAUSADO"}</p>
        </div>
        <Switch className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-slate-300" checked={r.active} onCheckedChange={(v) => call(() => updateRecurringExpense(r.id, { active: v }), v ? "Gasto fijo reactivado" : "Gasto fijo pausado")} data-testid={`recurring-active-${r.id}`} />
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        $<Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} onWheel={(e) => e.target.blur()} className="h-8 w-24 rounded-lg" data-testid={`recurring-amount-${r.id}`} />
        día<Input type="number" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} onWheel={(e) => e.target.blur()} className="h-8 w-14 rounded-lg text-center" data-testid={`recurring-day-${r.id}`} />
        <span className="flex-1">de cada mes</span>
        {dirty && <button onClick={() => call(() => updateRecurringExpense(r.id, { amount: parseFloat(amount), day_of_month: parseInt(day, 10) }), "Gasto fijo actualizado")} className="p-1.5 rounded-lg bg-slate-900 text-white" data-testid={`recurring-save-${r.id}`}><Save className="h-3.5 w-3.5" /></button>}
        <button onClick={() => window.confirm("¿Detener este gasto fijo? Ya no se crearán más meses. Los gastos ya confirmados se conservan.") && call(() => deleteRecurringExpense(r.id), "Gasto fijo detenido")} className="p-1.5 rounded-lg hover:bg-rose-50" data-testid={`recurring-delete-${r.id}`}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></button>
      </div>
    </div>
  );
};

export const RecurringManager = ({ open, onOpenChange, categories, accounts, onChanged }) => {
  const [rows, setRows] = useState([]);
  const load = () => getRecurringExpenses().then((r) => setRows(r.data.recurring)).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]);
  const cats = Object.fromEntries(categories.map((c) => [c.key, c]));
  const accs = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const refresh = () => { load(); onChanged(); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl" data-testid="recurring-dialog">
        <DialogHeader><DialogTitle>Gastos fijos mensuales</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
          {rows.length ? rows.map((r) => <Row key={`${r.id}-${r.amount}-${r.day_of_month}`} r={r} cat={cats[r.category]} account={accs[r.bank_account_id]} onChanged={refresh} />)
            : <p className="text-sm text-slate-400 text-center py-8" data-testid="recurring-empty">Aún no hay gastos fijos. Al crear un gasto activa "Repetir cada mes".</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
};
