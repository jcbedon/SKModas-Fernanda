import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getDuplicateRecharges, fixDuplicateRecharges } from "@/lib/api";

const fmt = (v) => "$" + Number(v || 0).toFixed(2);

export const DuplicateRecharges = ({ onFixed }) => {
  const [data, setData] = useState({ duplicates: [], total_extra: 0 });
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const load = () => getDuplicateRecharges().then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const fix = async () => {
    if (!window.confirm(`¿Anular ${data.duplicates.reduce((n, d) => n + d.duplicate_row_ids.length, 0)} movimiento(s) duplicado(s) por ${fmt(data.total_extra)}? Se conserva una entrada por recarga y las anuladas quedan tachadas como registro.`)) return;
    setFixing(true);
    try {
      const r = await fixDuplicateRecharges();
      toast.success(`${r.data.fixed_rows} duplicado(s) anulado(s) · ${fmt(r.data.total_removed)} corregidos`);
      setOpen(false);
      await load();
      onFixed?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al corregir");
    } finally {
      setFixing(false);
    }
  };

  const count = data.duplicates.length;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { load(); setOpen(true); }}
        className={`rounded-lg gap-1 ${count ? "bg-red-500 text-white hover:bg-red-600" : "text-white hover:bg-white/10"}`}
        data-testid="duplicate-recharges-btn">
        <Copy className="h-4 w-4" /> {count ? `${count} duplicado${count === 1 ? "" : "s"}` : "Revisar duplicados"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="duplicate-recharges-dialog">
          <DialogHeader><DialogTitle>Recargas duplicadas en Cuentas</DialogTitle></DialogHeader>
          {count === 0 ? (
            <div className="text-center py-8 text-slate-500"><ShieldCheck className="h-10 w-10 mx-auto text-green-500 mb-2" />No hay recargas duplicadas</div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Estas recargas aparecen más de una vez en el libro de la cuenta. La recarga del cliente es una sola; solo se anulan las copias extra.</p>
              <div className="max-h-80 overflow-auto space-y-2">
                {data.duplicates.map((d) => (
                  <div key={d.source_transaction_id} className="border rounded-lg p-3 flex justify-between text-sm" data-testid={`duplicate-row-${d.source_transaction_id}`}>
                    <div>
                      <p className="font-semibold">{d.customer_name || d.customer_id} <span className="text-slate-400">#{d.customer_id}</span></p>
                      <p className="text-xs text-slate-500">{d.account_name} · Ref {d.reference_number || "—"} · {fmt(d.amount)}</p>
                    </div>
                    <p className="text-red-600 font-bold">{d.duplicate_row_ids.length + 1}× · sobra {fmt(d.extra_amount)}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <p className="font-bold">Total sobrante: <span className="text-red-600" data-testid="duplicate-total-extra">{fmt(data.total_extra)}</span></p>
                <Button onClick={fix} disabled={fixing} className="bg-red-600 hover:bg-red-700 text-white" data-testid="fix-duplicates-btn">
                  {fixing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Anular duplicados
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
