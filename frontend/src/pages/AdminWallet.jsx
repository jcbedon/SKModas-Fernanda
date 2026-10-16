import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getPendingDeposits, approveDeposit, rejectDeposit, getAllDeposits, adminBalanceAdjustment, adminCreateRecharge, getAllClients, generateRechargeUploadQR, checkRechargeUploadStatus, deleteDeposit, getDeletedDeposits, setDepositAmount, scanDepositProof, listBankAccounts, setDepositBankReviewed } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CheckCircle, Clock, Image, ZoomIn, XCircle, History, Minus, DollarSign, Search, Plus, Upload, FileBarChart, QrCode, Smartphone, Loader2, Trash2, AlertTriangle, RefreshCw, Check } from "lucide-react";
import RechargeReport from "@/components/RechargeReport";
import ClientBalanceReport from "@/components/ClientBalanceReport";
import QRCode from "qrcode";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Weekly cycle: MONDAY 00:00 local → SUNDAY 23:59 local (Mon-Sun window).
// Recharge filter closes Sunday 11:59 PM and reopens Monday 00:00 AM.
const getWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  // Snap to local midnight first so we bucket by calendar day, not by hour.
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // JS getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday.
  // Days back to Monday: Sun→6, Mon→0, Tue→1, ..., Sat→5.
  const jsDay = local.getDay();
  const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1;
  local.setDate(local.getDate() - daysSinceMonday);
  // Encode key as local YYYY-MM-DD (avoid toISOString which drifts by TZ).
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getWeekLabel = (dateStr) => {
  const key = getWeekKey(dateStr);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  const startMonday = new Date(y, m - 1, d);
  // Inclusive endpoints: Monday → Sunday of the same 7-day window.
  const endSunday = new Date(startMonday);
  endSunday.setDate(startMonday.getDate() + 6);
  const fmt = (dt) => {
    const day = dt.getDate();
    const monthRaw = dt.toLocaleDateString('es-ES', { month: 'short' });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).replace('.', '');
    return `${day} ${month}`;
  };
  return `${fmt(startMonday)} - ${fmt(endSunday)}`;
};

const getCurrentWeekKey = () => getWeekKey(new Date().toISOString());

export default function AdminWallet() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";
  
  const [pendingDeposits, setPendingDeposits] = useState([]);
  const [depositAmountEdits, setDepositAmountEdits] = useState({});
  const [scanningDeposit, setScanningDeposit] = useState(null);
  const [scanResults, setScanResults] = useState({}); // {depositId: {detected_reference_number, detected_amount, matches_reference, ...}}
  const [allDeposits, setAllDeposits] = useState([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyWeekFilter, setHistoryWeekFilter] = useState(() => getCurrentWeekKey());
  const [dashboardWeekFilter, setDashboardWeekFilter] = useState(() => getCurrentWeekKey());
  
  // Recharge Report state
  const [showReport, setShowReport] = useState(false);
  const [reportTab, setReportTab] = useState("balance"); // "balance" or "recharges"
  
  // Deleted tab state
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedDeposits, setDeletedDeposits] = useState([]);

  // Duplicates tab state
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [dupClientSearch, setDupClientSearch] = useState("");
  const [dupRefSearch, setDupRefSearch] = useState("");
  const [dupAmountSearch, setDupAmountSearch] = useState("");
  const [dupShowAccepted, setDupShowAccepted] = useState(false);
  
  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  
  // Ajuste de balance state
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  // Crear recarga state
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [rechargeClient, setRechargeClient] = useState(null); // Changed to object
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargeDescription, setRechargeDescription] = useState("");
  const [rechargeProof, setRechargeProof] = useState(null);
  const [rechargeProofPreview, setRechargeProofPreview] = useState(null);
  const [creatingRecharge, setCreatingRecharge] = useState(false);
  const [rechargeClientSearchOpen, setRechargeClientSearchOpen] = useState(false);
  const [rechargeClientSearch, setRechargeClientSearch] = useState("");
  // Active bank accounts of the tenant — used to attribute the recharge to a
  // specific account so it shows up in the bank ledger. When the tenant has
  // only one account we don't even need to render the selector.
  const [bankAccounts, setBankAccounts] = useState([]);
  const [rechargeBankAccountId, setRechargeBankAccountId] = useState("");
  const rechargeFileInputRef = useRef(null);
  
  // QR Upload state
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef(null);
  
  const APP_URL = process.env.REACT_APP_BACKEND_URL?.replace('/api', '') || window.location.origin;

  useEffect(() => { 
    loadData(); 
  }, [includeDeleted]);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadData());

  const loadData = async () => {
    try {
      const [pendingRes, allRes, clientsRes, deletedRes, banksRes] = await Promise.all([
        getPendingDeposits(),
        getAllDeposits(includeDeleted),
        getAllClients(),
        getDeletedDeposits().catch(() => ({ data: [] })),
        listBankAccounts().catch(() => ({ data: { bank_accounts: [] } })),
      ]);
      setPendingDeposits(pendingRes.data);
      setAllDeposits(allRes.data);
      setClients(clientsRes.data);
      setDeletedDeposits(deletedRes.data || []);
      const active = ((banksRes.data?.bank_accounts) || []).filter((a) => a.is_active !== false);
      setBankAccounts(active);
      // When only one active account exists, preselect it so the manual
      // recharge always lands somewhere even if the admin doesn't touch the
      // selector.
      if (active.length === 1) {
        setRechargeBankAccountId(active[0].id);
      }
    } catch (error) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const loadDuplicates = async () => {
    setDuplicatesLoading(true);
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = JSON.parse(localStorage.getItem("outletsusa_user"))?.token;
      const res = await fetch(`${API}/api/wallet/duplicates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setDuplicates(data);
    } catch {
      toast.error("Error al cargar duplicados");
    } finally {
      setDuplicatesLoading(false);
    }
  };

  const acceptDuplicateGroup = async (kind, group) => {
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = JSON.parse(localStorage.getItem("outletsusa_user"))?.token;
      await fetch(`${API}/api/wallet/duplicates/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: kind,
          key: group.key,
          tx_ids: (group.transactions || []).map(t => t.id),
        }),
      });
      toast.success("Grupo marcado como aceptado");
      await loadDuplicates();
    } catch {
      toast.error("Error al aceptar");
    }
  };

  const unacceptDuplicateGroup = async (group) => {
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = JSON.parse(localStorage.getItem("outletsusa_user"))?.token;
      await fetch(`${API}/api/wallet/duplicates/unaccept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ signature: group.signature }),
      });
      toast.success("Grupo reactivado");
      await loadDuplicates();
    } catch {
      toast.error("Error al reactivar");
    }
  };


  const handleScanProof = async (depositId) => {
    setScanningDeposit(depositId);
    try {
      const res = await scanDepositProof(depositId);
      setScanResults({ ...scanResults, [depositId]: res.data });
      // If detected amount and admin hasn't set one yet, prefill it
      const currentEdit = depositAmountEdits[depositId];
      if (!currentEdit && res.data.detected_amount) {
        setDepositAmountEdits({ ...depositAmountEdits, [depositId]: String(res.data.detected_amount) });
      }
      if (res.data.matches_reference === true) {
        toast.success("Comprobante coincide");
      } else if (res.data.matches_reference === false) {
        toast.error("El comprobante NO coincide con lo que escribió el cliente");
      } else {
        toast.info("Información extraída del comprobante");
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al leer el comprobante");
    } finally {
      setScanningDeposit(null);
    }
  };

  const handleApprove = async (transactionId) => {
    const tx = pendingDeposits.find(d => d.id === transactionId);
    // If amount missing or zero, require admin to input it (client-submitted recharges)
    if (!tx?.amount || tx.amount <= 0) {
      const amountEdit = depositAmountEdits[transactionId];
      const newAmount = parseFloat(amountEdit);
      if (isNaN(newAmount) || newAmount <= 0) {
        toast.error("Ingresa el monto de la recarga antes de aprobar");
        return;
      }
      try {
        await setDepositAmount(transactionId, newAmount);
      } catch (error) {
        toast.error(error.response?.data?.detail || "Error al asignar monto");
        return;
      }
    }
    setApproving(transactionId);
    try {
      await approveDeposit(transactionId);
      toast.success("Depósito aprobado");
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al aprobar");
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (transactionId) => {
    setRejecting(transactionId);
    try {
      await rejectDeposit(transactionId);
      toast.success("Depósito rechazado");
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al rechazar");
    } finally {
      setRejecting(null);
    }
  };

  const openDeleteDialog = (transactionId) => {
    setDeleteTargetId(transactionId);
    setDeletePassword("");
    setDeleteDialogOpen(true);
  };

  const handleDeleteDeposit = async () => {
    if (!deletePassword) {
      toast.error("Ingresa tu contraseña");
      return;
    }
    setDeleting(true);
    try {
      await deleteDeposit(deleteTargetId, deletePassword);
      toast.success("Recarga eliminada exitosamente");
      setDeleteDialogOpen(false);
      setDeletePassword("");
      setDeleteTargetId(null);
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  };

  const handleBalanceAdjustment = async () => {
    if (!selectedClient || !adjustAmount || !adjustReason) {
      toast.error("Completa todos los campos");
      return;
    }
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    setAdjusting(true);
    try {
      await adminBalanceAdjustment({
        user_id: selectedClient,
        amount: amount,
        description: adjustReason
      });
      toast.success("Ajuste realizado exitosamente");
      setAdjustDialogOpen(false);
      setSelectedClient("");
      setAdjustAmount("");
      setAdjustReason("");
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al realizar ajuste");
    } finally {
      setAdjusting(false);
    }
  };

  const handleRechargeProofChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("El archivo es demasiado grande. Máximo 10MB");
        return;
      }
      setRechargeProof(file);
      const reader = new FileReader();
      reader.onload = (e) => setRechargeProofPreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleCreateRecharge = async () => {
    if (!rechargeClient) {
      toast.error("Selecciona un cliente");
      return;
    }
    if (!rechargeAmount || parseFloat(rechargeAmount) <= 0) {
      toast.error("Ingresa un monto válido mayor a 0");
      return;
    }
    if (!rechargeProof) {
      toast.error("El comprobante es obligatorio");
      return;
    }
    if (bankAccounts.length === 0) {
      toast.error("No hay cuentas bancarias activas. Crea una primero en /admin/bank-accounts");
      return;
    }
    if (!rechargeBankAccountId) {
      toast.error("Selecciona la cuenta bancaria de destino");
      return;
    }
    
    setCreatingRecharge(true);
    try {
      const formData = new FormData();
      formData.append("user_id", rechargeClient.id);
      formData.append("amount", parseFloat(rechargeAmount));
      formData.append("description", rechargeDescription || "Recarga creada por administrador");
      formData.append("proof", rechargeProof);
      if (rechargeBankAccountId) {
        formData.append("bank_account_id", rechargeBankAccountId);
      }
      
      await adminCreateRecharge(formData);
      toast.success("Recarga creada exitosamente");
      setRechargeDialogOpen(false);
      resetRechargeForm();
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al crear la recarga");
    } finally {
      setCreatingRecharge(false);
    }
  };

  const resetRechargeForm = () => {
    setRechargeClient(null);
    setRechargeAmount("");
    setRechargeDescription("");
    setRechargeProof(null);
    setRechargeProofPreview(null);
    setRechargeClientSearch("");
    setRechargeClientSearchOpen(false);
    // Preserve auto-selection when there's exactly one active account so the
    // next recharge still lands in the ledger without extra clicks.
    setRechargeBankAccountId(bankAccounts.length === 1 ? bankAccounts[0].id : "");
    if (rechargeFileInputRef.current) {
      rechargeFileInputRef.current.value = "";
    }
    // Cleanup QR polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    setPolling(false);
  };

  // QR Functions
  const handleGenerateQR = async () => {
    if (!rechargeClient) {
      toast.error("Primero selecciona un cliente");
      return;
    }
    
    try {
      const res = await generateRechargeUploadQR(rechargeClient.id);
      const token = res.data.upload_token;
      setUploadToken(token);
      
      // Generate QR code
      const uploadUrl = `${APP_URL}/upload-recharge/${token}`;
      const qr = await QRCode.toDataURL(uploadUrl, {
        width: 300,
        margin: 2,
        color: { dark: "#2ECC71", light: "#ffffff" }
      });
      setQrCodeUrl(qr);
      setShowQRDialog(true);
      
      // Start polling to check if image was uploaded
      setPolling(true);
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await checkRechargeUploadStatus(token);
          if (statusRes.data.used && statusRes.data.image_url) {
            clearInterval(pollingRef.current);
            setPolling(false);
            setShowQRDialog(false);
            
            // Set the uploaded image as proof
            const fullImageUrl = `${BACKEND_URL}${statusRes.data.image_url}`;
            setRechargeProofPreview(fullImageUrl);
            // We need to fetch the file for the form
            const response = await fetch(fullImageUrl);
            const blob = await response.blob();
            const file = new File([blob], "proof_qr.jpg", { type: blob.type });
            setRechargeProof(file);
            
            toast.success("¡Imagen recibida desde el teléfono!");
          }
        } catch (err) {
          clearInterval(pollingRef.current);
          setPolling(false);
        }
      }, 3000);
      
    } catch (error) {
      toast.error("Error al generar código QR");
    }
  };

  const handleCloseQR = () => {
    setShowQRDialog(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    setPolling(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const getProofUrl = (deposit) => {
    if (!deposit.proof_url) return null;
    if (deposit.proof_url.startsWith("http")) return deposit.proof_url;
    return `${BACKEND_URL}${deposit.proof_url}`;
  };

  // Toggle the subtle "reviewed against the bank account" marker on a recharge.
  const toggleBankReviewed = async (deposit) => {
    const next = !deposit.bank_reviewed;
    setAllDeposits(prev => prev.map(d => d.id === deposit.id ? { ...d, bank_reviewed: next } : d));
    try {
      await setDepositBankReviewed(deposit.id, next);
    } catch (e) {
      setAllDeposits(prev => prev.map(d => d.id === deposit.id ? { ...d, bank_reviewed: !next } : d));
      toast.error("No se pudo actualizar la revisión");
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-green-100 text-green-700 border-green-200">Aprobado</Badge>;
      case "rejected":
        return <Badge className="bg-red-100 text-red-700 border-red-200">Rechazado</Badge>;
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Pendiente</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredHistory = allDeposits.filter(d => {
    const matchesFilter = historyFilter === "all" || d.status === historyFilter;
    const matchesSearch = historySearch === "" || 
      d.user_name?.toLowerCase().includes(historySearch.toLowerCase()) ||
      d.customer_id?.toLowerCase().includes(historySearch.toLowerCase()) ||
      d.reference_number?.toLowerCase().includes(historySearch.toLowerCase());
    const matchesWeek = historyWeekFilter === "all" || getWeekKey(d.created_at) === historyWeekFilter;
    return matchesFilter && matchesSearch && matchesWeek;
  });

  // Week buckets for the week-filter dropdown (always include current week).
  const historyWeeksMap = {};
  allDeposits.forEach(d => {
    const key = getWeekKey(d.created_at);
    if (!key) return;
    if (!historyWeeksMap[key]) historyWeeksMap[key] = { label: getWeekLabel(d.created_at), count: 0, total: 0 };
    historyWeeksMap[key].count += 1;
    if (d.status === 'approved') historyWeeksMap[key].total += d.amount || 0;
  });
  const _currentWeekKey = getCurrentWeekKey();
  if (!historyWeeksMap[_currentWeekKey]) {
    historyWeeksMap[_currentWeekKey] = { label: getWeekLabel(new Date().toISOString()), count: 0, total: 0 };
  }
  const historyWeekList = Object.entries(historyWeeksMap).sort((a, b) => b[0].localeCompare(a[0]));

  // Group filtered history by week (used when "Todas las semanas" is active)
  const groupedHistoryByWeek = (() => {
    const groups = {};
    filteredHistory.forEach(d => {
      const key = getWeekKey(d.created_at) || 'sin-fecha';
      if (!groups[key]) groups[key] = { label: key === 'sin-fecha' ? 'Sin fecha' : getWeekLabel(d.created_at), items: [], totalApproved: 0 };
      groups[key].items.push(d);
      if (d.status === 'approved') groups[key].totalApproved += d.amount || 0;
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const filteredClients = clients
    .filter(c => 
      clientSearch === "" || 
      c.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
      c.customer_id?.toLowerCase().includes(clientSearch.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg">
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800">Gestión de Recargas</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Dashboard week filter + Stats Cards */}
        {(() => {
          // Build week list from ALL deposits (any status)
          const weeks = {};
          allDeposits.forEach(d => {
            const k = getWeekKey(d.created_at);
            if (!k) return;
            if (!weeks[k]) weeks[k] = { key: k, label: getWeekLabel(d.created_at) };
          });
          const weekList = Object.values(weeks).sort((a, b) => b.key.localeCompare(a.key));

          // Filter helper by dashboardWeekFilter (or "all")
          const inSelectedWeek = (d) => {
            if (dashboardWeekFilter === "all") return true;
            return getWeekKey(d.created_at) === dashboardWeekFilter;
          };

          const pendingFiltered = allDeposits.filter(d => d.status === "pending" && inSelectedWeek(d));
          const approvedFiltered = allDeposits.filter(d => d.status === "approved" && inSelectedWeek(d));
          const rejectedFiltered = allDeposits.filter(d => d.status === "rejected" && inSelectedWeek(d));
          const manualFiltered = allDeposits.filter(d => d.created_by_admin === true && d.status !== "rejected" && inSelectedWeek(d));
          const sumAmt = (arr) => arr.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);

          return (
            <>
              <div className="flex items-center gap-2 mb-4" data-testid="dashboard-week-filter-wrap">
                <span className="text-xs text-gray-500 font-medium">Filtrar por semana:</span>
                <Select value={dashboardWeekFilter} onValueChange={setDashboardWeekFilter}>
                  <SelectTrigger className="rounded-lg h-9 w-64 bg-white" data-testid="dashboard-week-filter">
                    <SelectValue placeholder="Semana" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las semanas</SelectItem>
                    {weekList.map(w => (
                      <SelectItem key={w.key} value={w.key}>{w.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Card className="rounded-xl" data-testid="stat-pending-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center shrink-0">
                      <Clock className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-extrabold text-slate-800 leading-tight" data-testid="stat-pending-count">{pendingFiltered.length}</p>
                      <p className="text-xs text-gray-500">Pendientes</p>
                      <p className="text-sm font-semibold text-yellow-700 mt-0.5" data-testid="stat-pending-sum">${sumAmt(pendingFiltered).toFixed(2)}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-xl" data-testid="stat-approved-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-extrabold text-slate-800 leading-tight" data-testid="stat-approved-count">{approvedFiltered.length}</p>
                      <p className="text-xs text-gray-500">Aprobados</p>
                      <p className="text-sm font-semibold text-green-700 mt-0.5" data-testid="stat-approved-sum">${sumAmt(approvedFiltered).toFixed(2)}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-xl" data-testid="stat-rejected-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                      <XCircle className="h-5 w-5 text-red-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-extrabold text-slate-800 leading-tight" data-testid="stat-rejected-count">{rejectedFiltered.length}</p>
                      <p className="text-xs text-gray-500">Rechazados</p>
                      <p className="text-sm font-semibold text-red-700 mt-0.5" data-testid="stat-rejected-sum">${sumAmt(rejectedFiltered).toFixed(2)}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-xl" data-testid="stat-manual-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                      <Plus className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-extrabold text-slate-800 leading-tight" data-testid="stat-manual-count">{manualFiltered.length}</p>
                      <p className="text-xs text-gray-500">Manuales (Admin)</p>
                      <p className="text-sm font-semibold text-blue-700 mt-0.5" data-testid="stat-manual-sum">${sumAmt(manualFiltered).toFixed(2)}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          );
        })()}

        {/* Navigation Tabs */}
        <Tabs value={showDeleted ? "deleted" : showReport ? "report" : (showDuplicates ? "duplicates" : (showHistory ? "history" : "pending"))} className="mb-6">
          <TabsList className="grid w-full grid-cols-5 h-12 rounded-xl bg-gray-100">
            <TabsTrigger 
              value="pending"
              onClick={() => { setShowHistory(false); setShowReport(false); setShowDeleted(false); setShowDuplicates(false); }}
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-medium"
              data-testid="show-pending-btn"
            >
              <Clock className="h-4 w-4 mr-1" />
              Pendientes ({pendingDeposits.length})
            </TabsTrigger>
            <TabsTrigger 
              value="history"
              onClick={() => { setShowHistory(true); setShowReport(false); setShowDeleted(false); setShowDuplicates(false); }}
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-medium"
              data-testid="show-history-btn"
            >
              <History className="h-4 w-4 mr-1" />
              Historial
            </TabsTrigger>
            <TabsTrigger 
              value="duplicates"
              onClick={() => { setShowDuplicates(true); setShowHistory(false); setShowReport(false); setShowDeleted(false); if (!duplicates) loadDuplicates(); }}
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-medium"
              data-testid="show-duplicates-btn"
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              Duplicados{duplicates ? ` (${(duplicates.by_reference?.length||0) + (duplicates.by_client_amount_day?.length||0) + (duplicates.by_same_proof?.length||0)})` : ""}
            </TabsTrigger>
            <TabsTrigger 
              value="deleted"
              onClick={() => { setShowDeleted(true); setShowHistory(false); setShowReport(false); setShowDuplicates(false); }}
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-medium"
              data-testid="show-deleted-btn"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Eliminados ({deletedDeposits.length})
            </TabsTrigger>
            <TabsTrigger 
              value="report"
              onClick={() => { setShowReport(true); setShowHistory(false); setShowDeleted(false); setShowDuplicates(false); }}
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-medium"
              data-testid="show-report-btn"
            >
              <FileBarChart className="h-4 w-4 mr-1" />
              Reporte
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-6">
          <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="rounded-xl border-red-200 text-red-600 hover:bg-red-50" data-testid="adjust-balance-btn">
                <Minus className="h-4 w-4 mr-2" />
                Ajuste
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-red-600" />
                  Ajuste de Balance
                </DialogTitle>
                <DialogDescription>
                  Restar dinero del wallet de un cliente con un motivo personalizado.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input 
                      placeholder="Buscar cliente..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="pl-9 rounded-xl mb-2"
                      data-testid="client-search-input"
                    />
                  </div>
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger className="rounded-xl" data-testid="select-client-trigger">
                      <SelectValue placeholder="Seleccionar cliente" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {filteredClients.map(client => (
                        <SelectItem key={client.id} value={client.id} data-testid={`client-option-${client.customer_id}`}>
                          <span className="font-medium">{client.name}</span>
                          <span className="text-gray-500 ml-2">#{client.customer_id}</span>
                          <span className="text-green-600 ml-2">${client.wallet_balance?.toFixed(2)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Monto a restar ($)</Label>
                  <Input 
                    type="number" 
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    className="rounded-xl"
                    data-testid="adjust-amount-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Motivo del ajuste</Label>
                  <Textarea 
                    placeholder="Escribe el motivo del ajuste..."
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="rounded-xl min-h-[80px]"
                    data-testid="adjust-reason-input"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2">
                <DialogClose asChild>
                  <Button variant="outline" className="rounded-xl">Cancelar</Button>
                </DialogClose>
                <Button 
                  onClick={handleBalanceAdjustment}
                  disabled={adjusting || !selectedClient || !adjustAmount || !adjustReason}
                  className="rounded-xl bg-red-600 hover:bg-red-700"
                  data-testid="confirm-adjustment-btn"
                >
                  {adjusting ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                      Procesando...
                    </span>
                  ) : (
                    <>
                      <Minus className="h-4 w-4 mr-2" />
                      Confirmar Ajuste
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Crear Recarga Dialog */}
          <Dialog open={rechargeDialogOpen} onOpenChange={(open) => {
            setRechargeDialogOpen(open);
            if (!open) resetRechargeForm();
          }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-green-600 hover:bg-green-700" data-testid="create-recharge-btn">
                <Plus className="h-4 w-4 mr-2" />
                Crear Recarga
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  Crear Recarga Manual
                </DialogTitle>
                <DialogDescription>
                  Crea una recarga directa para un cliente. El comprobante es obligatorio.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* Cliente selector - Single Search Field */}
                <div className="space-y-2">
                  <Label>Cliente <span className="text-red-500">*</span></Label>
                  <Popover open={rechargeClientSearchOpen} onOpenChange={setRechargeClientSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full h-12 justify-between rounded-xl"
                        data-testid="recharge-select-client-trigger"
                      >
                        {rechargeClient ? (
                          <span className="flex items-center gap-2">
                            <span className="font-bold text-green-600">#{rechargeClient.customer_id}</span>
                            <span>{rechargeClient.name}</span>
                            <span className="text-gray-500 text-xs">
                              Compras: ${Math.abs(rechargeClient.wallet_balance || 0).toFixed(2)} + Envio: ${(rechargeClient.total_shipping || 0).toFixed(2)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-500">Buscar cliente...</span>
                        )}
                        <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[380px] p-0 rounded-xl" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput 
                          placeholder="Buscar por nombre o código..." 
                          value={rechargeClientSearch}
                          onValueChange={setRechargeClientSearch}
                          className="h-11"
                          data-testid="recharge-client-search-input"
                        />
                        <CommandList>
                          <CommandEmpty>No se encontró cliente</CommandEmpty>
                          <CommandGroup>
                            {clients
                              .filter(c => c.is_active !== false)
                              .filter(c => 
                                rechargeClientSearch.length === 0 ||
                                c.name.toLowerCase().includes(rechargeClientSearch.toLowerCase()) ||
                                c.customer_id.toLowerCase().includes(rechargeClientSearch.toLowerCase())
                              )
                              .slice(0, 10)
                              .map((client) => (
                                <CommandItem
                                  key={client.id}
                                  value={client.customer_id}
                                  onSelect={() => {
                                    setRechargeClient(client);
                                    setRechargeClientSearchOpen(false);
                                  }}
                                  className="cursor-pointer py-3"
                                >
                                  <div className="flex items-center gap-3 w-full">
                                    <span className="font-bold text-green-600">#{client.customer_id}</span>
                                    <span className="flex-1 text-gray-900">{client.name}</span>
                                    <span className="text-xs text-right text-gray-500">
                                      <span className="text-red-600">${Math.abs(client.wallet_balance || 0).toFixed(2)}</span>
                                      {(client.total_shipping || 0) > 0 && (
                                        <span> + <span className="text-purple-600">${(client.total_shipping).toFixed(2)}</span></span>
                                      )}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))
                            }
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Monto */}
                <div className="space-y-2">
                  <Label>Monto a recargar ($) <span className="text-red-500">*</span></Label>
                  <Input 
                    type="number" 
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value)}
                    className="rounded-xl h-12 text-lg font-bold"
                    data-testid="recharge-amount-input"
                  />
                </div>

                {/* Cuenta bancaria de destino — obligatoria. Si solo hay una
                    cuenta activa, queda preseleccionada; si hay varias el admin
                    debe elegir explícitamente para que la recarga aterrice en
                    el ledger correcto. */}
                {bankAccounts.length > 1 && (
                  <div className="space-y-2">
                    <Label>Cuenta bancaria de destino <span className="text-red-500">*</span></Label>
                    <Select value={rechargeBankAccountId || ""} onValueChange={(v) => setRechargeBankAccountId(v)}>
                      <SelectTrigger className="rounded-xl h-12" data-testid="recharge-bank-account-select">
                        <SelectValue placeholder="Selecciona una cuenta..." />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>
                            {acc.bank_name} · {acc.owner_name} · ••{String(acc.account_number || "").slice(-4)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      Aparecerá como recarga en esta cuenta del ledger bancario.
                    </p>
                  </div>
                )}
                {bankAccounts.length === 1 && (
                  <p className="text-xs text-gray-500 -mt-2" data-testid="recharge-bank-account-info">
                    Se registrará en: <span className="font-semibold">{bankAccounts[0].bank_name} · ••{String(bankAccounts[0].account_number || "").slice(-4)}</span>
                  </p>
                )}
                {bankAccounts.length === 0 && (
                  <p className="text-xs text-red-600 -mt-2 font-medium" data-testid="recharge-no-bank-accounts-warning">
                    ⚠ No hay cuentas bancarias activas. Crea una en <span className="underline">/admin/bank-accounts</span> antes de registrar recargas.
                  </p>
                )}

                {/* Descripción */}
                <div className="space-y-2">
                  <Label>Descripción (opcional)</Label>
                  <Textarea 
                    placeholder="Ej: Transferencia bancaria, Zelle, etc."
                    value={rechargeDescription}
                    onChange={(e) => setRechargeDescription(e.target.value)}
                    className="rounded-xl min-h-[60px]"
                    data-testid="recharge-description-input"
                  />
                </div>

                {/* Comprobante con QR */}
                <div className="space-y-2">
                  <Label>Comprobante de Pago <span className="text-red-500">*</span></Label>
                  
                  {/* Upload Options */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Upload from PC */}
                    <div 
                      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                        rechargeProofPreview ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-green-400 hover:bg-green-50/50'
                      }`}
                      onClick={() => rechargeFileInputRef.current?.click()}
                    >
                      <input
                        ref={rechargeFileInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleRechargeProofChange}
                        className="hidden"
                        data-testid="recharge-proof-input"
                      />
                      <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm font-medium text-gray-600">Desde PC</p>
                      <p className="text-xs text-gray-400">Clic para subir</p>
                    </div>
                    
                    {/* Upload via QR */}
                    <div 
                      className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors border-gray-300 hover:border-green-400 hover:bg-green-50/50"
                      onClick={handleGenerateQR}
                    >
                      <QrCode className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm font-medium text-gray-600">Desde Celular</p>
                      <p className="text-xs text-gray-400">Escanear QR</p>
                    </div>
                  </div>
                  
                  {/* Preview */}
                  {rechargeProofPreview && (
                    <div className="mt-3 relative">
                      <img 
                        src={rechargeProofPreview} 
                        alt="Vista previa" 
                        className="w-full max-h-40 object-contain rounded-xl border border-green-200"
                      />
                      <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded-lg text-xs flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Comprobante listo
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2">
                <DialogClose asChild>
                  <Button variant="outline" className="rounded-xl">Cancelar</Button>
                </DialogClose>
                <Button 
                  onClick={handleCreateRecharge}
                  disabled={creatingRecharge || !rechargeClient || !rechargeAmount || !rechargeProof}
                  className="rounded-xl bg-green-600 hover:bg-green-700"
                  data-testid="submit-recharge-btn"
                >
                  {creatingRecharge ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                      Creando...
                    </span>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Crear Recarga
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* QR Dialog */}
          <Dialog open={showQRDialog} onOpenChange={(open) => !open && handleCloseQR()}>
            <DialogContent className="rounded-2xl max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-green-700">
                  <Smartphone className="h-5 w-5" />
                  Escanea con tu celular
                </DialogTitle>
              </DialogHeader>
              <div className="text-center py-4">
                <div className="bg-white p-4 rounded-xl inline-block shadow-lg border">
                  {qrCodeUrl && <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64" />}
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 text-green-600">
                  {polling && (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm font-medium">Esperando imagen...</span>
                    </>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-3">
                  Escanea el código QR con tu celular para subir el comprobante de pago
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseQR} className="w-full rounded-xl">
                  Cancelar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* History Filters */}
        {showHistory && (
          <div className="space-y-3 mb-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input 
                  placeholder="Buscar por nombre, ID o comprobante..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="pl-9 rounded-xl"
                  data-testid="history-search-input"
                />
              </div>
              <Select value={historyWeekFilter} onValueChange={setHistoryWeekFilter}>
                <SelectTrigger className="w-52 rounded-xl" data-testid="history-week-filter-trigger">
                  <SelectValue placeholder="Filtrar por semana" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="history-week-option-all">Todas las semanas</SelectItem>
                  {historyWeekList.map(([key, w]) => (
                    <SelectItem key={key} value={key} className="text-xs" data-testid={`history-week-option-${key}`}>
                      {w.label} ({w.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={historyFilter} onValueChange={setHistoryFilter}>
                <SelectTrigger className="w-40 rounded-xl" data-testid="history-filter-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="approved">Aprobados</SelectItem>
                  <SelectItem value="pending">Pendientes</SelectItem>
                  <SelectItem value="rejected">Rechazados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none" data-testid="history-include-deleted-toggle">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="rounded border-slate-300"
              />
              Incluir recargas eliminadas en el listado (las verás marcadas)
            </label>
          </div>
        )}

        {!showDeleted && !showReport && !showDuplicates && (
        <ScrollArea className="h-[calc(100vh-400px)]">
          {!showHistory ? (
            // Pending Deposits View
            pendingDeposits.length === 0 ? (
              <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                <CardContent className="p-8 text-center">
                  <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No hay solicitudes pendientes</p>
                  <p className="text-gray-400 text-sm mt-1">Todas las recargas han sido procesadas</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {pendingDeposits.map((deposit) => {
                  const proofUrl = getProofUrl(deposit);
                  const amountKnown = deposit.amount && deposit.amount > 0;
                  const pendingAmountValue = depositAmountEdits[deposit.id] ?? "";
                  return (
                    <Card key={deposit.id} className="rounded-xl border-yellow-200 bg-yellow-50/50" data-testid="pending-deposit-item">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="font-bold">#{deposit.customer_id}</Badge>
                              <span className="font-bold text-slate-800">{deposit.user_name}</span>
                            </div>
                            {deposit.reference_number && (
                              <p className="text-sm font-semibold text-slate-700 mt-1">
                                Comprobante: <span className="font-mono bg-white px-2 py-0.5 rounded" data-testid={`pending-ref-${deposit.id}`}>{deposit.reference_number}</span>
                              </p>
                            )}
                            <p className="text-xs text-gray-500 mt-1">{deposit.description}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {new Date(deposit.created_at).toLocaleDateString('es-ES', {
                                day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                          </div>
                          <div className="text-right">
                            {amountKnown ? (
                              <div className="bg-white px-4 py-2 rounded-xl shadow-sm">
                                <p className="text-xs text-gray-500">Monto</p>
                                <p className="text-2xl font-extrabold text-green-600">${deposit.amount.toFixed(2)}</p>
                              </div>
                            ) : (
                              <div className="bg-white px-3 py-2 rounded-xl shadow-sm border-2 border-amber-300">
                                <p className="text-xs text-amber-700 font-semibold mb-1">Monto (USD) *</p>
                                <div className="flex items-center gap-1">
                                  <span className="text-lg font-bold text-gray-400">$</span>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    value={pendingAmountValue}
                                    onChange={(e) => setDepositAmountEdits({ ...depositAmountEdits, [deposit.id]: e.target.value })}
                                    onWheel={(e) => e.target.blur()}
                                    className="h-9 w-28 text-lg font-bold text-right rounded border-gray-200"
                                    data-testid={`set-amount-input-${deposit.id}`}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {proofUrl ? (
                          <div className="mb-3">
                            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                              <Image className="h-3 w-3" /> Comprobante de pago
                            </p>
                            <Dialog>
                              <DialogTrigger asChild>
                                <div className="relative cursor-pointer group rounded-xl overflow-hidden border border-gray-200 bg-white">
                                  <img src={proofUrl} alt="Comprobante" className="w-full max-h-48 object-contain" />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <div className="opacity-0 group-hover:opacity-100 bg-white rounded-full p-2 shadow-lg transition-opacity">
                                      <ZoomIn className="h-5 w-5 text-gray-700" />
                                    </div>
                                  </div>
                                </div>
                              </DialogTrigger>
                              <DialogContent className="rounded-2xl max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Comprobante - #{deposit.customer_id}{deposit.amount > 0 ? ` - $${deposit.amount.toFixed(2)}` : ""}</DialogTitle>
                                </DialogHeader>
                                <div className="mt-2">
                                  <img src={proofUrl} alt="Comprobante" className="w-full rounded-xl" />
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        ) : (
                          <div className="mb-3 p-3 bg-gray-100 rounded-xl text-center">
                            <p className="text-sm text-gray-400 flex items-center justify-center gap-2">
                              <Image className="h-4 w-4" /> Sin comprobante adjunto
                            </p>
                          </div>
                        )}

                        {/* AI Scan button + results */}
                        {proofUrl && (
                          <div className="mb-3">
                            <Button
                              onClick={() => handleScanProof(deposit.id)}
                              disabled={scanningDeposit === deposit.id}
                              variant="outline"
                              size="sm"
                              className="w-full h-10 border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-xl"
                              data-testid={`scan-proof-${deposit.id}`}
                            >
                              {scanningDeposit === deposit.id ? (
                                <span className="flex items-center gap-2">
                                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent"></span>
                                  Leyendo comprobante...
                                </span>
                              ) : (
                                <>✨ Leer comprobante con IA</>
                              )}
                            </Button>
                            {scanResults[deposit.id] && (
                              <div className="mt-2 p-3 rounded-xl border bg-white" data-testid={`scan-result-${deposit.id}`}>
                                <div className="text-xs space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-500">Número detectado:</span>
                                    <span className="font-mono font-bold">{scanResults[deposit.id].detected_reference_number || "—"}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-500">Monto detectado:</span>
                                    <span className="font-bold text-green-700">
                                      {scanResults[deposit.id].detected_amount != null ? `$${Number(scanResults[deposit.id].detected_amount).toFixed(2)}` : "—"}
                                    </span>
                                  </div>
                                  {scanResults[deposit.id].confidence && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-500">Confianza:</span>
                                      <span className="font-medium capitalize">{scanResults[deposit.id].confidence}</span>
                                    </div>
                                  )}
                                  {scanResults[deposit.id].matches_reference === true && (
                                    <div className="mt-2 p-2 rounded bg-green-50 border border-green-200 text-green-800 font-semibold flex items-center gap-1">
                                      <CheckCircle className="h-4 w-4" /> El número coincide con el del cliente
                                    </div>
                                  )}
                                  {scanResults[deposit.id].matches_reference === false && (
                                    <div className="mt-2 p-2 rounded bg-red-50 border border-red-200 text-red-800 font-semibold">
                                      ⚠ El número NO coincide con el del cliente ({scanResults[deposit.id].client_reference_number || "—"})
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleApprove(deposit.id)}
                            disabled={approving === deposit.id || rejecting === deposit.id}
                            className="flex-1 h-12 font-bold rounded-xl"
                            data-testid={`approve-deposit-${deposit.id}`}
                            style={{ background: '#2ECC71', color: 'white' }}
                          >
                            {approving === deposit.id ? (
                              <span className="flex items-center gap-2">
                                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                                Aprobando...
                              </span>
                            ) : (
                              <>
                                <CheckCircle className="h-5 w-5 mr-2" />
                                Aprobar
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => handleReject(deposit.id)}
                            disabled={approving === deposit.id || rejecting === deposit.id}
                            variant="outline"
                            className="flex-1 h-12 font-bold rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                            data-testid={`reject-deposit-${deposit.id}`}
                          >
                            {rejecting === deposit.id ? (
                              <span className="flex items-center gap-2">
                                <span className="animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent"></span>
                                Rechazando...
                              </span>
                            ) : (
                              <>
                                <XCircle className="h-5 w-5 mr-2" />
                                Rechazar
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )
          ) : (
            // History View — grouped by week
            filteredHistory.length === 0 ? (
              <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                <CardContent className="p-8 text-center">
                  <History className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No hay registros</p>
                  <p className="text-gray-400 text-sm mt-1">No se encontraron recargas con los filtros aplicados</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-5">
                {groupedHistoryByWeek.map(([weekKey, group]) => (
                  <div key={weekKey} className="space-y-3" data-testid={`history-week-group-${weekKey}`}>
                    <div className="flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm py-1 z-10 border-b border-slate-200">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Semana: {group.label}
                      </p>
                      <span className="text-xs font-semibold text-slate-600">
                        {group.items.length} {group.items.length === 1 ? 'recarga' : 'recargas'}
                        {group.totalApproved > 0 && (
                          <span className="ml-2 text-green-700">· Aprobadas: ${group.totalApproved.toFixed(2)}</span>
                        )}
                      </span>
                    </div>
                    {group.items.map((deposit, idx) => {
                      const proofUrl = getProofUrl(deposit);
                      return (
                        <Card key={deposit.id} className={`rounded-xl ${deposit.is_deleted ? 'opacity-70 border-dashed border-2 border-red-200' : ''}`} data-testid="history-deposit-item">
                          <CardContent className="p-4">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-[11px] font-bold text-gray-400 tabular-nums w-6 shrink-0" data-testid={`deposit-number-${deposit.id}`}>#{idx + 1}</span>
                                  <Badge variant="outline" className="font-bold text-xs">#{deposit.customer_id}</Badge>
                                  <span className="font-semibold text-slate-800">{deposit.user_name}</span>
                                  {getStatusBadge(deposit.status)}
                                  {deposit.status === 'approved' && (
                                    <button
                                      type="button"
                                      onClick={() => toggleBankReviewed(deposit)}
                                      title={deposit.bank_reviewed ? `Revisada en banco${deposit.bank_reviewed_by ? ' por ' + deposit.bank_reviewed_by : ''}` : 'Marcar como revisada en banco'}
                                      className={`inline-flex items-center justify-center h-4 w-4 rounded-full border transition-colors ${deposit.bank_reviewed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-transparent hover:border-green-400 hover:text-green-400'}`}
                                      data-testid={`bank-reviewed-toggle-${deposit.id}`}
                                    >
                                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                                    </button>
                                  )}
                                  {deposit.is_deleted && (
                                    <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] uppercase font-bold" data-testid="deposit-deleted-badge">Eliminada</Badge>
                                  )}
                                </div>
                                <p className="text-sm text-gray-500">{deposit.description}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                  {new Date(deposit.created_at).toLocaleDateString('es-ES', {
                                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                  })}
                                </p>
                              </div>
                              <div className="text-right flex items-center gap-2">
                                {proofUrl && (
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button variant="ghost" size="sm" className="text-gray-400 hover:text-gray-600">
                                        <Image className="h-4 w-4" />
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="rounded-2xl max-w-2xl">
                                      <DialogHeader>
                                        <DialogTitle>Comprobante - #{deposit.customer_id}</DialogTitle>
                                      </DialogHeader>
                                      <img src={proofUrl} alt="Comprobante" className="w-full rounded-xl" />
                                    </DialogContent>
                                  </Dialog>
                                )}
                                <div className="bg-gray-50 px-3 py-1 rounded-lg">
                                  <p className={`text-xl font-bold ${deposit.status === 'approved' ? 'text-green-600' : deposit.status === 'rejected' ? 'text-red-600' : 'text-yellow-600'}`}>
                                    ${deposit.amount.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end mt-2 pt-2 border-t border-gray-100">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 rounded-lg"
                                onClick={() => openDeleteDialog(deposit.id)}
                                data-testid={`delete-deposit-${deposit.id}`}
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Eliminar
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ))}
              </div>
            )
          )}
        </ScrollArea>
        )}

        {/* Duplicates Tab */}
        {showDuplicates && (
          <ScrollArea className="h-[calc(100vh-400px)]" data-testid="duplicates-tab">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-600">
                Detección de posibles duplicados entre recargas <b>pendientes y aprobadas</b>.
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadDuplicates}
                disabled={duplicatesLoading}
                className="rounded-lg"
                data-testid="rescan-duplicates-btn"
              >
                {duplicatesLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Escaneando...</> : <><RefreshCw className="h-4 w-4 mr-2" />Re-escanear</>}
              </Button>
            </div>

            {duplicatesLoading && !duplicates ? (
              <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                <CardContent className="p-8 text-center">
                  <Loader2 className="h-8 w-8 text-slate-400 mx-auto mb-3 animate-spin" />
                  <p className="text-gray-500 font-medium">Escaneando duplicados...</p>
                </CardContent>
              </Card>
            ) : duplicates ? (
              (() => {
                // Filter group's transactions by client + reference + amount
                const filterGroup = (g) => {
                  const clientQ = dupClientSearch.trim().toLowerCase();
                  const refQ = dupRefSearch.trim().toLowerCase();
                  const amountQ = parseFloat(dupAmountSearch);
                  const hasAmountFilter = !Number.isNaN(amountQ);
                  if (!clientQ && !refQ && !hasAmountFilter) return g;
                  const txs = (g.transactions || []).filter(t => {
                    const cMatch = !clientQ ||
                      (t.customer_id || "").toLowerCase().includes(clientQ) ||
                      (t.customer_name || "").toLowerCase().includes(clientQ);
                    const rMatch = !refQ ||
                      (t.reference_number || "").toLowerCase().includes(refQ);
                    const aMatch = !hasAmountFilter ||
                      Math.abs((Number(t.amount) || 0) - amountQ) < 0.01;
                    return cMatch && rMatch && aMatch;
                  });
                  if (!txs.length) return null;
                  return { ...g, transactions: txs, count: txs.length };
                };
                const filterSection = (arr) => (arr || []).map(filterGroup).filter(Boolean);

                const sections = [
                  { key: "by_reference", title: "Por Número de Comprobante", icon: "📋", sub: "Mismo número de referencia bancaria. Suele ser un error real.", data: filterSection(duplicates.by_reference) },
                  { key: "by_client_amount_day", title: "Mismo Cliente + Monto + Día", icon: "🎯", sub: "Sospechoso: el cliente subió el mismo depósito 2 veces el mismo día.", data: filterSection(duplicates.by_client_amount_day) },
                  { key: "by_same_proof", title: "Misma Imagen de Comprobante", icon: "🖼️", sub: "La misma foto se usó en más de una recarga. Casi siempre es error real.", data: filterSection(duplicates.by_same_proof) },
                ];
                const acceptedList = filterSection(duplicates.accepted);

                const renderGroup = (kind, g, idx, opts = {}) => (
                  <div key={idx} className={`border rounded-lg p-3 ${opts.accepted ? "border-green-200 bg-green-50/40" : "border-slate-200 bg-slate-50"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-slate-500">
                        {typeof g.key === "string" ? g.key : (g.key?.customer_id ? `${g.key.customer_id} · $${g.key.amount} · ${g.key.day}` : JSON.stringify(g.key))}
                      </span>
                      <span className={`ml-auto text-xs font-bold ${opts.accepted ? "text-green-700" : "text-red-600"}`}>
                        {g.count} recargas · ${(g.total_amount || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="space-y-1.5 mb-2">
                      {(g.transactions || []).map(t => (
                        <div key={t.id} className="flex items-center gap-2 text-xs bg-white p-2 rounded border border-slate-100">
                          <span className={`px-1.5 py-0.5 rounded font-semibold ${t.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                            {t.status}
                          </span>
                          <span className="font-mono text-slate-500">{(t.created_at || "").substring(0, 10)}</span>
                          <span className="font-bold text-slate-800">${(t.amount || 0).toFixed(2)}</span>
                          <span className="text-slate-600">{t.customer_name || t.customer_id}</span>
                          {t.reference_number && <span className="text-slate-400 font-mono">Ref: {t.reference_number}</span>}
                          {t.proof_url && (
                            <a href={t.proof_url.startsWith("/") ? `${APP_URL}${t.proof_url}` : t.proof_url} target="_blank" rel="noreferrer" className="ml-auto text-blue-600 hover:underline">Ver</a>
                          )}
                        </div>
                      ))}
                    </div>
                    {opts.accepted ? (
                      <div className="flex items-center justify-between text-[11px] text-green-700">
                        <span>
                          Aceptado{g.accepted_by_name ? ` por ${g.accepted_by_name}` : ""}{g.accepted_at ? ` · ${g.accepted_at.substring(0, 10)}` : ""}
                        </span>
                        <button
                          onClick={() => unacceptDuplicateGroup(g)}
                          className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition"
                          data-testid={`dup-unaccept-${g.signature}`}
                        >
                          Reactivar
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none" data-testid={`dup-accept-label-${g.signature}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded accent-green-600 cursor-pointer"
                          checked={false}
                          onChange={() => acceptDuplicateGroup(kind, g)}
                          data-testid={`dup-accept-checkbox-${g.signature}`}
                        />
                        <span>Aceptado (no es duplicado real) — mover a la sección Aceptados</span>
                      </label>
                    )}
                  </div>
                );

                return (
                  <>
                    {/* Filter by client + ref + amount + toggle Aceptados */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          value={dupClientSearch}
                          onChange={(e) => setDupClientSearch(e.target.value)}
                          placeholder="Cliente (ID o nombre)..."
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-slate-400"
                          data-testid="dup-client-search"
                        />
                      </div>
                      <div className="relative flex-1 min-w-[180px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          value={dupRefSearch}
                          onChange={(e) => setDupRefSearch(e.target.value)}
                          placeholder="Nº comprobante..."
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-slate-400"
                          data-testid="dup-ref-search"
                        />
                      </div>
                      <div className="relative w-[140px]">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={dupAmountSearch}
                          onChange={(e) => setDupAmountSearch(e.target.value)}
                          placeholder="Monto..."
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-slate-400"
                          data-testid="dup-amount-search"
                        />
                      </div>
                      {(dupClientSearch || dupRefSearch || dupAmountSearch) && (
                        <button
                          type="button"
                          onClick={() => { setDupClientSearch(""); setDupRefSearch(""); setDupAmountSearch(""); }}
                          className="px-3 py-2 rounded-lg text-xs text-slate-600 hover:bg-slate-100 border border-slate-200"
                          data-testid="dup-clear-filters"
                        >
                          Limpiar
                        </button>
                      )}
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-3 py-2 rounded-lg border border-slate-200 bg-white" data-testid="dup-show-accepted-toggle">
                        <input
                          type="checkbox"
                          checked={dupShowAccepted}
                          onChange={(e) => setDupShowAccepted(e.target.checked)}
                          className="h-4 w-4 rounded accent-green-600 cursor-pointer"
                        />
                        <span>Ver aceptados ({acceptedList.length})</span>
                      </label>
                    </div>

                    {dupShowAccepted ? (
                      <Card className="rounded-2xl">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                            <h3 className="font-bold text-slate-800">Grupos Aceptados</h3>
                            <span className="ml-auto text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">
                              {acceptedList.length}
                            </span>
                          </div>
                          {acceptedList.length === 0 ? (
                            <p className="text-sm text-slate-400 italic">Aún no has marcado ningún grupo como aceptado.</p>
                          ) : (
                            <div className="space-y-3">
                              {acceptedList.map((g, idx) => renderGroup(g.type, g, idx, { accepted: true }))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-4">
                        {sections.map(section => (
                          <Card key={section.key} className="rounded-2xl" data-testid={`dup-section-${section.key}`}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xl">{section.icon}</span>
                                <h3 className="font-bold text-slate-800">{section.title}</h3>
                                <span className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${section.data.length > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                                  {section.data.length} grupo{section.data.length === 1 ? "" : "s"}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mb-3">{section.sub}</p>
                              {section.data.length === 0 ? (
                                <p className="text-sm text-slate-400 italic">{(dupClientSearch || dupRefSearch || dupAmountSearch) ? "Sin coincidencias con el filtro." : "Sin duplicados en esta categoría."}</p>
                              ) : (
                                <div className="space-y-3">
                                  {section.data.map((g, idx) => renderGroup(section.key, g, idx))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                <CardContent className="p-8 text-center">
                  <AlertTriangle className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">Click en Re-escanear para detectar duplicados</p>
                </CardContent>
              </Card>
            )}
          </ScrollArea>
        )}


        {/* Deleted Deposits Tab */}
        {showDeleted && (
          <ScrollArea className="h-[calc(100vh-400px)]">
            {deletedDeposits.length === 0 ? (
              <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                <CardContent className="p-8 text-center">
                  <Trash2 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No hay recargas eliminadas</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {deletedDeposits.map((deposit) => {
                  const proofUrl = getProofUrl(deposit);
                  return (
                    <Card key={deposit.id} className="rounded-xl bg-red-50/30 border-red-100" data-testid="deleted-deposit-item">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="font-bold text-xs">#{deposit.customer_id}</Badge>
                              <span className="font-semibold text-slate-800">{deposit.user_name}</span>
                              <Badge className="bg-red-100 text-red-700 text-xs">Eliminada</Badge>
                            </div>
                            <p className="text-sm text-gray-500">{deposit.description}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              Creada: {new Date(deposit.created_at).toLocaleDateString('es-ES', {
                                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                            {deposit.deleted_at && (
                              <p className="text-xs text-red-400 mt-0.5">
                                Eliminada: {new Date(deposit.deleted_at).toLocaleDateString('es-ES', {
                                  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex items-center gap-3">
                            {proofUrl && (
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="text-gray-400 hover:text-gray-600">
                                    <Image className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="rounded-2xl max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Comprobante - #{deposit.customer_id}</DialogTitle>
                                  </DialogHeader>
                                  <img src={proofUrl} alt="Comprobante" className="w-full rounded-xl" />
                                </DialogContent>
                              </Dialog>
                            )}
                            <div className="bg-red-50 px-3 py-1 rounded-lg">
                              <p className="text-xl font-bold text-red-600 line-through">${deposit.amount.toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeletePassword(""); }}>
          <DialogContent className="rounded-2xl max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                Eliminar Recarga
              </DialogTitle>
              <DialogDescription>
                Esta accion revertira el monto del wallet del cliente. Ingresa tu contrasena de administrador para confirmar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Contrasena del Administrador</Label>
                <Input
                  type="password"
                  placeholder="Tu contrasena..."
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="mt-1 h-11 rounded-xl"
                  data-testid="delete-password-input"
                  onKeyDown={(e) => e.key === 'Enter' && handleDeleteDeposit()}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  className="flex-1 h-11 rounded-xl"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleDeleteDeposit}
                  disabled={deleting || !deletePassword}
                  className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                  data-testid="confirm-delete-btn"
                >
                  {deleting ? "Eliminando..." : "Confirmar Eliminacion"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Recharge Report Section */}
        {showReport && (
          <div className="mt-4 space-y-4">
            {/* Sub-tabs for report types */}
            <div className="flex gap-2 border-b pb-3">
              <Button
                variant={reportTab === "balance" ? "default" : "outline"}
                size="sm"
                onClick={() => setReportTab("balance")}
                className={`rounded-xl ${reportTab === "balance" ? "bg-green-600 hover:bg-green-700" : ""}`}
                data-testid="report-tab-balance"
              >
                <DollarSign className="h-4 w-4 mr-1" />
                Abonos y Consumos
              </Button>
              <Button
                variant={reportTab === "recharges" ? "default" : "outline"}
                size="sm"
                onClick={() => setReportTab("recharges")}
                className={`rounded-xl ${reportTab === "recharges" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                data-testid="report-tab-recharges"
              >
                <FileBarChart className="h-4 w-4 mr-1" />
                Detalle Recargas
              </Button>
            </div>
            
            {reportTab === "balance" ? (
              <ClientBalanceReport />
            ) : (
              <RechargeReport />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
