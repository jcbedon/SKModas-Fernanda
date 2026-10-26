import { Pencil, Trash2, Paperclip, Landmark } from "lucide-react";
import { iconFor, money } from "./categoryIcons";

const dayTitle = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};

export const ExpenseList = ({ expenses, categories, accounts, onEdit, onDelete }) => {
  const cats = Object.fromEntries(categories.map((c) => [c.key, c]));
  const accs = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const groups = expenses.reduce((g, e) => ((g[e.date] = g[e.date] || []).push(e), g), {});
  if (!expenses.length) {
    return <p className="text-center text-sm text-slate-400 py-10" data-testid="expenses-empty">Sin gastos en este período. Toca "Nuevo gasto" para registrar uno.</p>;
  }
  return (
    <div className="space-y-5" data-testid="expense-list">
      {Object.entries(groups).map(([day, rows]) => (
        <div key={day}>
          <div className="flex justify-between text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            <span>{dayTitle(day)}</span><span>{money(rows.reduce((a, r) => a + r.amount, 0))}</span>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
            {rows.map((e) => {
              const c = cats[e.category] || { color: "#64748b", icon: "tag", label: e.category_label };
              const Icon = iconFor(c.icon);
              const acc = accs[e.bank_account_id];
              return (
                <div key={e.id} className="group flex items-center gap-3 px-4 py-3" data-testid={`expense-row-${e.id}`}>
                  <span className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${c.color}1a`, color: c.color }}><Icon className="h-5 w-5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">{e.description || c.label}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1 truncate">
                      {c.label}
                      {acc && <><span>·</span><Landmark className="h-3 w-3" />{acc.bank_name}</>}
                      {e.receipt_url && <a href={`${process.env.REACT_APP_BACKEND_URL}${e.receipt_url}`} target="_blank" rel="noreferrer" className="text-indigo-500 flex items-center gap-0.5 ml-1" data-testid={`expense-receipt-${e.id}`}><Paperclip className="h-3 w-3" />Comprobante</a>}
                    </p>
                  </div>
                  <span className="font-bold text-rose-600 text-sm" data-testid={`expense-amount-${e.id}`}>−{money(e.amount)}</span>
                  <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(e)} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid={`expense-edit-${e.id}`}><Pencil className="h-3.5 w-3.5 text-slate-500" /></button>
                    <button onClick={() => onDelete(e)} className="p-1.5 rounded-lg hover:bg-rose-50" data-testid={`expense-delete-${e.id}`}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
