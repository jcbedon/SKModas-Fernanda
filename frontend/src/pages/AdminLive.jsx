import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/App";
import { useNavigate } from "react-router-dom";
import { 
  createLive, 
  updateLive,
  startLive, 
  endLive, 
  getActiveLive, 
  getLives,
  createPurchase,
  getLivePurchases,
  getActiveClients,
  getAllClients,
  getWalletByCustomerId,
  getClientInfo,
  updatePurchase,
  deletePurchase,
  getDeletePurchasePreview,
  getTenantSettings,
  getLive,
  getClientsDebtsReport,
  updateManualCommission
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StoreInvoiceSection from "@/components/StoreInvoiceSection";
import PurchaseItem from "@/components/live/PurchaseItem";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Radio, 
  Play, 
  Square, 
  Plus, 
  ArrowLeft,
  User,
  ShoppingBag,
  DollarSign,
  Store,
  CheckCircle,
  AlertTriangle,
  Zap,
  Edit,
  Trash2,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Package,
  Receipt,
  HandCoins
} from "lucide-react";

// Default tax options
const DEFAULT_TAX_OPTIONS = [
  { value: "8.25", label: "8.25%" },
  { value: "10", label: "10%" },
  { value: "15", label: "15%" },
  { value: "0", label: "Sin Taxes" },
  { value: "other", label: "Otro" }
];

// Week boundary helper: Thursday 00:00 local → Wednesday 23:59 local.
// Same logic used in AdminShipments, AdminWallet, ClientDashboard.
const getWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  // Snap to local midnight
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // JS getDay(): 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.
  // Days back to Thursday: Thu→0, Fri→1, Sat→2, Sun→3, Mon→4, Tue→5, Wed→6.
  const jsDay = local.getDay();
  const daysSinceThursday = (jsDay - 4 + 7) % 7;
  local.setDate(local.getDate() - daysSinceThursday);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getWeekLabel = (dateStr) => {
  const key = getWeekKey(dateStr);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  const startThursday = new Date(y, m - 1, d);
  const endWednesday = new Date(startThursday);
  endWednesday.setDate(startThursday.getDate() + 6);
  const fmt = (dt) => {
    const day = dt.getDate();
    const monthRaw = dt.toLocaleDateString('es-ES', { month: 'short' });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).replace('.', '');
    return `${day} ${month}`;
  };
  return `${fmt(startThursday)} - ${fmt(endWednesday)}`;
};

const getCurrentWeekKey = () => getWeekKey(new Date().toISOString());

export default function AdminLive() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const logoUrl = user?.tenant_logo || "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";
  
  // Check permissions for employees
  const permissions = user?.permissions || {};
  const isAdmin = user?.role === "admin";
  const hasPermission = isAdmin || permissions.manage_lives === true;
  
  const [activeLive, setActiveLive] = useState(null);
  const [selectedLive, setSelectedLive] = useState(null); // Live currently being viewed/edited
  const [lives, setLives] = useState([]);
  const [livesWeekFilter, setLivesWeekFilter] = useState(() => getCurrentWeekKey());
  const [purchases, setPurchases] = useState([]);
  const [activeClients, setActiveClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous re-entry guard. Plain `submitting` state isn't enough because
  // React batches setState — a second click fired between the click handler and
  // the next render still sees the old false value, so two `createPurchase`
  // requests can race and create a duplicate purchase. Using a ref blocks the
  // second call instantly without waiting for re-render.
  const submittingRef = useRef(false);
  const [newLiveTitle, setNewLiveTitle] = useState("");
  const [newLiveStore, setNewLiveStore] = useState("");
  const [createLiveDialogOpen, setCreateLiveDialogOpen] = useState(false);
  
  // Edit Live state
  const [editLiveDialogOpen, setEditLiveDialogOpen] = useState(false);
  const [editLiveForm, setEditLiveForm] = useState({ title: "", store: "" });
  
  // Confirm open finalized live
  const [confirmOpenFinalizedDialog, setConfirmOpenFinalizedDialog] = useState(false);
  const [liveToOpen, setLiveToOpen] = useState(null);

  // Delete purchase confirmation (with backend-computed preview).
  const [deletePreview, setDeletePreview] = useState(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Admin-password gate for sensitive actions on FINALIZED lives.
  const [reactivatePwd, setReactivatePwd] = useState("");
  const [reactivatePwdOpen, setReactivatePwdOpen] = useState(false);
  const [reactivatePwdSubmitting, setReactivatePwdSubmitting] = useState(false);
  const [reactivatePwdError, setReactivatePwdError] = useState("");
  const [deletePwd, setDeletePwd] = useState("");
  const [deletePwdError, setDeletePwdError] = useState("");
  const [deletePwdRequired, setDeletePwdRequired] = useState(false);
  
  // Redirect if no permission
  useEffect(() => {
    if (!hasPermission) {
      toast.error("No tienes permiso para acceder a este módulo");
      navigate("/admin");
    }
  }, [hasPermission, navigate]);

  // Purchase form state
  const [purchaseForm, setPurchaseForm] = useState({
    customer_id: "",
    item_name: "",
    price: "",
    quantity: "1",        // Cantidad de unidades a registrar de una sola vez
    tax_option: "8.25",  // Selected tax option value
    custom_tax: "",       // For "other" option
    apply_commission: true,
    commission_amount: "3"
  });
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerWallet, setCustomerWallet] = useState(null);
  const [customerCommission, setCustomerCommission] = useState(3.0);
  const [editingPurchase, setEditingPurchase] = useState(null);
  const [editForm, setEditForm] = useState({ 
    item_name: "", store: "", price: "", tax_option: "8.25",
    custom_tax: "", apply_commission: true, commission: "3", customer_id: ""
  });
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [expandedClient, setExpandedClient] = useState(null);
  const [reviewedClients, setReviewedClients] = useState({});
  const [clientGroupSearch, setClientGroupSearch] = useState("");
  
  // Client autocomplete state
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientSearchValue, setClientSearchValue] = useState("");
  
  // Tax options from tenant settings
  const [taxOptions, setTaxOptions] = useState(DEFAULT_TAX_OPTIONS);

  // Debt status per customer_id (UPPER) -> { color, label, days, amount }
  // Used to surface a colored dot next to the client name in the quick-register form
  // and to gate the submission with a confirmation when the client is in "red" status.
  const [debtStatusMap, setDebtStatusMap] = useState({});
  const [debtConfirmDialog, setDebtConfirmDialog] = useState(null); // {client, status, onConfirm}

  // Manual commission dialog state
  const [manualCommissionDialog, setManualCommissionDialog] = useState(false);
  const [manualCommissionValue, setManualCommissionValue] = useState("");
  const [manualCommissionNote, setManualCommissionNote] = useState("");
  const [savingManualCommission, setSavingManualCommission] = useState(false);

  const customerIdRef = useRef(null);

  // Filter clients for autocomplete - now more permissive
  const filteredClients = useMemo(() => {
    if (!clientSearchValue || clientSearchValue.length < 1) return [];
    const search = clientSearchValue.toLowerCase().trim();

    // Simple search: match if name or customer_id contains the search string
    return activeClients.filter(c => {
      const name = c.name?.toLowerCase() || "";
      const customerId = c.customer_id?.toLowerCase() || "";
      return name.includes(search) || customerId.includes(search);
    }).slice(0, 8); // Limit to 8 suggestions
  }, [activeClients, clientSearchValue]);

  // Color mapping for debt-status dots used in the live quick-register form.
  const debtDotClass = (color) => {
    if (color === "red") return "bg-red-500";
    if (color === "orange") return "bg-orange-500";
    if (color === "green") return "bg-green-500";
    return "";
  };

  // Calculate actual tax rate from selected option
  const getEffectiveTaxRate = (taxOption, customTax) => {
    if (taxOption === "0") return 0;
    if (taxOption === "other") return parseFloat(customTax) / 100 || 0;
    return parseFloat(taxOption) / 100;
  };

  useEffect(() => {
    loadData();
    // Load tenant tax settings
    getTenantSettings().then(res => {
      if (res.data?.tax_options && res.data.tax_options.length > 0) {
        setTaxOptions(res.data.tax_options);
      }
    }).catch(() => {});
    // Load debt status so we can show colored dots and gate red-status submissions.
    getClientsDebtsReport().then(res => {
      const map = {};
      (res.data?.clients || []).forEach((c) => {
        const lastDate = c.last_invoice_date;
        const lastAmount = Number(c.last_invoice_amount || 0);
        let color = null, label = null, days = null;
        if (lastDate && lastAmount > 0) {
          days = Math.floor((Date.now() - new Date(lastDate)) / 86400000);
          if (days > 5) { color = "red"; label = `${days} días sin pagar — LIQUIDAR`; }
          else if (days > 2) { color = "orange"; label = `${days} días sin pagar`; }
          else { color = "green"; label = `${days} día(s) sin pagar`; }
        }
        if (color) {
          map[String(c.customer_id || "").toUpperCase()] = { color, label, days, amount: lastAmount };
        }
      });
      setDebtStatusMap(map);
    }).catch(() => {});
  }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadData(true));

  const loadData = async (preserveSelection = false) => {
    try {
      const currentSelectedId = selectedLive?.id; // Preserve current selection
      
      const [activeLiveRes, livesRes, clientsRes] = await Promise.all([
        getActiveLive(),
        getLives(),
        getAllClients()  // Use all clients for autocomplete
      ]);
      
      setActiveLive(activeLiveRes.data);
      setLives(livesRes.data);
      setActiveClients(clientsRes.data);

      // If preserveSelection is true and we had a selected live, keep it
      if (preserveSelection && currentSelectedId) {
        const updatedLive = livesRes.data.find(l => l.id === currentSelectedId);
        if (updatedLive) {
          setSelectedLive(updatedLive);
          const purchasesRes = await getLivePurchases(currentSelectedId);
          setPurchases(purchasesRes.data);
          return;
        }
      }
      
      // Don't auto-select any live - always show the list first
      // User must explicitly choose which live to work with
    } catch (error) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLive = async (live) => {
    // If live is finalized, show confirmation dialog
    if (live.status === "ended" || live.status === "finalized" || live.status === "completed") {
      setLiveToOpen(live);
      setConfirmOpenFinalizedDialog(true);
      return;
    }
    
    // Otherwise, open directly
    await openLive(live);
  };
  
  const openLive = async (live) => {
    setSelectedLive(live);
    try {
      const purchasesRes = await getLivePurchases(live.id);
      setPurchases(purchasesRes.data);
    } catch (error) {
      toast.error("Error al cargar compras del live");
    }
  };
  
  const confirmOpenFinalizedLive = async () => {
    if (liveToOpen) {
      await openLive(liveToOpen);
    }
    setConfirmOpenFinalizedDialog(false);
    setLiveToOpen(null);
  };

  const handleCreateLive = async () => {
    if (!newLiveStore.trim()) {
      toast.error("Ingresa el nombre de la tienda");
      return;
    }
    // Auto-build the title: store name + current date.
    const autoTitle = `${newLiveStore.trim()} ${new Date().toLocaleDateString('es-EC')}`;

    try {
      const res = await createLive({ title: autoTitle, store: newLiveStore.trim() });
      const newLiveId = res.data.live_id;
      toast.success("Live creado");
      setNewLiveTitle("");
      setNewLiveStore("");
      setCreateLiveDialogOpen(false);
      
      // Reload lives and select the NEW live
      const livesRes = await getLives();
      setLives(livesRes.data);
      
      // Find and select the newly created live
      const createdLive = livesRes.data.find(l => l.id === newLiveId);
      if (createdLive) {
        setSelectedLive(createdLive);
        setPurchases([]);
      }
    } catch (error) {
      toast.error("Error al crear Live");
    }
  };

  const handleStartLive = async (liveId) => {
    try {
      await startLive(liveId);
      toast.success("¡LIVE INICIADO!");
      // Reload lives and select the started one
      const livesRes = await getLives();
      setLives(livesRes.data);
      const startedLive = livesRes.data.find(l => l.id === liveId);
      if (startedLive) {
        setActiveLive(startedLive);
        setSelectedLive(startedLive);
        const purchasesRes = await getLivePurchases(liveId);
        setPurchases(purchasesRes.data);
      }
    } catch (error) {
      toast.error("Error al iniciar Live");
    }
  };

  const openEditLiveDialog = () => {
    if (selectedLive) {
      setEditLiveForm({
        title: selectedLive.title || "",
        store: selectedLive.store || ""
      });
      setEditLiveDialogOpen(true);
    }
  };

  const handleUpdateLive = async () => {
    if (!selectedLive) return;
    if (!editLiveForm.title.trim()) {
      toast.error("El título es requerido");
      return;
    }
    try {
      await updateLive(selectedLive.id, editLiveForm);
      toast.success("Live actualizado y compras sincronizadas");
      setEditLiveDialogOpen(false);
      // Reload lives
      const livesRes = await getLives();
      setLives(livesRes.data);
      // Update selected live
      const updatedLive = livesRes.data.find(l => l.id === selectedLive.id);
      if (updatedLive) {
        setSelectedLive(updatedLive);
        if (activeLive?.id === updatedLive.id) {
          setActiveLive(updatedLive);
        }
        // Also reload purchases to show updated store name
        const purchasesRes = await getLivePurchases(updatedLive.id);
        setPurchases(purchasesRes.data);
      }
    } catch (error) {
      toast.error("Error al actualizar Live");
    }
  };

  const handleEndLive = async () => {
    try {
      await endLive(selectedLive.id);
      toast.success("Live finalizado");
      // Reload to update status
      const livesRes = await getLives();
      setLives(livesRes.data);
      setActiveLive(null);
      // Keep selectedLive but update its status
      const updatedLive = livesRes.data.find(l => l.id === selectedLive.id);
      if (updatedLive) setSelectedLive(updatedLive);
    } catch (error) {
      const errorMessage = error.response?.data?.detail || "Error al finalizar Live";
      toast.error(errorMessage);
    }
  };

  // Open manual commission dialog
  const openManualCommissionDialog = () => {
    setManualCommissionValue(selectedLive?.manual_commission || "");
    setManualCommissionNote(selectedLive?.manual_commission_note || "");
    setManualCommissionDialog(true);
  };

  // Save manual commission
  const handleSaveManualCommission = async () => {
    if (!selectedLive) return;
    const value = parseFloat(manualCommissionValue) || 0;
    
    setSavingManualCommission(true);
    try {
      await updateManualCommission(selectedLive.id, value, manualCommissionNote);
      toast.success("Comisión manual guardada");
      // Reload live data
      const res = await getLive(selectedLive.id);
      setSelectedLive(res.data);
      // Update in lives list too
      setLives(prev => prev.map(l => l.id === selectedLive.id ? res.data : l));
      setManualCommissionDialog(false);
    } catch (error) {
      toast.error("Error al guardar comisión manual");
    } finally {
      setSavingManualCommission(false);
    }
  };

  const handleReactivateLive = () => {
    if (!selectedLive) return;
    setReactivatePwd("");
    setReactivatePwdError("");
    setReactivatePwdOpen(true);
  };

  const doReactivateLive = async () => {
    if (!selectedLive) return;
    if (!reactivatePwd.trim()) {
      setReactivatePwdError("Ingresa la clave del administrador");
      return;
    }
    setReactivatePwdSubmitting(true);
    setReactivatePwdError("");
    try {
      await startLive(selectedLive.id, { password: reactivatePwd });
      toast.success("¡Live reactivado! Ahora puedes agregar productos");
      setReactivatePwdOpen(false);
      setReactivatePwd("");
      // Reload to update status
      const livesRes = await getLives();
      setLives(livesRes.data);
      const reactivatedLive = livesRes.data.find(l => l.id === selectedLive.id);
      if (reactivatedLive) {
        setSelectedLive(reactivatedLive);
        setActiveLive(reactivatedLive);
      }
    } catch (error) {
      if (error.response?.status === 401) {
        setReactivatePwdError("Clave de administrador incorrecta");
      } else {
        toast.error(error.response?.data?.detail || "Error al reactivar Live");
      }
    } finally {
      setReactivatePwdSubmitting(false);
    }
  };

  const handleCustomerIdChange = async (value) => {
    setClientSearchValue(value);
    setPurchaseForm({ ...purchaseForm, customer_id: value.toUpperCase() });
    setSelectedCustomer(null);
    setCustomerWallet(null);
    setCustomerCommission(3.0);

    // Always show dropdown when typing (will be filtered by filteredClients)
    if (value.length >= 1) {
      setClientSearchOpen(true);
    } else {
      setClientSearchOpen(false);
    }

    // Try to find customer by exact ID
    if (value.length >= 2) {
      try {
        const clientInfoRes = await getClientInfo(value.toUpperCase());
        const clientData = clientInfoRes.data;
        setCustomerWallet({ available: clientData.wallet_balance });
        setSelectedCustomer(clientData);
        setCustomerCommission(clientData.commission_fee || 3.0);
        // Don't close dropdown immediately - let user see suggestions
      } catch (error) {
        // Customer not found by ID - keep dropdown open for name search
      }
    }
  };

  const handleSelectClient = async (client) => {
    setPurchaseForm({ ...purchaseForm, customer_id: client.customer_id });
    setClientSearchValue(client.customer_id);
    // Set quickly with cached data so the UI is responsive…
    setSelectedCustomer(client);
    setCustomerWallet({ available: client.wallet_balance || 0 });
    setCustomerCommission(client.commission_fee || 3.0);
    setClientSearchOpen(false);
    // …then refresh with the per-customer info endpoint so we get the
    // accurate `pending_to_invoice` / `pending_purchases_count` for the badge.
    try {
      const res = await getClientInfo(client.customer_id);
      setSelectedCustomer(res.data);
    } catch (_e) {
      // Silent — cached client data already populates the UI.
    }
  };

  const handleSubmitPurchase = async (e) => {
    e.preventDefault();

    // Synchronous re-entry guard — block double submits at the very first line.
    if (submittingRef.current) return;

    if (!purchaseForm.customer_id || !purchaseForm.item_name || !purchaseForm.price) {
      toast.error("Completa todos los campos");
      return;
    }

    const price = parseFloat(purchaseForm.price);
    if (isNaN(price) || price <= 0) {
      toast.error("Precio inválido");
      return;
    }

    // Validate custom tax if "other" is selected
    if (purchaseForm.tax_option === "other" && (!purchaseForm.custom_tax || parseFloat(purchaseForm.custom_tax) < 0)) {
      toast.error("Ingresa un valor válido para el impuesto personalizado");
      return;
    }

    // Block-and-confirm if the client is in "red" debt status. We surface
    // the days unpaid + last invoice amount so the admin makes an informed call.
    const debtKey = String(purchaseForm.customer_id || "").toUpperCase();
    const dbt = debtStatusMap[debtKey];
    if (dbt && dbt.color === "red") {
      setDebtConfirmDialog({
        client: selectedCustomer || { customer_id: purchaseForm.customer_id, name: "" },
        status: dbt,
        proceed: () => {
          setDebtConfirmDialog(null);
          // Re-enter submission flow but skip the gate this time.
          actuallySubmitPurchase();
        },
      });
      return;
    }
    actuallySubmitPurchase();
  };

  const actuallySubmitPurchase = async () => {
    // Sync guard prevents two parallel `createPurchase` calls when the form is
    // submitted twice in quick succession (double click / Enter spam).
    if (submittingRef.current) return;
    submittingRef.current = true;
    const price = parseFloat(purchaseForm.price);
    // Cantidad de unidades a registrar (cada una se crea como purchase
    // independiente para preservar la edición/borrado individual y la lógica
    // existente de facturas/saldos). Default 1, mínimo 1, máximo 50.
    const qty = Math.max(1, Math.min(50, parseInt(purchaseForm.quantity || "1", 10) || 1));
    setSubmitting(true);

    try {
      const taxRate = getEffectiveTaxRate(purchaseForm.tax_option, purchaseForm.custom_tax);

      let lastResult = null;
      for (let i = 0; i < qty; i++) {
        lastResult = await createPurchase({
          customer_id: purchaseForm.customer_id,
          item_name: purchaseForm.item_name,
          store: selectedLive.store || "Sin tienda",
          price: price,
          live_id: selectedLive.id,
          tax_rate: taxRate,
          apply_tax: taxRate > 0,
          apply_commission: purchaseForm.apply_commission,
          commission_amount: parseFloat(purchaseForm.commission_amount) || 0
        });
      }

      if (qty > 1) {
        toast.success(
          `${lastResult.data.customer_name}: ${qty}× ${purchaseForm.item_name} registrados (Saldo: $${lastResult.data.new_balance.toFixed(2)})`,
          { duration: 3500 }
        );
      } else {
        toast.success(
          `${lastResult.data.customer_name}: ${purchaseForm.item_name} - Total: $${lastResult.data.total.toFixed(2)} (Saldo: $${lastResult.data.new_balance.toFixed(2)})`,
          { duration: 3000 }
        );
      }

      // Reset form but keep tax option and commission for next purchase
      const lastTaxOption = purchaseForm.tax_option;
      const lastCustomTax = purchaseForm.custom_tax;
      const lastCommission = purchaseForm.commission_amount;
      setPurchaseForm({
        customer_id: "",
        item_name: "",
        price: "",
        quantity: "1",
        tax_option: lastTaxOption,
        custom_tax: lastCustomTax,
        apply_commission: true,
        commission_amount: lastCommission
      });
      setClientSearchValue("");
      setSelectedCustomer(null);
      setCustomerWallet(null);

      // Refresh purchases
      const purchasesRes = await getLivePurchases(selectedLive.id);
      setPurchases(purchasesRes.data);

      // Refresh lives to update stats
      const livesRes = await getLives();
      setLives(livesRes.data);
      const updatedLive = livesRes.data.find(l => l.id === selectedLive.id);
      if (updatedLive) setSelectedLive(updatedLive);

      // Focus back to customer ID
      customerIdRef.current?.focus();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al registrar compra");
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const handleEditPurchase = (purchase) => {
    setEditingPurchase(purchase.id);
    // Determine tax_option from stored tax_rate
    let tax_option = "0";
    let custom_tax = "";
    if (purchase.apply_tax !== false && purchase.tax_rate > 0) {
      const rate = (purchase.tax_rate * 100).toFixed(2).replace(/\.?0+$/, '');
      // Check if it matches predefined options
      const matchingOption = DEFAULT_TAX_OPTIONS.find(opt => opt.value === rate);
      if (matchingOption && matchingOption.value !== "other") {
        tax_option = rate;
      } else {
        tax_option = "other";
        custom_tax = rate;
      }
    }
    setEditForm({ 
      item_name: purchase.item_name, 
      store: purchase.store, 
      price: purchase.price.toString(),
      tax_option: tax_option,
      custom_tax: custom_tax,
      apply_commission: purchase.apply_commission !== false,
      commission: (purchase.commission || 0).toString(),
      customer_id: purchase.customer_id
    });
  };

  const handleSaveEdit = async (purchaseId) => {
    try {
      const data = {};
      const orig = purchases.find(p => p.id === purchaseId);
      
      // Basic fields
      if (editForm.item_name !== orig.item_name) data.item_name = editForm.item_name;
      if (editForm.store !== orig.store) data.store = editForm.store;
      if (parseFloat(editForm.price) !== orig.price) data.price = parseFloat(editForm.price);
      
      // Customer change
      if (editForm.customer_id !== orig.customer_id) data.customer_id = editForm.customer_id;
      
      // Tax fields - use new tax option system
      const newTaxRate = getEffectiveTaxRate(editForm.tax_option, editForm.custom_tax);
      const newApplyTax = newTaxRate > 0;
      const origApplyTax = orig.apply_tax !== false;
      const origTaxRate = orig.tax_rate || 0;
      
      if (newApplyTax !== origApplyTax) data.apply_tax = newApplyTax;
      if (Math.abs(newTaxRate - origTaxRate) > 0.0001) data.tax_rate = newTaxRate;
      
      // Commission fields
      const newApplyCommission = editForm.apply_commission;
      const newCommission = parseFloat(editForm.commission) || 0;
      const origApplyCommission = orig.apply_commission !== false;
      const origCommission = orig.commission || 0;
      
      if (newApplyCommission !== origApplyCommission) data.apply_commission = newApplyCommission;
      if (newApplyCommission && newCommission !== origCommission) data.commission = newCommission;
      if (!newApplyCommission) data.commission = 0;
      
      if (Object.keys(data).length === 0) { setEditingPurchase(null); return; }
      await updatePurchase(purchaseId, data);
      toast.success("Compra actualizada");
      setEditingPurchase(null);
      loadData(true); // Preserve selection to stay on current Live
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al editar");
    }
  };

  // Step 1: User clicks the trash icon → fetch a preview from the backend so
  // the confirm dialog can show "this will leave the invoice with X items / $Y".
  const handleDeletePurchase = async (purchaseId) => {
    setDeletePreviewLoading(true);
    setDeletePwd("");
    setDeletePwdError("");
    setDeletePwdRequired(!!(selectedLive && ["completed", "ended", "finalized"].includes(selectedLive.status)));
    setDeletePreview({ purchase_id: purchaseId }); // open dialog immediately with skeleton
    try {
      const res = await getDeletePurchasePreview(purchaseId);
      setDeletePreview(res.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "No se pudo cargar la vista previa");
      setDeletePreview(null);
    } finally {
      setDeletePreviewLoading(false);
    }
  };

  // Step 2: User confirms in the dialog → actually delete.
  const confirmDeletePurchase = async () => {
    if (!deletePreview?.purchase_id) return;
    if (deletePwdRequired && !deletePwd.trim()) {
      setDeletePwdError("Ingresa la clave del administrador");
      return;
    }
    setDeleteSubmitting(true);
    setDeletePwdError("");
    try {
      await deletePurchase(deletePreview.purchase_id, deletePwd.trim() ? { password: deletePwd } : undefined);
      toast.success("Compra eliminada y saldo reembolsado");
      setDeletePreview(null);
      setDeletePwd("");
      setDeletePwdRequired(false);
      loadData(true); // Preserve selection to stay on current Live
    } catch (error) {
      if (error.response?.status === 401) {
        // Live finalizado: el backend exige la clave del administrador.
        setDeletePwdRequired(true);
        setDeletePwdError(deletePwd.trim() ? "Clave de administrador incorrecta" : "Este live está finalizado. Ingresa la clave del administrador para eliminar.");
      } else {
        toast.error(error.response?.data?.detail || "Error al eliminar");
      }
    } finally {
      setDeleteSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate("/admin")}
            data-testid="back-btn"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Live Shopping</span>
          {activeLive && (
            <Badge className="text-white animate-pulse text-sm px-3 py-1" style={{ background: '#2ECC71' }}>
              <Radio className="h-3 w-3 mr-2 inline" />
              EN VIVO
            </Badge>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* No Selected Live - Show list of all lives */}
        {!selectedLive && (
          <div className="space-y-6">
            <Card className="rounded-2xl border-dashed border-2 border-gray-300">
              <CardContent className="p-8 text-center">
                <Radio className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-700 mb-2">Selecciona o crea un Live</h2>
                <p className="text-gray-500 mb-6">Puedes crear uno nuevo o continuar con uno existente</p>
                
                <Dialog open={createLiveDialogOpen} onOpenChange={setCreateLiveDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      className="font-bold rounded-xl h-12 px-6" style={{ background: '#1E3A5F', color: 'white' }}
                      data-testid="create-live-btn"
                    >
                      <Plus className="h-5 w-5 mr-2" />
                      Crear Nuevo Live
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="rounded-2xl">
                    <DialogHeader>
                      <DialogTitle>Crear Nuevo Live</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div>
                        <Label>Tienda *</Label>
                        <Input
                          placeholder="Ej: Walmart, Target, Amazon..."
                          value={newLiveStore}
                          onChange={(e) => setNewLiveStore(e.target.value)}
                          className="h-12 rounded-xl mt-2"
                          data-testid="live-store-input"
                          autoFocus
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          El nombre del Live se crea solo: <span className="font-semibold">{newLiveStore.trim() ? `${newLiveStore.trim()} ${new Date().toLocaleDateString('es-EC')}` : `Tienda ${new Date().toLocaleDateString('es-EC')}`}</span>
                        </p>
                      </div>
                      <Button 
                        className="w-full h-12 font-bold rounded-xl" style={{ background: '#1E3A5F', color: 'white' }}
                        onClick={handleCreateLive}
                        data-testid="submit-create-live-btn"
                      >
                        Crear Live
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            {/* All Lives - Grouped by status */}
            {lives.length > 0 && (
              <div className="space-y-6">
                {/* Active Lives */}
                {lives.filter(l => l.status === "active").length > 0 && (
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                      Lives Activos
                    </h2>
                    <div className="space-y-3">
                      {lives.filter(l => l.status === "active").map((live) => (
                        <Card key={live.id} className="rounded-xl border-green-200 bg-green-50/50">
                          <CardContent className="p-4 flex items-center justify-between">
                            <div>
                              <p className="font-bold text-slate-800">{live.title}</p>
                              <p className="text-sm text-blue-600 font-medium">
                                <Store className="h-3 w-3 inline mr-1" />
                                {live.store || "Sin tienda"}
                              </p>
                              <p className="text-sm text-gray-500">
                                {live.purchase_count || 0} compras • ${(live.total_sales || 0).toFixed(2)} ventas
                              </p>
                            </div>
                            <Button 
                              onClick={() => handleSelectLive(live)}
                              className="bg-green-600 hover:bg-green-700 font-bold rounded-xl"
                              data-testid={`select-live-${live.id}`}
                            >
                              <Play className="h-4 w-4 mr-2" />
                              Continuar
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inactive Lives (not started) */}
                {lives.filter(l => l.status === "inactive").length > 0 && (
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 mb-4">Lives Pendientes</h2>
                    <div className="space-y-3">
                      {lives.filter(l => l.status === "inactive").map((live) => (
                        <Card key={live.id} className="rounded-xl">
                          <CardContent className="p-4 flex items-center justify-between">
                            <div>
                              <p className="font-bold text-slate-800">{live.title}</p>
                              <p className="text-sm text-gray-500">
                                Creado: {new Date(live.created_at).toLocaleDateString('es-ES')}
                              </p>
                            </div>
                            <Button 
                              onClick={() => handleStartLive(live.id)}
                              className="bg-blue-600 hover:bg-blue-700 font-bold rounded-xl"
                              data-testid={`start-live-${live.id}`}
                            >
                              <Play className="h-4 w-4 mr-2" />
                              Iniciar
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ended Lives — filtered/grouped by week with Monday 12:00 cutoff */}
                {(() => {
                  const finalizedLives = lives.filter(l => l.status === "ended" || l.status === "completed");
                  if (finalizedLives.length === 0) return null;

                  // Build the week-bucket dropdown options (always include current week)
                  const weeksMap = {};
                  finalizedLives.forEach(l => {
                    const ref = l.ended_at || l.created_at;
                    const key = getWeekKey(ref);
                    if (!key) return;
                    if (!weeksMap[key]) weeksMap[key] = { label: getWeekLabel(ref), count: 0, sales: 0 };
                    weeksMap[key].count += 1;
                    weeksMap[key].sales += l.total_sales || 0;
                  });
                  const currentKey = getCurrentWeekKey();
                  if (!weeksMap[currentKey]) {
                    weeksMap[currentKey] = { label: getWeekLabel(new Date().toISOString()), count: 0, sales: 0 };
                  }
                  const weekList = Object.entries(weeksMap).sort((a, b) => b[0].localeCompare(a[0]));

                  const filteredFinalized = livesWeekFilter === "all"
                    ? finalizedLives
                    : finalizedLives.filter(l => getWeekKey(l.ended_at || l.created_at) === livesWeekFilter);

                  // Group by week only when "Todas las semanas"
                  const groupedByWeek = livesWeekFilter === "all"
                    ? (() => {
                        const buckets = {};
                        filteredFinalized.forEach(l => {
                          const key = getWeekKey(l.ended_at || l.created_at) || "sin-fecha";
                          if (!buckets[key]) buckets[key] = { label: key === "sin-fecha" ? "Sin fecha" : getWeekLabel(l.ended_at || l.created_at), items: [], totalSales: 0 };
                          buckets[key].items.push(l);
                          buckets[key].totalSales += l.total_sales || 0;
                        });
                        return Object.entries(buckets).sort((a, b) => b[0].localeCompare(a[0]));
                      })()
                    : null;

                  const renderLiveCard = (live) => (
                    <Card key={live.id} className="rounded-xl bg-gray-50">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-800">{live.title}</p>
                          <p className="text-sm text-blue-600 font-medium">
                            <Store className="h-3 w-3 inline mr-1" />
                            {live.store || "Sin tienda"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {live.purchase_count || 0} compras • ${(live.total_sales || 0).toFixed(2)} ventas
                          </p>
                          <p className="text-xs text-gray-400">
                            Finalizado: {new Date(live.ended_at || live.created_at).toLocaleDateString('es-ES')}
                          </p>
                        </div>
                        <Button
                          onClick={() => handleSelectLive(live)}
                          variant="outline"
                          className="font-bold rounded-xl"
                          data-testid={`open-live-${live.id}`}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Abrir
                        </Button>
                      </CardContent>
                    </Card>
                  );

                  return (
                    <div>
                      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                        <h2 className="text-lg font-bold text-slate-800">Lives Finalizados</h2>
                        <Select value={livesWeekFilter} onValueChange={setLivesWeekFilter}>
                          <SelectTrigger className="h-9 rounded-lg text-xs bg-white w-52" data-testid="lives-week-filter">
                            <SelectValue placeholder="Filtrar por semana" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all" data-testid="lives-week-option-all">Todas las semanas</SelectItem>
                            {weekList.map(([key, w]) => (
                              <SelectItem key={key} value={key} className="text-xs" data-testid={`lives-week-option-${key}`}>
                                {w.label} ({w.count})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {filteredFinalized.length === 0 ? (
                        <Card className="rounded-xl border-dashed border-2 border-gray-200">
                          <CardContent className="p-6 text-center">
                            <p className="text-sm text-gray-500 font-medium">Sin lives finalizados en esta semana</p>
                            <p className="text-xs text-gray-400 mt-1">Cambia el filtro para ver otras semanas</p>
                          </CardContent>
                        </Card>
                      ) : groupedByWeek ? (
                        <div className="space-y-5">
                          {groupedByWeek.map(([wk, group]) => (
                            <div key={wk} className="space-y-3" data-testid={`lives-week-group-${wk}`}>
                              <div className="flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm py-1 z-10 border-b border-slate-200">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Semana: {group.label}
                                </p>
                                <span className="text-xs font-semibold text-slate-600">
                                  {group.items.length} live{group.items.length === 1 ? '' : 's'} · ${group.totalSales.toFixed(2)}
                                </span>
                              </div>
                              {group.items.map(renderLiveCard)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {filteredFinalized.map(renderLiveCard)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Selected Live - Purchase Mode */}
        {selectedLive && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Purchase Form - LEFT */}
            <div className="space-y-4">
              {/* Live Header */}
              <Card className="text-white rounded-2xl border-0 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1E3A5F, #2a4f7f)' }}>
                <CardContent className="p-0">
                  {/* Top Bar - Back button and status */}
                  <div className="px-4 py-2 flex items-center justify-between border-b border-white/10">
                    <Button 
                      onClick={() => { setSelectedLive(null); setPurchases([]); }}
                      variant="ghost"
                      size="sm"
                      className="text-white/80 hover:text-white hover:bg-white/10 -ml-2"
                      data-testid="back-to-lives-btn"
                    >
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      Volver
                    </Button>
                    <div className="flex items-center gap-2">
                      {selectedLive.status === "active" ? (
                        <>
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium text-green-300">EN VIVO</span>
                        </>
                      ) : (
                        <>
                          <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                          <span className="text-sm font-medium text-gray-300">FINALIZADO</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Main Content */}
                  <div className="p-4">
                    {/* Title and Actions Row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h2 className="text-2xl font-bold leading-tight">{selectedLive.title}</h2>
                        <p className="text-blue-200 mt-1 flex items-center gap-1">
                          <Store className="h-4 w-4" />
                          {selectedLive.store || "Sin tienda definida"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={openEditLiveDialog}
                          variant="outline"
                          size="sm"
                          className="border-white/30 text-white hover:bg-white/10"
                          data-testid="edit-live-btn"
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Editar
                        </Button>
                        {selectedLive.status === "active" && (
                          <Button 
                            onClick={handleEndLive}
                            size="sm"
                            className="bg-red-500/80 hover:bg-red-500 text-white border-0"
                            data-testid="end-live-btn"
                          >
                            <Square className="h-4 w-4 mr-1" />
                            Finalizar
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className="flex flex-nowrap items-center gap-x-4 mt-4 pt-4 border-t border-white/20">
                      <div>
                        <p className="text-gray-300 text-[11px]">Ventas</p>
                        <p className="text-lg font-bold leading-tight">{selectedLive.purchase_count || 0}</p>
                      </div>
                      <div>
                        <p className="text-gray-300 text-[11px]">Total</p>
                        <p className="text-lg font-bold leading-tight">${(selectedLive.total_sales || 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-300 text-[11px]">Comisiones</p>
                        <p className="text-lg font-bold leading-tight">${(selectedLive.total_commissions || 0).toFixed(2)}</p>
                      </div>
                      {/* Manual Commission Button */}
                      <div>
                        <button
                          onClick={openManualCommissionDialog}
                          className="flex flex-col items-start hover:bg-white/10 rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors"
                          data-testid="manual-commission-btn"
                        >
                          <p className="text-gray-300 text-[11px] flex items-center gap-1">
                            <HandCoins className="h-3 w-3" />
                            Comisión Manual
                          </p>
                          <p className={`text-lg font-bold leading-tight ${(selectedLive.manual_commission || 0) > 0 ? 'text-green-300' : 'text-white/50'}`}>
                            ${(selectedLive.manual_commission || 0).toFixed(2)}
                          </p>
                        </button>
                      </div>
                      {/* Store Invoice inline in header - always show */}
                      <div className="ml-auto min-w-0">
                        <StoreInvoiceSection 
                          live={selectedLive} 
                          onUpdate={async () => {
                            const res = await getLive(selectedLive.id);
                            setSelectedLive(res.data);
                          }}
                          compact={true}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Purchase Form - Only show if live is active */}
              {selectedLive.status === "active" ? (
              <Card className="rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    Registro Rápido
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitPurchase} noValidate className="space-y-4">
                    {/* Customer ID with Autocomplete */}
                    <div>
                      <Label className="text-sm font-medium">ID Cliente</Label>
                      <div className="relative mt-1">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 z-10" />
                        <Input
                          ref={customerIdRef}
                          placeholder="ID o nombre del cliente..."
                          value={clientSearchValue}
                          onChange={(e) => {
                            handleCustomerIdChange(e.target.value);
                            if (e.target.value.length >= 1) {
                              setClientSearchOpen(true);
                            }
                          }}
                          onFocus={() => clientSearchValue.length >= 1 && setClientSearchOpen(true)}
                          onBlur={() => setTimeout(() => setClientSearchOpen(false), 200)}
                          className="pl-10 h-14 text-xl font-bold rounded-xl"
                          data-testid="purchase-customer-id"
                          autoComplete="off"
                        />
                        
                        {/* Autocomplete Dropdown */}
                        {clientSearchOpen && filteredClients.length > 0 && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                            {filteredClients.map((client) => {
                              const dbt = debtStatusMap[String(client.customer_id || "").toUpperCase()];
                              return (
                              <button
                                key={client.id}
                                type="button"
                                onClick={() => handleSelectClient(client)}
                                className="w-full px-4 py-3 text-left hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-0"
                                data-testid={`client-suggestion-${client.customer_id}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-bold text-blue-600 flex-shrink-0">#{client.customer_id}</span>
                                  <span className="text-gray-800 truncate">{client.name}</span>
                                  {dbt && (
                                    <span
                                      title={dbt.label}
                                      className={`inline-block w-2.5 h-2.5 rounded-full ${debtDotClass(dbt.color)} flex-shrink-0`}
                                      data-testid={`client-debt-dot-${client.customer_id}-${dbt.color}`}
                                    />
                                  )}
                                </div>
                              </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {selectedCustomer && (() => {
                        const dbt = debtStatusMap[String(selectedCustomer.customer_id || "").toUpperCase()];
                        const pending = Number(selectedCustomer.pending_to_invoice || 0);
                        const pendingCount = Number(selectedCustomer.pending_purchases_count || 0);
                        // Color escalonado para que sea visualmente fácil identificar
                        // a quién hay que cobrar antes del viernes.
                        let pendingCls = "";
                        if (pending >= 150) pendingCls = "bg-red-100 text-red-800 border-red-200";
                        else if (pending >= 50) pendingCls = "bg-amber-100 text-amber-800 border-amber-200";
                        else if (pending > 0) pendingCls = "bg-yellow-50 text-yellow-700 border-yellow-200";
                        return (
                        <div className="mt-2 p-3 bg-green-50 rounded-xl flex items-center gap-2 flex-wrap">
                          <CheckCircle className="h-5 w-5 text-green-600" />
                          <span className="font-medium text-green-800">{selectedCustomer.name}</span>
                          {dbt && (
                            <span
                              title={dbt.label}
                              className={`inline-block w-2.5 h-2.5 rounded-full ${debtDotClass(dbt.color)}`}
                              data-testid={`selected-client-debt-dot-${dbt.color}`}
                            />
                          )}
                          {pendingCount > 0 && (
                            <span
                              className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold border rounded-md ${pendingCls}`}
                              title={`${pendingCount} compras sin facturar`}
                              data-testid="selected-client-pending-badge"
                            >
                              <Receipt className="h-3 w-3" />
                              Por facturar: {pendingCount} items (${pending.toFixed(2)})
                            </span>
                          )}
                        </div>
                        );
                      })()}
                    </div>

                    {/* Item Name */}
                    <div>
                      <Label className="text-sm font-medium">Producto</Label>
                      <div className="relative mt-1">
                        <ShoppingBag className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <Input
                          placeholder="Nombre del producto"
                          value={purchaseForm.item_name}
                          onChange={(e) => setPurchaseForm({ ...purchaseForm, item_name: e.target.value })}
                          className="pl-10 h-12 rounded-xl"
                          data-testid="purchase-item-name"
                        />
                      </div>
                    </div>

                    {/* Price */}
                    <div>
                      <div className="flex items-end justify-between gap-2">
                        <Label className="text-sm font-medium">Precio (USD)</Label>
                        <Label className="text-[11px] font-medium text-gray-500" htmlFor="purchase-qty">Cant.</Label>
                      </div>
                      <div className="relative mt-1 flex gap-2 items-stretch">
                        <div className="relative flex-1">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={purchaseForm.price}
                            onChange={(e) => setPurchaseForm({ ...purchaseForm, price: e.target.value })}
                            onWheel={(e) => e.target.blur()}
                            onInvalid={(e) => e.preventDefault()}
                            className="pl-10 h-14 text-2xl font-bold text-center rounded-xl"
                            data-testid="purchase-price"
                          />
                        </div>
                        <Input
                          id="purchase-qty"
                          type="number"
                          inputMode="numeric"
                          step="1"
                          min="1"
                          max="50"
                          value={purchaseForm.quantity}
                          onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: e.target.value })}
                          onWheel={(e) => e.target.blur()}
                          className="w-16 h-14 text-lg font-semibold text-center rounded-xl"
                          title="Cantidad de unidades a registrar"
                          data-testid="purchase-quantity"
                        />
                      </div>
                      
                      {/* Tax Options - Dropdown */}
                      <div className="mt-3 p-3 bg-blue-50 rounded-xl">
                        <p className="text-xs font-semibold text-gray-600 mb-2">Impuesto (Tax)</p>
                        <div className="flex gap-2 items-center">
                          <Select 
                            value={purchaseForm.tax_option} 
                            onValueChange={(val) => setPurchaseForm({ ...purchaseForm, tax_option: val })}
                          >
                            <SelectTrigger className="h-10 rounded-lg bg-white flex-1" data-testid="tax-select">
                              <SelectValue placeholder="Seleccionar impuesto" />
                            </SelectTrigger>
                            <SelectContent>
                              {taxOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          
                          {purchaseForm.tax_option === "other" && (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                placeholder="0"
                                value={purchaseForm.custom_tax}
                                onChange={(e) => setPurchaseForm({ ...purchaseForm, custom_tax: e.target.value })}
                                onWheel={(e) => e.target.blur()}
                                onInvalid={(e) => e.preventDefault()}
                                className="w-20 h-10 text-center rounded-lg"
                                data-testid="custom-tax-input"
                              />
                              <span className="text-sm font-medium text-gray-600">%</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Commission */}
                      <div className="mt-3 p-3 bg-yellow-50 rounded-xl">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={purchaseForm.apply_commission}
                              onChange={(e) => setPurchaseForm({ ...purchaseForm, apply_commission: e.target.checked })}
                              className="w-4 h-4 rounded text-yellow-600"
                              data-testid="apply-commission-checkbox"
                            />
                            <span className="text-sm font-medium text-gray-700">Comisión $</span>
                          </label>
                          {purchaseForm.apply_commission && (
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              placeholder="3.00"
                              value={purchaseForm.commission_amount}
                              onChange={(e) => setPurchaseForm({ ...purchaseForm, commission_amount: e.target.value })}
                              onWheel={(e) => e.target.blur()}
                              onInvalid={(e) => e.preventDefault()}
                              className="w-24 h-8 text-center rounded-lg text-sm font-bold"
                              data-testid="commission-amount-input"
                            />
                          )}
                        </div>
                      </div>

                      {purchaseForm.price && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-xl">
                          {(() => {
                            const price = parseFloat(purchaseForm.price || 0);
                            const taxRate = getEffectiveTaxRate(purchaseForm.tax_option, purchaseForm.custom_tax);
                            const taxAmount = price * taxRate;
                            const priceWithTax = price + taxAmount;
                            const commission = purchaseForm.apply_commission ? parseFloat(purchaseForm.commission_amount || 0) : 0;
                            const total = priceWithTax + commission;
                            const qty = Math.max(1, Math.min(50, parseInt(purchaseForm.quantity || "1", 10) || 1));
                            const taxLabel = purchaseForm.tax_option === "other" 
                              ? `${purchaseForm.custom_tax || 0}%`
                              : purchaseForm.tax_option === "0" 
                                ? "Sin Tax" 
                                : `${purchaseForm.tax_option}%`;
                            
                            return (
                              <>
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">Precio:</span>
                                  <span className="font-medium">${price.toFixed(2)}</span>
                                </div>
                                {taxRate > 0 && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Tax ({taxLabel}):</span>
                                    <span className="font-medium">${taxAmount.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-sm font-bold text-blue-600">
                                  <span>Precio {taxRate > 0 ? '+ Tax' : ''}:</span>
                                  <span>${priceWithTax.toFixed(2)}</span>
                                </div>
                                {purchaseForm.apply_commission && (
                                  <div className="flex justify-between text-sm mt-2 pt-2 border-t border-dashed">
                                    <span className="text-yellow-600">Comisión:</span>
                                    <span className="font-bold text-yellow-600">${commission.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-lg font-bold mt-2 pt-2 border-t -mx-3 px-3 py-2 rounded-b-xl" style={{ background: 'rgba(30,58,95,0.05)' }}>
                                  <span>Se descuenta del saldo:</span>
                                  <span className="text-red-600">${total.toFixed(2)}</span>
                                </div>
                                {qty > 1 && (
                                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-dashed text-gray-600" data-testid="purchase-qty-total">
                                    <span>× {qty} unidades =</span>
                                    <span className="font-bold text-red-700">${(total * qty).toFixed(2)}</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Submit Button */}
                    <Button
                      type="submit"
                      className="w-full h-16 text-white font-black text-xl rounded-2xl shadow-xl active:scale-95 transition-transform"
                      style={{ background: '#1E3A5F' }}
                      disabled={submitting}
                      data-testid="submit-purchase-btn"
                    >
                      {submitting ? (
                        <span className="flex items-center gap-2">
                          <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></span>
                          GUARDANDO...
                        </span>
                      ) : (
                        <>
                          <CheckCircle className="h-6 w-6 mr-2" />
                          REGISTRAR COMPRA
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              ) : (
              /* Message for finalized lives - no purchase form */
              <Card className="rounded-2xl border-amber-200 bg-amber-50">
                <CardContent className="p-6 text-center">
                  <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-amber-800 mb-2">Live Finalizado</h3>
                  <p className="text-amber-700 mb-4">
                    Este live está finalizado. Solo puedes ver las compras registradas.
                  </p>
                  <Button 
                    onClick={handleReactivateLive}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl h-12 px-6"
                    data-testid="reactivate-live-btn"
                  >
                    <Play className="h-5 w-5 mr-2" />
                    Reactivar Live para Agregar Productos
                  </Button>
                </CardContent>
              </Card>
              )}
            </div>

            {/* Purchases List - RIGHT */}
            <div>
              <Card className="rounded-2xl h-[calc(100vh-160px)] flex flex-col">
                <CardHeader className="pb-2 shrink-0 max-h-[280px] overflow-hidden">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg" data-testid="live-purchases-title">Compras del Live ({purchases.length})</CardTitle>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Buscar cliente..."
                        value={clientGroupSearch}
                        onChange={(e) => setClientGroupSearch(e.target.value)}
                        className="h-7 w-28 text-xs rounded-md px-2"
                        data-testid="client-group-search"
                      />
                      <Badge className="bg-blue-100 text-blue-800 font-bold" data-testid="live-total-items">
                        <Package className="h-3 w-3 mr-1" />
                        {purchases.length} prendas
                      </Badge>
                    </div>
                  </div>

                  {/* Client summary - collapsible */}
                  {purchases.length > 0 && (() => {
                    const clientGroups = {};
                    purchases.forEach(p => {
                      const cid = p.customer_id || "SIN_ID";
                      if (!clientGroups[cid]) {
                        const cl = activeClients.find(c => c.customer_id === cid);
                        clientGroups[cid] = { name: cl?.name || cid, count: 0, total: 0, price: 0, commission: 0 };
                      }
                      clientGroups[cid].count++;
                      clientGroups[cid].total += p.total || 0;
                      clientGroups[cid].price += p.price || 0;
                      clientGroups[cid].commission += p.commission || 0;
                    });
                    const sortedClients = Object.entries(clientGroups).sort((a, b) => b[1].count - a[1].count);
                    const filteredGroupClients = clientGroupSearch.trim()
                      ? sortedClients.filter(([cid, info]) =>
                          cid.toLowerCase().includes(clientGroupSearch.toLowerCase()) ||
                          info.name.toLowerCase().includes(clientGroupSearch.toLowerCase())
                        )
                      : sortedClients;
                    const reviewedCount = sortedClients.filter(([cid]) => reviewedClients[cid]).length;

                    return (
                      <div className="mt-2 border rounded-lg overflow-hidden" data-testid="client-summary-section">
                        <div className="bg-slate-50 px-3 py-1.5 flex items-center justify-between text-xs text-slate-600 border-b">
                          <span className="font-semibold">{sortedClients.length} clientes</span>
                          <span>{reviewedCount}/{sortedClients.length} revisados</span>
                        </div>
                        <div className="max-h-[120px] overflow-y-auto divide-y divide-slate-100">
                          {filteredGroupClients.map(([cid, info]) => {
                            const isExpanded = expandedClient === cid;
                            const isReviewed = !!reviewedClients[cid];
                            return (
                              <div key={cid} data-testid={`client-group-${cid}`}>
                                <div
                                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 transition-colors text-xs ${isExpanded ? 'bg-blue-50' : ''}`}
                                  onClick={() => {
                                    setExpandedClient(isExpanded ? null : cid);
                                    setPurchaseSearch("");
                                  }}
                                >
                                  <Checkbox
                                    checked={isReviewed}
                                    onCheckedChange={(checked) => {
                                      setReviewedClients(prev => ({ ...prev, [cid]: !!checked }));
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-3.5 w-3.5 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                                    data-testid={`review-check-${cid}`}
                                  />
                                  {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                                  <span className="text-[10px] text-blue-600 font-bold shrink-0">{cid}</span>
                                  <span className={`font-medium flex-1 truncate ${isReviewed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                    {info.name}
                                  </span>
                                  <Badge variant="outline" className="h-5 text-[10px] px-1.5 font-bold">
                                    {info.count}
                                  </Badge>
                                  <span className="text-slate-600 font-medium text-[10px] w-16 text-right">${info.price.toFixed(2)}</span>
                                </div>
                                {isExpanded && (
                                  <div className="bg-blue-50/50 px-3 py-1 space-y-0.5 border-t border-blue-100">
                                    {purchases.filter(p => p.customer_id === cid).map(p => (
                                      <div key={p.id} className="flex items-center text-[10px] text-slate-500 py-0.5">
                                        <span className="truncate flex-1">{p.item_name}</span>
                                        <span className="w-16 text-right font-medium">${(p.price || 0).toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar por cliente o producto..."
                      value={purchaseSearch}
                      onChange={(e) => { setPurchaseSearch(e.target.value); setExpandedClient(null); }}
                      className="pl-9 h-9 rounded-lg text-sm"
                      data-testid="purchase-search-input"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 flex-1 overflow-hidden">
                  <ScrollArea className="h-full pr-2">
                    {(() => {
                      let filtered = purchases;
                      // If a client is selected from the summary, filter to that client
                      if (expandedClient && !purchaseSearch.trim()) {
                        filtered = purchases.filter(p => p.customer_id === expandedClient);
                      } else if (purchaseSearch.trim()) {
                        filtered = purchases.filter(p => 
                            p.customer_id?.toLowerCase().includes(purchaseSearch.toLowerCase()) ||
                            p.item_name?.toLowerCase().includes(purchaseSearch.toLowerCase()) ||
                            activeClients.find(c => c.customer_id === p.customer_id)?.name?.toLowerCase().includes(purchaseSearch.toLowerCase())
                          );
                      }
                      
                      if (filtered.length === 0 && purchases.length > 0) {
                        return (
                          <div className="text-center py-8 text-gray-400">
                            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No se encontraron resultados</p>
                          </div>
                        );
                      }
                      if (filtered.length === 0) {
                        return (
                          <div className="text-center py-12 text-gray-400">
                            <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-50" />
                            <p>Sin compras aun</p>
                          </div>
                        );
                      }
                      return (
                        <div className="space-y-2">
                          {expandedClient && !purchaseSearch.trim() && (
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs text-blue-600 font-medium" data-testid="filtered-client-label">
                                Mostrando: {activeClients.find(c => c.customer_id === expandedClient)?.name || expandedClient} ({filtered.length})
                              </p>
                              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setExpandedClient(null)} data-testid="show-all-btn">
                                Ver todo
                              </Button>
                            </div>
                          )}
                          {filtered.map((purchase) => (
                          <PurchaseItem
                            key={purchase.id}
                            purchase={purchase}
                            isEditing={editingPurchase === purchase.id}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            taxOptions={taxOptions}
                            activeClients={activeClients}
                            getEffectiveTaxRate={getEffectiveTaxRate}
                            onEdit={handleEditPurchase}
                            onSaveEdit={handleSaveEdit}
                            onCancelEdit={() => setEditingPurchase(null)}
                            onDelete={handleDeletePurchase}
                          />
                        ))}
                      </div>
                      );
                    })()}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Edit Live Dialog */}
        <Dialog open={editLiveDialogOpen} onOpenChange={setEditLiveDialogOpen}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="h-5 w-5 text-blue-600" />
                Editar Live
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label className="text-sm font-semibold">Título del Live *</Label>
                <Input
                  placeholder="Ej: Live de Navidad"
                  value={editLiveForm.title}
                  onChange={(e) => setEditLiveForm({...editLiveForm, title: e.target.value})}
                  className="mt-1 h-11 rounded-xl"
                  data-testid="edit-live-title"
                />
              </div>
              <div>
                <Label className="text-sm font-semibold">Tienda</Label>
                <Input
                  placeholder="Ej: Amazon, Target, Walmart"
                  value={editLiveForm.store}
                  onChange={(e) => setEditLiveForm({...editLiveForm, store: e.target.value})}
                  className="mt-1 h-11 rounded-xl"
                  data-testid="edit-live-store"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setEditLiveDialogOpen(false)}
                  className="flex-1 h-11 rounded-xl"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleUpdateLive}
                  className="flex-1 h-11 rounded-xl font-bold"
                  style={{ background: '#1E3A5F', color: 'white' }}
                  data-testid="save-edit-live-btn"
                >
                  Guardar Cambios
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Debt-status confirmation: gate sales for clients in "red" status */}
        <Dialog open={!!debtConfirmDialog} onOpenChange={(open) => !open && setDebtConfirmDialog(null)}>
          <DialogContent className="rounded-2xl max-w-md" data-testid="debt-confirm-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Cliente con deuda crítica
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-sm font-bold text-red-900">
                  {debtConfirmDialog?.client?.name || debtConfirmDialog?.client?.customer_id}
                </p>
                <p className="text-xs text-red-800 mt-1">
                  Tiene <span className="font-extrabold">{debtConfirmDialog?.status?.days || 0} día(s) sin pagar</span>.
                </p>
                <p className="text-xs text-red-800">
                  Última factura pendiente: <span className="font-extrabold">${(debtConfirmDialog?.status?.amount || 0).toFixed(2)}</span>
                </p>
              </div>
              <p className="text-sm text-slate-700">
                ¿Quieres continuar registrando esta compra?
              </p>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setDebtConfirmDialog(null)}
                  className="flex-1 h-11 rounded-xl"
                  data-testid="debt-confirm-cancel"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={() => debtConfirmDialog?.proceed?.()}
                  className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                  data-testid="debt-confirm-continue"
                >
                  Continuar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirm Open Finalized Live Dialog */}
        <Dialog open={confirmOpenFinalizedDialog} onOpenChange={setConfirmOpenFinalizedDialog}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                Live Finalizado
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-gray-600">
                Este live ya fue <strong>finalizado</strong>. Al abrirlo podrás ver los productos registrados pero no podrás agregar nuevos.
              </p>
              <p className="text-sm text-gray-500">
                ¿Estás seguro de que quieres abrir este live?
              </p>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmOpenFinalizedDialog(false);
                    setLiveToOpen(null);
                  }}
                  className="flex-1 h-11 rounded-xl"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={confirmOpenFinalizedLive}
                  className="flex-1 h-11 rounded-xl font-bold bg-amber-500 hover:bg-amber-600 text-white"
                >
                  Sí, Abrir Live
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reactivate finalized live — requires Astrid-Shop admin password */}
        <Dialog open={reactivatePwdOpen} onOpenChange={(open) => { if (!open && !reactivatePwdSubmitting) { setReactivatePwdOpen(false); setReactivatePwd(""); setReactivatePwdError(""); } }}>
          <DialogContent className="rounded-2xl max-w-md" data-testid="reactivate-pwd-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-800">
                <Play className="h-5 w-5 text-green-600" />
                Reactivar Live
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                Para reactivar este live finalizado y <strong>agregar productos</strong>, ingresa la <strong>clave del administrador de Astrid-Shop</strong>.
              </p>
              <div>
                <Label className="text-sm font-medium">Clave de administrador</Label>
                <Input
                  type="password"
                  autoFocus
                  value={reactivatePwd}
                  onChange={(e) => { setReactivatePwd(e.target.value); setReactivatePwdError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") doReactivateLive(); }}
                  placeholder="••••••••"
                  className="h-12 rounded-xl mt-2"
                  data-testid="reactivate-pwd-input"
                />
                {reactivatePwdError && (
                  <p className="text-xs text-red-600 mt-1" data-testid="reactivate-pwd-error">{reactivatePwdError}</p>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { setReactivatePwdOpen(false); setReactivatePwd(""); setReactivatePwdError(""); }}
                  disabled={reactivatePwdSubmitting}
                  className="flex-1 h-11 rounded-xl"
                  data-testid="reactivate-pwd-cancel"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={doReactivateLive}
                  disabled={reactivatePwdSubmitting}
                  className="flex-1 h-11 rounded-xl font-bold bg-green-600 hover:bg-green-700 text-white"
                  data-testid="reactivate-pwd-confirm"
                >
                  {reactivatePwdSubmitting ? "Verificando…" : "Reactivar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete purchase confirmation with backend-computed preview */}
        <AlertDialog open={!!deletePreview} onOpenChange={(open) => { if (!open && !deleteSubmitting) { setDeletePreview(null); setDeletePwd(""); setDeletePwdError(""); setDeletePwdRequired(false); } }}>
          <AlertDialogContent data-testid="delete-purchase-preview-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-700">
                <Trash2 className="h-5 w-5" /> Eliminar producto
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="text-sm text-slate-600 space-y-3 pt-1">
                  {deletePreviewLoading || !deletePreview?.item_name ? (
                    <p className="text-slate-400">Calculando impacto…</p>
                  ) : (
                    <>
                      <p>
                        Vas a eliminar <span className="font-semibold text-slate-800">{deletePreview.item_name}</span>
                        {deletePreview.store && (<> de <span className="font-semibold text-slate-800">{deletePreview.store}</span></>)}
                        {deletePreview.customer_name && (
                          <> del cliente <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{deletePreview.customer_id}</span> <span className="font-semibold">{deletePreview.customer_name}</span></>
                        )}.
                      </p>
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs">
                        <p className="font-semibold text-emerald-800">
                          Se reembolsará <span className="font-mono">${(deletePreview.refund_amount || 0).toFixed(2)}</span> al saldo del cliente.
                        </p>
                      </div>
                      {deletePreview.belongs_to_invoice ? (
                        <div className={`rounded-lg p-2.5 border text-xs ${deletePreview.is_last_item ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`} data-testid="delete-preview-invoice-block">
                          <p className="font-semibold text-slate-800">
                            Pertenece a la factura <span className="font-mono">{deletePreview.invoice_number}</span>
                            {deletePreview.invoice_status === "approved" && (<> <span className="ml-1 text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-1 py-0.5 rounded">aprobada</span></>)}
                          </p>
                          {deletePreview.is_last_item ? (
                            <p className="mt-1 text-red-700">
                              ⚠️ Es el <strong>último ítem</strong>. La factura quedará vacía y se desmarcará.
                            </p>
                          ) : (
                            <p className="mt-1 text-slate-700">
                              Después: <span className="font-semibold">{deletePreview.items_after_count} {deletePreview.items_after_count === 1 ? "ítem" : "ítems"}</span> · total <span className="font-mono line-through text-slate-400">${(deletePreview.current_invoice_total || 0).toFixed(2)}</span> → <span className="font-mono font-bold text-slate-900">${(deletePreview.invoice_total_after || 0).toFixed(2)}</span>
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-slate-500">Los saldos del cliente se recalcularán automáticamente.</p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Este producto no pertenece a ninguna factura.</p>
                      )}
                      {deletePwdRequired && (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-2" data-testid="delete-pwd-block">
                          <p className="text-xs font-semibold text-slate-700">
                            Este live está finalizado. Ingresa la <strong>clave del administrador de Astrid-Shop</strong> para eliminar.
                          </p>
                          <Input
                            type="password"
                            value={deletePwd}
                            onChange={(e) => { setDeletePwd(e.target.value); setDeletePwdError(""); }}
                            placeholder="Clave de administrador"
                            className="h-10 rounded-lg bg-white"
                            data-testid="delete-pwd-input"
                          />
                          {deletePwdError && (
                            <p className="text-xs text-red-600" data-testid="delete-pwd-error">{deletePwdError}</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="delete-purchase-cancel">Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); confirmDeletePurchase(); }}
                disabled={deleteSubmitting || deletePreviewLoading || !deletePreview?.item_name || (deletePwdRequired && !deletePwd.trim())}
                className="bg-red-600 hover:bg-red-700 text-white"
                data-testid="delete-purchase-confirm"
              >
                {deleteSubmitting ? "Eliminando…" : "Sí, eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Manual Commission Dialog */}
        <Dialog open={manualCommissionDialog} onOpenChange={setManualCommissionDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={{ color: "#1E3A5F" }}>
                <HandCoins className="h-5 w-5 text-green-600" />
                Comisión Manual del Live
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-gray-600">
                Agrega una comisión extra que se sumará a las ganancias de este Live.
                Esta comisión se incluirá en reportes y estadísticas.
              </p>
              <div>
                <Label className="text-sm font-medium">Monto de Comisión ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={manualCommissionValue}
                  onChange={(e) => setManualCommissionValue(e.target.value)}
                  className="mt-1"
                  data-testid="manual-commission-input"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Nota (opcional)</Label>
                <Input
                  type="text"
                  placeholder="Ej: Propina, comisión acordada..."
                  value={manualCommissionNote}
                  onChange={(e) => setManualCommissionNote(e.target.value)}
                  className="mt-1"
                  data-testid="manual-commission-note"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setManualCommissionDialog(false)}
                disabled={savingManualCommission}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveManualCommission}
                disabled={savingManualCommission}
                className="bg-green-600 hover:bg-green-700"
                data-testid="save-manual-commission-btn"
              >
                {savingManualCommission ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
