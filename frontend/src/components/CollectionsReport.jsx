import { useState, useEffect, useMemo } from "react";
import { getCollectionsReport } from "@/lib/api";
import { generateCollectionsReportPDF } from "@/lib/collectionsReportPDF";
import { getWeekKey } from "@/lib/weekKey";
import { toast } from "sonner";
import { useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDown, Search, Calendar, MessageCircle, ChevronDown, ChevronUp, HandCoins, Package, Truck } from "lucide-react";

const fmtMoney = (v) => "$" + Number(v || 0).toFixed(2);
const fmtDate = (s) => new Date(s).toLocaleString("es-EC", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const dateToKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const shortLabel = (dt) => dt.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");

const buildOptions = () => {
  const weeks = [], days = [];
  for (let i = 0; i < 84; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const wk = getWeekKey(d.toISOString());
    if (!weeks.find((w) => w.key === wk) && weeks.length < 12) {
      const end = keyToDate(wk); end.setDate(end.getDate() + 6);
      weeks.push({ key: wk, label: `${shortLabel(keyToDate(wk))} - ${shortLabel(end)}` });
    }
    if (i < 30) days.push({ key: dateToKey(d), label: d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }) });
  }
  return { weeks, days };
};

const waUrl = (c, tenantName) => {
  let digits = String(c.whatsapp || "").replace(/[^0-9]/g, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = "593" + digits.slice(1);
  const msg = c.is_paid
    ? `Hola ${c.name}, gracias por tu pago de ${fmtMoney(c.last_payment_amount)}. Tu factura ya está cancelada. ¡Gracias por comprar con ${tenantName}!`
    : `Hola ${c.name}, recibimos tu abono de ${fmtMoney(c.last_payment_amount)}. Te falta pagar ${fmtMoney(c.remaining)} para completar tu factura. ¡Gracias! — ${tenantName}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
};

const CollectionRow = ({ c, idx, tenantName }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-xl bg-white" data-testid={`collection-row-${c.customer_id}`}>
      <div className="flex items-center gap-3 p-3 flex-wrap">
        <span className="text-xs font-bold text-slate-400 w-6">{idx + 1}</span>
        <div className="flex-1 min-w-[160px]">
          <p className="font-semibold text-slate-800">{c.name} <Badge variant="outline" className="ml-1 text-[10px]">#{c.customer_id}</Badge></p>
          <p className="text-xs text-slate-500">Último pago: {fmtDate(c.last_payment_at)} · <span className="font-semibold text-green-700">{fmtMoney(c.last_payment_amount)}</span></p>
        </div>
        <div className="min-w-[120px]" data-testid={`collection-packages-${c.customer_id}`}>
          <p className="text-[10px] uppercase text-slate-400">Paquetes</p>
          {c.packages_total > 0
            ? <p className="text-sm font-semibold text-slate-700 flex items-center gap-1"><Package className="h-3.5 w-3.5 text-indigo-500" />{c.packages_total} · <span className="text-xs text-slate-500">{c.packages_breakdown}</span></p>
            : <p className="text-xs text-slate-400">Sin paquetes</p>}
          {c.paid_without_shipment && (
            <Badge className="mt-0.5 bg-orange-100 text-orange-700 hover:bg-orange-100 text-[10px] gap-1" data-testid={`collection-unshipped-${c.customer_id}`}>
              <Truck className="h-3 w-3" />Pagado sin envío: {c.unshipped_paid_invoices.join(", ")}
            </Badge>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-slate-400">Abonado</p>
          <p className="font-bold text-green-700" data-testid={`collection-paid-${c.customer_id}`}>{fmtMoney(c.paid_in_period)}</p>
        </div>
        <div className="text-right min-w-[90px]">
          <p className="text-[10px] uppercase text-slate-400">Falta</p>
          {c.is_paid
            ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100" data-testid={`collection-status-${c.customer_id}`}>Pagado</Badge>
            : <p className="font-bold text-red-600" data-testid={`collection-remaining-${c.customer_id}`}>{fmtMoney(c.remaining)}</p>}
        </div>
        {c.whatsapp && (
          <a href={waUrl(c, tenantName)} target="_blank" rel="noreferrer" data-testid={`collection-wa-${c.customer_id}`}>
            <Button size="sm" variant="outline" className="rounded-lg border-green-300 text-green-700 gap-1"><MessageCircle className="h-4 w-4" />WhatsApp</Button>
          </a>
        )}
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setOpen(!open)} data-testid={`collection-toggle-${c.customer_id}`}>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      {open && (
        <div className="border-t px-12 py-2 space-y-1 bg-slate-50 rounded-b-xl">
          {c.payments.map((p, i) => (
            <div key={i} className="flex justify-between text-xs text-slate-600"><span>{fmtDate(p.created_at)}</span><span className="font-semibold text-green-700">{fmtMoney(p.amount)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function CollectionsReport() {
  const { user } = useAuth();
  const tenantName = user?.tenant_name || "nuestra tienda";
  const { weeks, days } = useMemo(buildOptions, []);
  const [mode, setMode] = useState("week");
  const [week, setWeek] = useState(weeks[0].key);
  const [day, setDay] = useState(days[0].key);
  const [search, setSearch] = useState("");
  const [onlyUnshipped, setOnlyUnshipped] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    const start = mode === "all" ? null : keyToDate(mode === "week" ? week : day);
    if (!start) return {};
    const end = new Date(start); end.setDate(end.getDate() + (mode === "week" ? 7 : 1)); end.setMilliseconds(-1);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [mode, week, day]);

  useEffect(() => {
    setLoading(true);
    getCollectionsReport(range).then((r) => setData(r.data)).catch(() => toast.error("Error al cargar cobranza")).finally(() => setLoading(false));
  }, [range]);

  const rows = (data?.clients || []).filter((c) => {
    if (onlyUnshipped && !c.paid_without_shipment) return false;
    const t = search.trim().toLowerCase();
    return !t || c.name.toLowerCase().includes(t) || c.customer_id.toLowerCase().includes(t);
  });
  const periodLabel = mode === "all" ? "Todo" : mode === "week" ? weeks.find((w) => w.key === week)?.label : days.find((d) => d.key === day)?.label;
  const t = data?.totals || {};

  return (
    <div className="space-y-4" data-testid="collections-report">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex gap-1">
          {[["week", "Semana"], ["day", "Día"], ["all", "Todo"]].map(([k, l]) => (
            <Button key={k} size="sm" variant={mode === k ? "default" : "outline"} onClick={() => setMode(k)} className={`rounded-xl ${mode === k ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`} data-testid={`collections-mode-${k}`}>{l}</Button>
          ))}
        </div>
        {mode !== "all" && (
          <Select value={mode === "week" ? week : day} onValueChange={mode === "week" ? setWeek : setDay}>
            <SelectTrigger className="w-48 rounded-xl h-9" data-testid="collections-period-select"><Calendar className="h-4 w-4 mr-2 text-gray-400" /><SelectValue /></SelectTrigger>
            <SelectContent>{(mode === "week" ? weeks : days).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" onClick={() => setOnlyUnshipped(!onlyUnshipped)}
          className={`rounded-xl gap-1 h-9 ${onlyUnshipped ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500" : "border-orange-300 text-orange-700"}`}
          data-testid="collections-unshipped-filter">
          <Truck className="h-4 w-4" /> Pagado sin envío ({data?.totals?.paid_without_shipment_count ?? 0})
        </Button>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o ID..." className="pl-9 rounded-xl h-9" data-testid="collections-search" />
        </div>
        <Button className="rounded-xl gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!rows.length} data-testid="collections-pdf-btn"
          onClick={() => generateCollectionsReportPDF({ tenantName: user?.tenant_name, clients: rows, totals: {
            total_paid: rows.reduce((a, c) => a + c.paid_in_period, 0),
            total_remaining: rows.reduce((a, c) => a + c.remaining, 0),
            paid_off_count: rows.filter((c) => c.is_paid).length,
          }, periodLabel: onlyUnshipped ? `${periodLabel} · Pagado sin envío` : periodLabel })}>
          <FileDown className="h-4 w-4" /> Descargar PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Clientes que abonaron", t.clients_count ?? 0, "text-slate-800", "collections-kpi-clients"],
          ["Total abonado", fmtMoney(t.total_paid), "text-green-700", "collections-kpi-paid"],
          ["Falta por cobrar", fmtMoney(t.total_remaining), "text-red-600", "collections-kpi-remaining"],
          ["Ya pagaron todo", t.paid_off_count ?? 0, "text-emerald-600", "collections-kpi-paidoff"]].map(([l, v, cls, id]) => (
          <Card key={id} className="rounded-xl"><CardContent className="p-3"><p className="text-[11px] text-slate-500">{l}</p><p className={`text-lg font-bold ${cls}`} data-testid={id}>{v}</p></CardContent></Card>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 text-center py-8">Cargando...</p>
      ) : rows.length === 0 ? (
        <Card className="rounded-xl border-dashed"><CardContent className="p-8 text-center text-slate-500"><HandCoins className="h-10 w-10 mx-auto text-slate-300 mb-2" />{onlyUnshipped ? "No hay clientes con factura pagada sin envío en este período" : "Nadie con factura pendiente ha abonado en este período"}</CardContent></Card>
      ) : (
        <div className="space-y-2">{rows.map((c, i) => <CollectionRow key={c.id} c={c} idx={i} tenantName={tenantName} />)}</div>
      )}
      <p className="text-[11px] text-slate-400">Ordenado por el pago más reciente. Incluye clientes con factura pendiente o que la terminaron de pagar con recargas posteriores a la factura.</p>
    </div>
  );
}
