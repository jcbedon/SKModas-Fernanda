import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getAuditLogs, getAuditUsers, getAuditActions, getAuditHistory } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { toast } from "sonner";
import {
  FileText, Search, User, Calendar, Filter, ChevronLeft, ChevronRight, Clock,
  Activity, ArrowLeft, Trash2, Receipt, Wallet, Store, Radio, AlertTriangle,
} from "lucide-react";

const ACTION_COLORS = {
  create_client: "bg-green-100 text-green-700",
  update_client: "bg-yellow-100 text-yellow-700",
  delete_client: "bg-red-100 text-red-700",
  create_purchase: "bg-green-100 text-green-700",
  update_purchase: "bg-yellow-100 text-yellow-700",
  invoice_totals_updated: "bg-blue-100 text-blue-700",
  delete_purchase: "bg-red-100 text-red-700",
  approve_recharge: "bg-emerald-100 text-emerald-700",
  reject_recharge: "bg-red-100 text-red-700",
  delete_recharge: "bg-red-100 text-red-700",
  adjust_wallet: "bg-orange-100 text-orange-700",
  create_recharge: "bg-emerald-100 text-emerald-700",
  create_shipment: "bg-purple-100 text-purple-700",
  update_shipment: "bg-purple-100 text-purple-700",
  delete_shipment: "bg-red-100 text-red-700",
  create_invoice: "bg-indigo-100 text-indigo-700",
  approve_invoice: "bg-emerald-100 text-emerald-700",
  reopen_invoice: "bg-yellow-100 text-yellow-700",
  invoice_annulled: "bg-red-100 text-red-700",
  create_live: "bg-pink-100 text-pink-700",
  start_live: "bg-pink-100 text-pink-700",
  end_live: "bg-pink-100 text-pink-700",
  create_employee: "bg-cyan-100 text-cyan-700",
  update_employee: "bg-cyan-100 text-cyan-700",
  delete_employee: "bg-red-100 text-red-700",
};

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

export default function AdminAuditLog() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

  const [tab, setTab] = useState("audit");

  // ---------- AUDIT TAB STATE ----------
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [actions, setActions] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ user_id: "", action: "", start_date: "", end_date: "" });
  const limit = 20;

  // ---------- HISTORIAL TAB STATE ----------
  const [historyDays, setHistoryDays] = useState(7);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState({ deleted_purchases: [], annulled_invoices: [], approved_recharges: [] });
  const [historyFilter, setHistoryFilter] = useState("");

  useEffect(() => { loadInitialData(); }, []);

  useEffect(() => {
    if (tab === "audit") loadLogs();
  }, [page, filters, tab]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, historyDays]);

  // Refresh on tab focus
  useRefreshOnTabFocus(() => {
    if (tab === "audit") loadLogs();
    else loadHistory();
  });

  const loadInitialData = async () => {
    try {
      const [usersRes, actionsRes] = await Promise.all([getAuditUsers(), getAuditActions()]);
      setUsers((usersRes.data || []).filter((u) => u.user_id));
      setActions(actionsRes.data || []);
    } catch (error) {
      console.error("Error loading initial data:", error);
    }
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const params = {
        limit, skip: page * limit,
        ...Object.fromEntries(Object.entries(filters).filter(([_k, v]) => v !== "" && v !== "all")),
      };
      const response = await getAuditLogs(params);
      setLogs(response.data.logs || []);
      setTotal(response.data.total || 0);
    } catch (error) {
      toast.error("Error al cargar registros de auditoría");
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await getAuditHistory(historyDays);
      setHistory(res.data || { deleted_purchases: [], annulled_invoices: [], approved_recharges: [] });
    } catch (error) {
      toast.error("No se pudo cargar el historial");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const getActionLabel = (key) => actions.find((a) => a.value === key)?.label || key;
  const totalPages = Math.ceil(total / limit);

  const filterText = historyFilter.trim().toUpperCase();
  const matchText = (s) => !filterText || (s || "").toUpperCase().includes(filterText);
  const filteredDeleted = history.deleted_purchases.filter(
    (p) => matchText(p.customer_id) || matchText(p.customer_name) || matchText(p.item_name) || matchText(p.store) || matchText(p.live_title)
  );
  const filteredAnnulled = history.annulled_invoices.filter(
    (a) => matchText(a.customer_id) || matchText(a.customer_name) || matchText(a.invoice_number)
  );
  const filteredRecharges = history.approved_recharges.filter(
    (r) => matchText(r.customer_id) || matchText(r.customer_name) || matchText(r.description)
  );

  return (
    <div className="app-bg min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b" style={{ background: "rgba(255,255,255,0.95)", borderColor: "#E5E7EB" }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Registro de Auditoría</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2 rounded-xl h-11 bg-white border" data-testid="audit-tabs">
            <TabsTrigger value="audit" className="rounded-lg data-[state=active]:bg-slate-800 data-[state=active]:text-white" data-testid="tab-audit">
              <Activity className="h-4 w-4 mr-2" /> Auditoría
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg data-[state=active]:bg-red-600 data-[state=active]:text-white" data-testid="tab-history">
              <Trash2 className="h-4 w-4 mr-2" /> Historial
            </TabsTrigger>
          </TabsList>

          {/* ============ AUDIT TAB ============ */}
          <TabsContent value="audit" className="mt-6 space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-600">Usuario</label>
                    <Select value={filters.user_id} onValueChange={(v) => handleFilterChange("user_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Todos los usuarios" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los usuarios</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>
                            {u.user_name || u.user_id} ({u.user_role || "—"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-600">Acción</label>
                    <Select value={filters.action} onValueChange={(v) => handleFilterChange("action", v)}>
                      <SelectTrigger><SelectValue placeholder="Todas las acciones" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las acciones</SelectItem>
                        {actions.map((a) => (<SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-600">Desde</label>
                    <Input type="date" value={filters.start_date} onChange={(e) => handleFilterChange("start_date", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-600">Hasta</label>
                    <Input type="date" value={filters.end_date} onChange={(e) => handleFilterChange("end_date", e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardContent className="pt-6 flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-lg"><Activity className="h-6 w-6 text-blue-600" /></div>
                <div><p className="text-sm text-slate-500">Total Registros</p><p className="text-2xl font-bold text-slate-800">{total}</p></div>
              </CardContent></Card>
              <Card><CardContent className="pt-6 flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-lg"><User className="h-6 w-6 text-green-600" /></div>
                <div><p className="text-sm text-slate-500">Usuarios Activos</p><p className="text-2xl font-bold text-slate-800">{users.length}</p></div>
              </CardContent></Card>
              <Card><CardContent className="pt-6 flex items-center gap-4">
                <div className="p-3 bg-purple-100 rounded-lg"><FileText className="h-6 w-6 text-purple-600" /></div>
                <div><p className="text-sm text-slate-500">Página</p><p className="text-2xl font-bold text-slate-800">{page + 1} de {totalPages || 1}</p></div>
              </CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Registros de Actividad</CardTitle></CardHeader>
              <CardContent>
                {loadingLogs ? (
                  <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
                ) : logs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500"><FileText className="h-12 w-12 mx-auto mb-4 text-slate-300" /><p>No hay registros de auditoría</p></div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {logs.map((log) => (
                        <div key={log.id} className="p-4 bg-slate-50 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge className={ACTION_COLORS[log.action] || "bg-slate-100 text-slate-700"}>{getActionLabel(log.action)}</Badge>
                                <Badge variant="outline" className="text-xs">{log.user_role === "admin" ? "Admin" : "Empleado"}</Badge>
                              </div>
                              <p className="font-medium text-slate-800">
                                <span className="text-blue-600">{log.user_name}</span>{" "}
                                <span className="text-slate-500 font-normal">realizó</span>{" "}
                                {getActionLabel(log.action).toLowerCase()}
                                {log.entity_name && (<><span className="text-slate-500 font-normal"> en </span><span className="text-emerald-600">{log.entity_name}</span></>)}
                              </p>
                              {log.details && Object.keys(log.details).length > 0 && (
                                <div className="mt-2 text-sm text-slate-500">
                                  <details className="cursor-pointer">
                                    <summary className="hover:text-slate-700">Ver detalles</summary>
                                    <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-x-auto">{JSON.stringify(log.details, null, 2)}</pre>
                                  </details>
                                </div>
                              )}
                            </div>
                            <div className="text-right text-sm text-slate-500 whitespace-nowrap">
                              <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(log.created_at)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-slate-500">Mostrando {page * limit + 1} - {Math.min((page + 1) * limit, total)} de {total}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                        <ChevronLeft className="h-4 w-4" /> Anterior
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                        Siguiente <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ HISTORIAL TAB ============ */}
          <TabsContent value="history" className="mt-6 space-y-6">
            {/* Header bar */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-red-600" /> Historial de Acciones Sensibles
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Productos eliminados, facturas anuladas y recargas aprobadas en el rango seleccionado.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-slate-400" />
                    <Select value={String(historyDays)} onValueChange={(v) => setHistoryDays(Number(v))}>
                      <SelectTrigger className="h-9 w-[160px] rounded-lg" data-testid="history-days-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">Últimos 7 días</SelectItem>
                        <SelectItem value="14">Últimos 14 días</SelectItem>
                        <SelectItem value="30">Últimos 30 días</SelectItem>
                        <SelectItem value="60">Últimos 60 días</SelectItem>
                        <SelectItem value="90">Últimos 90 días</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={historyFilter}
                    onChange={(e) => setHistoryFilter(e.target.value)}
                    placeholder="Filtrar por código, nombre, ítem, tienda, live..."
                    className="pl-9 h-10 rounded-lg uppercase"
                    data-testid="history-filter"
                  />
                </div>
              </CardContent>
            </Card>

            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-600" />
              </div>
            ) : (
              <>
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-3">
                  <Card data-testid="kpi-deleted">
                    <CardContent className="pt-6 flex items-center gap-4">
                      <div className="p-3 bg-red-100 rounded-lg"><Trash2 className="h-6 w-6 text-red-600" /></div>
                      <div>
                        <p className="text-sm text-slate-500">Productos Eliminados</p>
                        <p className="text-2xl font-bold text-slate-800">{filteredDeleted.length}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-annulled">
                    <CardContent className="pt-6 flex items-center gap-4">
                      <div className="p-3 bg-amber-100 rounded-lg"><Receipt className="h-6 w-6 text-amber-600" /></div>
                      <div>
                        <p className="text-sm text-slate-500">Facturas Anuladas</p>
                        <p className="text-2xl font-bold text-slate-800">{filteredAnnulled.length}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-recharges">
                    <CardContent className="pt-6 flex items-center gap-4">
                      <div className="p-3 bg-emerald-100 rounded-lg"><Wallet className="h-6 w-6 text-emerald-600" /></div>
                      <div>
                        <p className="text-sm text-slate-500">Recargas Aprobadas</p>
                        <p className="text-2xl font-bold text-slate-800">{filteredRecharges.length}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Deleted purchases */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-700">
                      <Trash2 className="h-5 w-5" /> Productos Eliminados
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {filteredDeleted.length === 0 ? (
                      <p className="text-center text-slate-400 py-8 text-sm">Sin productos eliminados en este rango</p>
                    ) : (
                      <div className="space-y-2">
                        {filteredDeleted.map((p, i) => (
                          <div key={i} className="p-3 bg-red-50/40 rounded-lg border border-red-100" data-testid={`deleted-row-${i}`}>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-xs">{p.customer_id || "—"}</Badge>
                                <span className="text-sm font-bold text-slate-800">{p.customer_name || "Sin nombre"}</span>
                                <span className="text-sm text-slate-700">·</span>
                                <span className="text-sm font-medium text-slate-700">{p.item_name}</span>
                                {p.source === "refund" && (
                                  <Badge className="bg-slate-100 text-slate-500 text-[10px]" title="Eliminación previa al sistema de auditoría enriquecida — no se conservó tienda ni live.">legacy</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-slate-500">
                                <Clock className="h-3 w-3" />{formatDate(p.deleted_at)}
                                <span className="font-bold text-red-600">{money(p.total)}</span>
                              </div>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
                              {p.store && (<span className="flex items-center gap-1"><Store className="h-3 w-3 text-slate-400" /> {p.store}</span>)}
                              {p.live_title && (<span className="flex items-center gap-1"><Radio className="h-3 w-3 text-slate-400" /> {p.live_title}</span>)}
                              {p.deleted_by && (<span className="flex items-center gap-1"><User className="h-3 w-3 text-slate-400" /> Eliminó: <span className="font-semibold text-slate-700">{p.deleted_by}</span></span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {history.deleted_purchases.some((p) => p.source === "refund") && (
                      <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <span>Las eliminaciones previas a hoy no incluyen tienda ni live (se reconstruyen desde la transacción de reembolso). Las eliminaciones desde hoy registran toda la información.</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Annulled invoices */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-amber-700">
                      <Receipt className="h-5 w-5" /> Facturas Anuladas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {filteredAnnulled.length === 0 ? (
                      <p className="text-center text-slate-400 py-8 text-sm">Sin facturas anuladas en este rango</p>
                    ) : (
                      <div className="space-y-2">
                        {filteredAnnulled.map((a, i) => (
                          <div key={i} className="p-3 bg-amber-50/40 rounded-lg border border-amber-100" data-testid={`annulled-row-${i}`}>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-xs">{a.customer_id || "—"}</Badge>
                                <span className="text-sm font-bold text-slate-800">{a.customer_name || "Sin nombre"}</span>
                                <span className="text-sm text-slate-700">·</span>
                                <span className="text-sm font-medium text-slate-700">{a.invoice_number || a.invoice_id}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-slate-500">
                                <Clock className="h-3 w-3" />{formatDate(a.annulled_at)}
                                <span className="font-bold text-amber-700">{money(a.total)}</span>
                              </div>
                            </div>
                            {a.annulled_by && (
                              <div className="mt-1 text-xs text-slate-600 flex items-center gap-1">
                                <User className="h-3 w-3 text-slate-400" /> Anuló: <span className="font-semibold text-slate-700">{a.annulled_by}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Approved recharges */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-emerald-700">
                      <Wallet className="h-5 w-5" /> Recargas Aprobadas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {filteredRecharges.length === 0 ? (
                      <p className="text-center text-slate-400 py-8 text-sm">Sin recargas aprobadas en este rango</p>
                    ) : (
                      <div className="space-y-2">
                        {filteredRecharges.map((r, i) => (
                          <div key={i} className="p-3 bg-emerald-50/40 rounded-lg border border-emerald-100" data-testid={`recharge-row-${i}`}>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-xs">{r.customer_id || "—"}</Badge>
                                <span className="text-sm font-bold text-slate-800">{r.customer_name || "Sin nombre"}</span>
                                {r.description && (<span className="text-sm text-slate-500">· {r.description}</span>)}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-slate-500">
                                <Clock className="h-3 w-3" />{formatDate(r.approved_at)}
                                <span className="font-bold text-emerald-700">{money(r.amount)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
