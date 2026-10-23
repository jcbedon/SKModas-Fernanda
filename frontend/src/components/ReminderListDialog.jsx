import { useState, useEffect } from "react";
import { BellRing, CheckCircle2, MessageCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { waUrl } from "@/lib/collectionsWhatsApp";

const storeKey = () => `reminders-sent-${new Date().toISOString().slice(0, 10)}`;
const readSent = () => { try { return JSON.parse(localStorage.getItem(storeKey()) || "{}"); } catch { return {}; } };

export const ReminderListDialog = ({ debtors, tenantName }) => {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(readSent);
  useEffect(() => { if (open) setSent(readSent()); }, [open]);

  const markSent = (id) => {
    const next = { ...sent, [id]: new Date().toISOString() };
    setSent(next);
    localStorage.setItem(storeKey(), JSON.stringify(next));
  };
  const reset = () => { setSent({}); localStorage.removeItem(storeKey()); };
  const withPhone = debtors.filter((c) => c.whatsapp);
  const pending = withPhone.filter((c) => !sent[c.id]);
  const next = pending[0];
  const send = (c) => { markSent(c.id); window.open(waUrl(c, tenantName), "_blank", "noopener"); };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!debtors.length}
        className="rounded-xl gap-1 h-9 border-red-300 text-red-700" data-testid="reminders-open-btn">
        <BellRing className="h-4 w-4" /> Recordatorios ({debtors.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="reminders-dialog">
          <DialogHeader><DialogTitle>Recordatorios a deudores sin abonos</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between text-sm">
            <p className="text-slate-600">
              Enviados hoy: <b data-testid="reminders-sent-count">{withPhone.length - pending.length}</b> de {withPhone.length}
              {debtors.length > withPhone.length && <span className="text-amber-600"> · {debtors.length - withPhone.length} sin WhatsApp</span>}
            </p>
            <Button size="sm" variant="ghost" onClick={reset} className="gap-1 text-slate-500" data-testid="reminders-reset-btn"><RotateCcw className="h-3.5 w-3.5" />Reiniciar</Button>
          </div>
          {next ? (
            <Button onClick={() => send(next)} className="w-full h-11 rounded-xl bg-green-600 hover:bg-green-700 text-white gap-2" data-testid="reminders-send-next-btn">
              <MessageCircle className="h-4 w-4" /> Enviar al siguiente: {next.name} · ${next.remaining.toFixed(2)}
            </Button>
          ) : (
            <p className="text-center text-green-700 font-semibold py-2 flex items-center justify-center gap-2" data-testid="reminders-done"><CheckCircle2 className="h-5 w-5" />Todos los recordatorios enviados</p>
          )}
          <div className="max-h-80 overflow-auto space-y-1.5">
            {debtors.map((c) => (
              <div key={c.id} className={`flex items-center gap-2 border rounded-lg p-2 text-sm ${sent[c.id] ? "bg-green-50 border-green-200" : ""}`} data-testid={`reminder-row-${c.customer_id}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.name} <span className="text-slate-400 text-xs">#{c.customer_id}</span></p>
                  <p className="text-xs text-red-600">Debe ${c.remaining.toFixed(2)}</p>
                </div>
                {sent[c.id] && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Enviado</Badge>}
                {c.whatsapp ? (
                  <Button size="sm" variant="outline" onClick={() => send(c)} className="h-8 border-green-300 text-green-700 gap-1" data-testid={`reminder-send-${c.customer_id}`}>
                    <MessageCircle className="h-3.5 w-3.5" />{sent[c.id] ? "Reenviar" : "Enviar"}
                  </Button>
                ) : <span className="text-xs text-amber-600">Sin WhatsApp</span>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">Cada botón abre tu WhatsApp con el mensaje listo; solo presiona enviar. Las marcas de "Enviado" se guardan en este dispositivo durante el día.</p>
        </DialogContent>
      </Dialog>
    </>
  );
};
