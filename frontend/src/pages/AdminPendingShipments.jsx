import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getInvoicesWithoutShipment } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Truck, Search, ChevronRight, FileText, Users, AlertCircle,
} from "lucide-react";

// Week boundary helper: Monday 12:00 local → next Monday 11:59:59 local.
// Returns an ISO date string (yyyy-mm-dd) of the start-Monday at noon as a stable bucket key.
function getWeekKey(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDay();
  const daysSinceMonday = (day - 1 + 7) % 7;
  const candidate = new Date(d);
  candidate.setDate(d.getDate() - daysSinceMonday);
  candidate.setHours(12, 0, 0, 0);
  if (candidate > d) candidate.setDate(candidate.getDate() - 7);
  return candidate.toISOString().slice(0, 10);
}

// Compact label, e.g. "10–17 Feb" or "27 Ene–3 Feb" when months differ.
function getWeekLabelShort(weekKey) {
  const start = new Date(`${weekKey}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const monthShort = (dt) => {
    const m = dt.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
    return m.charAt(0).toUpperCase() + m.slice(1);
  };
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) return `${start.getDate()}–${end.getDate()} ${monthShort(start)}`;
  return `${start.getDate()} ${monthShort(start)}–${end.getDate()} ${monthShort(end)}`;
}

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminPendingShipments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ clients: [], invoices_count: 0, clients_count: 0 });
  const [filter, setFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const daysSinceMonday = (day - 1 + 7) % 7;
    const candidate = new Date(now);
    candidate.setDate(now.getDate() - daysSinceMonday);
    candidate.setHours(12, 0, 0, 0);
    if (candidate > now) candidate.setDate(candidate.getDate() - 7);
    return candidate.toISOString().slice(0, 10);
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await getInvoicesWithoutShipment();
        setData(res.data || { clients: [], invoices_count: 0, clients_count: 0 });
      } catch (e) {
        toast.error("No se pudo cargar el reporte");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Every Monday-bucket present across all pending invoices, desc.
  // Always include the current week so the default filter has a matching option.
  const weekOptions = useMemo(() => {
    const set = new Set();
    (data.clients || []).forEach((c) => {
      (c.invoices || []).forEach((inv) => {
        const wk = getWeekKey(inv.created_at);
        if (wk) set.add(wk);
      });
    });
    const currentWeekKey = getWeekKey(new Date().toISOString());
    if (currentWeekKey) set.add(currentWeekKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data.clients]);

  // Apply week filter to invoices first, then drop empty clients, then text filter.
  const filteredClients = useMemo(() => {
    const code = filter.trim().toUpperCase();
    let clients = data.clients || [];
    if (weekFilter !== "all") {
      clients = clients
        .map((c) => ({
          ...c,
          invoices: (c.invoices || []).filter((inv) => getWeekKey(inv.created_at) === weekFilter),
        }))
        .filter((c) => c.invoices.length > 0);
    }
    if (code) {
      clients = clients.filter((c) =>
        (c.customer_id || "").toUpperCase().includes(code) ||
        (c.name || "").toUpperCase().includes(code)
      );
    }
    return clients;
  }, [data.clients, filter, weekFilter]);

  // KPIs reflect the week filter (and text filter) so totals match what the user sees.
  const visibleInvoicesCount = useMemo(
    () => filteredClients.reduce((acc, c) => acc + (c.invoices?.length || 0), 0),
    [filteredClients]
  );

  // When viewing "Todas las semanas", split clients into per-week buckets so the UI
  // can render a sticky "SEMANA: …" header above each group (matches the pattern
  // used in AdminWallet and the client portal).
  const clientsGroupedByWeek = useMemo(() => {
    if (weekFilter !== "all") return null;
    const buckets = {};
    filteredClients.forEach((c) => {
      (c.invoices || []).forEach((inv) => {
        const wk = getWeekKey(inv.created_at) || "sin-fecha";
        if (!buckets[wk]) buckets[wk] = {};
        if (!buckets[wk][c.customer_id]) {
          buckets[wk][c.customer_id] = { customer_id: c.customer_id, name: c.name, invoices: [] };
        }
        buckets[wk][c.customer_id].invoices.push(inv);
      });
    });
    return Object.entries(buckets)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([wk, byCustomer]) => ({
        weekKey: wk,
        label: wk === "sin-fecha" ? "Sin fecha" : getWeekLabelShort(wk),
        clients: Object.values(byCustomer),
        invoicesCount: Object.values(byCustomer).reduce((s, c) => s + c.invoices.length, 0),
      }));
  }, [filteredClients, weekFilter]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="app-bg min-h-screen pb-12">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Envíos Pendientes</span>
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
            <Truck className="h-5 w-5 text-purple-600" />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="rounded-2xl bg-purple-50 border-purple-100" data-testid="kpi-clients">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-purple-700 text-[10px] uppercase font-bold">
                <Users className="h-3.5 w-3.5" /> Clientes
              </div>
              <p className="text-2xl font-extrabold text-purple-900 mt-1">{filteredClients.length}</p>
              <p className="text-[10px] text-purple-700/70">con envíos sin cobrar</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl bg-amber-50 border-amber-100" data-testid="kpi-invoices">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-amber-700 text-[10px] uppercase font-bold">
                <FileText className="h-3.5 w-3.5" /> Facturas
              </div>
              <p className="text-2xl font-extrabold text-amber-900 mt-1">{visibleInvoicesCount}</p>
              <p className="text-[10px] text-amber-700/70">faltan asignar envío</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <Card className="rounded-2xl mb-4">
          <CardContent className="p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
              <Select value={weekFilter} onValueChange={setWeekFilter}>
                <SelectTrigger className="h-10 rounded-xl bg-white" data-testid="pending-shipments-week-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las semanas</SelectItem>
                  {weekOptions.map((wk) => (
                    <SelectItem key={wk} value={wk} data-testid={`week-option-${wk}`}>
                      {getWeekLabelShort(wk)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar por código o nombre"
                  className="h-10 rounded-xl pl-9 uppercase"
                  data-testid="pending-shipments-filter"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Clients list */}
        {filteredClients.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="p-8 text-center text-slate-500">
              <AlertCircle className="h-10 w-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-semibold">
                {data.clients_count === 0
                  ? "Todos los envíos están asignados ✓"
                  : weekFilter !== "all"
                  ? "Sin envíos pendientes en esta semana"
                  : "Sin resultados para este filtro"}
              </p>
            </CardContent>
          </Card>
        ) : clientsGroupedByWeek ? (
          <div className="space-y-5">
            {clientsGroupedByWeek.map((group) => (
              <div key={group.weekKey} className="space-y-3" data-testid={`pending-week-group-${group.weekKey}`}>
                <div className="flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm py-1 z-10 border-b border-slate-200">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Semana: {group.label}
                  </p>
                  <span className="text-xs font-semibold text-slate-600">
                    {group.clients.length} cliente{group.clients.length === 1 ? "" : "s"} · {group.invoicesCount} factura{group.invoicesCount === 1 ? "" : "s"}
                  </span>
                </div>
                {group.clients.map((c) => (
                  <Card key={`${group.weekKey}-${c.customer_id}`} className="rounded-2xl" data-testid={`pending-client-${c.customer_id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="font-mono">{c.customer_id}</Badge>
                          <span className="text-sm font-bold text-slate-800 truncate">{c.name || "Sin nombre"}</span>
                        </div>
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200">{c.invoices.length} factura(s)</Badge>
                      </div>
                      <div className="space-y-1">
                        {c.invoices.map((inv) => (
                          <button
                            key={inv.id}
                            type="button"
                            onClick={() => navigate(`/admin/invoices?invoice_id=${inv.id}&back=/admin/pending-shipments`)}
                            className="w-full flex items-center justify-between gap-2 bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl px-3 py-2 text-left"
                            data-testid={`pending-invoice-${inv.invoice_number}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                              <span className="text-xs font-bold text-slate-700">{inv.invoice_number}</span>
                              <span className="text-[10px] text-slate-500 truncate">
                                {inv.created_at ? new Date(inv.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : ""}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs font-extrabold text-slate-800">${Number(inv.total_a_pagar || 0).toFixed(2)}</span>
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredClients.map((c) => (
              <Card key={c.customer_id} className="rounded-2xl" data-testid={`pending-client-${c.customer_id}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="font-mono">{c.customer_id}</Badge>
                      <span className="text-sm font-bold text-slate-800 truncate">{c.name || "Sin nombre"}</span>
                    </div>
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">{c.invoices.length} factura(s)</Badge>
                  </div>
                  <div className="space-y-1">
                    {c.invoices.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => navigate(`/admin/invoices?invoice_id=${inv.id}&back=/admin/pending-shipments`)}
                        className="w-full flex items-center justify-between gap-2 bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl px-3 py-2 text-left"
                        data-testid={`pending-invoice-${inv.invoice_number}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="text-xs font-bold text-slate-700">{inv.invoice_number}</span>
                          <span className="text-[10px] text-slate-500 truncate">
                            {inv.created_at ? new Date(inv.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-extrabold text-slate-800">${Number(inv.total_a_pagar || 0).toFixed(2)}</span>
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
