import { useEffect, useState } from "react";
import { diagnoseInvoice } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, RefreshCw, FileText, Package, ShoppingBag, Wallet, Trash2, Edit, CheckCircle2, AlertCircle, XCircle } from "lucide-react";

// Color + label per audit action
const actionMeta = {
  create_invoice: { color: "bg-blue-100 text-blue-800 border-blue-200", icon: FileText, label: "Factura creada" },
  approve_invoice: { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2, label: "Factura aprobada" },
  reopen_invoice: { color: "bg-amber-100 text-amber-800 border-amber-200", icon: RefreshCw, label: "Factura reabierta" },
  invoice_annulled: { color: "bg-rose-100 text-rose-800 border-rose-200", icon: XCircle, label: "Factura anulada" },
  annul_invoice: { color: "bg-rose-100 text-rose-800 border-rose-200", icon: XCircle, label: "Factura anulada" },
  invoice_totals_updated: { color: "bg-blue-100 text-blue-800 border-blue-200", icon: RefreshCw, label: "Total actualizado" },
  update_invoice: { color: "bg-slate-100 text-slate-800 border-slate-200", icon: Edit, label: "Factura editada" },
  create_purchase: { color: "bg-blue-50 text-blue-700 border-blue-100", icon: ShoppingBag, label: "Compra creada" },
  update_purchase: { color: "bg-amber-50 text-amber-700 border-amber-100", icon: Edit, label: "Compra editada" },
  delete_purchase: { color: "bg-rose-50 text-rose-700 border-rose-100", icon: Trash2, label: "Compra eliminada" },
  restore_purchase: { color: "bg-emerald-50 text-emerald-700 border-emerald-100", icon: RefreshCw, label: "Compra restaurada" },
  create_shipment: { color: "bg-purple-50 text-purple-700 border-purple-100", icon: Package, label: "Envío creado" },
  update_shipment: { color: "bg-purple-50 text-purple-700 border-purple-100", icon: Edit, label: "Envío editado" },
  delete_shipment: { color: "bg-rose-50 text-rose-700 border-rose-100", icon: Trash2, label: "Envío eliminado" },
  reassign_purchase: { color: "bg-indigo-50 text-indigo-700 border-indigo-100", icon: RefreshCw, label: "Compra reasignada" },
};

const fmtTs = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" }) + " · " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  } catch { return s; }
};

export default function InvoiceDiagnosticDialog({ invoiceId, open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !invoiceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await diagnoseInvoice(invoiceId);
        if (!cancelled) setData(res.data);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, invoiceId]);

  const inv = data?.invoice;
  const chain = data?.client_invoices_chain || [];
  const linked = data?.linked_purchases || [];
  const wallet = data?.wallet_transactions || [];
  const timeline = data?.timeline || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto" data-testid="invoice-diagnostic-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-5 w-5 text-amber-600" />
            Diagnóstico de Factura {inv?.invoice_number || ""}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="text-center py-12 text-sm text-slate-500">
            <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin text-amber-600" />
            Recopilando timeline desde MongoDB y audit logs…
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800">
            <p className="font-bold mb-1">Error</p>
            <p>{error}</p>
          </div>
        )}

        {!loading && data && !error && (
          <div className="space-y-4 mt-2">
            {/* Current invoice state */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
              <p className="text-[11px] font-bold text-blue-800 uppercase mb-2">Estado actual de la factura</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div><span className="text-slate-500">Total:</span> <b>${(inv.total || 0).toFixed(2)}</b></div>
                <div><span className="text-slate-500">Subtotal:</span> ${(inv.subtotal || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Comisiones:</span> ${(inv.total_commission || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Taxes:</span> ${(inv.total_tax || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Envío:</span> ${(inv.shipping_cost || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Saldo pend.:</span> ${(inv.saldo_pendiente || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Saldo a favor ant.:</span> ${(inv.saldo_a_favor_anterior || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Depósitos aplic.:</span> ${(inv.deposits_applied || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Total a pagar:</span> <b className="text-blue-900">${(inv.total_a_pagar || 0).toFixed(2)}</b></div>
                <div><span className="text-slate-500">Saldo a favor:</span> ${(inv.saldo_a_favor || 0).toFixed(2)}</div>
                <div><span className="text-slate-500">Items:</span> {linked.length}{linked.filter(p => p.is_deleted).length > 0 && <span className="text-rose-700"> ({linked.filter(p => p.is_deleted).length} eliminados)</span>}</div>
                <div><span className="text-slate-500">Estado:</span> <Badge variant="outline" className="text-[10px]">{inv.is_annulled ? "ANULADA" : (inv.status || "pending")}</Badge></div>
              </div>
            </div>

            {/* Client invoices chain - shows cascade context */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Cadena de facturas del cliente ({chain.length}) — la cascada de saldos
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                {chain.map((ci) => {
                  const isCurrent = ci.id === inv.id;
                  return (
                    <div key={ci.id} className={`px-3 py-2 text-xs grid grid-cols-7 gap-2 items-center ${isCurrent ? "bg-amber-50" : "bg-white"}`} data-testid={`chain-${ci.id}`}>
                      <span className="font-mono font-bold">{ci.invoice_number}{isCurrent && " ←"}</span>
                      <span className="text-slate-500">{fmtTs(ci.created_at)}</span>
                      <span>Total: <b>${(ci.total || 0).toFixed(2)}</b></span>
                      <span>Envío: ${(ci.shipping_cost || 0).toFixed(2)}</span>
                      <span>Ant: ${(ci.saldo_a_favor_anterior || 0).toFixed(2)}</span>
                      <span>Dep: ${(ci.deposits_applied || 0).toFixed(2)}</span>
                      <span className="text-right">
                        {ci.is_annulled ? <Badge className="bg-rose-500 text-[10px]">ANULADA</Badge> : (
                          <span>Pagar: <b>${(ci.total_a_pagar || 0).toFixed(2)}</b> · Fav: ${(ci.saldo_a_favor || 0).toFixed(2)}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Linked purchases including soft-deleted */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 flex items-center gap-2">
                <ShoppingBag className="h-3.5 w-3.5" />
                Compras vinculadas ({linked.length})
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                {linked.map((p) => (
                  <div key={p.id} className={`px-3 py-2 text-xs flex items-center gap-2 ${p.is_deleted ? "bg-rose-50 line-through opacity-70" : "bg-white"}`}>
                    <span className="font-mono text-slate-400 text-[10px]">{p.id.slice(0, 6)}</span>
                    <span className="font-bold flex-shrink-0">{p.store || "—"}</span>
                    <span className="text-slate-600 truncate flex-1">{p.item_name || "—"}</span>
                    <span className="text-slate-500 text-[10px]">{fmtTs(p.created_at)}</span>
                    <span className="text-right font-bold">${(p.total || 0).toFixed(2)}</span>
                    {p.is_deleted && <Badge className="bg-rose-500 text-[9px]">ELIMINADA</Badge>}
                  </div>
                ))}
              </div>
            </div>

            {/* Wallet transactions */}
            {wallet.length > 0 && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 flex items-center gap-2">
                  <Wallet className="h-3.5 w-3.5" />
                  Depósitos del cliente ({wallet.length})
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {wallet.map((tx) => (
                    <div key={tx.id} className={`px-3 py-2 text-xs flex items-center gap-2 ${tx.is_deleted ? "bg-rose-50 opacity-70" : "bg-white"}`}>
                      <span className="font-bold w-20 flex-shrink-0">${(tx.amount || 0).toFixed(2)}</span>
                      <span className="text-slate-500 text-[10px] w-32">{fmtTs(tx.approved_at || tx.created_at)}</span>
                      <span className="text-slate-600 truncate flex-1">{tx.description || ""}</span>
                      {tx.is_deleted ? (
                        <Badge className="bg-rose-500 text-[9px]">ELIMINADO</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">{tx.status}</Badge>
                      )}
                      {tx.approved_by_name && <span className="text-[10px] text-slate-500">por {tx.approved_by_name}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="rounded-xl border-2 border-amber-200 overflow-hidden">
              <div className="bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Timeline completo ({timeline.length} eventos) — orden cronológico inverso
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-amber-100">
                {timeline.length === 0 && (
                  <p className="text-center py-4 text-xs text-slate-500 italic">Sin eventos en audit log para esta factura.</p>
                )}
                {timeline.map((ev, idx) => {
                  const meta = actionMeta[ev.type] || { color: "bg-slate-100 text-slate-700 border-slate-200", icon: AlertCircle, label: ev.type };
                  const Icon = meta.icon;
                  return (
                    <div key={idx} className="px-3 py-2 text-xs flex items-start gap-2" data-testid={`timeline-${idx}`}>
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-bold ${meta.color} flex items-center gap-1`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-slate-500">{fmtTs(ev.ts)}</span>
                          {ev.user_name && (
                            <span className="font-bold text-slate-700">{ev.user_name}</span>
                          )}
                          {ev.user_role && <span className="text-[10px] text-slate-400">({ev.user_role})</span>}
                          {ev.entity_name && <span className="text-slate-600 truncate">· {ev.entity_name}</span>}
                        </div>
                        {ev.details && typeof ev.details === "object" && Object.keys(ev.details).length > 0 && (
                          <details className="mt-0.5">
                            <summary className="cursor-pointer text-[10px] text-blue-700 font-bold">ver detalles</summary>
                            <pre className="mt-1 text-[10px] bg-slate-50 p-1 rounded overflow-x-auto">{JSON.stringify(ev.details, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Interpretation hint */}
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-[11px] text-indigo-900">
              <p className="font-bold mb-1">📖 Cómo interpretar</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Si ves <b>delete_purchase</b> → alguien eliminó una compra. Revisa el usuario y la fecha.</li>
                <li>Si ves <b>update_purchase</b> con cambio en `price` → editaron el precio.</li>
                <li>Si ves <b>invoice_annulled</b> en otra factura del cliente → eso disparó recálculo en cascada.</li>
                <li>Si ves <b>wallet_deposit_deleted</b> → un depósito fue removido y la cascada se reordenó.</li>
                <li>Si la cadena muestra que una factura previa cambió saldo → este invoice recibió diferente `saldo_a_favor_anterior`.</li>
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
