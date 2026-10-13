import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getBusinessStats, getClientsDebtsReport, getInactiveClientsReport } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, Wallet, Store, Radio, BarChart3, PieChart as PieChartIcon, Users, AlertTriangle, Search, Filter, ChevronDown, ChevronUp, Receipt, Image, Clock, Phone } from "lucide-react";
import { SalesTrendChart, StoreBarChart, ProfitPieChart, LiveBarChart, ClientsDebtsChart, ClientsDebtsPieChart, ClientsByDateChart } from "@/components/StatsCharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StoreProfitsReport from "@/components/StoreProfitsReport";
import ClientReportGenerator from "@/components/ClientReportGenerator";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminStats() {
  const navigate = useNavigate();
  const { user, hideFinancials } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  
  // Format money - respects hideFinancials permission
  const formatMoney = (n) => {
    if (hideFinancials) return "••••";
    return "$" + (n || 0).toFixed(2);
  };
  
  // ListItem component for ranking lists
  const ListItem = ({ rank, name, count, sales, commission, color }) => (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: color }}>
          {rank}
        </div>
        <div>
          <p className="font-medium text-slate-800">{name}</p>
          <p className="text-xs text-gray-500">{count} ventas</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-slate-800">{formatMoney(sales)}</p>
        <p className="text-xs text-yellow-600">+{formatMoney(commission)}</p>
      </div>
    </div>
  );
  
  // Permission helpers. Admins always see everything. For employees we honor
  // the granular keys; the legacy `view_statistics` toggle acts as a master
  // that auto-grants any sub-permission that hasn't been explicitly set
  // (backwards-compat with employees created before granular permissions
  // existed).
  const isAdmin = user?.role === "admin";
  const userPermissions = user?.permissions || {};
  const masterStats = !!userPermissions.view_statistics;
  const hasStatsPerm = (key) => {
    if (isAdmin) return true;
    if (userPermissions[key] === true) return true;
    // Legacy: if master is on AND no granular tabs were explicitly turned on,
    // grant access so existing employees don't get locked out.
    const anyGranular = [
      "stats_resumen", "stats_tiendas", "stats_deudas",
      "stats_inactivos", "stats_graficas", "stats_detalle",
      "stats_view_money_kpis",
    ].some((k) => userPermissions[k] === true);
    return masterStats && !anyGranular;
  };
  const canSeeMoneyKpis = hasStatsPerm("stats_view_money_kpis");

  const [stats, setStats] = useState(null);
  const [debtsData, setDebtsData] = useState(null);
  const [inactiveData, setInactiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("resumen");
  const [period, setPeriod] = useState("all");
  
  // Filtros para deudas
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [chartLimit, setChartLimit] = useState(15);
  const [tableLimit, setTableLimit] = useState(20);
  const [sortBy, setSortBy] = useState("debt");
  const [sortAsc, setSortAsc] = useState(false);

  // Filtros para inactivos
  const [inactiveThreshold, setInactiveThreshold] = useState(30); // días
  const [inactiveSearch, setInactiveSearch] = useState("");
  const [inactiveLimit, setInactiveLimit] = useState(50);
  const [includeNeverPurchased, setIncludeNeverPurchased] = useState(false);

  const loadStats = async (p) => {
    try {
      setLoading(true);
      const [statsRes, debtsRes, inactiveRes] = await Promise.all([
        getBusinessStats(p || period),
        getClientsDebtsReport(),
        getInactiveClientsReport().catch(() => ({ data: { clients: [], summary: {} } })),
      ]);
      setStats(statsRes.data);
      setDebtsData(debtsRes.data);
      setInactiveData(inactiveRes.data);
    } catch (e) {
      toast.error("Error al cargar estadisticas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadStats());

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    loadStats(newPeriod);
  };

  // Datos filtrados y ordenados
  const filteredClients = useMemo(() => {
    if (!debtsData?.clients) return [];
    
    let result = [...debtsData.clients];
    
    // Filtro de búsqueda
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c => 
        c.name.toLowerCase().includes(term) ||
        c.customer_id.toLowerCase().includes(term) ||
        (c.whatsapp && c.whatsapp.includes(term))
      );
    }
    
    // Filtro de estado
    if (statusFilter === "with_debt") {
      result = result.filter(c => (c.real_debt || 0) > 0.01);
    } else if (statusFilter === "no_debt") {
      result = result.filter(c => (c.real_debt || 0) <= 0.01);
    } else if (statusFilter === "with_pending") {
      // Clientes con compras pendientes de facturar (acumulado mid-semana).
      result = result.filter(c => (c.pending_to_invoice || 0) > 0.01);
    }
    
    // Ordenamiento
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "debt":
          // Highest real debt first
          comparison = (b.real_debt || 0) - (a.real_debt || 0);
          break;
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "code":
          comparison = (a.customer_id || "").localeCompare(b.customer_id || "");
          break;
        case "date":
          comparison = new Date(b.created_at) - new Date(a.created_at);
          break;
        case "balance":
          comparison = a.pending_balance - b.pending_balance;
          break;
        case "days_unpaid": {
          // Most days without paying first.
          const dA = a.last_invoice_date ? Math.floor((Date.now() - new Date(a.last_invoice_date)) / 86400000) : -1;
          const dB = b.last_invoice_date ? Math.floor((Date.now() - new Date(b.last_invoice_date)) / 86400000) : -1;
          comparison = dB - dA;
          break;
        }
        default:
          comparison = (b.real_debt || 0) - (a.real_debt || 0);
      }
      return sortAsc ? -comparison : comparison;
    });
    
    return result;
  }, [debtsData?.clients, searchTerm, statusFilter, sortBy, sortAsc]);

  // Resumen filtrado
  const filteredSummary = useMemo(() => {
    const clients = filteredClients;
    const withDebt = clients.filter(c => (c.real_debt || 0) > 0.01);
    const withCredit = clients.filter(c => (c.real_debt || 0) < -0.01);
    const withPending = clients.filter(c => (c.pending_to_invoice || 0) > 0.01);
    const totalDebt = withDebt.reduce((sum, c) => sum + (c.real_debt || 0), 0);
    const totalCredit = withCredit.reduce((sum, c) => sum + Math.abs(c.real_debt || 0), 0);
    const totalPending = withPending.reduce((sum, c) => sum + (c.pending_to_invoice || 0), 0);

    return {
      total_clients: clients.length,
      clients_with_debt: withDebt.length,
      clients_with_credit: withCredit.length,
      clients_positive_balance: clients.length - withDebt.length,
      total_debt: totalDebt,
      total_credit: totalCredit,
      total_pending_to_invoice: totalPending,
      clients_with_pending: withPending.length,
    };
  }, [filteredClients]);

  // Top clientes con saldo a favor (ordenados de mayor a menor crédito).
  const topCreditClients = useMemo(() => {
    return [...(debtsData?.clients || [])]
      .filter(c => (c.pending_balance || 0) > 0.01)
      .sort((a, b) => (b.pending_balance || 0) - (a.pending_balance || 0));
  }, [debtsData?.clients]);

  // Clientes inactivos según umbral seleccionado + filtro de búsqueda.
  // Los "Nunca compró" se incluyen solo si el toggle está activado, para no
  // saturar la vista cuando solo importa hacer seguimiento de clientes que
  // antes compraban y dejaron de hacerlo.
  const filteredInactive = useMemo(() => {
    if (!inactiveData?.clients) return [];
    const term = inactiveSearch.toLowerCase();
    return inactiveData.clients.filter((c) => {
      const passesThreshold = c.days_since_last_purchase !== null
        ? c.days_since_last_purchase >= inactiveThreshold
        : includeNeverPurchased;
      if (!passesThreshold) return false;
      if (!term) return true;
      return (
        (c.name || "").toLowerCase().includes(term) ||
        (c.customer_id || "").toLowerCase().includes(term) ||
        (c.whatsapp || "").includes(term)
      );
    });
  }, [inactiveData?.clients, inactiveThreshold, inactiveSearch, includeNeverPurchased]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  const rev = stats?.revenue || {};
  const wal = stats?.wallets || {};
  const stores = stats?.sales_by_store || [];
  const lives = stats?.sales_by_live || [];
  const trend = stats?.sales_trend || [];
  const colors = ["#1E3A5F", "#2ECC71", "#E74C3C", "#F39C12", "#9B59B6", "#3498DB"];
  
  // Debts data
  const clientsDebts = debtsData?.clients || [];
  const debtsSummary = debtsData?.summary || {};
  
  // Toggle sort
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;
  };

  return (
    <div className="app-bg min-h-screen">
      <div className="bg-white/90 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
          <span className="font-bold text-slate-800">Estadisticas del Negocio</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Period Filter */}
        <div className="flex flex-wrap gap-2" data-testid="period-filter">
          {[
            { value: "today", label: "Hoy" },
            { value: "7days", label: "7 dias" },
            { value: "30days", label: "30 dias" },
            { value: "90days", label: "90 dias" },
            { value: "all", label: "Todo" }
          ].map((opt) => (
            <Button
              key={opt.value}
              variant={period === opt.value ? "default" : "outline"}
              size="sm"
              className={`rounded-xl text-sm ${period === opt.value ? '' : ''}`}
              style={period === opt.value ? { background: '#1E3A5F', color: 'white' } : {}}
              onClick={() => handlePeriodChange(opt.value)}
              data-testid={`period-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Client PDF Report generator */}
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-purple-50/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="client-report-section">
          <div>
            <p className="text-sm font-bold text-slate-800">Reporte PDF de Clientes</p>
            <p className="text-xs text-slate-500">Filtra por estado, inactividad, mercadería estancada y fechas, y descarga un PDF profesional.</p>
          </div>
          <ClientReportGenerator tenantName={user?.tenant_name || "Reporte de Clientes"} />
        </div>

        {/* Summary Cards — KPIs de dinero (visibles solo si el empleado tiene
            el permiso `stats_view_money_kpis` o es admin). */}
        {canSeeMoneyKpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="rounded-xl bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-4">
              <Badge className="bg-green-600 text-white text-xs mb-2">Ganancia</Badge>
              <p className="text-2xl font-extrabold text-green-700">{formatMoney(rev.gross_profit)}</p>
              <p className="text-xs text-green-600">Solo Comisiones</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-4">
              <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs mb-2">{rev.purchase_count} compras</Badge>
              <p className="text-2xl font-extrabold text-blue-700">{formatMoney(rev.total_product_sales)}</p>
              <p className="text-xs text-blue-600">Ventas Productos</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
            <CardContent className="p-4">
              <TrendingUp className="h-5 w-5 text-yellow-600 mb-2" />
              <p className="text-2xl font-extrabold text-yellow-700">{formatMoney(rev.total_commissions)}</p>
              <p className="text-xs text-yellow-600">Comisiones</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="p-4">
              <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs mb-2">{rev.shipment_count} envios</Badge>
              <p className="text-2xl font-extrabold text-purple-700">{formatMoney(rev.total_shipping)}</p>
              <p className="text-xs text-purple-600">Envios</p>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Tabs — visibility per tab is enforced via `hasStatsPerm(...)`. */}
        {(() => {
          // Compute allowed tabs in display order so we can also redirect the
          // active tab to a permitted one when the user lacks access.
          const tabConfig = [
            { value: "resumen",    perm: "stats_resumen",    label: "Resumen",    Icon: DollarSign,    activeCls: "data-[state=active]:bg-slate-800 data-[state=active]:text-white" },
            { value: "ganancias",  perm: "stats_tiendas",    label: "Tiendas",    Icon: Receipt,       activeCls: "data-[state=active]:bg-green-600 data-[state=active]:text-white" },
            { value: "deudas",     perm: "stats_deudas",     label: "Deudas",     Icon: AlertTriangle, activeCls: "data-[state=active]:bg-red-600 data-[state=active]:text-white" },
            { value: "inactivos",  perm: "stats_inactivos",  label: "Inactivos",  Icon: Clock,         activeCls: "data-[state=active]:bg-orange-600 data-[state=active]:text-white" },
            { value: "graficas",   perm: "stats_graficas",   label: "Graficas",   Icon: BarChart3,     activeCls: "data-[state=active]:bg-slate-800 data-[state=active]:text-white" },
            { value: "detalle",    perm: "stats_detalle",    label: "Detalle",    Icon: Store,         activeCls: "data-[state=active]:bg-slate-800 data-[state=active]:text-white" },
          ];
          const allowedTabs = tabConfig.filter((t) => hasStatsPerm(t.perm));
          if (allowedTabs.length === 0) {
            return (
              <Card className="rounded-xl border-amber-200 bg-amber-50">
                <CardContent className="p-6 text-center text-amber-700 text-sm">
                  No tienes permiso para ver ninguna pestaña de Estadísticas. Pide al administrador que active al menos una.
                </CardContent>
              </Card>
            );
          }
          // If activeTab isn't in allowed list, default to the first allowed.
          const safeActive = allowedTabs.find((t) => t.value === activeTab)?.value || allowedTabs[0].value;
          if (safeActive !== activeTab) {
            // Defer state update to avoid setState-in-render warning.
            setTimeout(() => setActiveTab(safeActive), 0);
          }
          return (
        <Tabs value={safeActive} onValueChange={setActiveTab}>
          <TabsList
            className="grid w-full rounded-xl h-11 bg-white border"
            style={{ gridTemplateColumns: `repeat(${allowedTabs.length}, minmax(0, 1fr))` }}
          >
            {allowedTabs.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className={`rounded-lg text-xs sm:text-sm ${t.activeCls}`}
                data-testid={`tab-${t.value}`}
              >
                <t.Icon className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Resumen Tab */}
          <TabsContent value="resumen" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-green-600" />
                    Desglose de Ingresos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Ventas Productos</span><span className="font-bold">{formatMoney(rev.total_product_sales)}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Tax Cobrado</span><span className="font-bold">{formatMoney(rev.total_tax_collected)}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Comisiones</span><span className="font-bold text-yellow-600">{formatMoney(rev.total_commissions)}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Envios</span><span className="font-bold text-purple-600">{formatMoney(rev.total_shipping)}</span></div>
                  <div className="flex justify-between py-3 bg-green-50 rounded-lg px-3">
                    <span className="font-bold text-green-800">GANANCIA TOTAL</span>
                    <span className="font-extrabold text-2xl text-green-600">{formatMoney(rev.gross_profit)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-blue-600" />
                    Estado de Wallets
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Depositos Recibidos</span><span className="font-bold text-green-600">{formatMoney(wal.total_deposits_received)}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Saldo Clientes</span><span className="font-bold text-blue-600">{formatMoney(wal.total_client_balance)}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Clientes</span><span className="font-bold">{wal.client_count || 0}</span></div>
                  <div className="flex justify-between py-2 border-b"><span className="text-gray-600">Compras</span><span className="font-bold">{rev.purchase_count || 0}</span></div>
                  <div className="flex justify-between py-2"><span className="text-gray-600">Peso Enviado</span><span className="font-bold">{rev.total_weight_shipped || 0} lbs</span></div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Ganancias Tab - Store Profits */}
          <TabsContent value="ganancias" className="mt-6">
            <StoreProfitsReport />
          </TabsContent>

          {/* Graficas Tab */}
          <TabsContent value="graficas" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sales Trend */}
              <Card className="rounded-xl md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                    Tendencia de Ventas (30 dias)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SalesTrendChart data={trend} />
                </CardContent>
              </Card>

              {/* Store Bar Chart */}
              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Store className="h-5 w-5 text-blue-600" />
                    Ventas por Tienda
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StoreBarChart data={stores} />
                </CardContent>
              </Card>

              {/* Profit Pie Chart */}
              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <PieChartIcon className="h-5 w-5 text-green-600" />
                    Distribucion de Ganancias
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ProfitPieChart commissions={rev.total_commissions} shipping={rev.total_shipping} />
                </CardContent>
              </Card>

              {/* Live Bar Chart */}
              <Card className="rounded-xl md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Radio className="h-5 w-5 text-red-600" />
                    Ventas por Live
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LiveBarChart data={lives} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Deudas Tab */}
          <TabsContent value="deudas" className="mt-6">
            <div className="space-y-6">
              {/* Filters */}
              <Card className="rounded-xl">
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Search */}
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Buscar por nombre, ID o WhatsApp..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                        data-testid="debt-search-input"
                      />
                    </div>
                    
                    {/* Status Filter */}
                    <div className="flex gap-2">
                      <Button
                        variant={statusFilter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("all")}
                        className={statusFilter === "all" ? "bg-slate-800" : ""}
                        data-testid="filter-all"
                      >
                        Todos ({clientsDebts.length})
                      </Button>
                      <Button
                        variant={statusFilter === "with_debt" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("with_debt")}
                        className={statusFilter === "with_debt" ? "bg-red-600 hover:bg-red-700" : "text-red-600 border-red-300"}
                        data-testid="filter-with-debt"
                      >
                        Con Deuda ({debtsSummary.clients_with_debt || 0})
                      </Button>
                      <Button
                        variant={statusFilter === "no_debt" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("no_debt")}
                        className={statusFilter === "no_debt" ? "bg-green-600 hover:bg-green-700" : "text-green-600 border-green-300"}
                        data-testid="filter-no-debt"
                      >
                        Sin Deuda ({debtsSummary.clients_positive_balance || 0})
                      </Button>
                      <Button
                        variant={statusFilter === "with_pending" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("with_pending")}
                        className={statusFilter === "with_pending" ? "bg-amber-600 hover:bg-amber-700" : "text-amber-700 border-amber-300"}
                        data-testid="filter-with-pending"
                      >
                        Con Por Facturar ({debtsData?.summary?.clients_with_pending_to_invoice || 0})
                      </Button>
                    </div>
                    
                    {/* Chart Limit */}
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-gray-400" />
                      <select
                        value={chartLimit}
                        onChange={(e) => setChartLimit(Number(e.target.value))}
                        className="border rounded-md px-2 py-1 text-sm bg-white"
                        data-testid="chart-limit-select"
                      >
                        <option value={10}>Top 10</option>
                        <option value={15}>Top 15</option>
                        <option value={25}>Top 25</option>
                        <option value={50}>Top 50</option>
                        <option value={100}>Top 100</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* Active filters indicator */}
                  {(searchTerm || statusFilter !== "all") && (
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Filtros activos:</span>
                      {searchTerm && (
                        <Badge variant="secondary" className="text-xs">
                          Búsqueda: "{searchTerm}"
                          <button onClick={() => setSearchTerm("")} className="ml-1 hover:text-red-500">×</button>
                        </Badge>
                      )}
                      {statusFilter !== "all" && (
                        <Badge variant="secondary" className="text-xs">
                          {statusFilter === "with_debt" ? "Con Deuda" : statusFilter === "no_debt" ? "Sin Deuda" : "Con Por Facturar"}
                          <button onClick={() => setStatusFilter("all")} className="ml-1 hover:text-red-500">×</button>
                        </Badge>
                      )}
                      <span className="text-gray-400">|</span>
                      <span className="font-medium text-slate-700">{filteredClients.length} resultados</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Summary Cards - Using filtered data */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200">
                  <CardContent className="p-4">
                    <Users className="h-5 w-5 text-slate-600 mb-2" />
                    <p className="text-2xl font-extrabold text-slate-700">{filteredSummary.total_clients}</p>
                    <p className="text-xs text-slate-600">Total Clientes</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-red-50 to-red-100 border-red-200">
                  <CardContent className="p-4">
                    <AlertTriangle className="h-5 w-5 text-red-600 mb-2" />
                    <p className="text-2xl font-extrabold text-red-700">{filteredSummary.clients_with_debt}</p>
                    <p className="text-xs text-red-600">Con Deuda</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                  <CardContent className="p-4">
                    <Wallet className="h-5 w-5 text-green-600 mb-2" />
                    <p className="text-2xl font-extrabold text-green-700">{filteredSummary.clients_positive_balance}</p>
                    <p className="text-xs text-green-600">Sin Deuda</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                  <CardContent className="p-4">
                    <DollarSign className="h-5 w-5 text-orange-600 mb-2" />
                    <p className="text-2xl font-extrabold text-orange-700">{formatMoney(filteredSummary.total_debt)}</p>
                    <p className="text-xs text-orange-600">Deuda Total</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200" data-testid="kpi-total-credit">
                  <CardContent className="p-4">
                    <Wallet className="h-5 w-5 text-emerald-600 mb-2" />
                    <p className="text-2xl font-extrabold text-emerald-700">{formatMoney(filteredSummary.total_credit)}</p>
                    <p className="text-xs text-emerald-600">Saldo a Favor ({filteredSummary.clients_with_credit || 0})</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200" data-testid="kpi-pending-to-invoice">
                  <CardContent className="p-4">
                    <Receipt className="h-5 w-5 text-amber-600 mb-2" />
                    <p className="text-2xl font-extrabold text-amber-700">{formatMoney(filteredSummary.total_pending_to_invoice)}</p>
                    <p className="text-xs text-amber-700">Por Facturar ({filteredSummary.clients_with_pending || 0})</p>
                  </CardContent>
                </Card>
              </div>

              {/* Charts - Using filtered data */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Main Debts Chart */}
                <Card className="rounded-xl md:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-red-600" />
                      Balance por Cliente
                      <Badge variant="outline" className="ml-auto text-xs">{Math.min(chartLimit, filteredClients.length)} de {filteredClients.length}</Badge>
                    </CardTitle>
                    <p className="text-xs text-gray-500">Rojo = Debe | Verde = A favor</p>
                  </CardHeader>
                  <CardContent>
                    <ClientsDebtsChart data={filteredClients.slice(0, chartLimit)} />
                  </CardContent>
                </Card>

                {/* Pie Chart */}
                <Card className="rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <PieChartIcon className="h-5 w-5 text-slate-600" />
                      Distribucion
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ClientsDebtsPieChart summary={filteredSummary} />
                  </CardContent>
                </Card>
              </div>

              {/* Clients by Date Chart */}
              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                    Clientes por Mes de Registro
                  </CardTitle>
                  <p className="text-xs text-gray-500">Cantidad de clientes y deuda acumulada por mes</p>
                </CardHeader>
                <CardContent>
                  <ClientsByDateChart data={filteredClients} />
                </CardContent>
              </Card>

              {/* Clients Table with sortable headers */}
              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-600" />
                      Detalle de Clientes
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="border rounded-md px-2 py-1 text-sm bg-white"
                        data-testid="debts-sort-select"
                      >
                        <option value="days_unpaid">Días sin pagar</option>
                        <option value="debt">Deuda más grande</option>
                        <option value="name">Nombre (A-Z)</option>
                        <option value="code">Código (A-Z)</option>
                      </select>
                      <span className="text-sm text-gray-500">Mostrar:</span>
                      <select
                        value={tableLimit}
                        onChange={(e) => setTableLimit(Number(e.target.value))}
                        className="border rounded-md px-2 py-1 text-sm bg-white"
                        data-testid="table-limit-select"
                      >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={500}>500</option>
                        <option value={1000}>1000</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Filtrar por código de cliente o nombre"
                        className="h-9 rounded-lg pl-9 text-sm"
                        data-testid="debts-customer-filter"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left p-2 font-medium">Cliente</th>
                          <th className="text-left p-2 font-medium">ID</th>
                          <th className="text-right p-2 font-medium" title="Suma de facturas pendientes menos recargas disponibles">Deuda Real</th>
                          <th className="text-right p-2 font-medium">Fecha</th>
                          <th className="text-right p-2 font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClients.slice(0, tableLimit).map((client) => {
                          const realDebt = Number(client.real_debt || 0);
                          const isCredit = realDebt < -0.01;
                          const isZero = Math.abs(realDebt) < 0.01;
                          const debtClass = isCredit ? 'text-green-600' : isZero ? 'text-gray-600' : 'text-red-600';
                          const lastDateStr = client.last_invoice_date;
                          const daysUnpaid = lastDateStr
                            ? Math.floor((Date.now() - new Date(lastDateStr)) / 86400000)
                            : null;
                          let statusLabel = "Sin factura";
                          let statusClass = "text-slate-400";
                          if (isCredit) {
                            statusLabel = "Saldo a favor";
                            statusClass = "text-green-600 font-semibold";
                          } else if (isZero) {
                            statusLabel = "Al día";
                            statusClass = "text-green-600 font-semibold";
                          } else if (daysUnpaid !== null) {
                            if (daysUnpaid > 5) {
                              statusLabel = `Más de 5 días sin pagar — LIQUIDAR (${daysUnpaid}d)`;
                              statusClass = "text-red-600 font-bold";
                            } else if (daysUnpaid > 2) {
                              statusLabel = `Más de 2 días sin pagar (${daysUnpaid}d)`;
                              statusClass = "text-orange-600 font-semibold";
                            } else {
                              statusLabel = `Menos de 2 días sin pagar (${daysUnpaid}d)`;
                              statusClass = "text-green-600 font-semibold";
                            }
                          }
                          return (
                            <tr key={client.id} className={`border-b hover:bg-gray-50 ${realDebt > 0.01 && daysUnpaid !== null && daysUnpaid > 5 ? 'bg-red-50/50' : ''}`} data-testid={`debts-row-${client.customer_id}`}>
                              <td className="p-2">
                                <div className="font-medium text-slate-800">{client.name}</div>
                                <div className="text-xs text-gray-500">{client.whatsapp}</div>
                              </td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs">{client.customer_id}</Badge>
                              </td>
                              <td className="p-2 text-right" data-testid={`debts-real-debt-${client.customer_id}`}>
                                <span className={`font-bold ${debtClass}`}>
                                  {isCredit ? '+' : ''}{formatMoney(Math.abs(realDebt))}
                                </span>
                                {(client.floating_deposits || 0) > 0.01 && (
                                  <div className="text-[10px] text-sky-600" title="Recargas aprobadas sin aplicar a ninguna factura">
                                    Rec. disp.: {formatMoney(client.floating_deposits)}
                                  </div>
                                )}
                              </td>
                              <td className="p-2 text-right text-gray-600">
                                {lastDateStr ? new Date(lastDateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                              </td>
                              <td className={`p-2 text-right text-xs ${statusClass}`} data-testid={`debts-status-${client.customer_id}`}>
                                {statusLabel}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredClients.length > tableLimit && (
                      <div className="text-center py-3 space-y-2">
                        <p className="text-gray-500 text-sm">Mostrando {tableLimit} de {filteredClients.length} clientes</p>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setTableLimit(Math.min(tableLimit + 50, filteredClients.length))}
                        >
                          Cargar más
                        </Button>
                      </div>
                    )}
                    {filteredClients.length === 0 && (
                      <p className="text-center text-gray-400 py-8">No se encontraron clientes con los filtros aplicados</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Top Clientes con Saldo a Favor — pendant of "Detalle de Clientes" focused
                  on positive balances. Hidden when no client has credit. */}
              {topCreditClients.length > 0 && (
                <Card className="rounded-xl border-emerald-200">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-lg flex items-center gap-2 text-emerald-700">
                        <Wallet className="h-5 w-5 text-emerald-600" />
                        Clientes con Saldo a Favor
                        <Badge className="ml-1 bg-emerald-100 text-emerald-700 border-emerald-200">
                          {topCreditClients.length} clientes
                        </Badge>
                      </CardTitle>
                      <div className="text-right">
                        <p className="text-xs text-emerald-600">Total a Favor</p>
                        <p className="text-xl font-extrabold text-emerald-700" data-testid="top-credit-total">
                          {formatMoney(topCreditClients.reduce((s, c) => s + (c.pending_balance || 0), 0))}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-emerald-50/50">
                            <th className="text-left p-2 font-medium w-12">#</th>
                            <th className="text-left p-2 font-medium">Cliente</th>
                            <th className="text-left p-2 font-medium">ID</th>
                            <th className="text-right p-2 font-medium">Saldo a Favor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topCreditClients.slice(0, tableLimit).map((client, idx) => (
                            <tr
                              key={client.id}
                              className="border-b hover:bg-emerald-50/40"
                              data-testid={`credit-row-${client.customer_id}`}
                            >
                              <td className="p-2 font-semibold text-gray-500">
                                {idx + 1}
                                {idx === 0 && <span className="ml-1">🏆</span>}
                              </td>
                              <td className="p-2">
                                <div className="font-medium text-slate-800">{client.name}</div>
                                <div className="text-xs text-gray-500">{client.whatsapp}</div>
                              </td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs">{client.customer_id}</Badge>
                              </td>
                              <td className="p-2 text-right">
                                <span className="font-bold text-emerald-600">
                                  +{formatMoney(client.pending_balance)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {topCreditClients.length > tableLimit && (
                        <p className="text-xs text-gray-500 text-center mt-3">
                          Mostrando {tableLimit} de {topCreditClients.length}. Cambia "Mostrar" arriba para ver más.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Inactivos Tab */}
          <TabsContent value="inactivos" className="mt-6">
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200">
                  <CardContent className="p-4">
                    <Users className="h-5 w-5 text-slate-600 mb-2" />
                    <p className="text-2xl font-extrabold text-slate-700">{inactiveData?.summary?.total_clients || 0}</p>
                    <p className="text-xs text-slate-600">Clientes Activos</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
                  <CardContent className="p-4">
                    <Clock className="h-5 w-5 text-yellow-600 mb-2" />
                    <p className="text-2xl font-extrabold text-yellow-700">{inactiveData?.summary?.inactive_30d || 0}</p>
                    <p className="text-xs text-yellow-600">+30 días sin compra</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                  <CardContent className="p-4">
                    <Clock className="h-5 w-5 text-orange-600 mb-2" />
                    <p className="text-2xl font-extrabold text-orange-700">{inactiveData?.summary?.inactive_60d || 0}</p>
                    <p className="text-xs text-orange-600">+60 días sin compra</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-red-50 to-red-100 border-red-200">
                  <CardContent className="p-4">
                    <Clock className="h-5 w-5 text-red-600 mb-2" />
                    <p className="text-2xl font-extrabold text-red-700">{inactiveData?.summary?.inactive_90d || 0}</p>
                    <p className="text-xs text-red-600">+90 días sin compra</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                  <CardContent className="p-4">
                    <Users className="h-5 w-5 text-purple-600 mb-2" />
                    <p className="text-2xl font-extrabold text-purple-700">{inactiveData?.summary?.never_purchased || 0}</p>
                    <p className="text-xs text-purple-600">Nunca compró</p>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <Card className="rounded-xl">
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-end">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-gray-600 mb-1 block">Umbral de inactividad</label>
                      <div className="flex flex-wrap gap-2">
                        {[30, 60, 90, 180, 365].map((d) => (
                          <Button
                            key={d}
                            variant={inactiveThreshold === d ? "default" : "outline"}
                            size="sm"
                            onClick={() => setInactiveThreshold(d)}
                            className={inactiveThreshold === d ? "bg-orange-600 hover:bg-orange-700" : "text-orange-700 border-orange-300"}
                            data-testid={`inactive-threshold-${d}`}
                          >
                            +{d}d
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 relative">
                      <label className="text-xs font-medium text-gray-600 mb-1 block">Buscar</label>
                      <Search className="absolute left-3 top-9 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Nombre, ID o WhatsApp..."
                        value={inactiveSearch}
                        onChange={(e) => setInactiveSearch(e.target.value)}
                        className="pl-10 h-9"
                        data-testid="inactive-search-input"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="include-never"
                        type="checkbox"
                        checked={includeNeverPurchased}
                        onChange={(e) => setIncludeNeverPurchased(e.target.checked)}
                        className="h-4 w-4"
                        data-testid="inactive-include-never-checkbox"
                      />
                      <label htmlFor="include-never" className="text-sm text-gray-700 select-none">
                        Incluir "Nunca compró"
                      </label>
                    </div>
                    <select
                      value={inactiveLimit}
                      onChange={(e) => setInactiveLimit(Number(e.target.value))}
                      className="border rounded-md px-2 py-1 text-sm bg-white h-9"
                      data-testid="inactive-limit-select"
                    >
                      <option value={20}>Top 20</option>
                      <option value={50}>Top 50</option>
                      <option value={100}>Top 100</option>
                      <option value={500}>Top 500</option>
                    </select>
                  </div>
                </CardContent>
              </Card>

              {/* Table */}
              <Card className="rounded-xl border-orange-200">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-lg flex items-center gap-2 text-orange-700">
                      <Clock className="h-5 w-5 text-orange-600" />
                      Clientes sin comprar hace +{inactiveThreshold} días
                      <Badge className="ml-1 bg-orange-100 text-orange-700 border-orange-200">
                        {filteredInactive.length} clientes
                      </Badge>
                    </CardTitle>
                    <p className="text-xs text-gray-500">Ordenado: más inactivo primero. Listo para seguimiento.</p>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredInactive.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      Ningún cliente sin compras hace más de {inactiveThreshold} días con los filtros actuales.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-orange-50/50">
                            <th className="text-left p-2 font-medium w-12">#</th>
                            <th className="text-left p-2 font-medium">Cliente</th>
                            <th className="text-left p-2 font-medium">ID</th>
                            <th className="text-left p-2 font-medium">WhatsApp</th>
                            <th className="text-right p-2 font-medium">Última compra</th>
                            <th className="text-right p-2 font-medium">Días inactivo</th>
                            <th className="text-right p-2 font-medium" title="Compras sin facturar">Por Facturar</th>
                            <th className="text-right p-2 font-medium">Compras</th>
                            <th className="text-right p-2 font-medium">Total gastado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInactive.slice(0, inactiveLimit).map((c, idx) => {
                            const days = c.days_since_last_purchase;
                            const isNever = days === null;
                            const lastStr = isNever
                              ? "—"
                              : new Date(c.last_purchase_at).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
                            const sevClass = isNever
                              ? "text-purple-700 bg-purple-50"
                              : days >= 90
                                ? "text-red-700 bg-red-50"
                                : days >= 60
                                  ? "text-orange-700 bg-orange-50"
                                  : "text-yellow-700 bg-yellow-50";
                            const whatsappLink = c.whatsapp
                              ? `https://wa.me/${String(c.whatsapp).replace(/[^0-9]/g, "")}`
                              : null;
                            return (
                              <tr key={c.id} className="border-b hover:bg-orange-50/40" data-testid={`inactive-row-${c.customer_id}`}>
                                <td className="p-2 font-semibold text-gray-500">{idx + 1}</td>
                                <td className="p-2">
                                  <div className="font-medium text-slate-800">{c.name}</div>
                                  <div className="text-xs text-gray-500">
                                    Registrado: {c.registered_at ? new Date(c.registered_at).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                                  </div>
                                </td>
                                <td className="p-2">
                                  <Badge variant="outline" className="text-xs">{c.customer_id}</Badge>
                                </td>
                                <td className="p-2">
                                  {whatsappLink ? (
                                    <div className="flex items-center gap-2">
                                      <a
                                        href={whatsappLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-green-600 hover:underline inline-flex items-center gap-1"
                                        data-testid={`inactive-whatsapp-${c.customer_id}`}
                                      >
                                        <Phone className="h-3 w-3" /> {c.whatsapp}
                                      </a>
                                      <a
                                        href={`https://wa.me/${String(c.whatsapp).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                                          isNever
                                            ? `Hola ${c.name}, te escribimos desde Outlets USA EC. Tenemos novedades que pueden interesarte. ¿Te gustaría conocer nuestras ofertas?`
                                            : `Hola ${c.name}, hace ${days} días que no compras con nosotros. Tenemos nuevas ofertas que pueden interesarte. ¿Quieres que te muestre lo más reciente?`
                                        )}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Enviar mensaje de seguimiento con plantilla"
                                        className="inline-flex items-center justify-center bg-green-600 hover:bg-green-700 text-white rounded-md w-6 h-6 text-[10px] font-bold transition-colors"
                                        data-testid={`inactive-whatsapp-template-${c.customer_id}`}
                                      >
                                        ✉
                                      </a>
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 text-xs">Sin contacto</span>
                                  )}
                                </td>
                                <td className="p-2 text-right text-xs">{lastStr}</td>
                                <td className="p-2 text-right">
                                  <span className={`px-2 py-1 rounded font-bold text-xs ${sevClass}`}>
                                    {isNever ? "Nunca compró" : `${days}d`}
                                  </span>
                                </td>
                                <td className="p-2 text-right">
                                  {(c.pending_to_invoice || 0) > 0.01 ? (
                                    <span className="font-bold text-amber-700">{formatMoney(c.pending_to_invoice)}</span>
                                  ) : (
                                    <span className="text-gray-300 text-xs">—</span>
                                  )}
                                </td>
                                <td className="p-2 text-right">{c.purchase_count}</td>
                                <td className="p-2 text-right font-semibold text-slate-700">{formatMoney(c.total_spent)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {filteredInactive.length > inactiveLimit && (
                        <p className="text-xs text-gray-500 text-center mt-3">
                          Mostrando {inactiveLimit} de {filteredInactive.length}. Cambia "Top N" arriba para ver más.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Detalle Tab */}
          <TabsContent value="detalle" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Store className="h-5 w-5 text-blue-600" />
                    Ranking Tiendas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stores.length > 0 ? stores.map((s, i) => (
                    <ListItem key={i} rank={i + 1} name={s.name} count={s.cantidad} sales={s.ventas} commission={s.comisiones} color={colors[i % colors.length]} />
                  )) : <p className="text-center text-gray-400 py-4">Sin datos</p>}
                </CardContent>
              </Card>

              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Radio className="h-5 w-5 text-red-600" />
                    Ranking Lives
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lives.length > 0 ? lives.slice(0, 8).map((l, i) => (
                    <ListItem key={i} rank={i + 1} name={l.name} count={l.compras} sales={l.ventas} commission={l.comisiones} color={colors[i % colors.length]} />
                  )) : <p className="text-center text-gray-400 py-4">Sin datos</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
          );
        })()}

      </div>
    </div>
  );
}
