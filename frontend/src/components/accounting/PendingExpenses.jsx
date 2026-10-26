import { useState } from "react";
import { toast } from "sonner";
import { BellRing, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { confirmExpense, deleteExpense } from "@/lib/api";
import { iconFor, money } from "./categoryIcons";

const PendingRow = ({ e, cat, accounts, onDone }) => {
  const [amount, setAmount] = useState(String(e.amount));
  const [bank, setBank] = useState(e.bank_account_id || "");
  const [busy, setBusy] = useState(false);
  const Icon = iconFor(cat?.icon);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onDone(); } catch (err) { toast.error(err.response?.data?.detail || "Error"); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl px-3 py-2.5" data-testid={`pending-expense-${e.id}`}>
      <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${cat?.color || "#64748b"}1a`, color: cat?.color || "#64748b" }}><Icon className="h-4 w-4" /></span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{e.description || e.category_label}</p>
        <p className="text-xs text-slate-400">{e.category_label} · vence {e.date}</p>
      </div>
      <Input type="number" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} onWheel={(ev) => ev.target.blur()}
        className="h-8 w-24 rounded-lg text-right font-semibold" data-testid={`pending-amount-${e.id}`} />
      <select value={bank} onChange={(ev) => setBank(ev.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs max-w-[140px]" data-testid={`pending-account-${e.id}`}>
        <option value="">Efectivo / sin cuenta</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name}{a.account_number ? ` · ${String(a.account_number).slice(-4)}` : ""}</option>)}
      </select>
      <button disabled={busy} onClick={() => run(() => confirmExpense(e.id, { amount: parseFloat(amount), bank_account_id: bank || null }), "Gasto confirmado")}
        className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1" data-testid={`pending-confirm-${e.id}`}>
        <Check className="h-3.5 w-3.5" />Confirmar
      </button>
      <button disabled={busy} onClick={() => window.confirm("¿Descartar este gasto de este mes?") && run(() => deleteExpense(e.id), "Descartado")}
        className="h-8 w-8 rounded-lg hover:bg-rose-50 flex items-center justify-center" data-testid={`pending-discard-${e.id}`}>
        <X className="h-4 w-4 text-rose-500" />
      </button>
    </div>
  );
};

export const PendingExpenses = ({ pending, categories, accounts, onChanged }) => {
  if (!pending.length) return null;
  const cats = Object.fromEntries(categories.map((c) => [c.key, c]));
  return (
    <div className="rounded-3xl bg-amber-50 border border-amber-200 p-4 space-y-2" data-testid="pending-expenses">
      <p className="font-semibold text-amber-800 flex items-center gap-2"><BellRing className="h-4 w-4" />Gastos fijos por confirmar ({pending.length})</p>
      <p className="text-xs text-amber-700/80">No cuentan en el balance ni salen de la cuenta hasta que los confirmes. Puedes ajustar el monto antes.</p>
      {pending.map((e) => <PendingRow key={e.id} e={e} cat={cats[e.category]} accounts={accounts} onDone={onChanged} />)}
    </div>
  );
};
