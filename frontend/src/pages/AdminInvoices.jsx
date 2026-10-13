import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/App";
import { searchInvoices, annulInvoice, getInvoiceDetail, getAllClients, getMyTenant, recalculateAllInvoices, listAnnulledInvoices, restoreInvoice } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import InvoiceDialog from "@/components/InvoiceDialog";
import { 
  Search, 
  FileText, 
  CheckCircle, 
  Clock, 
  Ban, 
  Loader2,
  AlertTriangle,
  User,
  Phone,
  Mail,
  Calendar,
  Plus,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Upload,
  RefreshCw,
  History,
  RotateCcw
} from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminInvoices() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, hideFinancials } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  
  // Format money with hideFinancials support
  const formatMoney = (v) => {
    if (hideFinancials) return "••••";
    return "$" + Number(v || 0).toFixed(2);
  };
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("active"); // active, annulled, all
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showAnnulDialog, setShowAnnulDialog] = useState(false);
  const [invoiceToAnnul, setInvoiceToAnnul] = useState(null);
  const [annulling, setAnnulling] = useState(false);
  // Restauración de facturas anuladas: modal separado con lista + password
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [annulledList, setAnnulledList] = useState([]);
  const [loadingAnnulled, setLoadingAnnulled] = useState(false);
  const [invoiceToRestore, setInvoiceToRestore] = useState(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoring, setRestoring] = useState(false);
  
  // For creating new invoice - client selection
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [loadingClients, setLoadingClients] = useState(false);
  
  // For InvoiceDialog
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [selectedClientForInvoice, setSelectedClientForInvoice] = useState(null);
  const [existingInvoiceToView, setExistingInvoiceToView] = useState(null);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState("all");
  const [expandedWeeks, setExpandedWeeks] = useState({});
  const [recalcDialogOpen, setRecalcDialogOpen] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  
  const defaultTenantInfo = {
    business_name: user?.tenant_name || "Personal Shopper",
    owner_name: user?.name || "",
    email: user?.email || "",
    logo_url: logoUrl
  };

  useEffect(() => {
    loadInvoices();
  }, [activeTab]);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadInvoices());

  // If navigated here with ?invoice_id=..., auto-open that invoice once loaded.
  // If navigated with ?customer_id=..., auto-open the create-invoice flow for that client.
  useEffect(() => {
    const invoiceId = searchParams.get("invoice_id");
    const customerId = searchParams.get("customer_id");
    if (!invoiceId && !customerId) return;
    let cancelled = false;
    (async () => {
      try {
        if (invoiceId) {
          const res = await getInvoiceDetail(invoiceId);
          if (cancelled) return;
          setExistingInvoiceToView(res.data);
          setSelectedClientForInvoice(null);
          setInvoiceDialogOpen(true);
        } else if (customerId) {
          // Load clients first if not already loaded
          let clientsList = clients;
          if (clientsList.length === 0) {
            setLoadingClients(true);
            try {
              const res = await getAllClients();
              clientsList = res.data;
              setClients(clientsList);
            } finally {
              setLoadingClients(false);
            }
          }
          
          // Find the client and trigger the invoice flow
          const upper = customerId.toUpperCase();
          const c = clientsList.find(x => (x.customer_id || "").toUpperCase() === upper);
          if (c && !cancelled) {
            await handleSelectClientForInvoice(c);
          }
        }
      } catch (_) {
        // Silent: if it can't be opened, stay on the list.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("invoice_id"), searchParams.get("customer_id")]);

  const loadInvoices = async (query = searchQuery) => {
    try {
      setLoading(true);
      const statusFilter = activeTab === "active" ? "active" : activeTab === "annulled" ? "annulled" : "all";
      const res = await searchInvoices(query, statusFilter);
      setInvoices(res.data);
    } catch (error) {
      toast.error("Error al cargar facturas");
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      setLoadingClients(true);
      const res = await getAllClients();
      setClients(res.data);
    } catch (error) {
      toast.error("Error al cargar clientes");
    } finally {
      setLoadingClients(false);
    }
  };

  const handleNewInvoiceClick = () => {
    loadClients();
    setClientSearch("");
    setShowClientSelector(true);
  };

  const handleRecalculateAll = async () => {
    try {
      setRecalcLoading(true);
      const res = await recalculateAllInvoices();
      toast.success(res.data?.message || "Facturas recalculadas");
      setRecalcDialogOpen(false);
      await loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al recalcular");
    } finally {
      setRecalcLoading(false);
    }
  };

  const handleSelectClientForInvoice = async (client) => {
    setSelectedClientForInvoice(client);
    setExistingInvoiceToView(null); // Clear existing invoice since we're creating new
    setShowClientSelector(false);
    
    // Load tenant info
    try {
      const res = await getMyTenant();
      setTenantInfo({
        business_name: res.data.business_name || user?.tenant_name || "Personal Shopper",
        owner_name: res.data.owner_name || user?.name || "",
        email: res.data.admin_email || user?.email || "",
        logo_url: res.data.logo_url || logoUrl
      });
    } catch (error) {
      console.error("Error fetching tenant info:", error);
      setTenantInfo(defaultTenantInfo);
    }
    
    setInvoiceDialogOpen(true);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadInvoices(searchQuery);
  };

  const handleViewInvoice = async (invoice) => {
    try {
      // Open the InvoiceDialog with this existing invoice
      setExistingInvoiceToView(invoice);
      setSelectedClientForInvoice(null); // Clear client since we're viewing existing
      setInvoiceDialogOpen(true);
    } catch (error) {
      toast.error("Error al cargar detalles de la factura");
    }
  };

  const handleAnnulClick = (invoice, e) => {
    e.stopPropagation();
    setInvoiceToAnnul(invoice);
    setShowAnnulDialog(true);
  };

  const confirmAnnul = async () => {
    if (!invoiceToAnnul) return;
    
    try {
      setAnnulling(true);
      await annulInvoice(invoiceToAnnul.id);
      toast.success(`Factura ${invoiceToAnnul.invoice_number} anulada exitosamente`);
      setShowAnnulDialog(false);
      setInvoiceToAnnul(null);
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al anular factura");
    } finally {
      setAnnulling(false);
    }
  };

  // Restaurar factura anulada — reversible con password del admin.
  const openRestoreDialog = async () => {
    setShowRestoreDialog(true);
    setLoadingAnnulled(true);
    try {
      const res = await listAnnulledInvoices();
      setAnnulledList(res.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Error cargando facturas anuladas");
    } finally {
      setLoadingAnnulled(false);
    }
  };

  const doRestore = async () => {
    if (!invoiceToRestore) return;
    if (!restorePassword) {
      toast.error("Ingresa tu contraseña para confirmar");
      return;
    }
    setRestoring(true);
    try {
      await restoreInvoice(invoiceToRestore.id, restorePassword);
      toast.success(`Factura ${invoiceToRestore.invoice_number || ""} restaurada`);
      setInvoiceToRestore(null);
      setRestorePassword("");
      setShowRestoreDialog(false);
      // Refrescar la lista principal para que aparezca de nuevo
      await handleSearch();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo restaurar la factura");
    } finally {
      setRestoring(false);
    }
  };

  const getStatusBadge = (invoice) => {
    if (invoice.is_annulled) {
      return (
        <Badge className="bg-red-100 text-red-800">
          <Ban className="h-3 w-3 mr-1" /> Anulada
        </Badge>
      );
    }
    if (invoice.status === "approved") {
      return (
        <Badge className="bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3 mr-1" /> Pagada
        </Badge>
      );
    }
    return (
      <Badge className="bg-yellow-100 text-yellow-800">
        <Clock className="h-3 w-3 mr-1" /> Pendiente
      </Badge>
    );
  };

  const tabs = [
    { id: "active", label: "Activas", icon: FileText },
    { id: "annulled", label: "Anuladas", icon: Ban },
    { id: "all", label: "Todas", icon: Search }
  ];

  // Count invoices by type for tabs
  const activeCount = invoices.filter(i => !i.is_annulled).length;
  const annulledCount = invoices.filter(i => i.is_annulled).length;

  return (
    <div className="app-bg min-h-screen" style={{ background: 'linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)' }}>
      {/* Header - White Style */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          {/* Left: Logo + Business Name */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="text-gray-600 hover:bg-gray-100 -ml-2">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <img src={logoUrl} alt="Logo" className="h-12 object-contain" />
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1E3A5F' }}>{user?.tenant_name || "Outlets USA EC"}</h1>
              <p className="text-sm text-gray-500">{user?.name}</p>
            </div>
          </div>
          
          {/* Right: Actions */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-gray-500">
              <Upload className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Module actions bar — kept outside the hidden top header so it stays visible */}
      <div className="pt-4">
        {/* Blue Banner - Module Info */}
        <div className="px-6 pb-4">
          <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: '#1E3A5F' }}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
              <div>
                <h2 className="text-white font-bold text-lg">Gestión de Facturas</h2>
                <p className="text-white/70 text-sm">
                  {invoices.filter(i => !i.is_annulled).length} facturas activas | {formatMoney(invoices.filter(i => !i.is_annulled).reduce((sum, i) => sum + (i.total || 0), 0))} total
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setRecalcDialogOpen(true)}
                variant="outline"
                className="bg-white/10 hover:bg-white/20 text-white border-white/30 font-medium px-4 py-3 rounded-xl"
                data-testid="recalc-all-invoices-btn"
                title="Recalcular saldos, abonos y total a pagar en todas las facturas"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Recalcular
              </Button>
              <Button
                onClick={openRestoreDialog}
                variant="outline"
                className="bg-white/10 hover:bg-white/20 text-white border-white/30 font-medium px-4 py-3 rounded-xl"
                data-testid="restore-invoice-btn"
                title="Ver facturas anuladas y restaurarlas"
              >
                <History className="h-4 w-4 mr-2" />
                Anuladas
              </Button>
              <Button
                onClick={handleNewInvoiceClick}
                className="bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-3 rounded-xl shadow-lg"
                data-testid="new-invoice-btn"
              >
                <Plus className="h-5 w-5 mr-2" />
                Nueva Factura
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <Input
            placeholder="Buscar por número de factura, cliente, email, WhatsApp..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 text-lg rounded-xl"
            data-testid="invoice-search-input"
          />
        </div>
        <Button 
          type="submit" 
          className="h-12 px-6 rounded-xl"
          style={{ background: '#1E3A5F' }}
          data-testid="invoice-search-btn"
        >
          <Search className="h-5 w-5 mr-2" />
          Buscar
        </Button>
      </form>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-3">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="rounded-lg"
            style={activeTab === tab.id ? { background: '#1E3A5F' } : {}}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="h-4 w-4 mr-2" />
            {tab.label}
            {tab.id === "active" && activeTab === "all" && (
              <Badge className="ml-2 bg-blue-500 text-white text-xs">{activeCount}</Badge>
            )}
            {tab.id === "annulled" && activeTab === "all" && (
              <Badge className="ml-2 bg-red-500 text-white text-xs">{annulledCount}</Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-600">No se encontraron facturas</p>
          <p className="text-sm text-gray-400 mt-2">
            {searchQuery ? "Intenta con otros términos de búsqueda" : "Aún no hay facturas registradas"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            // Week grouping helpers
            const getWeekKey = (dateStr) => {
              const d = new Date(dateStr);
              const dayOfWeek = d.getDay(); // 0=Sun,1=Mon,2=Tue...
              const daysSinceTue = (dayOfWeek + 5) % 7; // days since Tuesday
              const tuesday = new Date(d);
              tuesday.setDate(d.getDate() - daysSinceTue);
              tuesday.setHours(0, 0, 0, 0);
              return tuesday.toISOString().slice(0, 10);
            };
            const getWeekLabel = (dateStr) => {
              const d = new Date(dateStr);
              const dayOfWeek = d.getDay();
              const daysSinceTue = (dayOfWeek + 5) % 7;
              const tuesday = new Date(d);
              tuesday.setDate(d.getDate() - daysSinceTue);
              tuesday.setHours(0, 0, 0, 0);
              const monday = new Date(tuesday);
              monday.setDate(tuesday.getDate() + 6);
              const fmt = (dt) => dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
              return `${fmt(tuesday)} - ${fmt(monday)}`;
            };
            const nowKey = getWeekKey(new Date().toISOString());

            // Group invoices by week
            const grouped = {};
            invoices.forEach((inv) => {
              const key = getWeekKey(inv.created_at);
              if (!grouped[key]) grouped[key] = { label: getWeekLabel(inv.created_at), invoices: [], total: 0 };
              grouped[key].invoices.push(inv);
              if (!inv.is_annulled) grouped[key].total += inv.total || 0;
            });

            const weeks = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));

            // Filter by selected week
            const filteredWeeks = selectedWeek === "all" ? weeks : weeks.filter(([k]) => k === selectedWeek);

            return (
              <>
                {/* Week filter pills */}
                <div className="flex gap-1.5 overflow-x-auto pb-2">
                  <button
                    onClick={() => setSelectedWeek("all")}
                    className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-all ${selectedWeek === "all" ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    data-testid="week-filter-all"
                  >
                    Todas ({invoices.length})
                  </button>
                  {weeks.map(([key, { label, invoices: wInvs }]) => (
                    <button
                      key={key}
                      onClick={() => setSelectedWeek(selectedWeek === key ? "all" : key)}
                      className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-all ${selectedWeek === key ? 'bg-slate-800 text-white' : key === nowKey ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      data-testid={`week-filter-${key}`}
                    >
                      {key === nowKey ? 'Esta semana' : label} ({wInvs.length})
                    </button>
                  ))}
                </div>

                <p className="text-sm text-gray-500">
                  {selectedWeek === "all" ? `${invoices.length} factura(s)` : `${filteredWeeks[0]?.[1]?.invoices.length || 0} factura(s) en semana`}
                </p>

                {/* Grouped invoices */}
                {filteredWeeks.map(([key, { label, invoices: wInvs, total }]) => {
                  const isCurrent = key === nowKey;
                  const isExpanded = expandedWeeks[key] !== false; // expanded by default

                  return (
                    <div key={key}>
                      <button
                        onClick={() => setExpandedWeeks(prev => ({ ...prev, [key]: !isExpanded }))}
                        className="w-full flex items-center justify-between py-2 px-1 text-left hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                          <span className={`text-xs font-bold uppercase tracking-wider ${isCurrent ? 'text-blue-700' : 'text-slate-500'}`}>
                            {isCurrent ? 'Semana actual' : 'Semana'}: {label}
                          </span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5">{wInvs.length}</Badge>
                        </div>
                        <span className="text-xs font-bold text-slate-600">{formatMoney(total)}</span>
                      </button>
                      {isExpanded && (
                        <div className="space-y-2 mb-4">
                          {wInvs.map((invoice) => (
            <div
              key={invoice.id}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                invoice.is_annulled 
                  ? "bg-red-50 border-red-200 hover:border-red-300" 
                  : "bg-white hover:border-blue-300 hover:shadow-md"
              }`}
              onClick={() => handleViewInvoice(invoice)}
              data-testid={`invoice-row-${invoice.invoice_number}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div 
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      invoice.is_annulled ? "bg-red-100" : "bg-blue-50"
                    }`}
                  >
                    <FileText className={`h-6 w-6 ${invoice.is_annulled ? "text-red-500" : "text-blue-600"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-lg" style={{ color: invoice.is_annulled ? '#991B1B' : '#1E3A5F' }}>
                        {invoice.invoice_number}
                      </p>
                      {getStatusBadge(invoice)}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {invoice.client?.name || invoice.customer_id}
                      </span>
                      {invoice.client_pending_purchases > 0 && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          +{invoice.client_pending_purchases} pendiente{invoice.client_pending_purchases > 1 ? 's' : ''}
                        </span>
                      )}
                      {invoice.client?.whatsapp && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {invoice.client.whatsapp}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(invoice.created_at).toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                      {invoice.is_annulled && invoice.annulled_at && (
                        <span className="ml-2 text-red-600">
                          · Anulada el {new Date(invoice.annulled_at).toLocaleDateString("es-ES")} por {invoice.annulled_by_name}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    {(() => {
                      // Always compute total_a_pagar locally from authoritative components
                      // so the list matches the invoice dialog and PDF (all three use
                      // the same formula instead of trusting the backend-persisted value,
                      // which can go stale when shipping_cost lives on the shipment doc).
                      const displaySubtotal = (invoice.subtotal || 0) + (invoice.total_commission || 0);
                      const taxes = invoice.total_tax || 0;
                      const shippingCost = invoice.shipping_cost || (invoice.shipment?.shipping_cost || 0);
                      const saldoPend = invoice.saldo_pendiente || 0;
                      const saldoFavorAnt = invoice.saldo_a_favor_anterior || 0;
                      const depositsApp = invoice.deposits_applied || 0;
                      const grandTotal = displaySubtotal + taxes + shippingCost + saldoPend;
                      const totalCredits = depositsApp + saldoFavorAnt;
                      const totalAPagar = Math.max(0, grandTotal - totalCredits);
                      const totalRaw = invoice.total || 0;
                      const showBoth = !invoice.is_annulled && Math.abs(totalAPagar - totalRaw) > 0.01;
                      return (
                        <>
                          <p className={`font-extrabold text-xl ${invoice.is_annulled ? "text-red-600 line-through" : ""}`} style={{ color: invoice.is_annulled ? undefined : '#1E3A5F' }} data-testid={`invoice-total-a-pagar-${invoice.id}`}>
                            {formatMoney(totalAPagar)}
                          </p>
                          {showBoth && !hideFinancials && (
                            <p
                              className="text-[10px] text-gray-500 leading-tight"
                              title={`Items: ${formatMoney(displaySubtotal)} · Taxes: ${formatMoney(taxes)} · Envío: ${formatMoney(shippingCost)} · Saldo pend.: ${formatMoney(saldoPend)} · Depósitos: -${formatMoney(depositsApp)} · Saldo favor ant.: -${formatMoney(saldoFavorAnt)}`}
                              data-testid={`invoice-total-items-${invoice.id}`}
                            >
                              items: {formatMoney(totalRaw)}
                              {saldoFavorAnt > 0 && <> · saldo: -{formatMoney(saldoFavorAnt)}</>}
                            </p>
                          )}
                          <p className="text-xs text-gray-400">{invoice.purchase_ids?.length || 0} items</p>
                        </>
                      );
                    })()}
                  </div>
                  {!invoice.is_annulled && user?.role === "admin" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                      onClick={(e) => handleAnnulClick(invoice, e)}
                      data-testid={`annul-btn-${invoice.invoice_number}`}
                    >
                      <Ban className="h-4 w-4 mr-1" />
                      Anular
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}

      {/* Invoice Detail Dialog */}
      <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: '#1E3A5F' }}>
              <FileText className="h-5 w-5" />
              Factura {selectedInvoice?.invoice_number}
              {selectedInvoice?.is_annulled && (
                <Badge className="bg-red-100 text-red-800 ml-2">ANULADA</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {selectedInvoice && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                {/* Client Info */}
                <div className="p-4 rounded-xl bg-gray-50">
                  <p className="text-sm text-gray-500 mb-2">Cliente</p>
                  <p className="font-bold text-lg">{selectedInvoice.client?.name || selectedInvoice.customer_id}</p>
                  {selectedInvoice.client && (
                    <div className="flex gap-4 text-sm text-gray-600 mt-1">
                      {selectedInvoice.client.email && <span>{selectedInvoice.client.email}</span>}
                      {selectedInvoice.client.whatsapp && <span>{selectedInvoice.client.whatsapp}</span>}
                    </div>
                  )}
                </div>

                {/* Annulled Info */}
                {selectedInvoice.is_annulled && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                    <div className="flex items-center gap-2 text-red-700">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-bold">Factura Anulada</span>
                    </div>
                    <p className="text-sm text-red-600 mt-1">
                      Anulada el {new Date(selectedInvoice.annulled_at).toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })} por <strong>{selectedInvoice.annulled_by_name}</strong>
                    </p>
                  </div>
                )}

                {/* Purchases */}
                <div>
                  <p className="text-sm text-gray-500 mb-2">Items ({selectedInvoice.purchases?.length || 0})</p>
                  <div className="space-y-2">
                    {(selectedInvoice.purchases || []).map((p, idx) => (
                      <div key={idx} className="p-3 rounded-lg border bg-white">
                        <div className="flex justify-between">
                          <div>
                            <p className="font-medium">{p.item_name}</p>
                            <p className="text-sm text-gray-500">{p.store}</p>
                          </div>
                          <p className="font-bold">{formatMoney(p.total)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="p-4 rounded-xl" style={{ background: 'rgba(30,58,95,0.05)' }}>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span>{formatMoney(selectedInvoice.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Impuestos</span>
                      <span>{formatMoney(selectedInvoice.total_tax)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Comisiones</span>
                      <span>{formatMoney(selectedInvoice.total_commission)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg pt-2 border-t">
                      <span>Total</span>
                      <span className={selectedInvoice.is_annulled ? "text-red-600 line-through" : ""} style={{ color: selectedInvoice.is_annulled ? undefined : '#1E3A5F' }}>
                        {formatMoney(selectedInvoice.total)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Annul Confirmation Dialog */}
      <Dialog open={showAnnulDialog} onOpenChange={setShowAnnulDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Confirmar Anulación
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <p className="text-gray-600">
              ¿Estás seguro de que deseas anular la factura <strong>{invoiceToAnnul?.invoice_number}</strong>?
            </p>
            <div className="mt-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
              <p className="text-sm text-yellow-800">
                <strong>Nota:</strong> Esta acción no elimina la factura, solo la marca como anulada. 
                Las compras asociadas volverán a estado pendiente y podrán ser facturadas nuevamente.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAnnulDialog(false)}
              disabled={annulling}
            >
              Cancelar
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={confirmAnnul}
              disabled={annulling}
              data-testid="confirm-annul-btn"
            >
              {annulling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Anulando...
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4 mr-2" />
                  Sí, Anular Factura
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recalculate All Invoices Dialog */}
      <Dialog open={recalcDialogOpen} onOpenChange={setRecalcDialogOpen}>
        <DialogContent data-testid="recalc-all-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-700">
              <RefreshCw className="h-5 w-5" />
              Recalcular Todas las Facturas
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-gray-700">
              Esta acción recalculará para <strong>todos los clientes</strong> las siguientes cifras almacenadas en cada factura activa:
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
              <li>Abonos aplicados por factura (según fecha de recarga)</li>
              <li>Saldo a favor anterior / Saldo a favor para la próxima</li>
              <li>Total a pagar (incluyendo costo de envío actualizado)</li>
            </ul>
            <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs text-blue-800">
                Útil cuando agregaste envíos o recargas después de crear una factura y las cifras almacenadas quedaron desactualizadas.
                Esta operación es segura y no cambia compras, recargas ni anula facturas.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecalcDialogOpen(false)} disabled={recalcLoading}>
              Cancelar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleRecalculateAll}
              disabled={recalcLoading}
              data-testid="confirm-recalc-btn"
            >
              {recalcLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recalculando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sí, recalcular ahora
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showClientSelector} onOpenChange={setShowClientSelector}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: '#1E3A5F' }}>
              <User className="h-5 w-5" />
              Seleccionar Cliente para Nueva Factura
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Client Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar cliente por nombre, ID o WhatsApp..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="pl-10 h-11"
                data-testid="client-search-input"
              />
            </div>
            
            {/* Client List */}
            {loadingClients ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {clients
                    .filter(c => 
                      c.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
                      c.customer_id?.toLowerCase().includes(clientSearch.toLowerCase()) ||
                      (c.whatsapp && c.whatsapp.includes(clientSearch))
                    )
                    .sort((a, b) => {
                      // First sort by pending_to_invoice (descending - clients with pending first)
                      if ((b.pending_to_invoice || 0) !== (a.pending_to_invoice || 0)) {
                        return (b.pending_to_invoice || 0) - (a.pending_to_invoice || 0);
                      }
                      // Then sort alphabetically
                      return a.name.localeCompare(b.name);
                    })
                    .map((client) => (
                      <div
                        key={client.id}
                        className={`p-3 rounded-xl border bg-white hover:border-blue-300 hover:shadow-md cursor-pointer transition-all flex items-center justify-between ${
                          client.pending_to_invoice > 0 ? 'border-l-4 border-l-amber-400' : ''
                        }`}
                        onClick={() => handleSelectClientForInvoice(client)}
                        data-testid={`select-client-${client.customer_id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            client.pending_to_invoice > 0 ? 'bg-amber-50' : 'bg-blue-50'
                          }`}>
                            <User className={`h-5 w-5 ${client.pending_to_invoice > 0 ? 'text-amber-600' : 'text-blue-600'}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium" style={{ color: '#1E3A5F' }}>{client.name}</p>
                              {client.pending_to_invoice > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                                  {client.pending_to_invoice} pendiente{client.pending_to_invoice > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-3 text-sm text-gray-500">
                              <span>#{client.customer_id}</span>
                              {client.whatsapp && <span>{client.whatsapp}</span>}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </div>
                    ))}
                  {clients.length === 0 && !loadingClients && (
                    <div className="text-center py-8 text-gray-500">
                      <User className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                      <p>No se encontraron clientes</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Dialog - Full Process */}
      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={(open) => {
          setInvoiceDialogOpen(open);
          if (!open) {
            setExistingInvoiceToView(null); // Clear when closing
            // If we got here from a deep-link with a `back` param (e.g. pending-shipments
            // report), return there instead of reloading the invoice list.
            const back = searchParams.get("back");
            if (back) {
              navigate(back);
            } else {
              loadInvoices();
            }
          }
        }}
        client={selectedClientForInvoice}
        existingInvoice={existingInvoiceToView}
        tenantInfo={tenantInfo || defaultTenantInfo}
      />

      {/* Restore Annulled Invoices Dialog */}
      <Dialog open={showRestoreDialog} onOpenChange={(o) => { setShowRestoreDialog(o); if (!o) { setInvoiceToRestore(null); setRestorePassword(""); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Facturas anuladas
            </DialogTitle>
            <DialogDescription>
              Restaura una factura previamente anulada. Los productos volverán a esta factura y los abonos se recalcularán.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {loadingAnnulled ? (
              <div className="py-8 text-center text-gray-500 text-sm">Cargando…</div>
            ) : annulledList.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-sm">No hay facturas anuladas.</div>
            ) : (
              <div className="space-y-2">
                {annulledList.map((inv) => (
                  <div
                    key={inv.id}
                    className="border rounded-lg p-3 flex items-center justify-between hover:bg-slate-50"
                    data-testid={`annulled-row-${inv.id}`}
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-slate-800">{inv.invoice_number || "—"}</div>
                      <div className="text-xs text-slate-500">
                        Cliente {inv.customer_id} · Total {formatMoney(inv.total)}
                      </div>
                      <div className="text-[11px] text-red-500 mt-1">
                        Anulada {inv.annulled_at ? new Date(inv.annulled_at).toLocaleString("es-EC") : "—"}
                        {inv.annulled_by_name ? ` por ${inv.annulled_by_name}` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setInvoiceToRestore(inv)}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      data-testid={`restore-btn-${inv.id}`}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {invoiceToRestore && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-sm text-slate-700">
                Restaurar <span className="font-semibold">{invoiceToRestore.invoice_number}</span> — confirma con tu contraseña de administrador:
              </div>
              <Input
                type="password"
                placeholder="Contraseña de admin"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doRestore()}
                data-testid="restore-password-input"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setInvoiceToRestore(null); setRestorePassword(""); }}>
                  Cancelar
                </Button>
                <Button
                  onClick={doRestore}
                  disabled={restoring}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="confirm-restore-btn"
                >
                  {restoring ? "Restaurando…" : "Confirmar restauración"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
