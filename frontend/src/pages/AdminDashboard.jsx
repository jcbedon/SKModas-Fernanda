import { useState, useEffect } from "react";
import { useAuth } from "@/App";
import { useNavigate, Link } from "react-router-dom";
import { getReportsSummary, getActiveLive, getBuyersReport, getSalesDetail, getInvoicesWithoutShipment } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Radio, 
  Users, 
  DollarSign, 
  Package, 
  TrendingUp,
  Wallet,
  Truck,
  BarChart3,
  LogOut,
  Play,
  Gift,
  Upload,
  UserCog,
  ClipboardList,
  FileText,
  Search,
  ShoppingBag,
  Landmark,
  Video,
  Boxes
} from "lucide-react";
import { uploadTenantLogo } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import AstridHeroBanner from "@/components/AstridHeroBanner";
import { useHideFinancials } from "@/components/MoneyDisplay";
const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

// Week boundary: Thursday 00:00 local → Wednesday 23:59 local.
// Returns { startISO, endISO, label } for `weeksBack` weeks ago (0 = current week).
function getWeekRange(weeksBack = 0) {
  const now = new Date();
  // Snap to local midnight
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // JS getDay(): 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.
  // Days back to Thursday: Thu→0, Fri→1, Sat→2, Sun→3, Mon→4, Tue→5, Wed→6.
  const jsDay = local.getDay();
  const daysSinceThursday = (jsDay - 4 + 7) % 7;
  const start = new Date(local);
  start.setDate(local.getDate() - daysSinceThursday);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - weeksBack * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  const fmt = (dt) => {
    const d = dt.getDate();
    const monthRaw = dt.toLocaleDateString("es-ES", { month: "short" });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).replace(".", "");
    return `${d}-${month}`;
  };
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    label: `${fmt(start)} → ${fmt(end)}`,
  };
}

export default function AdminDashboard() {
  const { user, logout, updateTenantLogo, hideFinancials } = useAuth();
  const { formatMoney } = useHideFinancials();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [activeLive, setActiveLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [dashPeriod, setDashPeriod] = useState("week"); // "week" (current) | "all" | "wN" where N is weeksBack
  const [salesDetailOpen, setSalesDetailOpen] = useState(false);
  const [salesDetailLoading, setSalesDetailLoading] = useState(false);
  const [salesDetail, setSalesDetail] = useState(null);
  const [salesDetailTab, setSalesDetailTab] = useState("buyers"); // buyers | invoiced | pending
  const [salesDetailFilter, setSalesDetailFilter] = useState("");
  const [buyersOpen, setBuyersOpen] = useState(false);
  const [buyersData, setBuyersData] = useState([]);
  const [buyersFilter, setBuyersFilter] = useState("");
  const [expandedBuyerWeek, setExpandedBuyerWeek] = useState(null);

  const [pendingShipCount, setPendingShipCount] = useState(null);

  useEffect(() => {
    loadData();
    getInvoicesWithoutShipment().then((r) => setPendingShipCount(r.data?.invoices_count ?? 0)).catch(() => {});
  }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadData());

  // Resolve the active period into either "week"/"all" (for legacy summary endpoint)
  // or {startISO, endISO} for explicit week ranges.
  const resolveRange = (p) => {
    if (typeof p === "string" && p.startsWith("w")) {
      const n = Number(p.slice(1)) || 0;
      return getWeekRange(n);
    }
    return null; // null means use legacy mode (week or all)
  };

  const loadData = async (period) => {
    try {
      const p = period || dashPeriod;
      // For specific past weeks (w0, w1, ...), resolve the explicit Monday→Monday range
      // and send it to the backend so the cards filter by `created_at` of that week,
      // not by the current week.
      let summaryPeriod = p;
      let startISO = null;
      let endISO = null;
      if (typeof p === "string" && p.startsWith("w")) {
        const range = resolveRange(p);
        if (range) {
          summaryPeriod = "week";
          startISO = range.startISO;
          endISO = range.endISO;
        }
      }
      // Per-call `.catch` so one failing endpoint (e.g. /reports/summary) doesn't
      // blank the whole admin dashboard. Each call returns either the real
      // response or a safe fallback, and we surface a soft toast aggregating
      // the failures.
      const failures = [];
      const safe = (label, p, fallback) =>
        p.catch((err) => {
          failures.push(label);
          console.warn(`[AdminDashboard] ${label} failed`, err);
          return fallback;
        });
      const [summaryRes, activeLiveRes] = await Promise.all([
        safe("summary",     getReportsSummary(summaryPeriod, startISO, endISO), { data: null }),
        safe("active-live", getActiveLive(),                                     { data: null }),
      ]);
      setSummary(summaryRes.data);
      setActiveLive(activeLiveRes.data);
      if (failures.length > 0) {
        toast.error(`No se pudo cargar: ${failures.join(", ")}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDashPeriod = (p) => {
    setDashPeriod(p);
    loadData(p);
  };

  // Open sales detail dialog for the current period selection.
  const openSalesDetail = async () => {
    setSalesDetailOpen(true);
    setSalesDetailFilter("");
    setSalesDetailTab("buyers");
    setSalesDetailLoading(true);
    try {
      const range = resolveRange(dashPeriod);
      const start = range?.startISO;
      const end = range?.endISO;
      const res = await getSalesDetail(start, end);
      setSalesDetail(res.data);
    } catch (e) {
      toast.error("No se pudo cargar el detalle");
      setSalesDetail(null);
    } finally {
      setSalesDetailLoading(false);
    }
  };

  const openBuyersReport = async () => {
    setBuyersOpen(true);
    setBuyersFilter("");
    setExpandedBuyerWeek(null);
    try {
      const res = await getBuyersReport(dashPeriod);
      setBuyersData(res.data || []);
    } catch { setBuyersData([]); }
  };


  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // Get employee permissions (if employee)
  const permissions = user?.permissions || {};
  const isAdmin = user?.role === "admin";
  // Single switch to hide the business MONEY cards on the dashboard for employees.
  // Reuses the existing "Ver KPIs de dinero" permission (admin always sees them).
  const canSeeMoneyCards = isAdmin || permissions.stats_view_money_kpis === true;

  // Filter menu items based on role and permissions
  const getFilteredMenuItems = () => {
    const allItems = [
      { icon: Radio, label: "Live Shopping", path: "/admin/live", color: "#1E3A5F", description: "Gestionar ventas en vivo", permission: "manage_lives" },
      ...(user?.live_module_enabled ? [{ icon: Video, label: "Live", path: "/admin/live-module", color: "#B84A5E", description: "Ingreso rápido de productos", permission: "manage_lives" }] : []),
      { icon: Users, label: "Clientes", path: "/admin/clients", color: "#2a4f7f", description: "Ver y gestionar clientes", permission: "manage_clients" },
      { icon: FileText, label: "Facturas", path: "/admin/invoices", color: "#3498DB", description: "Buscar y gestionar facturas", permission: "manage_invoices" },
      { icon: Wallet, label: "Recargas", path: "/admin/wallet", color: "#2ECC71", description: "Aprobar depósitos", permission: "approve_recharges" },
      { icon: Truck, label: "Envíos", path: "/admin/shipments", color: "#1E3A5F", description: "Gestionar envíos", permission: "manage_shipments" },
      { icon: Boxes, label: "Inventario", path: "/admin/inventory", color: "#0891B2", description: "Productos Ecuador y USA", permission: "manage_inventory" },
      { icon: Package, label: "Pacas", path: "/admin/pacas", color: "#D97706", description: "Vender paquetes de productos", permission: "manage_inventory" },
      { icon: Gift, label: "Referidos", path: "/admin/referrals", color: "#27ae60", description: "Configurar bonos", permission: "manage_referrals" },
      { icon: BarChart3, label: "Reportes", path: "/admin/reports", color: "#2a4f7f", description: "Ver estadísticas", permission: "view_reports" },
      { icon: TrendingUp, label: "Estadisticas", path: "/admin/stats", color: "#E74C3C", description: "Ver ganancias del negocio", permission: "view_statistics" },
      { icon: Landmark, label: "Cuentas", path: "/admin/bank-accounts", color: "#4F46E5", description: "Banca y movimientos", permission: "manage_bank_accounts" },
      { icon: UserCog, label: "Empleados", path: "/admin/employees", color: "#8E44AD", description: "Gestionar empleados y permisos", permission: "manage_employees" },
      { icon: ClipboardList, label: "Auditoría", path: "/admin/audit", color: "#34495E", description: "Registro de acciones", permission: "view_audit" },
    ];
    
    // Admin sees everything
    if (isAdmin) {
      return allItems;
    }
    
    // Employee sees only items they have permission for
    return allItems.filter(item => {
      if (item.adminOnly) return false;
      if (!item.permission) return true;
      return permissions[item.permission] === true;
    });
  };

  const menuItems = getFilteredMenuItems();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg min-h-screen">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg p-1 min-w-[48px] min-h-[48px] flex items-center justify-center">
              <img 
                src={logoUrl} 
                alt="Logo" 
                className={`h-12 object-contain logo-transparent transition-opacity duration-200 ${logoLoaded ? 'opacity-100' : 'opacity-0'}`}
                loading="eager" 
                fetchpriority="high"
                onLoad={() => setLogoLoaded(true)}
              />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold text-slate-800">{user?.tenant_name || "Admin"}</p>
              <p className="text-xs text-gray-500">{user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleLogout}
              data-testid="admin-logout-btn"
              className="text-gray-500"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      <AstridHeroBanner />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Active Live Banner */}
        {activeLive && (
          <Card className="mb-6 text-white rounded-2xl overflow-hidden border-0" style={{ background: 'linear-gradient(135deg, #1E3A5F, #2a4f7f)' }}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                  <div>
                    <p className="font-bold">LIVE ACTIVO: {activeLive.title}</p>
                    <p className="text-sm text-red-100">
                      {activeLive.purchase_count} ventas | {formatMoney(activeLive.total_sales)} total
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={() => navigate("/admin/live")}
                  className="font-bold" style={{ background: '#2ECC71', color: 'white' }}
                  data-testid="go-to-live-btn"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Ir al Live
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Period Filter + Stats Grid */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <p className="text-sm font-medium text-gray-500">
            {dashPeriod === "all"
              ? "Todo el tiempo"
              : dashPeriod === "week"
                ? `Esta semana · ${getWeekRange(0).label}`
                : (resolveRange(dashPeriod)?.label || "")}
          </p>
          <select
            value={dashPeriod}
            onChange={(e) => handleDashPeriod(e.target.value)}
            className="border rounded-lg px-2 py-1 text-xs font-medium bg-white text-slate-700 focus:outline-none"
            data-testid="dash-period-select"
          >
            <option value="week">Esta semana</option>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={`w${n}`}>{getWeekRange(n).label}</option>
            ))}
            <option value="all">Total</option>
          </select>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6">
          {[
            { key: "clients", icon: Users, value: summary?.client_count || 0, label: "Clientes", bg: "bg-slate-50", iconBg: "rgba(30,58,95,0.1)", iconColor: "#1E3A5F", prefix: "", isMoney: false },
            { key: "sales", icon: DollarSign, value: summary?.total_sales, label: "Ventas", bg: "bg-green-50", iconBg: "rgba(46,204,113,0.1)", iconColor: "#2ECC71", prefix: "", onClick: openSalesDetail, isMoney: true },
            { key: "commissions", icon: TrendingUp, value: summary?.total_commissions, label: "Comisiones", bg: "bg-yellow-50", iconBg: "rgba(234,179,8,0.1)", iconColor: "#ca8a04", prefix: "", isMoney: true },
            { key: "shipments", icon: Truck, value: summary?.total_shipping, label: "Envios", bg: "bg-purple-50", iconBg: "rgba(147,51,234,0.1)", iconColor: "#9333ea", prefix: "", onClick: () => navigate("/admin/shipments"), isMoney: true },
            { key: "packages", icon: Package, value: summary?.total_packages || 0, label: `Paquetes${summary?.shipments_count != null ? ` · ${summary.shipments_count} envío${summary.shipments_count === 1 ? '' : 's'}` : ''}`, bg: "bg-orange-50", iconBg: "rgba(249,115,22,0.1)", iconColor: "#ea580c", prefix: "", isMoney: false },
            { key: "buyers", icon: ShoppingBag, value: summary?.buyers_count || 0, label: "Compraron", bg: "bg-teal-50", iconBg: "rgba(20,184,166,0.1)", iconColor: "#0d9488", prefix: "", onClick: openBuyersReport, isMoney: false },
          ].filter((stat) => canSeeMoneyCards || !["sales", "commissions", "shipments"].includes(stat.key)).map((stat) => (
            <div key={stat.key} className={`${stat.bg} rounded-xl p-3 text-center ${stat.onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 transition-all' : ''}`} data-testid={`stat-${stat.key}`} onClick={stat.onClick}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5" style={{ background: stat.iconBg }}>
                <stat.icon className="h-4 w-4" style={{ color: stat.iconColor }} />
              </div>
              <p className="text-lg font-extrabold text-slate-800 leading-tight">
                {stat.isMoney ? formatMoney(stat.value) : stat.value}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Menu Grid */}
        <h2 className="text-lg font-bold text-slate-800 mb-4">Acciones Rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {menuItems.map((item) => (
            <Link key={item.path} to={item.path}>
              <Card 
                className="rounded-xl hover:shadow-lg transition-shadow cursor-pointer card-hover"
                data-testid={`menu-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: item.color }}>
                      <item.icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{item.label}</p>
                      <p className="text-sm text-gray-500">{item.description}</p>
                      {item.path === "/admin/shipments" && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/admin/pending-shipments"); }}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition-colors"
                          data-testid="dashboard-pending-shipments-btn"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Facturas sin Envío
                          <span className="rounded-full bg-orange-600 px-1.5 text-white" data-testid="dashboard-pending-shipments-count">{pendingShipCount ?? "…"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Top Customers */}
        {summary?.top_customers && summary.top_customers.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Mejores Clientes</h2>
            <Card className="rounded-xl">
              <CardContent className="p-4">
                <div className="space-y-3">
                  {summary.top_customers.slice(0, 5).map((customer, index) => (
                    <div 
                      key={customer._id} 
                      className="flex items-center justify-between py-2 border-b last:border-0"
                      data-testid="top-customer-item"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0 ? 'bg-yellow-100 text-yellow-700' :
                          index === 1 ? 'bg-gray-200 text-gray-700' :
                          index === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-bold text-slate-800">{customer.name}</p>
                          <p className="text-xs text-gray-500">#{customer._id} • {customer.purchase_count} compras</p>
                        </div>
                      </div>
                      <p className="font-bold text-green-600">${customer.total_spent.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Buyers Report Dialog */}
      <Dialog open={buyersOpen} onOpenChange={setBuyersOpen}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Compradores ({dashPeriod === "week" ? "Semana" : "Total"})</DialogTitle>
          </DialogHeader>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              placeholder="Buscar por código o nombre..."
              value={buyersFilter}
              onChange={(e) => setBuyersFilter(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-300"
              data-testid="buyers-filter"
            />
          </div>
          <ScrollArea className="max-h-[55vh] pr-2">
            {buyersData.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Sin compradores en este periodo</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {buyersData.map((week) => {
                  const filteredClients = buyersFilter.trim()
                    ? week.clients.filter(c =>
                        c.customer_id.toLowerCase().includes(buyersFilter.toLowerCase()) ||
                        c.name.toLowerCase().includes(buyersFilter.toLowerCase())
                      )
                    : week.clients;
                  if (filteredClients.length === 0) return null;
                  const isOpen = expandedBuyerWeek === week.week_key || buyersFilter.trim().length > 0;
                  const weekTotal = filteredClients.reduce((s, c) => s + c.total, 0);
                  const weekCount = filteredClients.reduce((s, c) => s + c.count, 0);
                  return (
                    <div key={week.week_key} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedBuyerWeek(isOpen && !buyersFilter.trim() ? null : week.week_key)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                      >
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{week.week_label}</span>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <Badge variant="outline" className="h-4 text-[10px] px-1">{filteredClients.length}</Badge>
                          <span>{weekCount} compras</span>
                          <span className="font-bold text-slate-700">${weekTotal.toFixed(2)}</span>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="divide-y divide-slate-100">
                          {filteredClients.map((client) => (
                            <div key={client.customer_id} className="px-3 py-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-blue-600">{client.customer_id}</span>
                                  <span className="text-xs font-medium text-slate-800">{client.name}</span>
                                  <Badge className="h-4 text-[9px] px-1 bg-slate-200 text-slate-600">{client.count} compras</Badge>
                                </div>
                                <span className="text-xs font-bold text-slate-800">${client.total.toFixed(2)}</span>
                              </div>
                              <div className="mt-1 space-y-0.5">
                                {client.stores.map((store) => (
                                  <div key={store.store} className="flex justify-between text-[10px] text-slate-400 pl-3">
                                    <span>{store.store}</span>
                                    <span>{store.count} • ${store.total.toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Sales Detail Dialog (clicking on the Ventas card) */}
      <Dialog open={salesDetailOpen} onOpenChange={setSalesDetailOpen}>
        <DialogContent className="rounded-2xl max-w-md w-[95vw] max-h-[85vh] overflow-y-auto" data-testid="sales-detail-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              Detalle de Ventas
            </DialogTitle>
            <p className="text-xs text-slate-500">
              {dashPeriod === "all"
                ? "Todo el tiempo"
                : (dashPeriod === "week" ? `Esta semana · ${getWeekRange(0).label}` : (resolveRange(dashPeriod)?.label || ""))}
            </p>
          </DialogHeader>

          {salesDetailLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-green-500 border-t-transparent" />
            </div>
          ) : salesDetail ? (
            <div className="pt-2 space-y-3">
              {/* KPI tabs */}
              <div className="grid grid-cols-3 gap-2" role="tablist" data-testid="sales-detail-tabs">
                {[
                  { key: "buyers", label: "Compraron", count: salesDetail.buyers_count, color: "blue" },
                  { key: "invoiced", label: "Con factura", count: salesDetail.invoiced_count, color: "green" },
                  { key: "pending", label: "Sin factura", count: salesDetail.pending_count, color: "amber" },
                ].map((t) => {
                  const active = salesDetailTab === t.key;
                  const cls = active
                    ? `bg-${t.color}-50 border-${t.color}-200 text-${t.color}-900`
                    : "bg-white border-slate-200 text-slate-500";
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setSalesDetailTab(t.key)}
                      className={`rounded-xl border p-2 text-left transition-colors ${cls}`}
                      data-testid={`sales-detail-tab-${t.key}`}
                    >
                      <p className="text-[10px] uppercase font-bold opacity-80">{t.label}</p>
                      <p className="text-2xl font-extrabold">{t.count}</p>
                    </button>
                  );
                })}
              </div>

              {/* Filter */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={salesDetailFilter}
                  onChange={(e) => setSalesDetailFilter(e.target.value)}
                  placeholder="Filtrar por código o nombre"
                  className="h-10 rounded-xl pl-9"
                  data-testid="sales-detail-filter"
                />
              </div>

              {/* List */}
              {(() => {
                const list = salesDetailTab === "buyers"
                  ? salesDetail.buyers
                  : salesDetailTab === "invoiced"
                    ? salesDetail.invoiced_customers
                    : salesDetail.pending_customers;
                const code = salesDetailFilter.trim().toUpperCase();
                const filtered = code
                  ? list.filter((c) =>
                      c.customer_id.toUpperCase().includes(code) ||
                      (c.name || "").toUpperCase().includes(code)
                    )
                  : list;
                if (filtered.length === 0) {
                  return <p className="text-xs text-slate-500 text-center py-4">Sin clientes en esta categoría.</p>;
                }
                return (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {filtered.map((c) => {
                      const isPendingTab = salesDetailTab === "pending";
                      const rowProps = isPendingTab
                        ? {
                            as: "button",
                            type: "button",
                            onClick: () => {
                              setSalesDetailOpen(false);
                              navigate(`/admin/invoices?customer_id=${encodeURIComponent(c.customer_id)}&back=/admin`);
                            },
                            className: "w-full text-left flex items-center justify-between bg-amber-50 hover:bg-amber-100 rounded-lg px-3 py-2 text-xs gap-2 transition-colors",
                          }
                        : {
                            className: "flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs gap-2",
                          };
                      const Wrapper = isPendingTab ? "button" : "div";
                      return (
                        <Wrapper
                          key={c.customer_id}
                          {...(isPendingTab ? { type: "button", onClick: rowProps.onClick } : {})}
                          className={rowProps.className}
                          data-testid={`sales-detail-row-${c.customer_id}`}
                        >
                          <Badge variant="outline" className="font-mono flex-shrink-0">{c.customer_id}</Badge>
                          <span className={`font-semibold truncate flex-1 ${isPendingTab ? "text-amber-900" : "text-slate-700"}`}>
                            {c.name || "Sin nombre"}
                          </span>
                          {isPendingTab && (
                            <span className="text-[10px] uppercase font-bold text-amber-700 flex-shrink-0">Generar →</span>
                          )}
                        </Wrapper>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
