import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { getPendingPurchases, createInvoice, getInvoiceDetail, approveInvoice, getClientInvoices, removeItemFromInvoice, reopenInvoice, generateAccessToken, getClientPendingBalance, getClientAvailableDeposits, annulInvoice, annulInvoicePreview, updateInvoiceSaldoPendiente, updatePurchase, getTenantSettings, auditInvoice, recalcInvoice, getLives, reassignPurchaseLive } from "@/lib/api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, CheckCircle, Clock, AlertCircle, History, Trash2, Edit, RefreshCw, Loader2, Package, ArrowRight, Info, Save, X, ShieldCheck, Radio, Stethoscope, Plus } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import InvoiceDiagnosticDialog from "@/components/InvoiceDiagnosticDialog";
import { addItemsToInvoice } from "@/lib/api";
// Helper function to load image with proper dimensions
const loadImageWithDimensions = (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      try {
        const dataURL = canvas.toDataURL("image/png");
        resolve({
          dataURL,
          width: img.naturalWidth,
          height: img.naturalHeight,
          aspectRatio: img.naturalWidth / img.naturalHeight
        });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
};

export default function InvoiceDialog({ open, onOpenChange, client, tenantInfo, existingInvoice = null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [pendingPurchases, setPendingPurchases] = useState([]);
  const [selectedPurchases, setSelectedPurchases] = useState([]);
  const [currentInvoice, setCurrentInvoice] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [viewMode, setViewMode] = useState("create"); // create, view, history
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState(null); // null | { issues, needs_recalc, ... }
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [diagnosticDialogOpen, setDiagnosticDialogOpen] = useState(false);
  // Add-items dialog: pick pending purchases to attach to the current invoice
  const [addItemsDialogOpen, setAddItemsDialogOpen] = useState(false);
  const [addItemsLoading, setAddItemsLoading] = useState(false);
  const [addItemsAvailable, setAddItemsAvailable] = useState([]);
  const [addItemsSelected, setAddItemsSelected] = useState(new Set());
  const [addItemsSaving, setAddItemsSaving] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [showShipmentPrompt, setShowShipmentPrompt] = useState(false);
  const [saldoPendiente, setSaldoPendiente] = useState("");
  const [autoPendingBalance, setAutoPendingBalance] = useState(0);
  const [pendingDetails, setPendingDetails] = useState([]);
  const [availableDeposits, setAvailableDeposits] = useState([]);
  const [annulDialogOpen, setAnnulDialogOpen] = useState(false);
  const [annulPreview, setAnnulPreview] = useState(null);
  const [deleteShipmentFlag, setDeleteShipmentFlag] = useState(true);
  const [annulTargetId, setAnnulTargetId] = useState(null);
  const [annulPassword, setAnnulPassword] = useState("");
  const [annulling, setAnnulling] = useState(false);
  const [editSaldoPendiente, setEditSaldoPendiente] = useState("");
  // Inline edit of pending purchases (items)
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const [editPurchaseForm, setEditPurchaseForm] = useState({
    item_name: "", store: "", price: "", tax_option: "0", custom_tax: "",
    apply_commission: true, commission: "0"
  });
  const [savingEdit, setSavingEdit] = useState(false);
  // Active lives — used to give the admin a destination when reassigning orphan
  // purchases (those whose original Live was deleted).
  const [activeLives, setActiveLives] = useState([]);
  const [reassignTargetId, setReassignTargetId] = useState(null); // purchase being reassigned
  const [reassigning, setReassigning] = useState(false);
  const [taxOptions, setTaxOptions] = useState([
    { value: "8.25", label: "8.25%" },
    { value: "10", label: "10%" },
    { value: "15", label: "15%" },
    { value: "0", label: "Sin Taxes" },
    { value: "other", label: "Otro" }
  ]);
  const invoiceRef = useRef(null);

  // Sync editSaldoPendiente when currentInvoice changes
  useEffect(() => {
    if (currentInvoice) {
      setEditSaldoPendiente(currentInvoice.saldo_pendiente > 0 ? currentInvoice.saldo_pendiente.toFixed(2) : "");
    }
  }, [currentInvoice?.id, currentInvoice?.saldo_pendiente]);

  useEffect(() => {
    if (open) {
      // If opening with an existing invoice, load it directly in view mode
      if (existingInvoice) {
        loadExistingInvoice(existingInvoice);
      } else if (client) {
        loadPendingPurchases();
        loadInvoices();
        loadPendingBalance();
        setShowShipmentPrompt(false);
        setViewMode("create");
      }
    }
  }, [open, client, existingInvoice]);

  const [isFirstInvoice, setIsFirstInvoice] = useState(true);
  const [saldoAFavor, setSaldoAFavor] = useState(0);

  const loadPendingBalance = async () => {
    try {
      const [balRes, depRes] = await Promise.all([
        getClientPendingBalance(client.customer_id),
        getClientAvailableDeposits(client.customer_id)
      ]);
      const isFirst = balRes.data.is_first_invoice !== false;
      setIsFirstInvoice(isFirst);
      setAutoPendingBalance(balRes.data.total_pending || 0);
      setPendingDetails(balRes.data.details || []);
      setSaldoPendiente(balRes.data.total_pending > 0 ? balRes.data.total_pending.toFixed(2) : "");
      setSaldoAFavor(balRes.data.saldo_a_favor || 0);
      setAvailableDeposits(depRes.data || []);
    } catch {
      setAutoPendingBalance(0);
      setIsFirstInvoice(true);
      setSaldoPendiente("");
      setSaldoAFavor(0);
      setAvailableDeposits([]);
    }
  };

  const loadExistingInvoice = async (invoice) => {
    try {
      setLoading(true);
      // Load full invoice details if we only have basic info
      if (invoice.id) {
        const res = await getInvoiceDetail(invoice.id);
        setCurrentInvoice(res.data);
      } else {
        setCurrentInvoice(invoice);
      }
      setViewMode("view");
    } catch (error) {
      toast.error("Error al cargar la factura");
    } finally {
      setLoading(false);
    }
  };

  const loadPendingPurchases = async () => {
    try {
      setLoading(true);
      const res = await getPendingPurchases(client.customer_id);
      setPendingPurchases(res.data);
      setSelectedPurchases(res.data.map(p => p.id));
    } catch (error) {
      toast.error("Error al cargar compras pendientes");
    } finally {
      setLoading(false);
    }
  };

  // Load tenant tax options once
  useEffect(() => {
    if (!open) return;
    getTenantSettings()
      .then((res) => {
        if (res.data?.tax_options && res.data.tax_options.length > 0) {
          setTaxOptions(res.data.tax_options);
        }
      })
      .catch(() => {});
  }, [open]);

  const getEffectiveTaxRate = (taxOption, customTax) => {
    if (taxOption === "0") return 0;
    if (taxOption === "other") return parseFloat(customTax) / 100 || 0;
    return parseFloat(taxOption) / 100 || 0;
  };

  const handleStartEditPurchase = (purchase, e) => {
    if (e) e.stopPropagation();
    setEditingPurchaseId(purchase.id);
    // Derive tax_option from stored tax_rate
    let tax_option = "0";
    let custom_tax = "";
    if (purchase.apply_tax !== false && purchase.tax_rate > 0) {
      const rate = (purchase.tax_rate * 100).toFixed(2).replace(/\.?0+$/, '');
      const matching = taxOptions.find(opt => opt.value === rate && opt.value !== "other");
      if (matching) {
        tax_option = rate;
      } else {
        tax_option = "other";
        custom_tax = rate;
      }
    }
    setEditPurchaseForm({
      item_name: purchase.item_name || "",
      store: purchase.store || "",
      price: (purchase.price ?? 0).toString(),
      tax_option,
      custom_tax,
      apply_commission: purchase.apply_commission !== false,
      commission: (purchase.commission || 0).toString()
    });
  };

  const handleCancelEditPurchase = (e) => {
    if (e) e.stopPropagation();
    setEditingPurchaseId(null);
  };

  const handleSavePurchaseEdit = async (purchaseId, e) => {
    if (e) e.stopPropagation();
    const orig = pendingPurchases.find(p => p.id === purchaseId) ||
                 currentInvoice?.purchases?.find(p => p.id === purchaseId);
    if (!orig) return;
    try {
      setSavingEdit(true);
      const data = {};
      if (editPurchaseForm.item_name !== orig.item_name) data.item_name = editPurchaseForm.item_name;
      if (editPurchaseForm.store !== orig.store) data.store = editPurchaseForm.store;
      const newPrice = parseFloat(editPurchaseForm.price);
      if (!Number.isNaN(newPrice) && newPrice !== orig.price) data.price = newPrice;

      const newTaxRate = getEffectiveTaxRate(editPurchaseForm.tax_option, editPurchaseForm.custom_tax);
      const newApplyTax = newTaxRate > 0;
      const origApplyTax = orig.apply_tax !== false;
      const origTaxRate = orig.tax_rate || 0;
      if (newApplyTax !== origApplyTax) data.apply_tax = newApplyTax;
      if (Math.abs(newTaxRate - origTaxRate) > 0.0001) data.tax_rate = newTaxRate;

      const newApplyCommission = !!editPurchaseForm.apply_commission;
      const newCommission = parseFloat(editPurchaseForm.commission) || 0;
      const origApplyCommission = orig.apply_commission !== false;
      const origCommission = orig.commission || 0;
      if (newApplyCommission !== origApplyCommission) data.apply_commission = newApplyCommission;
      if (newApplyCommission && newCommission !== origCommission) data.commission = newCommission;
      if (!newApplyCommission) data.commission = 0;

      if (Object.keys(data).length === 0) {
        setEditingPurchaseId(null);
        return;
      }
      await updatePurchase(purchaseId, data);
      toast.success("Artículo actualizado. Cambios aplicados también en LIVE.");
      setEditingPurchaseId(null);
      if (viewMode === "view" && currentInvoice?.id) {
        const invoiceRes = await getInvoiceDetail(currentInvoice.id);
        setCurrentInvoice(invoiceRes.data);
        loadInvoices();
      } else {
        await loadPendingPurchases();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al editar artículo");
    } finally {
      setSavingEdit(false);
    }
  };

  const loadInvoices = async () => {
    try {
      const res = await getClientInvoices(client.customer_id, true);
      setInvoices(res.data);
    } catch (error) {
      console.error("Error loading invoices:", error);
    }
  };

  const handleCreateInvoice = async () => {
    if (selectedPurchases.length === 0) {
      toast.error("Selecciona al menos una compra");
      return;
    }
    
    try {
      setLoading(true);
      const res = await createInvoice({
        customer_id: client.customer_id,
        purchase_ids: selectedPurchases,
        saldo_pendiente: parseFloat(saldoPendiente) || 0,
        saldo_a_favor: saldoAFavor || 0
      });
      toast.success(`Factura ${res.data.invoice_number} creada`);
      
      // Load the created invoice
      const invoiceRes = await getInvoiceDetail(res.data.invoice_id);
      setCurrentInvoice(invoiceRes.data);
      setViewMode("view");
      setShowShipmentPrompt(true); // Show shipment creation prompt
      loadPendingPurchases();
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al crear factura");
    } finally {
      setLoading(false);
    }
  };

  const handleGoToCreateShipment = () => {
    // Store invoice data in sessionStorage for the shipment page
    sessionStorage.setItem('shipmentFromInvoice', JSON.stringify({
      invoice_id: currentInvoice.id,
      invoice_number: currentInvoice.invoice_number,
      customer_id: client.customer_id,
      client_name: client.name,
      client: client,
      purchases: currentInvoice.purchases,
      subtotal: currentInvoice.subtotal,
      total_tax: currentInvoice.total_tax,
      total: currentInvoice.total,
      shipment_id: currentInvoice.shipment_id || null
    }));
    onOpenChange(false);
    navigate('/admin/shipments?from_invoice=true');
  };

  const handleApproveInvoice = async () => {
    if (!currentInvoice) return;
    
    try {
      setLoading(true);
      await approveInvoice(currentInvoice.id);
      toast.success("Factura aprobada - Compras movidas al historial");
      
      // Reload invoice
      const invoiceRes = await getInvoiceDetail(currentInvoice.id);
      setCurrentInvoice(invoiceRes.data);
      loadPendingPurchases();
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al aprobar factura");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (purchaseId) => {
    if (!currentInvoice) return;
    
    if (currentInvoice.purchases?.length <= 1) {
      toast.error("No puedes quitar el último artículo");
      return;
    }
    
    try {
      setLoading(true);
      await removeItemFromInvoice(currentInvoice.id, purchaseId);
      toast.success("Artículo removido de la factura");
      
      // Reload invoice
      const invoiceRes = await getInvoiceDetail(currentInvoice.id);
      setCurrentInvoice(invoiceRes.data);
      loadPendingPurchases();
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al remover artículo");
    } finally {
      setLoading(false);
    }
  };

  const handleReopenInvoice = async () => {
    if (!currentInvoice) return;
    
    try {
      setLoading(true);
      await reopenInvoice(currentInvoice.id);
      toast.success("Factura reabierta para modificaciones");
      
      // Reload invoice
      const invoiceRes = await getInvoiceDetail(currentInvoice.id);
      setCurrentInvoice(invoiceRes.data);
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al reabrir factura");
    } finally {
      setLoading(false);
    }
  };

  const openAnnulDialog = async (invoiceId, e) => {
    if (e) e.stopPropagation();
    setAnnulTargetId(invoiceId);
    setAnnulPassword("");
    setAnnulPreview(null);
    setDeleteShipmentFlag(true); // default: delete linked shipment
    setAnnulDialogOpen(true);
    // Fetch impact preview (linked shipment, purchases, deposits) so the UI
    // can show a detailed warning BEFORE the destructive action.
    try {
      const res = await annulInvoicePreview(invoiceId);
      setAnnulPreview(res.data);
    } catch (e2) {
      // Non-fatal — the user can still proceed without the preview.
      console.error("annul preview failed", e2);
    }
  };

  const handleAnnulInvoice = async () => {
    if (!annulPassword) {
      toast.error("Ingresa tu contraseña");
      return;
    }
    setAnnulling(true);
    try {
      const res = await annulInvoice(annulTargetId, annulPassword, deleteShipmentFlag);
      const shipMsg = res.data?.shipment_action === "deleted"
        ? " y envío eliminado"
        : (res.data?.shipment_action === "unlinked" ? " (envío desvinculado)" : "");
      toast.success(`Factura anulada${shipMsg}`);
      setAnnulDialogOpen(false);
      setAnnulTargetId(null);
      setAnnulPassword("");
      setAnnulPreview(null);
      loadInvoices();
      if (currentInvoice?.id === annulTargetId) {
        setCurrentInvoice(null);
        setViewMode("history");
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al eliminar factura");
    } finally {
      setAnnulling(false);
    }
  };

  const handleSaveSaldoPendiente = async () => {
    if (!currentInvoice) return;
    const newSaldo = parseFloat(editSaldoPendiente) || 0;
    try {
      await updateInvoiceSaldoPendiente(currentInvoice.id, newSaldo);
      toast.success("Saldo pendiente actualizado");
      const invoiceRes = await getInvoiceDetail(currentInvoice.id);
      setCurrentInvoice(invoiceRes.data);
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al actualizar");
    }
  };

  const handleViewInvoice = async (invoice) => {
    try {
      setLoading(true);
      const res = await getInvoiceDetail(invoice.id);
      setCurrentInvoice(res.data);
      setViewMode("view");
    } catch (error) {
      toast.error("Error al cargar factura");
    } finally {
      setLoading(false);
    }
  };

  const generatePDF = async () => {
    if (!currentInvoice) return;
    setGeneratingPDF(true);
    try {
      // Always re-fetch the latest invoice state from the backend before generating the PDF.
      // This ensures that if the user removed an item / adjusted a value, the PDF reflects it.
      let invoiceForPDF = currentInvoice;
      try {
        const fresh = await getInvoiceDetail(currentInvoice.id);
        invoiceForPDF = fresh.data;
        setCurrentInvoice(fresh.data);
      } catch (_) {
        // If refetch fails, fall back to in-memory state so user can still get a PDF.
      }
      const tenant = {
        ...(invoiceForPDF.tenant || {}),
        ...tenantInfo
      };
      const { generateInvoicePDF } = await import("@/lib/invoicePDF");
      await generateInvoicePDF(invoiceForPDF, tenant);
      toast.success("PDF descargado");
    } catch (error) {
      toast.error("Error al generar PDF");
      console.error("PDF generation error:", error);
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleAuditInvoice = async () => {
    if (!currentInvoice) return;
    setAuditing(true);
    try {
      const res = await auditInvoice(currentInvoice.id);
      setAuditResult(res.data);
      setAuditDialogOpen(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al auditar factura");
    } finally {
      setAuditing(false);
    }
  };

  const handleRecalcInvoice = async () => {
    if (!currentInvoice) return;
    setRecalcing(true);
    try {
      const res = await recalcInvoice(currentInvoice.id);
      const d = res.data || {};
      // Refresh invoice in-place so the UI shows corrected numbers immediately
      try {
        const fresh = await getInvoiceDetail(currentInvoice.id);
        setCurrentInvoice(fresh.data);
        // Force-reset the local saldo input so the UI matches the freshly persisted value.
        // Without this the "Saldo Pendiente" input would keep the previous typed value
        // and the displayed grandTotal would diverge from the PDF (which always reads
        // backend's saldo_pendiente).
        setEditSaldoPendiente(
          fresh.data?.saldo_pendiente > 0 ? fresh.data.saldo_pendiente.toFixed(2) : ""
        );
      } catch (_) { /* ignore refresh errors, we'll still close */ }
      const orphans = d.removed_orphan_ids || 0;
      toast.success(
        `Factura recalculada — Subtotal $${(d.subtotal || 0).toFixed(2)} · Total $${(d.total || 0).toFixed(2)}` +
        (orphans > 0 ? ` · ${orphans} ítem(s) huérfano(s) limpiado(s)` : "")
      );
      setAuditDialogOpen(false);
      setAuditResult(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al recalcular");
    } finally {
      setRecalcing(false);
    }
  };

  // Open the "add products to this invoice" dialog.
  // Loads the same pending purchases the client has available. We keep only
  // those NOT currently in this invoice (can't add a duplicate) and NOT
  // attached to any other invoice (backend rejects that case anyway).
  const openAddItemsDialog = async () => {
    if (!currentInvoice?.customer_id) return;
    setAddItemsDialogOpen(true);
    setAddItemsLoading(true);
    setAddItemsSelected(new Set());
    setAddItemsAvailable([]);
    try {
      const res = await getPendingPurchases(currentInvoice.customer_id);
      const currentIds = new Set((currentInvoice.purchases || []).map((p) => p.id));
      const available = (res.data || []).filter((p) => !currentIds.has(p.id) && !p.invoice_id);
      setAddItemsAvailable(available);
    } catch (e) {
      toast.error("No se pudieron cargar las compras pendientes");
    } finally {
      setAddItemsLoading(false);
    }
  };

  const toggleAddItemSelected = (pid) => {
    setAddItemsSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };

  const handleAddItemsToInvoice = async () => {
    if (addItemsSelected.size === 0) {
      toast.error("Selecciona al menos una compra");
      return;
    }
    setAddItemsSaving(true);
    try {
      const res = await addItemsToInvoice(currentInvoice.id, Array.from(addItemsSelected));
      toast.success(res.data?.message || "Artículos agregados");
      setAddItemsDialogOpen(false);
      setAddItemsSelected(new Set());
      // Refresh invoice so the new purchases appear in the table
      try {
        const fresh = await getInvoiceDetail(currentInvoice.id);
        setCurrentInvoice(fresh.data);
      } catch { /* non-fatal */ }
      // Also refresh the in-memory pending-purchases list so that if the admin
      // switches to "Nueva Factura" afterwards, the added items no longer show
      // up (the backend already excludes them — we just need the UI in sync).
      loadPendingPurchases();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudieron agregar las compras");
    } finally {
      setAddItemsSaving(false);
    }
  };


  const togglePurchase = (purchaseId) => {
    setSelectedPurchases(prev => 
      prev.includes(purchaseId) 
        ? prev.filter(id => id !== purchaseId)
        : [...prev, purchaseId]
    );
  };

  const selectAll = () => {
    setSelectedPurchases(pendingPurchases.map(p => p.id));
  };

  const deselectAll = () => {
    setSelectedPurchases([]);
  };

  // Calculate totals for selected purchases
  const selectedTotals = pendingPurchases
    .filter(p => selectedPurchases.includes(p.id))
    .reduce((acc, p) => ({
      subtotal: acc.subtotal + p.price,
      tax: acc.tax + (p.tax || 0),
      commission: acc.commission + (p.commission || 0),
      total: acc.total + p.total
    }), { subtotal: 0, tax: 0, commission: 0, total: 0 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(30,58,95,0.1)' }}>
              <FileText className="h-5 w-5" style={{ color: '#1E3A5F' }} />
            </div>
            Facturación - {client?.name}
            <Badge className="ml-2 bg-blue-100 text-blue-800">#{client?.customer_id}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="flex gap-2 border-b pb-3">
          <Button
            variant={viewMode === "create" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setViewMode("create");
              setCurrentInvoice(null);
              // Always refresh pending purchases when entering Nueva Factura so items
              // already attached to another invoice (e.g. via the "Agregar productos"
              // flow) stop appearing in the picker.
              loadPendingPurchases();
            }}
            className="rounded-lg"
            style={viewMode === "create" ? { background: '#1E3A5F' } : {}}
          >
            <FileText className="h-4 w-4 mr-2" />
            Nueva Factura
            {pendingPurchases.length > 0 && (
              <Badge className="ml-2 bg-red-500 text-white">{pendingPurchases.length}</Badge>
            )}
          </Button>
          <Button
            variant={viewMode === "history" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("history")}
            className="rounded-lg"
            style={viewMode === "history" ? { background: '#1E3A5F' } : {}}
          >
            <History className="h-4 w-4 mr-2" />
            Historial ({invoices.length})
          </Button>
        </div>

        <ScrollArea className="h-[60vh] pr-4">
          {/* CREATE MODE */}
          {viewMode === "create" && (
            <div className="space-y-4">
              {pendingPurchases.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="h-16 w-16 text-green-300 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-600">No hay compras pendientes</p>
                  <p className="text-sm text-gray-400 mt-2">Todas las compras han sido facturadas</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">{selectedPurchases.length} de {pendingPurchases.length} compras seleccionadas</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={selectAll} className="rounded-lg text-xs">
                        Seleccionar todo
                      </Button>
                      <Button variant="outline" size="sm" onClick={deselectAll} className="rounded-lg text-xs">
                        Deseleccionar
                      </Button>
                    </div>
                  </div>

                  {/* Purchases list */}
                  <div className="space-y-2">
                    {pendingPurchases.map((purchase) => {
                      const isEditing = editingPurchaseId === purchase.id;
                      if (isEditing) {
                        const price = parseFloat(editPurchaseForm.price) || 0;
                        const taxRate = getEffectiveTaxRate(editPurchaseForm.tax_option, editPurchaseForm.custom_tax);
                        const taxAmount = price * taxRate;
                        const commission = editPurchaseForm.apply_commission ? (parseFloat(editPurchaseForm.commission) || 0) : 0;
                        const totalPreview = price + taxAmount + commission;
                        const taxLabel = editPurchaseForm.tax_option === "other"
                          ? `${editPurchaseForm.custom_tax || 0}%`
                          : editPurchaseForm.tax_option === "0" ? "Sin Tax" : `${editPurchaseForm.tax_option}%`;
                        return (
                          <div
                            key={purchase.id}
                            className="p-4 rounded-xl border-2 border-blue-400 bg-blue-50/50 space-y-2"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`edit-pending-purchase-${purchase.id}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-blue-700 uppercase">Editando artículo</span>
                              <span className="text-xs text-gray-500">{purchase.store || ""}</span>
                            </div>
                            <Input
                              value={editPurchaseForm.item_name}
                              onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, item_name: e.target.value })}
                              placeholder="Producto"
                              className="h-9 rounded-lg text-sm"
                              data-testid="edit-pending-item-name"
                            />
                            <div className="flex gap-2">
                              <Input
                                value={editPurchaseForm.store}
                                onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, store: e.target.value })}
                                placeholder="Tienda"
                                className="h-9 rounded-lg text-sm flex-1"
                              />
                              <Input
                                type="number" step="0.01" min="0"
                                value={editPurchaseForm.price}
                                onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, price: e.target.value })}
                                placeholder="Precio"
                                className="h-9 rounded-lg text-sm w-28"
                                data-testid="edit-pending-price"
                                onWheel={(e) => e.target.blur()}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="p-2 bg-white rounded-lg border">
                                <p className="text-xs font-medium text-gray-600 mb-1">Impuesto</p>
                                <div className="flex gap-2 items-center">
                                  <Select
                                    value={editPurchaseForm.tax_option}
                                    onValueChange={(val) => setEditPurchaseForm({ ...editPurchaseForm, tax_option: val })}
                                  >
                                    <SelectTrigger className="h-8 rounded text-xs flex-1">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {taxOptions.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {editPurchaseForm.tax_option === "other" && (
                                    <Input
                                      type="number" step="0.01" min="0"
                                      value={editPurchaseForm.custom_tax}
                                      onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, custom_tax: e.target.value })}
                                      className="w-16 h-8 text-xs text-center rounded"
                                      placeholder="%"
                                    />
                                  )}
                                </div>
                              </div>
                              <div className="p-2 bg-white rounded-lg border">
                                <label className="flex items-center gap-1 text-xs cursor-pointer mb-1">
                                  <input
                                    type="checkbox"
                                    checked={editPurchaseForm.apply_commission}
                                    onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, apply_commission: e.target.checked })}
                                    className="w-3 h-3"
                                  />
                                  <span className="font-medium text-gray-700">Comisión $</span>
                                </label>
                                {editPurchaseForm.apply_commission && (
                                  <Input
                                    type="number" step="0.01"
                                    value={editPurchaseForm.commission}
                                    onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, commission: e.target.value })}
                                    className="h-7 text-xs text-center rounded"
                                    data-testid="edit-pending-commission"
                                    onWheel={(e) => e.target.blur()}
                                  />
                                )}
                              </div>
                            </div>
                            {/* Preview */}
                            <div className="p-2 bg-white/80 rounded-lg text-xs space-y-0.5 border">
                              <div className="flex justify-between"><span className="text-gray-500">Precio:</span><span>${price.toFixed(2)}</span></div>
                              {taxRate > 0 && (
                                <div className="flex justify-between"><span className="text-gray-500">Tax ({taxLabel}):</span><span>${taxAmount.toFixed(2)}</span></div>
                              )}
                              {editPurchaseForm.apply_commission && (
                                <div className="flex justify-between"><span className="text-gray-500">Comisión:</span><span>${commission.toFixed(2)}</span></div>
                              )}
                              <div className="flex justify-between pt-1 border-t font-bold text-blue-700"><span>Total:</span><span>${totalPreview.toFixed(2)}</span></div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={(e) => handleSavePurchaseEdit(purchase.id, e)}
                                disabled={savingEdit}
                                className="flex-1 h-9 rounded-lg text-white"
                                style={{ background: '#2ECC71' }}
                                data-testid={`save-pending-edit-${purchase.id}`}
                              >
                                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Guardar</>}
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                onClick={handleCancelEditPurchase}
                                className="h-9 rounded-lg"
                                data-testid={`cancel-pending-edit-${purchase.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={purchase.id}
                          className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                            selectedPurchases.includes(purchase.id)
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                          onClick={() => togglePurchase(purchase.id)}
                          data-testid={`pending-purchase-${purchase.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={selectedPurchases.includes(purchase.id)}
                              onCheckedChange={() => {}}
                              onClick={(e) => e.stopPropagation()}
                              className="data-[state=checked]:bg-blue-600 pointer-events-none"
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-gray-800 truncate">{purchase.item_name}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                  <p className="font-bold text-lg" style={{ color: '#1E3A5F' }}>
                                    ${(purchase.price + (purchase.commission || 0)).toFixed(2)}
                                  </p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-gray-500 hover:text-blue-600 hover:bg-blue-100"
                                    onClick={(e) => handleStartEditPurchase(purchase, e)}
                                    title="Editar artículo (aplica también en LIVE)"
                                    data-testid={`edit-pending-purchase-btn-${purchase.id}`}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                                <span>{purchase.store}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-xs">
                                <span className="text-gray-400">
                                  {new Date(purchase.created_at).toLocaleDateString("es-ES")}
                                </span>
                                {purchase.live_title ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-medium"
                                    data-testid={`pending-purchase-origin-${purchase.id}`}
                                    title={`Live: ${purchase.live_title}${purchase.live_id ? ` · ID: ${String(purchase.live_id).slice(0, 8)}` : ""}`}
                                  >
                                    <Radio className="h-3 w-3" />
                                    {purchase.live_title}
                                    {purchase.live_id && (
                                      <span className="ml-1 text-[10px] text-purple-500/70 font-mono">
                                        #{String(purchase.live_id).slice(0, 6)}
                                      </span>
                                    )}
                                  </span>
                                ) : purchase.live_origin === "deleted_live" && purchase.live_id ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium"
                                    data-testid={`pending-purchase-origin-${purchase.id}`}
                                    title={`Live eliminado · ID: ${purchase.live_id}`}
                                  >
                                    <Radio className="h-3 w-3" />
                                    Live eliminado
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 font-medium"
                                    data-testid={`pending-purchase-origin-${purchase.id}`}
                                    title="Compra registrada sin Live"
                                  >
                                    Sin live
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Saldo Pendiente Field */}
                  {selectedPurchases.length > 0 && (
                    <div className="p-3 rounded-xl border border-orange-200 bg-orange-50/50" data-testid="saldo-pendiente-section">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold text-orange-800">Saldo Pendiente</p>
                          <p className="text-xs text-orange-600">
                            {!isFirstInvoice ? 'Total a pagar de factura anterior' : 'Deuda anterior (editable)'}
                          </p>
                        </div>
                        <div className="w-32">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={saldoPendiente}
                            onChange={(e) => setSaldoPendiente(e.target.value)}
                            className={`h-9 text-right font-bold rounded-lg ${!isFirstInvoice ? 'text-orange-700 bg-orange-100 cursor-not-allowed' : 'text-orange-700'}`}
                            data-testid="saldo-pendiente-input"
                            onWheel={(e) => e.target.blur()}
                            disabled={!isFirstInvoice}
                          />
                        </div>
                      </div>
                      {pendingDetails.length > 0 && (
                        <div className="text-xs text-orange-600 space-y-0.5 border-t border-orange-200 pt-2 mt-1">
                          {pendingDetails.map((d, i) => (
                            <div key={i} className="flex justify-between">
                              <span>{d.invoice_number}: Total a pagar</span>
                              <span>${(d.total_a_pagar || d.remaining || 0).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Totals and Create button */}
                  {selectedPurchases.length > 0 && (
                    <div className="bg-white pt-4 border-t">
                      <div className="p-4 rounded-xl" style={{ background: 'rgba(30,58,95,0.05)' }}>
                        {(() => {
                          const subtotal = selectedTotals.subtotal; // Solo precio (Total Etiqueta)
                          const commission = selectedTotals.commission;
                          const tax = selectedTotals.tax;
                          const saldo = parseFloat(saldoPendiente) || 0;
                          const grandTotal = subtotal + commission + tax + saldo;
                          const totalAbonos = availableDeposits.reduce((s, d) => s + d.amount, 0);
                          const totalCredits = totalAbonos + (saldoAFavor || 0);
                          const totalAPagar = Math.max(0, grandTotal - totalCredits);

                          return (
                            <>
                              <div className="space-y-2 mb-3">
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">Subtotal:</span>
                                  <span className="font-medium">${(subtotal + commission).toFixed(2)}</span>
                                </div>
                                {tax > 0 && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Taxes:</span>
                                    <span className="font-medium">${tax.toFixed(2)}</span>
                                  </div>
                                )}
                                {saldo > 0 && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-orange-600">Saldo Pendiente:</span>
                                    <span className="font-medium text-orange-600">${saldo.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between border-t pt-2">
                                  <span className="font-bold">Total:</span>
                                  <span className="font-bold text-xl" style={{ color: '#1E3A5F' }}>${grandTotal.toFixed(2)}</span>
                                </div>
                              </div>

                              {/* Abonos (recargas disponibles) */}
                              {saldoAFavor > 0 && (
                                <div className="space-y-1 mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200" data-testid="saldo-favor-anterior">
                                  <p className="text-xs font-semibold text-blue-800 mb-1">Saldo a Favor (factura anterior)</p>
                                  <div className="flex justify-between text-sm font-bold text-blue-700">
                                    <span>Crédito:</span>
                                    <span>-${saldoAFavor.toFixed(2)}</span>
                                  </div>
                                </div>
                              )}

                              {availableDeposits.length > 0 && (
                                <div className="space-y-1 mb-3 p-3 rounded-lg bg-green-50 border border-green-200" data-testid="create-abonos-section">
                                  <p className="text-xs font-semibold text-green-800 mb-1">Abonos (Recargas del cliente)</p>
                                  {availableDeposits.map((dep, idx) => (
                                    <div key={dep.id} className="flex justify-between text-sm">
                                      <span className="text-green-700">
                                        Abono {idx + 1}{dep.original_amount && dep.original_amount !== dep.amount ? ` (recarga $${dep.original_amount.toFixed(2)})` : ''}:
                                      </span>
                                      <span className="font-bold text-green-700">-${dep.amount.toFixed(2)}</span>
                                    </div>
                                  ))}
                                  <div className="border-t border-green-300 pt-1 mt-1 flex justify-between text-sm font-bold text-green-800">
                                    <span>Total Abonos:</span>
                                    <span>-${totalAbonos.toFixed(2)}</span>
                                  </div>
                                </div>
                              )}

                              {/* Total a pagar o Saldo a favor */}
                              <div className="flex justify-between items-center mb-4 p-2 rounded-lg" style={{ background: totalAPagar > 0 ? 'rgba(220,38,38,0.05)' : 'rgba(22,163,74,0.05)' }}>
                                <span className="font-extrabold text-lg">Total a pagar:</span>
                                <span className="font-extrabold text-2xl" style={{ color: totalAPagar > 0 ? '#DC2626' : '#16A34A' }}>
                                  ${totalAPagar.toFixed(2)}
                                </span>
                              </div>
                              {totalCredits > grandTotal && (
                                <div className="p-3 rounded-lg bg-green-100 border border-green-300 mb-4 text-center" data-testid="saldo-favor-msg">
                                  <p className="text-sm font-bold text-green-800">
                                    Saldo a favor para próxima factura: ${(totalCredits - grandTotal).toFixed(2)}
                                  </p>
                                  <p className="text-xs text-green-600">Este saldo se aplicará automáticamente</p>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <Button
                          onClick={handleCreateInvoice}
                          disabled={loading}
                          className="w-full h-12 text-lg font-bold rounded-xl"
                          style={{ background: '#2ECC71' }}
                        >
                          {loading ? "Creando..." : `Crear Factura (${selectedPurchases.length} items)`}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* VIEW MODE - Invoice detail */}
          {viewMode === "view" && currentInvoice && (
            <div className="space-y-4" ref={invoiceRef}>
              {/* Invoice Header */}
              <div className="p-6 rounded-2xl text-white" style={{ background: 'linear-gradient(135deg, #1E3A5F 0%, #2c5282 100%)' }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    {(tenantInfo?.logo_url || currentInvoice.tenant?.logo_url) ? (
                      <img 
                        src={`${process.env.REACT_APP_BACKEND_URL || ''}${tenantInfo?.logo_url || currentInvoice.tenant?.logo_url}`}
                        alt="Logo"
                        className="w-16 h-16 rounded-2xl object-contain bg-white p-1"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className="w-16 h-16 rounded-2xl items-center justify-center" style={{ background: '#2ECC71', display: (tenantInfo?.logo_url || currentInvoice.tenant?.logo_url) ? 'none' : 'flex' }}>
                      <span className="text-2xl font-bold text-white">
                        {(tenantInfo?.business_name || currentInvoice.tenant?.business_name)?.substring(0, 2)?.toUpperCase() || "PS"}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">{tenantInfo?.business_name || currentInvoice.tenant?.business_name || "Personal Shopper"}</h2>
                      <p className="text-blue-200 text-sm">{tenantInfo?.email || currentInvoice.tenant?.email}</p>
                      <p className="text-blue-200 text-sm">{tenantInfo?.owner_name || currentInvoice.tenant?.owner_name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold">{currentInvoice.invoice_number}</p>
                    {currentInvoice.is_annulled ? (
                      <Badge className="bg-red-600 mt-2">ANULADA</Badge>
                    ) : (
                      <Badge className={currentInvoice.status === "approved" ? "bg-green-500 mt-2" : "bg-yellow-500 mt-2"}>
                        {currentInvoice.status === "approved" ? "PAGADA" : "PENDIENTE"}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Client Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 mb-2">DATOS DEL CLIENTE</p>
                  <p className="font-bold text-lg" style={{ color: '#1E3A5F' }}>{currentInvoice.client?.name}</p>
                  <p className="text-sm text-gray-600">ID: {currentInvoice.client?.customer_id}</p>
                  <p className="text-sm text-gray-600">WhatsApp: {currentInvoice.client?.whatsapp}</p>
                  <p className="text-sm text-gray-600">País: {currentInvoice.client?.country}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 mb-2">DETALLE DE COMPRA</p>
                  <p className="text-sm text-gray-600">Fecha: {new Date(currentInvoice.created_at).toLocaleDateString("es-ES")}</p>
                  <p className="text-sm text-gray-600">Items: {currentInvoice.purchases?.length || 0}</p>
                  {currentInvoice.approved_at && (
                    <p className="text-sm text-green-600 font-medium">
                      Aprobada: {new Date(currentInvoice.approved_at).toLocaleDateString("es-ES")}
                    </p>
                  )}
                </div>
              </div>

              {/* Shipment Info */}
              {currentInvoice.shipment && (
                <div className="p-4 rounded-xl bg-purple-50 border border-purple-200">
                  <p className="text-xs font-semibold text-purple-800 mb-2 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs">📦</span>
                    INFORMACIÓN DE ENVÍO
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-purple-600">Costo de Envío</p>
                      <p className="font-bold text-lg text-purple-800">${(currentInvoice.shipment.shipping_cost || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      {(() => {
                        const s = currentInvoice.shipment;
                        const isPounds = s.shipping_mode === "pounds";
                        const label = isPounds ? "Libras" : (s.shipping_mode === "packages" || s.package_count > 0 ? "Paquetes" : "Peso");
                        const value = isPounds
                          ? `${Number(s.package_count || 0).toFixed(1)} lb`
                          : (s.shipping_mode === "packages" || s.package_count > 0)
                            ? `${s.package_count || 0}`
                            : `${s.weight_pounds || 0} lbs`;
                        return (
                          <>
                            <p className="text-xs text-purple-600">{label}</p>
                            <p className="font-bold text-lg text-purple-800">{value}</p>
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <p className="text-xs text-purple-600">Tracking ({currentInvoice.shipment.tracking_numbers?.length || (currentInvoice.shipment.tracking_number ? 1 : 0)} paquete(s))</p>
                      {currentInvoice.shipment.tracking_numbers?.length > 0 ? (
                        <div className="space-y-1">
                          {currentInvoice.shipment.tracking_numbers.map((t, i) => (
                            <p key={i} className="font-bold text-sm text-purple-800 font-mono">#{i+1}: {t}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="font-bold text-lg text-purple-800">{currentInvoice.shipment.tracking_number || "N/A"}</p>
                      )}
                    </div>
                  </div>
                  {(currentInvoice.shipment.tracking_numbers?.length > 0 || currentInvoice.shipment.tracking_number) && currentInvoice.tenant?.tracking_url_template && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(currentInvoice.shipment.tracking_numbers?.length > 0 
                        ? currentInvoice.shipment.tracking_numbers 
                        : [currentInvoice.shipment.tracking_number]
                      ).filter(Boolean).map((tracking, idx) => (
                        <a
                          key={idx}
                          href={currentInvoice.tenant.tracking_url_template.replace('{tracking}', tracking)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-xs font-medium"
                        >
                          📦 Paquete {idx + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Purchases table */}
              {!currentInvoice.is_annulled && currentInvoice.status !== "approved" && (
                <div className="flex justify-end mb-2">
                  <Button
                    size="sm"
                    onClick={openAddItemsDialog}
                    className="h-8 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    data-testid="open-add-items-btn"
                    title="Agregar más compras pendientes del mismo cliente a esta factura"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar productos
                  </Button>
                </div>
              )}
              <div className="border rounded-xl overflow-hidden" data-testid="invoice-purchases-table">
                <table className="w-full">
                  <thead>
                    <tr style={{ background: '#1E3A5F' }}>
                      <th className="text-center p-3 text-white text-sm font-semibold w-20">CANTIDAD</th>
                      <th className="text-left p-3 text-white text-sm font-semibold">DETALLE</th>
                      <th className="text-right p-3 text-white text-sm font-semibold">COSTO</th>
                      <th className="text-left p-3 text-white text-sm font-semibold">TIENDA</th>
                      <th className="text-right p-3 text-white text-sm font-semibold">COMISION</th>
                      <th className="text-right p-3 text-white text-sm font-semibold">TOTAL</th>
                      <th className="text-center p-3 text-white text-sm font-semibold w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentInvoice.purchases?.map((p, idx) => {
                      const isEditing = editingPurchaseId === p.id;
                      const canEdit = currentInvoice.status === "pending" && !currentInvoice.is_annulled;
                      if (isEditing) {
                        const price = parseFloat(editPurchaseForm.price) || 0;
                        const taxRate = getEffectiveTaxRate(editPurchaseForm.tax_option, editPurchaseForm.custom_tax);
                        const taxAmount = price * taxRate;
                        const commission = editPurchaseForm.apply_commission ? (parseFloat(editPurchaseForm.commission) || 0) : 0;
                        const totalPreview = price + taxAmount + commission;
                        const taxLabel = editPurchaseForm.tax_option === "other"
                          ? `${editPurchaseForm.custom_tax || 0}%`
                          : editPurchaseForm.tax_option === "0" ? "Sin Tax" : `${editPurchaseForm.tax_option}%`;
                        return (
                          <tr key={p.id} className="bg-blue-50">
                            <td colSpan={7} className="p-3">
                              <div className="space-y-2" data-testid={`edit-invoice-purchase-${p.id}`}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-blue-700 uppercase">Editando artículo</span>
                                  <span className="text-xs text-gray-500">Preview Total: <span className="font-bold text-blue-700">${totalPreview.toFixed(2)}</span> ({taxLabel})</span>
                                </div>
                                <Input
                                  value={editPurchaseForm.item_name}
                                  onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, item_name: e.target.value })}
                                  placeholder="Producto"
                                  className="h-9 rounded-lg text-sm"
                                  data-testid="edit-invoice-item-name"
                                />
                                <div className="flex gap-2">
                                  <Input
                                    value={editPurchaseForm.store}
                                    onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, store: e.target.value })}
                                    placeholder="Tienda"
                                    className="h-9 rounded-lg text-sm flex-1"
                                  />
                                  <Input
                                    type="number" step="0.01" min="0"
                                    value={editPurchaseForm.price}
                                    onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, price: e.target.value })}
                                    placeholder="Precio"
                                    className="h-9 rounded-lg text-sm w-28"
                                    data-testid="edit-invoice-price"
                                    onWheel={(e) => e.target.blur()}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="p-2 bg-white rounded-lg border">
                                    <p className="text-xs font-medium text-gray-600 mb-1">Impuesto</p>
                                    <div className="flex gap-2 items-center">
                                      <Select
                                        value={editPurchaseForm.tax_option}
                                        onValueChange={(val) => setEditPurchaseForm({ ...editPurchaseForm, tax_option: val })}
                                      >
                                        <SelectTrigger className="h-8 rounded text-xs flex-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {taxOptions.map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {editPurchaseForm.tax_option === "other" && (
                                        <Input
                                          type="number" step="0.01" min="0"
                                          value={editPurchaseForm.custom_tax}
                                          onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, custom_tax: e.target.value })}
                                          className="w-16 h-8 text-xs text-center rounded"
                                          placeholder="%"
                                        />
                                      )}
                                    </div>
                                  </div>
                                  <div className="p-2 bg-white rounded-lg border">
                                    <label className="flex items-center gap-1 text-xs cursor-pointer mb-1">
                                      <input
                                        type="checkbox"
                                        checked={editPurchaseForm.apply_commission}
                                        onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, apply_commission: e.target.checked })}
                                        className="w-3 h-3"
                                      />
                                      <span className="font-medium text-gray-700">Comisión $</span>
                                    </label>
                                    {editPurchaseForm.apply_commission && (
                                      <Input
                                        type="number" step="0.01"
                                        value={editPurchaseForm.commission}
                                        onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, commission: e.target.value })}
                                        className="h-7 text-xs text-center rounded"
                                        data-testid="edit-invoice-commission"
                                        onWheel={(e) => e.target.blur()}
                                      />
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={(e) => handleSavePurchaseEdit(p.id, e)}
                                    disabled={savingEdit}
                                    className="flex-1 h-9 rounded-lg text-white"
                                    style={{ background: '#2ECC71' }}
                                    data-testid={`save-invoice-edit-${p.id}`}
                                  >
                                    {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Guardar</>}
                                  </Button>
                                  <Button
                                    size="sm" variant="outline"
                                    onClick={handleCancelEditPurchase}
                                    className="h-9 rounded-lg"
                                    data-testid={`cancel-invoice-edit-${p.id}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={p.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} group hover:bg-red-50 transition-colors`}>
                          <td className="p-3 text-sm text-center text-gray-600">1</td>
                          <td className="p-3 text-sm font-medium">{p.item_name}</td>
                          <td className="p-3 text-sm text-right">
                            ${(p.price + (p.commission || 0)).toFixed(2)}
                          </td>
                          <td className="p-3 text-sm text-gray-600">{p.store}</td>
                          <td className="p-3 text-sm text-right">—</td>
                          <td className="p-3 text-sm text-right font-bold">
                            ${(p.price + (p.commission || 0)).toFixed(2)}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center gap-1 justify-center">
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 hover:bg-blue-100 hover:text-blue-600 transition-all"
                                  onClick={(e) => handleStartEditPurchase(p, e)}
                                  disabled={loading}
                                  title="Editar artículo (aplica también en LIVE)"
                                  data-testid={`edit-invoice-purchase-btn-${p.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                              {currentInvoice.purchases.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 transition-all"
                                  onClick={() => handleRemoveItem(p.id)}
                                  disabled={loading}
                                  title="Quitar de la factura"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary stats below table */}
              {(() => {
                const shippingCost = currentInvoice.shipment?.shipping_cost || currentInvoice.shipping_cost || 0;
                const weightPounds = currentInvoice.shipment?.weight_pounds || currentInvoice.weight_pounds || 0;
                const totalArticulos = currentInvoice.purchases?.length || 0;
                const totalEtiqueta = currentInvoice.subtotal || 0;
                const totalCommission = currentInvoice.total_commission || 0;
                const displaySubtotal = totalEtiqueta + totalCommission;
                const taxes = currentInvoice.total_tax || 0;
                const saldoPend = parseFloat(editSaldoPendiente) || 0;
                const lateFee = currentInvoice.late_fee_applied ? (currentInvoice.late_fee_amount || 0) : 0;
                const grandTotal = displaySubtotal + taxes + shippingCost + saldoPend + lateFee;
                const appliedDeposits = currentInvoice.applied_deposits || [];
                const depositsApplied = currentInvoice.deposits_applied || 0;
                const saldoAFavorAnterior = currentInvoice.saldo_a_favor_anterior || 0;
                const totalCredits = depositsApplied + saldoAFavorAnterior;
                const totalAPagar = Math.max(0, grandTotal - totalCredits);
                const saldoAFavorResult = totalCredits > grandTotal ? round2(totalCredits - grandTotal) : 0;
                function round2(v) { return Math.round(v * 100) / 100; }

                return (
                  <>
                    {/* Artículos / Etiqueta / Peso row */}
                    <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-gray-50 border" data-testid="invoice-summary-stats">
                      <div className="text-center">
                        <p className="text-xs text-gray-500 font-semibold">Total de artículos</p>
                        <p className="font-bold text-lg" style={{ color: '#1E3A5F' }}>{totalArticulos}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500 font-semibold">Total Etiqueta</p>
                        <p className="font-bold text-lg" style={{ color: '#1E3A5F' }}>${totalEtiqueta.toFixed(2)}</p>
                      </div>
                      <div className="text-center">
                        {(() => {
                          const s = currentInvoice.shipment;
                          const mode = s?.shipping_mode;
                          const qty = s?.package_count;
                          const isPounds = mode === "pounds";
                          let label, value;
                          if (isPounds) { label = "Libras"; value = `${Number(qty || 0).toFixed(1)} lb`; }
                          else if (mode === "packages" || (qty && qty > 0)) { label = "Paquetes"; value = `${qty || 0}`; }
                          else { label = "Peso en Libras"; value = `${weightPounds} lbs`; }
                          return (
                            <>
                              <p className="text-xs text-gray-500 font-semibold">{label}</p>
                              <p className="font-bold text-lg" style={{ color: '#1E3A5F' }}>{value}</p>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="flex justify-end">
                      <div className="w-80 p-4 rounded-xl bg-gray-50 space-y-2" data-testid="invoice-financial-summary">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium">${displaySubtotal.toFixed(2)}</span>
                        </div>
                        {taxes > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Taxes:</span>
                            <span className="font-medium">${taxes.toFixed(2)}</span>
                          </div>
                        )}
                        {shippingCost > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600 flex items-center gap-1">
                              <Package className="h-3 w-3" />
                              Envio:
                            </span>
                            <span className="font-medium text-purple-600">${shippingCost.toFixed(2)}</span>
                          </div>
                        )}
                        {/* Saldo Pendiente - editable */}
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-orange-600 font-medium">Saldo Pendiente:</span>
                          <div className="flex items-center gap-1">
                            <span className="text-orange-600">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={editSaldoPendiente}
                              onChange={(e) => setEditSaldoPendiente(e.target.value)}
                              onBlur={handleSaveSaldoPendiente}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveSaldoPendiente()}
                              className="h-7 w-24 text-right text-sm font-bold text-orange-700 rounded px-2"
                              data-testid="view-saldo-pendiente-input"
                              onWheel={(e) => e.target.blur()}
                            />
                          </div>
                        </div>
                        {/* Late Fee / Recargo por Mora */}
                        {currentInvoice.late_fee_applied && currentInvoice.late_fee_amount > 0 && (
                          <div className="flex justify-between text-sm bg-amber-50 -mx-4 px-4 py-1.5 border-y border-amber-200">
                            <span className="text-amber-700 font-medium flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {currentInvoice.late_fee_description || 'Recargo por mora'}:
                            </span>
                            <span className="font-bold text-amber-700">${currentInvoice.late_fee_amount.toFixed(2)}</span>
                          </div>
                        )}
                        {/* Divider before Total */}
                        <div className="border-t border-gray-300 pt-2 mt-2">
                          <div className="flex justify-between">
                            <span className="font-bold text-gray-800">Total:</span>
                            <span className="font-bold text-xl" style={{ color: '#1E3A5F' }}>
                              ${grandTotal.toFixed(2)}
                            </span>
                          </div>
                        </div>
                        {/* Abonos assigned to THIS invoice */}
                        {appliedDeposits.length > 0 && (
                          <div className="space-y-1 pt-1">
                            {appliedDeposits.map((dep, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span className="text-green-700">Abono {idx + 1}:</span>
                                <span className="font-medium text-green-700">-${dep.amount_applied.toFixed(2)}</span>
                              </div>
                            ))}
                            {appliedDeposits.length > 1 && (
                              <div className="flex justify-between text-sm border-t border-green-200 pt-1 mt-1">
                                <span className="font-bold text-green-800">Total Abonos:</span>
                                <span className="font-bold text-green-800">-${depositsApplied.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {/* Saldo a favor from previous invoice */}
                        {saldoAFavorAnterior > 0 && (
                          <div className="flex justify-between text-sm pt-1">
                            <span className="text-blue-700">Saldo a Favor (anterior):</span>
                            <span className="font-medium text-blue-700">-${saldoAFavorAnterior.toFixed(2)}</span>
                          </div>
                        )}
                        {/* Total a pagar */}
                        <div className="border-t-2 border-gray-400 pt-2 mt-2">
                          <div className="flex justify-between">
                            <span className="font-extrabold text-gray-900">Total a pagar:</span>
                            <span className="font-extrabold text-2xl" style={{ color: totalAPagar > 0 ? '#DC2626' : '#16A34A' }}>
                              ${totalAPagar.toFixed(2)}
                            </span>
                          </div>
                        </div>
                        {saldoAFavorResult > 0 && (
                          <div className="mt-2 p-2 rounded-lg bg-green-100 border border-green-300 text-center">
                            <p className="text-sm font-bold text-green-800">
                              Saldo a favor para próxima factura: ${saldoAFavorResult.toFixed(2)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Shipment Creation Prompt - Show when invoice has no shipment */}
              {currentInvoice.status !== "approved" && !currentInvoice.shipment && (
                <div className="p-4 rounded-xl bg-purple-50 border-2 border-purple-300 space-y-3">
                  <div className="flex items-start gap-3">
                    <Package className="h-6 w-6 text-purple-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-purple-800">¿Crear envío para esta factura?</p>
                      <p className="text-sm text-purple-700 mt-1">
                        El envío incluirá los {currentInvoice.purchases?.length || 0} productos de esta factura.
                        El costo del envío se agregará al total final.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleGoToCreateShipment}
                    className="w-full h-10 rounded-xl bg-purple-600 hover:bg-purple-700"
                  >
                    <Package className="h-4 w-4 mr-2" />
                    Crear Envío para esta Factura
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}

              {/* Pending alert with shipping note */}
              {currentInvoice.status !== "approved" && (
                <div className="p-4 rounded-xl bg-yellow-50 border-2 border-yellow-200">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-6 w-6 text-yellow-600" />
                    <div className="flex-1">
                      <p className="font-semibold text-yellow-800">Factura Pendiente de Pago</p>
                      <p className="text-sm text-yellow-700">Puedes quitar artículos pasando el mouse sobre ellos. Aprueba cuando esté lista.</p>
                    </div>
                  </div>
                  {/* Note about shipping cost */}
                  {!currentInvoice.shipment && !currentInvoice.shipping_cost && (
                    <div className="mt-3 p-2 rounded-lg bg-yellow-100/50 flex items-start gap-2">
                      <Info className="h-4 w-4 text-yellow-700 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-yellow-700">
                        <strong>Nota:</strong> Aún falta agregar el valor del envío. El costo de envío se mostrará una vez que crees el envío para esta factura.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Approved - can reopen */}
              {currentInvoice.status === "approved" && (
                <div className="p-4 rounded-xl bg-blue-50 border-2 border-blue-200 flex items-center gap-3">
                  <Edit className="h-6 w-6 text-blue-600" />
                  <div className="flex-1">
                    <p className="font-semibold text-blue-800">Factura Pagada</p>
                    <p className="text-sm text-blue-700">Puedes reabrir la factura si necesitas modificarla o quitar artículos</p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  onClick={generatePDF}
                  variant="outline"
                  disabled={generatingPDF}
                  className="flex-1 h-12 rounded-xl"
                >
                  {generatingPDF ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Generando...
                    </>
                  ) : (
                    <>
                      <Download className="h-5 w-5 mr-2" />
                      Descargar PDF
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleAuditInvoice}
                  disabled={auditing}
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                  title="Auditar depósitos aplicados"
                  data-testid="audit-invoice-btn"
                >
                  {auditing ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" />
                  )}
                </Button>
                <Button
                  onClick={() => setDiagnosticDialogOpen(true)}
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 rounded-xl border border-amber-200 text-amber-700 hover:bg-amber-50"
                  title="Diagnóstico completo de la factura (timeline + cadena de saldos)"
                  data-testid="diagnose-invoice-btn"
                >
                  <Stethoscope className="h-5 w-5" />
                </Button>
                {currentInvoice.status === "approved" ? (
                  <Button
                    onClick={handleReopenInvoice}
                    disabled={loading}
                    variant="outline"
                    className="flex-1 h-12 rounded-xl border-orange-300 text-orange-600 hover:bg-orange-50"
                  >
                    <RefreshCw className="h-5 w-5 mr-2" />
                    {loading ? "Reabriendo..." : "Reabrir Factura"}
                  </Button>
                ) : (
                  <Button
                    onClick={handleApproveInvoice}
                    disabled={loading}
                    className="flex-1 h-12 rounded-xl"
                    style={{ background: '#2ECC71' }}
                  >
                    <CheckCircle className="h-5 w-5 mr-2" />
                    {loading ? "Aprobando..." : "Aprobar Factura"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* HISTORY MODE */}
          {viewMode === "history" && (
            <div className="space-y-3">
              {invoices.length === 0 ? (
                <div className="text-center py-12">
                  <History className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-600">Sin facturas</p>
                  <p className="text-sm text-gray-400 mt-2">Aún no se han creado facturas para este cliente</p>
                </div>
              ) : (
                invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className={`p-4 rounded-xl border transition-all ${inv.is_annulled ? 'bg-red-50/30 border-red-100 hover:border-red-300 cursor-pointer' : 'hover:border-blue-300 hover:shadow-md cursor-pointer'}`}
                    onClick={() => handleViewInvoice(inv)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: inv.is_annulled ? 'rgba(220,38,38,0.1)' : 'rgba(30,58,95,0.1)' }}>
                          <FileText className="h-6 w-6" style={{ color: inv.is_annulled ? '#DC2626' : '#1E3A5F' }} />
                        </div>
                        <div>
                          <p className={`font-bold ${inv.is_annulled ? 'text-red-400 line-through' : ''}`} style={{ color: inv.is_annulled ? undefined : '#1E3A5F' }}>{inv.invoice_number}</p>
                          <p className="text-sm text-gray-500">
                            {new Date(inv.created_at).toLocaleDateString("es-ES")} · {inv.purchase_ids?.length || 0} items
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className={`font-extrabold text-xl ${inv.is_annulled ? 'line-through text-red-400' : ''}`} style={{ color: inv.is_annulled ? undefined : '#1E3A5F' }}>
                            ${((inv.total || 0) + (inv.saldo_pendiente || 0) + (inv.shipping_cost || 0)).toFixed(2)}
                          </p>
                          {(inv.deposits_applied || 0) > 0 && !inv.is_annulled && (
                            <p className="text-xs text-green-600">Abonos: -${(inv.deposits_applied || 0).toFixed(2)}</p>
                          )}
                          {(inv.saldo_a_favor_anterior || 0) > 0 && !inv.is_annulled && (
                            <p className="text-xs text-blue-600">Saldo ant: -${(inv.saldo_a_favor_anterior || 0).toFixed(2)}</p>
                          )}
                          {(inv.total_a_pagar != null && inv.total_a_pagar > 0 && !inv.is_annulled) && (
                            <p className="text-xs font-bold text-red-600">A pagar: ${inv.total_a_pagar.toFixed(2)}</p>
                          )}
                          {(inv.saldo_a_favor || 0) > 0 && !inv.is_annulled && (
                            <p className="text-xs font-bold text-green-700">A favor: +${inv.saldo_a_favor.toFixed(2)}</p>
                          )}
                          {inv.is_annulled ? (
                            <Badge className="bg-red-100 text-red-700">Anulada</Badge>
                          ) : (
                            <Badge className={inv.status === "approved" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                              {inv.status === "approved" ? (
                                <><CheckCircle className="h-3 w-3 mr-1" /> Pagada</>
                              ) : (
                                <><Clock className="h-3 w-3 mr-1" /> Pendiente</>
                              )}
                            </Badge>
                          )}
                        </div>
                        {!inv.is_annulled && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                            onClick={(e) => openAnnulDialog(inv.id, e)}
                            title="Eliminar factura"
                            data-testid={`annul-invoice-${inv.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </ScrollArea>

        {/* Annul Invoice Confirmation Dialog */}
        <Dialog open={annulDialogOpen} onOpenChange={(open) => { setAnnulDialogOpen(open); if (!open) { setAnnulPassword(""); setAnnulPreview(null); } }}>
          <DialogContent className="max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                Eliminar Factura {annulPreview?.invoice?.invoice_number ? `· ${annulPreview.invoice.invoice_number}` : ""}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-600">
              Esta acción anulará la factura, liberará las compras y los abonos asignados.
            </p>

            {/* Impact preview */}
            {annulPreview && (
              <div className="space-y-2 mt-2">
                {/* Invoice summary */}
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs">
                  <p className="font-bold text-red-900 mb-1">Factura a anular</p>
                  <div className="grid grid-cols-2 gap-1 text-red-800">
                    <span>Total: <b>${(annulPreview.invoice.total || 0).toFixed(2)}</b></span>
                    <span>Total a pagar: <b>${(annulPreview.invoice.total_a_pagar || 0).toFixed(2)}</b></span>
                    <span>Compras: {annulPreview.counts.purchases}</span>
                    <span>Abonos aplicados: {annulPreview.counts.deposits_freed} (${(annulPreview.invoice.deposits_applied || 0).toFixed(2)})</span>
                  </div>
                </div>

                {/* Linked shipment */}
                {annulPreview.shipment ? (
                  <div className="rounded-xl bg-amber-50 border-2 border-amber-300 p-3" data-testid="annul-shipment-warning">
                    <p className="font-bold text-amber-900 mb-1 flex items-center gap-1 text-sm">
                      <Package className="h-4 w-4" /> Envío vinculado detectado
                    </p>
                    <div className="text-xs text-amber-900 space-y-0.5 mt-1">
                      <div><b>Categoría:</b> {annulPreview.shipment.shipping_category || "—"}</div>
                      <div><b>Paquetes/libras:</b> {annulPreview.shipment.package_count || 0} {annulPreview.shipment.shipping_mode === "pounds" ? "lb" : "paq."}</div>
                      <div><b>Costo de envío:</b> ${(annulPreview.shipment.shipping_cost || 0).toFixed(2)}</div>
                      <div><b>Estado:</b> {annulPreview.shipment.status || "preparing"}</div>
                      {annulPreview.shipment.created_at && (
                        <div><b>Creado:</b> {new Date(annulPreview.shipment.created_at).toLocaleString("es-ES")}</div>
                      )}
                      {annulPreview.shipment.created_by_name && (
                        <div><b>Creado por:</b> {annulPreview.shipment.created_by_name}</div>
                      )}
                      {Array.isArray(annulPreview.shipment.tracking_numbers) && annulPreview.shipment.tracking_numbers.length > 0 && (
                        <div><b>Guías:</b> {annulPreview.shipment.tracking_numbers.join(", ")}</div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer select-none bg-white rounded p-2 border border-amber-200">
                      <input
                        type="checkbox"
                        checked={deleteShipmentFlag}
                        onChange={(e) => setDeleteShipmentFlag(e.target.checked)}
                        className="w-4 h-4 accent-red-600"
                        data-testid="delete-shipment-checkbox"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        {deleteShipmentFlag
                          ? "Eliminar también el envío (recomendado)"
                          : "Solo desvincular el envío (se conserva como histórico sin factura)"}
                      </span>
                    </label>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-600">
                    Sin envío vinculado a esta factura.
                  </div>
                )}

                {/* Purchases list */}
                {annulPreview.purchases.length > 0 && (
                  <details className="rounded-xl border border-slate-200 p-2 text-xs">
                    <summary className="cursor-pointer font-bold text-slate-700">
                      {annulPreview.purchases.length} compras volverán a "pendiente" ▾
                    </summary>
                    <div className="mt-2 max-h-32 overflow-y-auto space-y-0.5 pl-2">
                      {annulPreview.purchases.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                          <span className="truncate">{p.store || "—"} · {p.item_name}</span>
                          <span className="font-bold flex-shrink-0">${(p.total || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            <div className="space-y-4 py-2 mt-2">
              <div>
                <p className="text-[11px] font-bold text-slate-700 mb-1">Ingresa tu contraseña para confirmar</p>
                <Input
                  type="password"
                  placeholder="Contraseña del administrador..."
                  value={annulPassword}
                  onChange={(e) => setAnnulPassword(e.target.value)}
                  className="h-11 rounded-xl"
                  data-testid="annul-password-input"
                  onKeyDown={(e) => e.key === 'Enter' && handleAnnulInvoice()}
                />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setAnnulDialogOpen(false)} className="flex-1 h-11 rounded-xl">
                  Cancelar
                </Button>
                <Button
                  onClick={handleAnnulInvoice}
                  disabled={annulling || !annulPassword}
                  className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                  data-testid="confirm-annul-btn"
                >
                  {annulling ? "Eliminando..." : (annulPreview?.shipment && deleteShipmentFlag ? "Eliminar factura + envío" : "Eliminar factura")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Audit Result Dialog */}
        <InvoiceDiagnosticDialog
          invoiceId={currentInvoice?.id}
          open={diagnosticDialogOpen}
          onOpenChange={setDiagnosticDialogOpen}
        />

        {/* Add more items to this invoice */}
        <Dialog open={addItemsDialogOpen} onOpenChange={setAddItemsDialogOpen}>
          <DialogContent className="rounded-2xl max-w-2xl w-[95vw] max-h-[85vh] overflow-y-auto" data-testid="add-items-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Plus className="h-5 w-5 text-emerald-600" />
                Agregar productos a factura {currentInvoice?.invoice_number || ""}
              </DialogTitle>
            </DialogHeader>

            {addItemsLoading ? (
              <div className="text-center py-8 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin text-emerald-600" />
                Cargando compras pendientes…
              </div>
            ) : addItemsAvailable.length === 0 ? (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-6 text-center text-sm text-slate-600">
                No hay compras pendientes disponibles para este cliente.
              </div>
            ) : (
              <>
                <div className="text-[11px] text-slate-500 mb-2">
                  Selecciona las compras del mismo cliente que quieras añadir a esta factura.
                </div>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {addItemsAvailable.map((p) => {
                    const checked = addItemsSelected.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer ${checked ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                        data-testid={`add-item-${p.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAddItemSelected(p.id)}
                          className="w-4 h-4 accent-emerald-600 flex-shrink-0"
                        />
                        <span className="font-mono text-[10px] text-slate-400 w-12 flex-shrink-0">{p.id.slice(0, 6)}</span>
                        <span className="font-bold text-slate-800 w-16 flex-shrink-0 truncate">{p.store || "—"}</span>
                        <span className="text-slate-600 truncate flex-1">{p.item_name || "—"}</span>
                        <span className="text-[10px] text-slate-400 w-20 text-right flex-shrink-0">
                          {p.created_at ? new Date(p.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : ""}
                        </span>
                        <span className="font-extrabold text-emerald-700 w-16 text-right flex-shrink-0">${(p.total || 0).toFixed(2)}</span>
                      </label>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between mt-3 text-xs">
                  <span className="text-slate-600">
                    {addItemsSelected.size} de {addItemsAvailable.length} seleccionadas · total: <b>${Array.from(addItemsSelected).reduce((sum, pid) => sum + ((addItemsAvailable.find((x) => x.id === pid) || {}).total || 0), 0).toFixed(2)}</b>
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setAddItemsSelected(new Set(addItemsAvailable.map((p) => p.id)))}
                    >
                      Seleccionar todo
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setAddItemsSelected(new Set())}
                    >
                      Limpiar
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-10 rounded-xl"
                    onClick={() => setAddItemsDialogOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={handleAddItemsToInvoice}
                    disabled={addItemsSelected.size === 0 || addItemsSaving}
                    className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    data-testid="confirm-add-items-btn"
                  >
                    {addItemsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Agregar ${addItemsSelected.size} compra${addItemsSelected.size === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={auditDialogOpen} onOpenChange={setAuditDialogOpen}>
          <DialogContent className="rounded-2xl max-w-md w-[95vw]" data-testid="audit-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className={`h-5 w-5 ${auditResult?.needs_recalc ? 'text-amber-600' : 'text-green-600'}`} />
                Auditoría de Factura
              </DialogTitle>
            </DialogHeader>
            {auditResult ? (
              <div className="space-y-3 pt-2 text-sm">
                {/* Always-on quick action: recompute totals/sums for THIS invoice
                    using the live purchases and then propagate to the client chain. */}
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-blue-700 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-blue-900">Recalcular factura</p>
                    <p className="text-xs text-blue-800/80">Suma de nuevo los productos actuales y corrige Subtotal, Taxes, Comisiones, Total y los saldos del cliente.</p>
                  </div>
                  <Button
                    onClick={handleRecalcInvoice}
                    disabled={recalcing}
                    size="sm"
                    className="h-9 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="audit-recalc-invoice-btn"
                  >
                    {recalcing ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />Recalculando…</>) : (<>Recalcular</>)}
                  </Button>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-slate-500">Almacenado</p>
                    <p className="text-base font-extrabold text-slate-800">${(auditResult.deposits_applied_stored || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-slate-500">Válido (real)</p>
                    <p className={`text-base font-extrabold ${auditResult.needs_recalc ? 'text-amber-700' : 'text-green-700'}`}>
                      ${(auditResult.valid_deposits_amount || 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Customer-wide audit */}
                {auditResult.customer_audit && auditResult.customer_audit.customer_id && (
                  <div className={`rounded-xl border p-3 ${auditResult.customer_audit.needs_recalc ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`} data-testid="audit-customer-summary">
                    <p className="text-[10px] uppercase font-bold text-slate-700 mb-2">Auditoría del cliente</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-slate-500">Recargas aprobadas</p>
                        <p className="font-extrabold text-slate-800">
                          {auditResult.customer_audit.approved_count} · ${(auditResult.customer_audit.approved_total || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Asignadas a facturas</p>
                        <p className={`font-extrabold ${auditResult.customer_audit.needs_recalc ? 'text-amber-700' : 'text-green-700'}`}>
                          {auditResult.customer_audit.assigned_count} · ${(auditResult.customer_audit.assigned_total || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {auditResult.customer_audit.duplicates.length > 0 && (
                      <p className="mt-2 text-xs text-amber-800">
                        ⚠️ {auditResult.customer_audit.duplicates.length} abono(s) duplicado(s) entre facturas
                      </p>
                    )}
                    {auditResult.customer_audit.orphans.length > 0 && (
                      <p className="mt-1 text-xs text-amber-800">
                        ⚠️ {auditResult.customer_audit.orphans.length} recarga(s) aprobada(s) sin asignar a ninguna factura
                      </p>
                    )}
                    {auditResult.customer_audit.stale_assigned_ids.length > 0 && (
                      <p className="mt-1 text-xs text-amber-800">
                        ⚠️ {auditResult.customer_audit.stale_assigned_ids.length} abono(s) referencian recargas no aprobadas
                      </p>
                    )}
                  </div>
                )}

                {(auditResult.needs_recalc || auditResult.customer_audit?.needs_recalc) ? (
                  <>
                    {auditResult.issues && auditResult.issues.length > 0 && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900">
                        <p className="font-bold text-sm">{auditResult.issues.length} inconsistencia(s) en esta factura</p>
                        <ul className="text-xs mt-2 space-y-1 list-disc pl-4">
                          {auditResult.issues.slice(0, 6).map((iss, idx) => {
                            const labels = {
                              tx_not_found: "Transacción no existe",
                              tx_deleted: "Recarga eliminada",
                              tx_not_approved: "No aprobada",
                              amount_mismatch: "Monto diferente",
                              missing_id: "Sin ID de depósito",
                            };
                            return (
                              <li key={idx} data-testid="audit-issue">
                                {labels[iss.type] || iss.type}
                                {iss.amount != null ? ` — $${Number(iss.amount).toFixed(2)}` : ''}
                                {iss.tx_status ? ` (${iss.tx_status})` : ''}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    <Button
                      onClick={handleRecalcInvoice}
                      disabled={recalcing}
                      className="w-full h-11 rounded-xl font-bold"
                      style={{ background: '#1E3A5F', color: 'white' }}
                      data-testid="audit-recalc-btn"
                    >
                      {recalcing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Recalculando...</>) : (<><RefreshCw className="h-4 w-4 mr-2" />Recalcular cadena del cliente</>)}
                    </Button>
                  </>
                ) : (
                  <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-900 text-sm font-semibold flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    Todo en orden — no se detectaron inconsistencias.
                  </div>
                )}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
