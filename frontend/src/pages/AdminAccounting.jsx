import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, FileDown, Settings2, Repeat, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { getAccountingSummary, getExpenses, getExpenseCategories, listBankAccounts, deleteExpense } from "@/lib/api";
import { getWeekKey } from "@/lib/weekKey";
import { generateAccountingPDF } from "@/lib/accountingPDF";
import { ExpenseFormDialog } from "@/components/accounting/ExpenseFormDialog";
import { ExpenseList } from "@/components/accounting/ExpenseList";
import { CategoryManager } from "@/components/accounting/CategoryManager";
import { PendingExpenses } from "@/components/accounting/PendingExpenses";
import { RecurringManager } from "@/components/accounting/RecurringManager";
import { IncomeExpenseChart, CategoryDonut } from "@/components/accounting/AccountingCharts";
import { money } from "@/components/accounting/categoryIcons";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (d, o) => d.toLocaleDateString("es-ES", o);

const periodRange = (mode, offset) => {
  const now = new Date();
  let s, e, label;
  if (mode === "week") {
    const [y, m, d] = getWeekKey(now.toISOString()).split("-").map(Number);
    s = new Date(y, m - 1, d + offset * 7); e = new Date(s); e.setDate(s.getDate() + 6);
    label = `${fmt(s, { day: "numeric", month: "short" })} – ${fmt(e, { day: "numeric", month: "short", year: "numeric" })}`;
  } else if (mode === "month") {
    s = new Date(now.getFullYear(), now.getMonth() + offset, 1); e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    label = fmt(s, { month: "long", year: "numeric" });
  } else {
    s = new Date(now.getFullYear() + offset, 0, 1); e = new Date(s.getFullYear(), 11, 31);
    label = String(s.getFullYear());
  }
  const end = new Date(e); end.setHours(23, 59, 59, 999);
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return { start: s.toISOString(), end: end.toISOString(), start_day: ymd(s), end_day: ymd(e), bucket: mode === "year" ? "month" : "day", label };
};

const Stat = ({ icon: Icon, label, value, tone, testid }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-white/10 backdrop-blur px-4 py-3">
    <span className={`h-9 w-9 rounded-xl flex items-center justify-center ${tone}`}><Icon className="h-4 w-4" /></span>
    <div><p className="text-[11px] text-white/60">{label}</p><p className="font-bold text-white" data-testid={testid}>{value}</p></div>
  </div>
);

export default function AdminAccounting() {
  const { user } = useAuth();
  const [mode, setMode] = useState("month");
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [pending, setPending] = useState([]);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const range = useMemo(() => periodRange(mode, offset), [mode, offset]);

  const load = useCallback(async () => {
    const { label, ...params } = range;
    try {
      const [s, e] = await Promise.all([
        getAccountingSummary({ ...params, tz_offset_minutes: new Date().getTimezoneOffset() }),
        getExpenses({ start_day: params.start_day, end_day: params.end_day, today: ymd(new Date()) }),
      ]);
      setSummary(s.data); setExpenses(e.data.expenses); setPending(e.data.pending || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error al cargar contabilidad");
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    getExpenseCategories().then((r) => setCategories(r.data.categories)).catch(() => {});
    listBankAccounts().then((r) => setAccounts((r.data.bank_accounts || []).filter((a) => a.is_active !== false))).catch(() => {});
  }, []);

  const remove = async (e) => {
    if (!window.confirm(`¿Eliminar el gasto de ${money(e.amount)}? Si salió de una cuenta, se devuelve a su saldo en Cuentas.`)) return;
    try { await deleteExpense(e.id); toast.success("Gasto eliminado"); load(); } catch (err) { toast.error(err.response?.data?.detail || "Error"); }
  };

  const net = summary?.net ?? 0;
  return (
    <div className="min-h-screen bg-slate-50" data-testid="accounting-page">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Contabilidad</h1>
            <p className="text-sm text-slate-500">Ganancias del sistema menos gastos del negocio</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-xl gap-1" onClick={() => setRecurringOpen(true)} data-testid="accounting-recurring-btn"><Repeat className="h-4 w-4" />Gastos fijos</Button>
            <Button variant="outline" className="rounded-xl gap-1" onClick={() => setCatsOpen(true)} data-testid="accounting-categories-btn"><Settings2 className="h-4 w-4" />Categorías</Button>
            <Button variant="outline" className="rounded-xl gap-1" disabled={!summary} data-testid="accounting-pdf-btn"
              onClick={() => generateAccountingPDF({ tenantName: user?.tenant_name, periodLabel: range.label, summary, expenses, accounts })}><FileDown className="h-4 w-4" />PDF</Button>
            <Button className="rounded-xl gap-1 bg-rose-500 hover:bg-rose-600 text-white" onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="accounting-new-expense-btn"><Plus className="h-4 w-4" />Nuevo gasto</Button>
          </div>
        </div>

        <PendingExpenses pending={pending} categories={categories} accounts={accounts} onChanged={load} />

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-2xl bg-white border border-slate-200 p-1">
            {[["week", "Semana"], ["month", "Mes"], ["year", "Año"]].map(([k, l]) => (
              <button key={k} onClick={() => { setMode(k); setOffset(0); }} data-testid={`accounting-mode-${k}`}
                className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors duration-150 ${mode === k ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-2xl px-1 py-1">
            <button onClick={() => setOffset(offset - 1)} className="p-1.5 rounded-xl hover:bg-slate-100" data-testid="accounting-prev"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-semibold text-slate-700 min-w-[170px] text-center" data-testid="accounting-period-label">{range.label}</span>
            <button onClick={() => setOffset(offset + 1)} disabled={offset >= 0} className="p-1.5 rounded-xl hover:bg-slate-100 disabled:opacity-30" data-testid="accounting-next"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900 p-6 md:p-8 text-white relative overflow-hidden">
          <div className={`absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl opacity-40 ${net >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} />
          <p className="text-sm text-white/60 relative">Balance neto</p>
          <p className={`text-4xl md:text-5xl font-bold relative ${net >= 0 ? "text-emerald-300" : "text-rose-300"}`} data-testid="accounting-net">{money(net)}</p>
          <div className="grid sm:grid-cols-3 gap-3 mt-6 relative">
            <Stat icon={TrendingUp} label="Ganancias" value={money(summary?.income.total)} tone="bg-emerald-400/20 text-emerald-300" testid="accounting-income" />
            <Stat icon={TrendingDown} label="Gastos" value={money(summary?.expenses_total)} tone="bg-rose-400/20 text-rose-300" testid="accounting-expenses" />
            <Stat icon={Wallet} label="Margen" value={summary?.income.total ? `${((net / summary.income.total) * 100).toFixed(0)}%` : "—"} tone="bg-sky-400/20 text-sky-300" testid="accounting-margin" />
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 p-5">
            <p className="font-semibold text-slate-800 mb-3">Ganancias vs Gastos</p>
            {summary?.series?.length ? <IncomeExpenseChart series={summary.series} /> : <p className="text-sm text-slate-400 py-20 text-center">Sin movimientos</p>}
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 p-5">
            <p className="font-semibold text-slate-800 mb-1">Gastos por categoría</p>
            {summary?.by_category?.length ? (
              <>
                <CategoryDonut data={summary.by_category} total={summary.expenses_total} />
                <div className="space-y-1.5 mt-2">
                  {summary.by_category.map((c) => (
                    <div key={c.key} className="flex items-center justify-between text-sm" data-testid={`accounting-cat-total-${c.key}`}>
                      <span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />{c.label}</span>
                      <span className="font-semibold">{money(c.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-slate-400 py-20 text-center">Sin gastos</p>}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-slate-100 p-5 h-fit" data-testid="accounting-income-breakdown">
            <p className="font-semibold text-slate-800 mb-3">De dónde vienen las ganancias</p>
            {summary && [["Comisiones de productos", summary.income.product_commissions], ["Comisiones manuales", summary.income.manual_commissions],
              ["Comisiones de Pacas", summary.income.pacas_commissions], ["Tax factura de tienda", -summary.income.store_invoice_taxes]].map(([l, v]) => (
              <div key={l} className="flex justify-between text-sm py-1.5 border-b border-slate-50 last:border-0">
                <span className="text-slate-500">{l}</span><span className={`font-semibold ${v < 0 ? "text-rose-500" : "text-slate-800"}`}>{money(v)}</span>
              </div>
            ))}
          </div>
          <div className="lg:col-span-2">
            <p className="font-semibold text-slate-800 mb-3">Gastos ({expenses.length})</p>
            <ExpenseList expenses={expenses} categories={categories} accounts={accounts} onEdit={(e) => { setEditing(e); setFormOpen(true); }} onDelete={remove} />
          </div>
        </div>
      </div>

      <ExpenseFormDialog open={formOpen} onOpenChange={setFormOpen} categories={categories} accounts={accounts} editing={editing} onSaved={load} />
      <RecurringManager open={recurringOpen} onOpenChange={setRecurringOpen} categories={categories} accounts={accounts} onChanged={load} />
      <CategoryManager open={catsOpen} onOpenChange={setCatsOpen} categories={categories} onSaved={setCategories} />
    </div>
  );
}
