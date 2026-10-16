import { useState, useEffect } from "react";
import { useAuth } from "@/App";
import { useNavigate } from "react-router-dom";
import { 
  getWallet, 
  getUserPurchases, 
  getUserShipments, 
  getUserNotifications,
  getWalletTransactions,
  requestDepositWithProof,
  getClientInvoices,
  getInvoiceDetail
} from "@/lib/api";
import { generateInvoicePDF } from "@/lib/invoicePDF";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import AstridHeroBanner from "@/components/AstridHeroBanner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ShoppingBag, 
  Truck, 
  Bell, 
  LogOut, 
  Plus,
  History,
  Share2,
  Gift,
  Copy,
  Check,
  Camera,
  X,
  Paperclip,
  Eye,
  FileText,
  Download,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Calendar,
  Package
} from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

// Week = Monday 12:00 local → next Monday 11:59:59 local (cutoff Monday at noon).
// Same logic used everywhere else (AdminShipments, AdminDashboard, etc.).
const getWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = d.getDay();
  const daysSinceMonday = (day - 1 + 7) % 7;
  const candidate = new Date(d);
  candidate.setDate(d.getDate() - daysSinceMonday);
  candidate.setHours(12, 0, 0, 0);
  if (candidate > d) candidate.setDate(candidate.getDate() - 7);
  return candidate.toISOString().slice(0, 10);
};

const getWeekLabel = (dateStr) => {
  const key = getWeekKey(dateStr);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  const startMonday = new Date(y, m - 1, d, 12, 0, 0);
  const endMonday = new Date(startMonday);
  endMonday.setDate(startMonday.getDate() + 7);
  const fmt = (dt) => {
    const day = dt.getDate();
    const monthRaw = dt.toLocaleDateString('es-ES', { month: 'short' });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).replace('.', '');
    return `${day} ${month}`;
  };
  return `${fmt(startMonday)} - ${fmt(endMonday)}`;
};

const getCurrentWeekKey = () => getWeekKey(new Date().toISOString());

export default function ClientDashboard() {
  const { user, logout } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Meta-state para detectar "todas las llamadas fallaron" — típico de un
  // bundle cacheado apuntando al backend viejo o de un problema de red.
  const [loadFailed, setLoadFailed] = useState(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [depositProof, setDepositProof] = useState(null);
  const [depositProofPreview, setDepositProofPreview] = useState(null);
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositReference, setDepositReference] = useState("");
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false);
  const [selectedAttachments, setSelectedAttachments] = useState([]);
  const [shipmentDetailOpen, setShipmentDetailOpen] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [shipmentProducts, setShipmentProducts] = useState([]);
  const [shipmentsWeekFilter, setShipmentsWeekFilter] = useState(() => getCurrentWeekKey());
  const [clientInvoices, setClientInvoices] = useState([]);
  const [downloadingPDF, setDownloadingPDF] = useState(null);
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsWeekFilter, setDetailsWeekFilter] = useState(() => getCurrentWeekKey());
  
  const backendUrl = process.env.REACT_APP_BACKEND_URL || '';

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => { if (user) loadData(); });

  const loadData = async () => {
    // Per-call `.catch` so a single failing endpoint doesn't blank the entire
    // dashboard. Each `Promise.all` element returns either the real response
    // or a safe empty fallback, and we surface a soft toast per failure
    // (deduped) rather than the historical "Error al cargar datos" for the
    // whole load.
    const failures = [];
    const errors = [];
    let totalCalls = 0;
    const safe = (label, p, fallback) => {
      totalCalls += 1;
      return p.catch((err) => {
        failures.push(label);
        errors.push(err);
        console.warn(`[ClientDashboard] ${label} failed`, err);
        return fallback;
      });
    };
    try {
      const [walletRes, purchasesRes, shipmentsRes, notificationsRes, transactionsRes, invoicesRes] = await Promise.all([
        safe("wallet",        getWallet(user.user_id),               { data: null }),
        safe("purchases",     getUserPurchases(user.user_id),        { data: [] }),
        safe("shipments",     getUserShipments(user.user_id),        { data: [] }),
        safe("notifications", getUserNotifications(user.user_id),    { data: [] }),
        safe("transactions",  getWalletTransactions(user.user_id),   { data: [] }),
        safe("invoices",      getClientInvoices(user.customer_id),   { data: [] }),
      ]);

      setWallet(walletRes.data);
      setPurchases(purchasesRes.data);
      setShipments(shipmentsRes.data);
      setNotifications(notificationsRes.data);
      setTransactions(transactionsRes.data);
      setClientInvoices(invoicesRes.data || []);

      // If ALL calls failed simultaneously the culprit is almost never data —
      // it's an out-of-date cached bundle pointing at a defunct backend URL,
      // a network/DNS problem, or CORS. Surface a clearer action banner
      // instead of the generic "no se pudo cargar" toast.
      if (failures.length === totalCalls && totalCalls > 0) {
        const first = errors[0];
        const looksLikeNetwork = !first?.response; // no HTTP response = pure network failure
        setLoadFailed({
          reason: looksLikeNetwork ? "network" : "server",
          detail: first?.message || "Error desconocido",
        });
      } else {
        setLoadFailed(null);
        if (failures.length > 0) {
          toast.error(`No se pudo cargar: ${failures.join(", ")}`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const hardRefresh = async () => {
    // Best-effort cache clear before reloading. Bypasses stale service worker
    // bundles that point at the previous production backend URL.
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (_e) {
      // Ignore — worst case the reload still helps.
    }
    // Cache-busting reload
    window.location.href = window.location.pathname + "?_ts=" + Date.now();
  };

  const handleDownloadInvoice = async (invoice, e) => {
    if (e) e.stopPropagation();
    setDownloadingPDF(invoice.id);
    try {
      const res = await getInvoiceDetail(invoice.id);
      await generateInvoicePDF(res.data, { business_name: user?.tenant_name, logo_url: user?.tenant_logo });
      toast.success("PDF descargado");
    } catch (error) {
      toast.error("Error al descargar PDF");
    } finally {
      setDownloadingPDF(null);
    }
  };


  const handleRequestDeposit = async () => {
    const ref = (depositReference || "").trim();
    if (!ref) {
      toast.error("Ingresa el número de comprobante");
      return;
    }
    if (!depositProof) {
      toast.error("Debes adjuntar la foto del comprobante");
      return;
    }
    setDepositSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("user_id", user.user_id);
      formData.append("reference_number", ref);
      formData.append("description", `Recarga con comprobante ${ref}`);
      formData.append("file", depositProof);
      await requestDepositWithProof(formData);
      setDepositSuccess(true);
      setDepositAmount("");
      setDepositReference("");
      setDepositProof(null);
      setDepositProofPreview(null);
      loadData();
    } catch (error) {
      console.error("[deposit-request] error:", error);
      const detail = error.response?.data?.detail;
      const status = error.response?.status;
      let msg = detail;
      if (!msg) {
        if (status === 413 || error.message?.includes("size")) {
          msg = "La imagen es demasiado grande (máx 10MB). Comprime la foto e intenta de nuevo.";
        } else if (status === 401 || status === 403) {
          msg = "Tu sesión expiró. Vuelve a iniciar sesión y reintenta.";
        } else if (!error.response) {
          msg = "Sin conexión al servidor. Revisa tu internet y reintenta.";
        } else {
          msg = "Error al enviar la solicitud. Inténtalo de nuevo.";
        }
      }
      toast.error(msg);
    } finally {
      setDepositSubmitting(false);
    }
  };

  const handleProofFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setDepositProof(file);
      const reader = new FileReader();
      reader.onloadend = () => setDepositProofPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleShareWhatsApp = () => {
    const referralCode = user?.customer_id || "";
    const message = `¡Hola! Te invito a comprar en OUTLETS USA EC. Usa mi código de referido *${referralCode}* al registrarte y ambos ganamos saldo. 🎁\n\n👉 Regístrate aquí: ${window.location.origin}/register?ref=${referralCode}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(user?.customer_id || "");
    setCopied(true);
    toast.success("¡Código copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusBadge = (status) => {
    const styles = {
      preparing: "bg-yellow-100 text-yellow-800",
      in_transit: "bg-blue-100 text-blue-800",
      delivered: "bg-green-100 text-green-800",
      confirmed: "bg-green-100 text-green-800",
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-green-100 text-green-800",
      waiting: "bg-gray-100 text-gray-800"
    };
    const labels = {
      preparing: "Preparación",
      in_transit: "En Tránsito",
      delivered: "Entregado",
      confirmed: "Confirmada",
      pending: "Pendiente",
      approved: "Aprobado",
      waiting: "En Espera"
    };
    return (
      <Badge className={`${styles[status] || "bg-gray-100 text-gray-800"} font-medium`}>
        {labels[status] || status}
      </Badge>
    );
  };

  // Function to get shipment status for a purchase by ID
  const getShipmentStatusForPurchase = (purchaseId) => {
    const shipment = shipments.find(s => s.purchase_ids && s.purchase_ids.includes(purchaseId));
    if (shipment) {
      return shipment.status;
    }
    return "waiting"; // En Espera if not in any shipment
  };

  // Function to find purchase by item name from transaction description
  const findPurchaseByDescription = (description) => {
    // Transaction description formats:
    // - "Compra: {item_name} ({store}) - Total: ${total}"
    // - "Comisión: {item_name} ({store})"
    let match = description.match(/Compra:\s*([^(]+)\s*\(/);
    if (!match) {
      match = description.match(/Comisión:\s*([^(]+)\s*\(/);
    }
    if (match) {
      const itemName = match[1].trim();
      return purchases.find(p => p.item_name === itemName);
    }
    return null;
  };

  // Function to get shipment status badge for transactions
  const getTransactionShipmentBadge = (tx) => {
    // For deposits, show the transaction status
    if (tx.type === 'deposit' || tx.type === 'referral_bonus' || tx.type === 'initial_balance') {
      return getStatusBadge(tx.status);
    }
    
    // For purchases, check shipment status
    if (tx.type === 'purchase') {
      // First try by purchase_id if available
      if (tx.purchase_id) {
        const shipmentStatus = getShipmentStatusForPurchase(tx.purchase_id);
        return getStatusBadge(shipmentStatus);
      }
      
      // Fallback: find purchase by description
      const purchase = findPurchaseByDescription(tx.description);
      if (purchase) {
        const shipmentStatus = getShipmentStatusForPurchase(purchase.id);
        return getStatusBadge(shipmentStatus);
      }
    }
    
    // Default to waiting
    return getStatusBadge("waiting");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-12 object-contain logo-transparent" />
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            data-testid="logout-btn"
            className="text-gray-500"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <AstridHeroBanner />

      {/* Wallet Card */}
      <div className="max-w-lg mx-auto px-4 pt-4">
        <Card className="text-white rounded-3xl shadow-2xl overflow-hidden" data-testid="wallet-card" style={{ background: 'linear-gradient(135deg, #1E3A5F, #2a4f7f)' }}>
          <CardContent className="p-6">
            {(() => {
              const pendingDebt = wallet?.pending_debt || 0;
              const saldoFavor = wallet?.saldo_a_favor || 0;
              const pendingDeposit = wallet?.pending_deposit_total || 0;
              const pendingDepositsList = wallet?.pending_deposits || [];
              const floatingDeposits = Number(wallet?.floating_deposits || 0);
              const hasDebt = pendingDebt > 0;
              const hasFavor = saldoFavor > 0;
              const hasPendingDeposit = pendingDeposit > 0;
              const hasPendingDepositRequest = pendingDepositsList.length > 0;
              const hasUnreadDeposit = hasPendingDepositRequest && !hasPendingDeposit;

              // Purchases the client already made but haven't been billed yet
              // (no invoice_id). Sum price + commission so they see the full
              // amount that will land on their next factura.
              const pendingPurchasesList = purchases.filter(p => !p.invoice_id);
              const pendingInvoiceTotal = pendingPurchasesList.reduce(
                (acc, p) => acc + (Number(p.price) || 0) + (Number(p.commission) || 0),
                0
              );
              const hasPendingInvoice = pendingInvoiceTotal > 0.01;

              // Available = money the client already has that will apply to
              // their next invoice: saldo_a_favor (excess from last inv) +
              // floating_deposits (approved but not yet attached).
              const availableTotal = Math.max(0, saldoFavor) + Math.max(0, floatingDeposits);
              const netPosition = availableTotal - pendingDebt;

              // Projected balance if the pending deposit(s) get approved:
              // - if client has favor: favor + deposit
              // - else: deposit - debt (can be negative = still owing)
              const projectedBalance = hasFavor
                ? saldoFavor + pendingDeposit
                : pendingDeposit - pendingDebt;

              return (
                <>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-white/70 text-sm font-medium">
                        {netPosition >= 0 ? 'Saldo Neto a Favor' : 'Debes en Total'}
                      </p>
                      <p
                        className={`text-4xl font-extrabold mt-1 ${netPosition >= 0 ? 'text-green-400' : 'text-red-400'}`}
                        data-testid="wallet-balance"
                      >
                        {netPosition >= 0 ? '+' : '-'}${Math.abs(netPosition).toFixed(2)}
                      </p>
                      {availableTotal > 0.01 && (
                        <p className="text-white/70 text-[11px] mt-1" data-testid="wallet-available-inline">
                          Saldo disponible para compras esta semana: <span className="text-green-300 font-semibold">${availableTotal.toFixed(2)}</span>
                        </p>
                      )}
                      {hasPendingInvoice && (
                        <p className="text-white/70 text-[11px] mt-1" data-testid="wallet-pending-invoice-inline">
                          Pendiente de facturar ({pendingPurchasesList.length}):{' '}
                          <span className="text-orange-300 font-semibold">
                            ${pendingInvoiceTotal.toFixed(2)}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge className="bg-white/20 text-white border-0 font-bold text-lg px-3 py-1">
                        #{user?.customer_id}
                      </Badge>
                    </div>
                  </div>

                  {hasPendingDeposit && (
                    <div className="mb-4 rounded-xl bg-amber-400/20 border border-amber-200/40 p-3" data-testid="pending-deposit-note">
                      <p className="text-xs text-amber-100 font-medium leading-relaxed">
                        Tu depósito de <span className="font-extrabold text-white">${pendingDeposit.toFixed(2)}</span> está siendo procesado y verificado por nuestro equipo.
                      </p>
                      <p className="text-xs text-amber-100 mt-2 leading-relaxed">
                        Cuando se apruebe, tu nuevo saldo será de{' '}
                        <span className="font-extrabold text-white">
                          {projectedBalance >= 0 ? '+' : '-'}${Math.abs(projectedBalance).toFixed(2)}
                        </span>
                        {projectedBalance > 0 ? ' a favor.' : projectedBalance < 0 ? ' pendiente.' : '.'}
                      </p>
                    </div>
                  )}

                  {hasUnreadDeposit && (
                    <div className="mb-4 rounded-xl bg-amber-400/20 border border-amber-200/40 p-3" data-testid="pending-deposit-unread-note">
                      <p className="text-xs text-amber-100 font-medium leading-relaxed">
                        Tu depósito está siendo procesado y verificado por nuestro equipo. Cuando se apruebe, tu nuevo saldo aparecerá aquí.
                      </p>
                    </div>
                  )}

                  {floatingDeposits > 0.01 && (
                    <div
                      className="mb-4 rounded-xl bg-sky-400/20 border border-sky-200/40 p-3"
                      data-testid="floating-deposits-note"
                    >
                      <p className="text-xs text-sky-100 font-medium leading-relaxed">
                        Tienes <span className="font-extrabold text-white">${floatingDeposits.toFixed(2)}</span> en recargas disponibles para tu próxima factura.
                      </p>
                    </div>
                  )}
                </>
              );
            })()}

            <div className="flex gap-3">
              <Dialog open={depositDialogOpen} onOpenChange={(open) => {
                setDepositDialogOpen(open);
                if (!open) {
                  setDepositSuccess(false);
                  setDepositReference("");
                  setDepositProof(null);
                  setDepositProofPreview(null);
                }
              }}>
                <DialogTrigger asChild>
                  <Button 
                    className="flex-1 bg-white text-slate-900 hover:bg-gray-100 font-bold rounded-xl h-12"
                    data-testid="request-deposit-btn"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Recargar
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  {depositSuccess ? (
                    <div className="py-4 text-center space-y-4" data-testid="deposit-success-message">
                      <div className="mx-auto h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                        <CheckCircle className="h-10 w-10 text-green-600" />
                      </div>
                      <h2 className="text-xl font-bold text-gray-800">¡Solicitud enviada!</h2>
                      <div className="space-y-2 text-sm text-gray-600 max-w-sm mx-auto">
                        <p>Tu solicitud será revisada por nuestro equipo.</p>
                        <p className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
                          <strong>Importante:</strong> No intentes volver a hacer un depósito mientras se procesa este. La revisión puede tomar algo de tiempo.
                        </p>
                      </div>
                      <Button
                        className="w-full h-12 font-bold rounded-xl"
                        style={{ background: '#1E3A5F', color: 'white' }}
                        onClick={() => { setDepositDialogOpen(false); setDepositSuccess(false); }}
                        data-testid="deposit-success-close"
                      >
                        Entendido
                      </Button>
                    </div>
                  ) : (
                    <>
                      <DialogHeader>
                        <DialogTitle className="text-xl font-bold">Solicitar Recarga</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                          Ingresa el número de comprobante y adjunta su foto. Nuestro equipo verificará el valor depositado y aprobará tu recarga.
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">Número de comprobante *</label>
                          <Input
                            type="text"
                            placeholder="Ej: 123456789"
                            value={depositReference}
                            onChange={(e) => setDepositReference(e.target.value)}
                            className="h-12 text-lg font-bold text-center rounded-xl mt-2"
                            data-testid="deposit-reference-input"
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">Foto del comprobante *</label>
                          <div className="mt-2">
                            {depositProofPreview ? (
                              <div className="relative rounded-xl overflow-hidden border-2 border-green-200 bg-green-50">
                                <img src={depositProofPreview} alt="Comprobante" className="w-full max-h-48 object-contain" />
                                <button
                                  onClick={() => { setDepositProof(null); setDepositProofPreview(null); }}
                                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                                  data-testid="remove-proof-btn"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50/50 transition-colors">
                                <Camera className="h-8 w-8 text-gray-400 mb-2" />
                                <span className="text-sm text-gray-500 font-medium">Subir foto del comprobante</span>
                                <span className="text-xs text-gray-400 mt-1">JPG, PNG o PDF</span>
                                <input
                                  type="file"
                                  accept="image/*,.pdf"
                                  className="hidden"
                                  onChange={handleProofFileChange}
                                  data-testid="deposit-proof-input"
                                />
                                {/* Nota: no forzamos `capture="environment"` para
                                    permitir al usuario elegir entre cámara y
                                    galería. iOS Safari puede descargar la
                                    webview durante el picker; el flujo de
                                    upload está protegido con re-hidratación
                                    de sesión desde localStorage en pageshow. */}
                              </label>
                            )}
                          </div>
                        </div>
                        <Button 
                          className="w-full h-12 font-bold rounded-xl" style={{ background: '#1E3A5F', color: 'white' }}
                          onClick={handleRequestDeposit}
                          disabled={depositSubmitting}
                          data-testid="submit-deposit-btn"
                        >
                          {depositSubmitting ? "Enviando..." : "Enviar Solicitud"}
                        </Button>
                      </div>
                    </>
                  )}
                </DialogContent>
              </Dialog>

              {/* Share/Referral Button */}
              <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    className="bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl h-12 px-4"
                    data-testid="share-referral-btn"
                  >
                    <Gift className="h-5 w-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                      <Gift className="h-6 w-6 text-green-500" />
                      Invita y Gana
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="bg-green-50 rounded-xl p-4 text-center">
                      <p className="text-sm text-gray-600 mb-2">Tu código de referido:</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-3xl font-extrabold text-green-600">
                          {user?.customer_id}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyCode}
                          className="text-green-600"
                        >
                          {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                        </Button>
                      </div>
                    </div>
                    
                    <div className="text-center text-sm text-gray-600">
                      <p>Comparte tu código con amigos.</p>
                      <p className="font-bold text-green-600">¡Ambos ganan saldo al registrarse!</p>
                    </div>

                    <Button 
                      className="w-full h-14 bg-green-500 hover:bg-green-600 font-bold rounded-xl text-lg"
                      onClick={handleShareWhatsApp}
                      data-testid="share-whatsapp-btn"
                    >
                      <Share2 className="h-5 w-5 mr-2" />
                      Compartir por WhatsApp
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="mt-4 pt-4 border-t border-white/20 flex items-center justify-between gap-2">
              <p className="text-white/70 text-xs">
                Hola, <span className="font-bold text-white">{user?.name}</span>
              </p>
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="text-[11px] px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-white font-semibold transition-colors"
                data-testid="open-details-btn"
              >
                Detalles
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recovery banner — solo aparece si TODAS las llamadas al backend
          fallaron simultáneamente. Un fallo global normalmente significa que
          el bundle del navegador quedó apuntando a un backend viejo (dominio
          de producción cambió) o hay un problema de red. Ofrece un botón
          para forzar limpieza de caché + reload. */}
      {loadFailed && (
        <div className="max-w-6xl mx-auto px-4 mt-4" data-testid="load-failed-banner">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <div className="text-red-600 text-2xl">⚠</div>
              <div className="flex-1">
                <p className="font-semibold text-red-800">
                  No se pudo cargar la información
                </p>
                <p className="text-sm text-red-700 mt-1">
                  {loadFailed.reason === "network"
                    ? "Parece un problema de conexión o tu app está desactualizada. Toca \"Actualizar app\" para volver a intentar con la versión más reciente."
                    : "El servidor respondió con un error. Toca \"Actualizar app\" o vuelve a iniciar sesión."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={hardRefresh}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
                    data-testid="hard-refresh-btn"
                  >
                    Actualizar app
                  </button>
                  <button
                    onClick={loadData}
                    className="px-4 py-2 rounded-lg bg-white border border-red-300 text-red-700 hover:bg-red-100 text-sm font-semibold"
                    data-testid="retry-load-btn"
                  >
                    Reintentar
                  </button>
                </div>
                <p className="text-[10px] text-red-500 mt-2 font-mono">{loadFailed.detail}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4 mt-6">
        <Tabs defaultValue="invoices" className="w-full">
          <TabsList className="grid w-full grid-cols-5 bg-gray-100 rounded-xl p-1 h-auto gap-1">
            <TabsTrigger
              value="invoices"
              className="flex flex-col items-center justify-center gap-1 data-[state=active]:bg-white rounded-lg py-2 px-1 text-[11px] sm:text-xs font-medium leading-none"
              data-testid="tab-invoices"
            >
              <FileText className="h-4 w-4" />
              <span>Facturas</span>
            </TabsTrigger>
            <TabsTrigger
              value="purchases"
              className="flex flex-col items-center justify-center gap-1 data-[state=active]:bg-white rounded-lg py-2 px-1 text-[11px] sm:text-xs font-medium leading-none"
              data-testid="tab-purchases"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Compras</span>
            </TabsTrigger>
            <TabsTrigger
              value="purchase-history"
              className="flex flex-col items-center justify-center gap-1 data-[state=active]:bg-white rounded-lg py-2 px-1 text-[11px] sm:text-xs font-medium leading-none"
              data-testid="tab-purchase-history"
            >
              <History className="h-4 w-4" />
              <span>Historial</span>
            </TabsTrigger>
            <TabsTrigger
              value="shipments"
              className="flex flex-col items-center justify-center gap-1 data-[state=active]:bg-white rounded-lg py-2 px-1 text-[11px] sm:text-xs font-medium leading-none"
              data-testid="tab-shipments"
            >
              <Truck className="h-4 w-4" />
              <span>Envíos</span>
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="flex flex-col items-center justify-center gap-1 data-[state=active]:bg-white rounded-lg py-2 px-1 text-[11px] sm:text-xs font-medium leading-none"
              data-testid="tab-notifications"
            >
              <Bell className="h-4 w-4" />
              <span>Avisos</span>
            </TabsTrigger>
          </TabsList>

          {/* Invoices Tab */}
          <TabsContent value="invoices" className="mt-4">
            <ScrollArea className="h-[400px]">
              {clientInvoices.length === 0 ? (
                <Card className="rounded-xl border-dashed border-2">
                  <CardContent className="p-6 text-center">
                    <FileText className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                    <p className="text-gray-500">No tienes facturas</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    // Group invoices by week (Tuesday to Monday)
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
                    const getWeekKey = (dateStr) => {
                      const d = new Date(dateStr);
                      const dayOfWeek = d.getDay();
                      const daysSinceTue = (dayOfWeek + 5) % 7;
                      const tuesday = new Date(d);
                      tuesday.setDate(d.getDate() - daysSinceTue);
                      tuesday.setHours(0, 0, 0, 0);
                      return tuesday.toISOString().slice(0, 10);
                    };

                    const grouped = {};
                    clientInvoices.forEach((inv) => {
                      const key = getWeekKey(inv.created_at);
                      if (!grouped[key]) grouped[key] = { label: getWeekLabel(inv.created_at), invoices: [] };
                      grouped[key].invoices.push(inv);
                    });

                    const weeks = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));
                    let globalIdx = 0;

                    return weeks.map(([key, { label, invoices }]) => (
                      <div key={key}>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">Semana: {label}</p>
                        <div className="space-y-2">
                          {invoices.map((inv) => {
                            const isFirst = globalIdx === 0;
                            globalIdx++;
                            return (
                              <Card key={inv.id} className={`rounded-xl ${isFirst ? 'border-2 border-blue-300 bg-blue-50/30' : ''}`} data-testid={`client-invoice-${inv.id}`}>
                                <CardContent className="p-3">
                                  <div className="flex justify-between items-center">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="font-bold" style={{ color: '#1E3A5F' }}>{inv.invoice_number}</p>
                                        {isFirst && <Badge className="bg-blue-500 text-white text-xs">Ultima</Badge>}
                                        <Badge className={inv.status === 'approved' ? 'bg-green-100 text-green-700 text-xs' : 'bg-yellow-100 text-yellow-700 text-xs'}>
                                          {inv.status === 'approved' ? 'Aprobada' : 'Pendiente'}
                                        </Badge>
                                      </div>
                                      <p className="text-xs text-gray-500 mt-1">
                                        {new Date(inv.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                        {' · '}{inv.purchase_ids?.length || 0} items
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 w-9 p-0 rounded-lg"
                                        onClick={(e) => handleDownloadInvoice(inv, e)}
                                        disabled={downloadingPDF === inv.id}
                                        data-testid={`download-invoice-${inv.id}`}
                                      >
                                        {downloadingPDF === inv.id ? (
                                          <div className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <Download className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Purchases Tab - Only pending (not invoiced) */}
          <TabsContent value="purchases" className="mt-4">
            <ScrollArea className="h-[400px]">
              {(() => {
                const pendingPurchases = purchases.filter(p => !p.invoice_id);
                if (pendingPurchases.length === 0) {
                  return (
                    <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                      <CardContent className="p-8 text-center">
                        <ShoppingBag className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500 font-medium">Sin compras pendientes</p>
                        <p className="text-gray-400 text-sm mt-1">Todas tus compras ya fueron facturadas</p>
                      </CardContent>
                    </Card>
                  );
                }
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-orange-600 px-1">Pendientes de facturar ({pendingPurchases.length})</p>
                    {pendingPurchases.map((purchase) => (
                      <Card key={purchase.id} className="rounded-xl border-gray-100" data-testid="purchase-item">
                        <CardContent className="p-3">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-bold text-slate-800 text-sm">{purchase.item_name}</p>
                              <p className="text-xs text-gray-500">{purchase.store}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {new Date(purchase.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-red-600">${(purchase.price + (purchase.commission || 0)).toFixed(2)}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                );
              })()}
            </ScrollArea>
          </TabsContent>

          {/* Purchase History Tab - Invoiced purchases */}
          <TabsContent value="purchase-history" className="mt-4">
            <ScrollArea className="h-[400px]">
              {(() => {
                const invoicedPurchases = purchases.filter(p => p.invoice_id);
                if (invoicedPurchases.length === 0) {
                  return (
                    <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                      <CardContent className="p-8 text-center">
                        <History className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500 font-medium">Sin historial</p>
                        <p className="text-gray-400 text-sm mt-1">Las compras facturadas apareceran aqui</p>
                      </CardContent>
                    </Card>
                  );
                }
                
                const getWeekKey = (dateStr) => {
                  const d = new Date(dateStr);
                  const dayOfWeek = d.getDay();
                  const daysSinceTue = (dayOfWeek + 5) % 7;
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

                const grouped = {};
                invoicedPurchases.forEach((p) => {
                  const key = getWeekKey(p.created_at);
                  if (!grouped[key]) grouped[key] = { label: getWeekLabel(p.created_at), items: [] };
                  grouped[key].items.push(p);
                });

                const weeks = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));

                return (
                  <div className="space-y-3">
                    {weeks.map(([key, { label, items }]) => {
                      const weekTotal = items.reduce((s, p) => s + p.price + (p.commission || 0), 0);
                      const isExpanded = expandedWeek === key;
                      return (
                        <div key={key}>
                          <button
                            onClick={() => setExpandedWeek(isExpanded ? null : key)}
                            className="w-full flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-1 hover:text-gray-700 transition-colors"
                          >
                            <span className="flex items-center gap-1">
                              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              Semana: {label}
                              <Badge variant="outline" className="text-xs ml-1">{items.length}</Badge>
                            </span>
                            <span className="text-gray-400">${weekTotal.toFixed(2)}</span>
                          </button>
                          {isExpanded && (
                            <div className="space-y-2 mb-3">
                              {items.map((purchase) => (
                                <Card key={purchase.id} className="rounded-xl border-gray-100" data-testid="history-purchase-item">
                                  <CardContent className="p-3">
                                    <div className="flex justify-between items-start">
                                      <div className="flex-1">
                                        <p className="font-bold text-slate-800 text-sm">{purchase.item_name}</p>
                                        <p className="text-xs text-gray-500">{purchase.store}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                          {new Date(purchase.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <p className="font-bold">${(purchase.price + (purchase.commission || 0)).toFixed(2)}</p>
                                        <Badge className="bg-green-100 text-green-700 text-[10px] mt-1">Facturada</Badge>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </ScrollArea>
          </TabsContent>

          {/* Shipments Tab */}
          <TabsContent value="shipments" className="mt-4">
            {(() => {
              // Build week buckets from all shipments + always include current week
              const weeksMap = {};
              (shipments || []).forEach(s => {
                const key = getWeekKey(s.created_at);
                if (!key) return;
                if (!weeksMap[key]) weeksMap[key] = { label: getWeekLabel(s.created_at), count: 0, packages: 0, pounds: 0, cost: 0 };
                weeksMap[key].count += 1;
                weeksMap[key].cost += s.shipping_cost || 0;
                if (s.shipping_mode === 'pounds') {
                  weeksMap[key].pounds += s.weight_pounds || 0;
                } else {
                  weeksMap[key].packages += s.package_count || 0;
                }
              });
              const currentKey = getCurrentWeekKey();
              if (!weeksMap[currentKey]) {
                weeksMap[currentKey] = { label: getWeekLabel(new Date().toISOString()), count: 0, packages: 0, pounds: 0, cost: 0 };
              }
              const weekList = Object.entries(weeksMap).sort((a, b) => b[0].localeCompare(a[0]));

              const filteredShipments = (shipmentsWeekFilter === 'all')
                ? (shipments || [])
                : (shipments || []).filter(s => getWeekKey(s.created_at) === shipmentsWeekFilter);

              // KPIs for active filter
              const kpiCount = filteredShipments.length;
              const kpiPackages = filteredShipments.filter(s => s.shipping_mode !== 'pounds').reduce((sum, s) => sum + (s.package_count || 0), 0);
              const kpiPounds = filteredShipments.filter(s => s.shipping_mode === 'pounds').reduce((sum, s) => sum + (s.weight_pounds || 0), 0);
              const kpiCost = filteredShipments.reduce((sum, s) => sum + (s.shipping_cost || 0), 0);

              const fmtDate = (iso) => {
                if (!iso) return '—';
                try {
                  const d = new Date(iso);
                  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) +
                    ' · ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
                } catch { return iso; }
              };

              return (
                <>
                  {/* Week filter + KPIs */}
                  <div className="mb-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-500" />
                      <Select value={shipmentsWeekFilter} onValueChange={setShipmentsWeekFilter}>
                        <SelectTrigger className="h-9 rounded-lg text-xs bg-white flex-1" data-testid="client-shipments-week-filter">
                          <SelectValue placeholder="Filtrar por semana" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" data-testid="week-option-all">Todas las semanas</SelectItem>
                          {weekList.map(([key, w]) => (
                            <SelectItem key={key} value={key} className="text-xs" data-testid={`week-option-${key}`}>
                              {w.label} ({w.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {kpiCount > 0 && (
                      <div className="grid grid-cols-3 gap-2" data-testid="client-shipments-kpis">
                        <Card className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                          <CardContent className="p-3 text-center">
                            <Package className="h-4 w-4 text-purple-700 mx-auto mb-1" />
                            <p className="text-lg font-extrabold text-purple-800 leading-none">{kpiCount}</p>
                            <p className="text-[10px] text-purple-600 mt-1 uppercase tracking-wide">Envíos</p>
                          </CardContent>
                        </Card>
                        <Card className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                          <CardContent className="p-3 text-center">
                            <Truck className="h-4 w-4 text-blue-700 mx-auto mb-1" />
                            <p className="text-lg font-extrabold text-blue-800 leading-none">
                              {kpiPackages > 0 ? kpiPackages : kpiPounds > 0 ? kpiPounds.toFixed(1) : 0}
                            </p>
                            <p className="text-[10px] text-blue-600 mt-1 uppercase tracking-wide">
                              {kpiPounds > 0 && kpiPackages === 0 ? 'Libras' : kpiPackages > 0 && kpiPounds === 0 ? 'Paquetes' : 'Pkg/lb'}
                            </p>
                          </CardContent>
                        </Card>
                        <Card className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
                          <CardContent className="p-3 text-center">
                            <FileText className="h-4 w-4 text-emerald-700 mx-auto mb-1" />
                            <p className="text-lg font-extrabold text-emerald-800 leading-none">${kpiCost.toFixed(0)}</p>
                            <p className="text-[10px] text-emerald-600 mt-1 uppercase tracking-wide">Costo</p>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>

                  <ScrollArea className="h-[400px]">
                    {filteredShipments.length === 0 ? (
                      <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                        <CardContent className="p-8 text-center">
                          <Truck className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500 font-medium">
                            {shipmentsWeekFilter === 'all' ? 'Sin envíos' : 'Sin envíos en esta semana'}
                          </p>
                          <p className="text-gray-400 text-sm mt-1">
                            {shipmentsWeekFilter === 'all'
                              ? 'Tus envíos aparecerán aquí'
                              : 'Cambia el filtro para ver otras semanas'}
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {filteredShipments.map((shipment) => (
                          <Card key={shipment.id} className="rounded-xl border-gray-100" data-testid="shipment-item">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <p className="font-bold text-slate-800">
                                    {shipment.shipping_type === 'with_family' ? 'Con Familiar USA' : 'Sin Familiar USA'}
                                  </p>
                                  <p className="text-sm text-gray-500">{shipment.country}</p>
                                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1" data-testid={`shipment-date-${shipment.id}`}>
                                    <Calendar className="h-3 w-3" />
                                    {fmtDate(shipment.created_at)}
                                  </p>
                                  {!!shipment.weight_pounds && shipment.weight_pounds > 0 && (
                                    <p className="text-sm text-blue-600 font-bold mt-1">
                                      {shipment.weight_pounds} lbs
                                    </p>
                                  )}
                                  {shipment.shipping_mode !== 'pounds' && !!shipment.package_count && shipment.package_count > 0 && (
                                    <p className="text-sm text-purple-600 font-bold mt-1">
                                      {shipment.package_count} paquete{shipment.package_count === 1 ? '' : 's'}
                                    </p>
                                  )}
                                </div>
                                {getStatusBadge(shipment.status)}
                              </div>

                              {shipment.tracking_number && (
                                <div className="bg-gray-50 rounded-lg p-3 mb-3">
                                  <p className="text-xs text-gray-500">Tracking:</p>
                                  <p className="font-mono font-bold text-sm">{shipment.tracking_number}</p>
                                </div>
                              )}

                              {shipment.additional_info && (
                                <div className="bg-blue-50 rounded-lg p-3 mb-3">
                                  <p className="text-xs text-gray-500">Información adicional:</p>
                                  <p className="text-sm text-slate-700">{shipment.additional_info}</p>
                                </div>
                              )}

                              <div className="flex justify-between items-center text-sm">
                                <button
                                  onClick={() => {
                                    setSelectedShipment(shipment);
                                    const prods = purchases.filter(p => shipment.purchase_ids.includes(p.id));
                                    setShipmentProducts(prods);
                                    setShipmentDetailOpen(true);
                                  }}
                                  className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                                  data-testid={`view-products-${shipment.id}`}
                                >
                                  <ShoppingBag className="h-4 w-4" />
                                  Ver {shipment.purchase_ids?.length || 0} productos
                                </button>
                                <div className="flex items-center gap-2">
                                  {shipment.attachments && shipment.attachments.length > 0 && (
                                    <button
                                      onClick={() => {
                                        setSelectedAttachments(shipment.attachments);
                                        setAttachmentDialogOpen(true);
                                      }}
                                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded-lg transition-colors"
                                      data-testid={`view-attachments-${shipment.id}`}
                                    >
                                      <Paperclip className="h-3 w-3" />
                                      <span>{shipment.attachments.length} archivo(s)</span>
                                    </button>
                                  )}
                                  <span className="font-bold text-red-600">${shipment.shipping_cost?.toFixed(2) || '0.00'}</span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </>
              );
            })()}
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="mt-4">
            <ScrollArea className="h-[400px]">
              {notifications.length === 0 ? (
                <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                  <CardContent className="p-8 text-center">
                    <Bell className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">Sin notificaciones</p>
                    <p className="text-gray-400 text-sm mt-1">Las alertas aparecerán aquí</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notif) => (
                    <Card key={notif.id} className="rounded-xl border-gray-100" data-testid="notification-item">
                      <CardContent className="p-4">
                        <div className="flex gap-3">
                          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <Bell className="h-5 w-5 text-red-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-800 break-words">{notif.title}</p>
                            <p className="text-sm text-gray-600 mt-1 whitespace-pre-line break-words">{notif.message}</p>
                            <p className="text-xs text-gray-400 mt-2">
                              {new Date(notif.created_at).toLocaleDateString('es-ES', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Attachments Dialog */}
      <Dialog open={attachmentDialogOpen} onOpenChange={setAttachmentDialogOpen}>
        <DialogContent className="rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-5 w-5 text-green-600" />
              Archivos Adjuntos
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {selectedAttachments.map((att, idx) => {
              // Asegurar que la URL tenga el prefijo /api si es necesario
              const normalizedAtt = !att.startsWith('http') && !att.startsWith('/api/') ? '/api' + att : att;
              const url = att.startsWith('http') ? att : `${process.env.REACT_APP_BACKEND_URL}${normalizedAtt}`;
              const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(att);
              const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(att);
              return (
                <div key={idx} className="border rounded-xl overflow-hidden">
                  {isImg ? (
                    <img src={url} alt={`Adjunto ${idx + 1}`} className="w-full max-h-64 object-contain bg-gray-50" />
                  ) : isVideo ? (
                    <div className="p-2 bg-gray-50">
                      <video controls className="w-full max-h-64 rounded">
                        <source src={url} type="video/mp4" />
                        Tu navegador no soporta video.
                      </video>
                      <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="block text-center text-sm text-blue-600 hover:underline mt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Abrir en nueva pestaña
                      </a>
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-50 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Archivo {idx + 1}</span>
                      <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Eye className="h-4 w-4" /> Ver/Descargar
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <ShipmentDetailModal 
        open={shipmentDetailOpen}
        onClose={() => setShipmentDetailOpen(false)}
        shipment={selectedShipment}
        products={shipmentProducts}
        backendUrl={backendUrl}
      />

      {/* Details Dialog: Invoices + Recharges breakdown */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="rounded-2xl max-w-md w-[95vw] max-h-[85vh] overflow-y-auto" data-testid="details-dialog">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-700" />
              Mi Detalle
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const activeInvoices = (clientInvoices || []).filter(i => !i.is_annulled);
            const recargasAprobadas = (transactions || []).filter(
              t => t.type === "deposit" && t.status === "approved" && !t.is_deleted
            );
            const allShipments = shipments || [];

            // Build week buckets from invoices + recargas + shipments (always include current week)
            const weeksMap = {};
            const addWeek = (dateStr) => {
              const key = getWeekKey(dateStr);
              if (!key) return;
              if (!weeksMap[key]) weeksMap[key] = { label: getWeekLabel(dateStr), count: 0 };
              weeksMap[key].count += 1;
            };
            activeInvoices.forEach(i => addWeek(i.created_at));
            recargasAprobadas.forEach(t => addWeek(t.approved_at || t.created_at));
            allShipments.forEach(s => addWeek(s.created_at));
            const _currentWk = getCurrentWeekKey();
            if (!weeksMap[_currentWk]) {
              weeksMap[_currentWk] = { label: getWeekLabel(new Date().toISOString()), count: 0 };
            }
            const weekList = Object.entries(weeksMap).sort((a, b) => b[0].localeCompare(a[0]));

            const matchesWeek = (dateStr) => detailsWeekFilter === "all" || getWeekKey(dateStr) === detailsWeekFilter;

            const filteredInvoices = activeInvoices.filter(i => matchesWeek(i.created_at));
            const filteredRecargas = recargasAprobadas.filter(t => matchesWeek(t.approved_at || t.created_at));
            const filteredShipments = allShipments.filter(s => matchesWeek(s.created_at));

            // KPIs scoped to selected week (or all)
            const totalFacturado = filteredInvoices.reduce((s, i) => s + (i.total || 0) + (i.shipping_cost || 0), 0);
            const totalRecargado = filteredRecargas.reduce((s, t) => s + (t.amount || 0), 0);
            const totalEnvios = filteredShipments.reduce((s, sh) => s + (sh.shipping_cost || 0), 0);

            // Grouping helpers — only when "all" is selected
            const groupByWeek = (items, getDate) => {
              if (detailsWeekFilter !== "all") return null;
              const buckets = {};
              items.forEach(it => {
                const key = getWeekKey(getDate(it)) || "sin-fecha";
                if (!buckets[key]) buckets[key] = { label: key === "sin-fecha" ? "Sin fecha" : getWeekLabel(getDate(it)), items: [], total: 0 };
                buckets[key].items.push(it);
              });
              return Object.entries(buckets).sort((a, b) => b[0].localeCompare(a[0]));
            };
            const invoiceGroups = groupByWeek(filteredInvoices, (i) => i.created_at);
            const rechargeGroups = groupByWeek(filteredRecargas, (t) => t.approved_at || t.created_at);
            const shipmentGroups = groupByWeek(filteredShipments, (s) => s.created_at);

            const renderInvoiceRow = (inv) => {
              const total = (inv.total || 0) + (inv.shipping_cost || 0);
              return (
                <div key={inv.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2" data-testid="details-invoice-row">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold truncate text-slate-800">{inv.invoice_number}</p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(inv.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <p className="font-extrabold ml-2 text-slate-900">${total.toFixed(2)}</p>
                </div>
              );
            };
            const renderRechargeRow = (tx) => (
              <div key={tx.id} className="flex items-center justify-between text-xs bg-green-50/60 rounded-lg px-3 py-2" data-testid="details-recharge-row">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-green-800">{tx.reference_number ? `Ref. ${tx.reference_number}` : 'Recarga'}</p>
                  <p className="text-[10px] text-green-700/70">
                    {new Date(tx.approved_at || tx.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <p className="font-extrabold text-green-700 ml-2">+${(tx.amount || 0).toFixed(2)}</p>
              </div>
            );
            const renderShipmentRow = (sh) => (
              <div key={sh.id} className="flex items-center justify-between text-xs bg-purple-50/60 rounded-lg px-3 py-2" data-testid="details-shipment-row">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-purple-800 truncate">
                    {sh.shipping_type === 'with_family' ? 'Con Familiar USA' : 'Sin Familiar USA'}
                  </p>
                  <p className="text-[10px] text-purple-700/70">
                    {new Date(sh.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {sh.tracking_number ? ` · ${sh.tracking_number}` : ''}
                  </p>
                </div>
                <p className="font-extrabold text-purple-700 ml-2">${(sh.shipping_cost || 0).toFixed(2)}</p>
              </div>
            );

            return (
              <div className="space-y-4 pt-2 text-sm">
                {/* Week filter */}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <Select value={detailsWeekFilter} onValueChange={setDetailsWeekFilter}>
                    <SelectTrigger className="h-9 rounded-lg text-xs bg-white flex-1" data-testid="details-week-filter">
                      <SelectValue placeholder="Filtrar por semana" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" data-testid="details-week-option-all">Todas las semanas</SelectItem>
                      {weekList.map(([key, w]) => (
                        <SelectItem key={key} value={key} className="text-xs" data-testid={`details-week-option-${key}`}>
                          {w.label} ({w.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-blue-50 border border-blue-100 p-3" data-testid="summary-invoices">
                    <p className="text-[10px] uppercase font-semibold text-blue-700">Facturado</p>
                    <p className="text-base font-extrabold text-blue-900 leading-tight">${totalFacturado.toFixed(2)}</p>
                    <p className="text-[10px] text-blue-700/70 mt-0.5">{filteredInvoices.length} factura(s)</p>
                  </div>
                  <div className="rounded-xl bg-green-50 border border-green-100 p-3" data-testid="summary-recharges">
                    <p className="text-[10px] uppercase font-semibold text-green-700">Recargado</p>
                    <p className="text-base font-extrabold text-green-900 leading-tight">${totalRecargado.toFixed(2)}</p>
                    <p className="text-[10px] text-green-700/70 mt-0.5">{filteredRecargas.length} recarga(s)</p>
                  </div>
                  <div className="rounded-xl bg-purple-50 border border-purple-100 p-3" data-testid="summary-shipments">
                    <p className="text-[10px] uppercase font-semibold text-purple-700">Envíos</p>
                    <p className="text-base font-extrabold text-purple-900 leading-tight">${totalEnvios.toFixed(2)}</p>
                    <p className="text-[10px] text-purple-700/70 mt-0.5">{filteredShipments.length} envío(s)</p>
                  </div>
                </div>

                {/* Invoices list */}
                <div>
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Facturas</p>
                  {filteredInvoices.length === 0 ? (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 text-center">
                      {detailsWeekFilter === "all" ? "Aún no tienes facturas." : "Sin facturas en esta semana."}
                    </p>
                  ) : invoiceGroups ? (
                    <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                      {invoiceGroups.map(([wk, g]) => (
                        <div key={wk} className="space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.label}</p>
                          {g.items.map(renderInvoiceRow)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {filteredInvoices.map(renderInvoiceRow)}
                    </div>
                  )}
                </div>

                {/* Recharges list */}
                <div>
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Recargas</p>
                  {filteredRecargas.length === 0 ? (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 text-center">
                      {detailsWeekFilter === "all" ? "Aún no tienes recargas aprobadas." : "Sin recargas en esta semana."}
                    </p>
                  ) : rechargeGroups ? (
                    <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                      {rechargeGroups.map(([wk, g]) => (
                        <div key={wk} className="space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.label}</p>
                          {g.items.map(renderRechargeRow)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {filteredRecargas.map(renderRechargeRow)}
                    </div>
                  )}
                </div>

                {/* Shipments list */}
                <div>
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Envíos</p>
                  {filteredShipments.length === 0 ? (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 text-center">
                      {detailsWeekFilter === "all" ? "Aún no tienes envíos." : "Sin envíos en esta semana."}
                    </p>
                  ) : shipmentGroups ? (
                    <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                      {shipmentGroups.map(([wk, g]) => (
                        <div key={wk} className="space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.label}</p>
                          {g.items.map(renderShipmentRow)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {filteredShipments.map(renderShipmentRow)}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShipmentDetailModal({ open, onClose, shipment, products, backendUrl }) {
  if (!open || !shipment) return null;
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-600" />
            Detalle del Envio
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          <div className="bg-blue-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Tipo:</span>
              <span className="font-medium">{shipment.shipping_type === 'with_family' ? 'Con Familiar USA' : 'Sin Familiar USA'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Destino:</span>
              <span className="font-medium">{shipment.country}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Peso:</span>
              <span className="font-bold text-blue-600">{shipment.weight_pounds || 0} lbs</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Costo:</span>
              <span className="font-bold text-red-600">${(shipment.shipping_cost || 0).toFixed(2)}</span>
            </div>
            {shipment.tracking_number && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Tracking:</span>
                <span className="font-mono text-sm">{shipment.tracking_number}</span>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-bold text-slate-800 mb-3">Productos ({products.length})</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {products.length > 0 ? (
                <ProductList items={products} />
              ) : (
                <p className="text-center text-gray-400 py-4">Sin productos</p>
              )}
            </div>
          </div>

          {shipment.attachments && shipment.attachments.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-800 mb-2">Archivos ({shipment.attachments.length})</h4>
              <AttachmentList items={shipment.attachments} backendUrl={backendUrl} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductList({ items }) {
  return (
    <div className="space-y-2">
      {items.map(function(p) {
        return (
          <div key={p.id} className="bg-gray-50 rounded-lg p-3 flex justify-between">
            <div>
              <p className="font-medium text-slate-800">{p.item_name}</p>
              <p className="text-xs text-gray-500">{p.store || 'Sin tienda'}</p>
            </div>
            <div className="text-right">
              <p className="font-bold">${(p.total || 0).toFixed(2)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AttachmentList({ items, backendUrl }) {
  return (
    <div className="space-y-2">
      {items.map(function(att, idx) {
        // Asegurar que la URL tenga el prefijo /api si es necesario
        var normalizedAtt = att;
        if (!att.startsWith('http') && !att.startsWith('/api/')) {
          normalizedAtt = '/api' + att;
        }
        var url = att.startsWith('http') ? att : backendUrl + normalizedAtt;
        var isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(att);
        var isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(att);
        
        if (isImg) {
          return <img key={idx} src={url} alt="Adjunto" className="w-full max-h-32 object-contain bg-gray-50 rounded" />;
        }
        if (isVideo) {
          return (
            <div key={idx} className="bg-gray-50 rounded p-2">
              <video controls className="w-full max-h-48 rounded">
                <source src={url} type="video/mp4" />
                Tu navegador no soporta video.
              </video>
              <a 
                href={url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="block text-center text-sm text-blue-600 hover:underline mt-2"
                onClick={(e) => e.stopPropagation()}
              >
                Abrir en nueva pestaña
              </a>
            </div>
          );
        }
        return (
          <a 
            key={idx} 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="block p-3 bg-gray-50 rounded hover:bg-gray-100 text-blue-600"
            onClick={(e) => e.stopPropagation()}
          >
            Ver Archivo {idx + 1}
          </a>
        );
      })}
    </div>
  );
}
