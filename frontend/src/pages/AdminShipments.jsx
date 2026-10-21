import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/App";
import { 
  getAllShipments, 
  updateShipmentStatus, 
  updateTracking,
  getAllClients,
  getPendingShipmentPurchases,
  createShipment,
  uploadShipmentAttachment,
  updateShipment,
  deleteShipment,
  getMyTenant,
  getClientInvoicesForShipment,
  createUploadSession,
  getUploadSession,
  attachSessionFilesToShipment,
  diagnoseShipments,
  toggleShipmentSent,
  getShippingCategoriesAdmin,
  getInvoicesWithoutShipment,
} from "@/lib/api";
import { generateCourierManifestPDF } from "@/lib/courierManifestPDF";
import { getShipmentParts, formatShipmentParts } from "@/lib/shipmentPackages";
import { toast } from "sonner";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import TrackingDialog from "@/components/TrackingDialog";
import ShipmentEditDialog from "@/components/ShipmentEditDialog";
import { 
  ArrowLeft, 
  Truck, 
  Package, 
  CheckCircle, 
  Clock, 
  Plus,
  MapPin,
  Phone,
  Navigation,
  Search,
  Paperclip,
  X,
  Image as ImageIcon,
  Trash2,
  FileText,
  AlertCircle,
  DollarSign,
  ChevronDown,
  Smartphone,
  RefreshCw,
  Stethoscope,
  FileDown
} from "lucide-react";
import QRCode from "qrcode";
import axios from "axios";

const LOGO_URL_DEFAULT = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminShipments() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || LOGO_URL_DEFAULT;
  
  // Check if coming from invoice
  const fromInvoice = searchParams.get('from_invoice') === 'true';
  const [invoiceData, setInvoiceData] = useState(null);
  
  // Check permissions for employees
  const permissions = user?.permissions || {};
  const isAdmin = user?.role === "admin";
  const hasPermission = isAdmin || permissions.manage_shipments === true;
  
  const [shipments, setShipments] = useState([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  // Default week filter = current week (Thursday 00:00 → Wednesday 23:59).
  // Shipments close Wednesday 23:59 and new week opens Thursday 00:00.
  const getCurrentWeekKey = () => {
    const d = new Date();
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
  // Week key for an arbitrary date (used by the courier PDF export and filters).
  const getWeekKey = (dateStr) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const jsDay = local.getDay();
    const daysSinceThursday = (jsDay - 4 + 7) % 7;
    local.setDate(local.getDate() - daysSinceThursday);
    const y = local.getFullYear();
    const m = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  // Human label for the week that contains `dateStr`
  const getWeekLabel = (dateStr) => {
    const key = getWeekKey(dateStr);
    if (!key) return "—";
    const [y, m, d] = key.split("-").map(Number);
    const startThursday = new Date(y, m - 1, d);
    const endWednesday = new Date(startThursday);
    endWednesday.setDate(startThursday.getDate() + 6);
    const fmt = (dt) => {
      const dayN = dt.getDate();
      const monthRaw = dt.toLocaleDateString("es-ES", { month: "long" });
      const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
      return `${dayN}-${month}`;
    };
    return `Jueves ${fmt(startThursday)} - Miércoles ${fmt(endWednesday)}`;
  };
  const [weekFilter, setWeekFilter] = useState(() => getCurrentWeekKey());
  // Courier (paquetería) pricing — used to compute "Pago a Empresa Paquetería"
  // live whenever any shipment is toggled as "Enviado".
  const [courierCats, setCourierCats] = useState([]);
  const [tenantShippingMode, setTenantShippingMode] = useState("packages");
  // Bumps each time a checkbox flips → drives the truck-icon flying animation.
  const [courierAnimTick, setCourierAnimTick] = useState(0);
  // Tenant snapshot (logo + name) for PDFs.
  const [tenantInfo, setTenantInfo] = useState({ name: "", logo: null });
  const [diagDialogOpen, setDiagDialogOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagData, setDiagData] = useState(null);

  // Run a deep diagnostic for the active week (currently selected weekFilter).
  // Resolves the explicit Monday→Monday range and asks the backend for raw shipment
  // metadata + audit logs so the admin can see the truth from MongoDB.
  const handleRunDiagnostic = async () => {
    setDiagDialogOpen(true);
    setDiagLoading(true);
    setDiagData(null);
    try {
      let startISO; let endISO;
      if (weekFilter === "all") {
        // Use current week as default for diagnostics
        const key = getCurrentWeekKey();
        const [y, m, d] = key.split("-").map(Number);
        const start = new Date(y, m - 1, d, 0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        end.setSeconds(end.getSeconds() - 1);
        startISO = start.toISOString();
        endISO = end.toISOString();
      } else {
        const [y, m, d] = weekFilter.split("-").map(Number);
        const start = new Date(y, m - 1, d, 0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        end.setSeconds(end.getSeconds() - 1);
        startISO = start.toISOString();
        endISO = end.toISOString();
      }
      const res = await diagnoseShipments(startISO, endISO);
      setDiagData({ ...res.data, _range: { startISO, endISO } });
    } catch (e) {
      toast.error("No se pudo ejecutar el diagnóstico");
      setDiagData({ error: e?.response?.data?.detail || e.message });
    } finally {
      setDiagLoading(false);
    }
  };
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [trackingDialogOpen, setTrackingDialogOpen] = useState(null);
  const [trackingNumbers, setTrackingNumbers] = useState([""]);  // Array of tracking numbers
  const [editDialogOpen, setEditDialogOpen] = useState(null);
  const [editForm, setEditForm] = useState({
    shipping_type: "",
    shipping_cost: "",
    weight_pounds: "",
    address: "",
    country: "",
    phone: "",
    additional_info: "",
    tracking_numbers: []
  });
  
  const [pendingShipCount, setPendingShipCount] = useState(null);
  useEffect(() => {
    getInvoicesWithoutShipment().then((r) => setPendingShipCount(r.data?.invoices_count ?? 0)).catch(() => {});
  }, []);

  // Redirect if no permission
  useEffect(() => {
    if (!hasPermission) {
      toast.error("No tienes permiso para acceder a este módulo");
      navigate("/admin");
    }
  }, [hasPermission, navigate]);

  // Load invoice data if coming from invoice
  useEffect(() => {
    if (fromInvoice) {
      const storedData = sessionStorage.getItem('shipmentFromInvoice');
      if (storedData) {
        const parsed = JSON.parse(storedData);
        setInvoiceData(parsed);
        // Auto-open create dialog
        setCreateDialogOpen(true);
        // Clear the stored data
        sessionStorage.removeItem('shipmentFromInvoice');
      }
    }
  }, [fromInvoice]);
  
  // Create shipment form
  const [selectedClient, setSelectedClient] = useState(null);
  const [pendingPurchases, setPendingPurchases] = useState([]);
  const [selectedPurchases, setSelectedPurchases] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  
  // Multiple packages support
  const [packages, setPackages] = useState([
    { id: 1, shipping_category: "", custom_unit_cost: "", package_count: "1" }
  ]);
  
  const [shipmentForm, setShipmentForm] = useState({
    address: "",
    country: "",
    phone: "",
    additional_info: ""
  });

  // New: Invoice selection (required for every shipment)
  const [clientInvoices, setClientInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Tenant settings (includes shipping_categories)
  const [tenantSettings, setTenantSettings] = useState({
    shipment_show_product_list: true,
    shipping_mode: "packages",
    shipping_categories: [
      { key: "G", label: "Categoría G (CON Núcleo Familiar)", value_packages: 32, value_pounds: 32 },
      { key: "A", label: "Categoría A (Personal)", value_packages: 42, value_pounds: 42 },
      { key: "B", label: "Categoría B (SIN Núcleo Familiar)", value_packages: 52, value_pounds: 52 }
    ]
  });

  // Mobile QR upload session
  const [uploadSession, setUploadSession] = useState(null); // {token, url, qr_data_url, expires_at}
  const [remoteFiles, setRemoteFiles] = useState([]); // files uploaded via mobile
  const pollingRef = useRef(null);

  // Filter and sort clients
  const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  const filteredClients = sortedClients.filter(client => 
    client.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    client.customer_id.toLowerCase().includes(clientSearch.toLowerCase())
  );

  useEffect(() => {
    loadData();
  }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadData());

  // Auto-select client when coming from invoice
  useEffect(() => {
    if (invoiceData && clients.length > 0 && createDialogOpen) {
      // Find the client by customer_id
      const client = clients.find(c => c.customer_id === invoiceData.customer_id);
      if (client) {
        setSelectedClient(invoiceData.client || client);
        // Pre-load purchases from the invoice
        if (invoiceData.purchases && invoiceData.purchases.length > 0) {
          setPendingPurchases(invoiceData.purchases);
          setSelectedPurchases(invoiceData.purchases.map(p => p.id));
        }
      }
    }
  }, [invoiceData, clients, createDialogOpen]);

  // Create upload session when dialog opens; clean up when it closes
  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    if (createDialogOpen && !uploadSession) {
      (async () => {
        try {
          const res = await createUploadSession();
          if (cancelled) return;
          const { token, expires_at } = res.data;
          const origin = window.location.origin;
          const mobileUrl = `${origin}/m/upload/${token}`;
          const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
            width: 220, margin: 1, color: { dark: "#0F172A", light: "#FFFFFF" }
          });
          if (cancelled) return;
          setUploadSession({ token, url: mobileUrl, qr_data_url: qrDataUrl, expires_at });
        } catch (err) {
          // non-critical; silent fail (QR just won't show)
          console.error("No se pudo crear la sesión de subida:", err);
        }
      })();
    }
    if (!createDialogOpen) {
      setUploadSession(null);
      setRemoteFiles([]);
      cleanup();
    }
    return cleanup;
  }, [createDialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for files uploaded via mobile
  useEffect(() => {
    if (!uploadSession?.token || !createDialogOpen) return;
    const tick = async () => {
      try {
        const res = await getUploadSession(uploadSession.token);
        const files = res.data.files || [];
        if (files.length !== remoteFiles.length) {
          if (files.length > remoteFiles.length) {
            const diff = files.length - remoteFiles.length;
            toast.success(`${diff} archivo(s) recibido(s) desde el teléfono`);
          }
          setRemoteFiles(files);
        }
      } catch (err) {
        // ignore; session may expire naturally
      }
    };
    pollingRef.current = setInterval(tick, 3000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [uploadSession?.token, createDialogOpen, remoteFiles.length]);

  const loadData = async () => {
    try {
      const [shipmentsRes, clientsRes, tenantRes] = await Promise.all([
        getAllShipments(),
        getAllClients(),
        getMyTenant()
      ]);
      setShipments(shipmentsRes.data);
      setClients(clientsRes.data);
      // Load tenant settings including shipping categories
      const productListSetting = tenantRes.data.shipment_show_product_list;
      const categories = Array.isArray(tenantRes.data.shipping_categories) && tenantRes.data.shipping_categories.length > 0
        ? tenantRes.data.shipping_categories
        : tenantSettings.shipping_categories;
      setTenantSettings({
        shipment_show_product_list: productListSetting !== false,
        shipping_mode: tenantRes.data.shipping_mode === "pounds" ? "pounds" : "packages",
        shipping_categories: categories
      });
      // Snapshot for the live courier-payment widget (independent slice so we
      // don't have to re-derive from tenantSettings everywhere).
      setCourierCats(categories || []);
      setTenantShippingMode(tenantRes.data.shipping_mode === "pounds" ? "pounds" : "packages");
      setTenantInfo({
        name: tenantRes.data.business_name || tenantRes.data.name || "",
        logo: tenantRes.data.logo_url || tenantRes.data.logo || null,
      });
    } catch (error) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const handleClientSelect = async (clientId) => {
    const client = clients.find(c => c.id === clientId);
    setSelectedClient(client);
    setSelectedPurchases([]);
    setSelectedInvoice(null);
    setClientInvoices([]);
    setPendingPurchases([]);

    if (client) {
      try {
        setLoadingInvoices(true);
        const invoicesRes = await getClientInvoicesForShipment(client.customer_id);
        setClientInvoices(invoicesRes.data);
        setShipmentForm(prev => ({
          ...prev,
          country: client.country || prev.country,
          phone: client.whatsapp || prev.phone
        }));
      } catch (error) {
        toast.error("Error al cargar facturas del cliente");
      } finally {
        setLoadingInvoices(false);
      }
    }
  };

  const handleSelectInvoice = (invoice) => {
    setSelectedInvoice(invoice);
    if (invoice?.purchases) {
      setPendingPurchases(invoice.purchases);
      setSelectedPurchases(invoice.purchases.map(p => p.id));
    } else {
      setPendingPurchases([]);
      setSelectedPurchases([]);
    }
  };

  // Package management functions
  const addPackage = () => {
    const newId = Math.max(...packages.map(p => p.id)) + 1;
    setPackages([...packages, { id: newId, shipping_category: "", custom_unit_cost: "", package_count: "1" }]);
  };

  const removePackage = (id) => {
    if (packages.length <= 1) return;
    setPackages(packages.filter(p => p.id !== id));
  };

  const updatePackage = (id, field, value) => {
    setPackages(packages.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const getPackageUnitCost = (pkg) => {
    if (!pkg.shipping_category) return 0;
    if (pkg.shipping_category === "OTHER") {
      return parseFloat(pkg.custom_unit_cost) || 0;
    }
    const cat = tenantSettings.shipping_categories.find(c => c.key === pkg.shipping_category);
    if (!cat) return 0;
    const priceField = tenantSettings.shipping_mode === "pounds" ? "value_pounds" : "value_packages";
    const price = cat[priceField] ?? cat.value ?? 0;
    return parseFloat(price) || 0;
  };

  const getPackageCost = (pkg) => {
    const unit = getPackageUnitCost(pkg);
    const rawQty = parseFloat(pkg.package_count) || 1;
    const qty = tenantSettings.shipping_mode === "pounds"
      ? Math.max(rawQty, 0.01)
      : Math.max(Math.round(rawQty), 1);
    return Math.round(unit * qty * 100) / 100;
  };

  const getTotalShippingCost = () => {
    return packages.reduce((sum, pkg) => sum + getPackageCost(pkg), 0);
  };

  const getTotalPackageCount = () => {
    return packages.reduce((sum, pkg) => {
      const rawQty = parseFloat(pkg.package_count) || 0;
      return sum + (tenantSettings.shipping_mode === "pounds" ? rawQty : Math.round(rawQty));
    }, 0);
  };

  const handleCreateShipment = async () => {
    // Validate
    if (!selectedClient) {
      toast.error("Selecciona un cliente");
      return;
    }
    const invoiceId = selectedInvoice?.id || invoiceData?.invoice_id;
    if (!invoiceId) {
      toast.error("Selecciona una factura para este envío");
      return;
    }
    
    // Validate all packages
    for (const pkg of packages) {
      if (!pkg.shipping_category) {
        toast.error("Selecciona una categoría para todos los paquetes");
        return;
      }
      if (pkg.shipping_category === "OTHER") {
        const v = parseFloat(pkg.custom_unit_cost);
        if (isNaN(v) || v < 0) {
          toast.error("Ingresa un costo personalizado válido para todos los paquetes");
          return;
        }
      }
    }
    
    const totalCost = getTotalShippingCost();
    const totalPackages = getTotalPackageCount();

    // Shipment purchases come from the selected invoice
    const purchasesToSend = (selectedInvoice?.purchases || pendingPurchases).map(p => p.id);
    if (purchasesToSend.length === 0) {
      toast.error("La factura seleccionada no tiene productos");
      return;
    }

    try {
      // Build packages array for backend
      const packagesData = packages.map(pkg => ({
        shipping_category: pkg.shipping_category,
        unit_cost: getPackageUnitCost(pkg),
        package_count: tenantSettings.shipping_mode === "pounds" 
          ? parseFloat(pkg.package_count) || 1
          : Math.max(Math.round(parseFloat(pkg.package_count) || 1), 1),
        cost: getPackageCost(pkg)
      }));
      
      // Use first package category as main category for backward compatibility
      const mainCategory = packages[0]?.shipping_category || "";
      const mainUnitCost = getPackageUnitCost(packages[0]);
      
      const response = await createShipment({
        user_id: selectedClient.id,
        purchase_ids: purchasesToSend,
        shipping_category: mainCategory,
        shipping_unit_cost: mainUnitCost,
        shipping_cost: totalCost,
        package_count: totalPackages,
        packages: packagesData,  // New: array of packages
        address: shipmentForm.address,
        country: shipmentForm.country,
        phone: shipmentForm.phone,
        additional_info: shipmentForm.additional_info,
        invoice_id: invoiceId
      });

      const shipmentId = response.data.shipment_id;

      // Upload attachments if any
      if (attachmentFiles.length > 0) {
        for (const file of attachmentFiles) {
          try {
            await uploadShipmentAttachment(shipmentId, file);
          } catch (err) {
            console.error("Error uploading attachment:", err);
          }
        }
      }

      // Attach files uploaded via QR/mobile session (if any)
      let remoteCount = 0;
      if (uploadSession?.token && remoteFiles.length > 0) {
        try {
          const res = await attachSessionFilesToShipment(shipmentId, uploadSession.token);
          remoteCount = res.data?.attached_count || remoteFiles.length;
        } catch (err) {
          console.error("Error attaching session files:", err);
        }
      }

      const totalAttached = attachmentFiles.length + remoteCount;
      if (totalAttached > 0) {
        toast.success(`Envío creado con ${totalAttached} archivo(s) adjunto(s)`);
      } else {
        toast.success("Envío creado exitosamente");
      }

      setCreateDialogOpen(false);
      setSelectedClient(null);
      setPendingPurchases([]);
      setSelectedPurchases([]);
      setClientSearch("");
      setAttachmentFiles([]);
      setSelectedInvoice(null);
      setClientInvoices([]);
      setPackages([{ id: 1, shipping_category: "", custom_unit_cost: "", package_count: "1" }]);
      setShipmentForm({
        address: "",
        country: "",
        phone: "",
        additional_info: ""
      });
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al crear envío");
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    setAttachmentFiles([...attachmentFiles, ...files]);
  };

  const removeAttachment = (index) => {
    setAttachmentFiles(attachmentFiles.filter((_, i) => i !== index));
  };

  const handleUpdateStatus = async (shipmentId, newStatus) => {
    try {
      await updateShipmentStatus(shipmentId, newStatus);
      toast.success(`Estado actualizado a: ${getStatusLabel(newStatus)}`);
      loadData();
    } catch (error) {
      toast.error("Error al actualizar estado");
    }
  };

  // Toggle the manual "marked_sent" flag. Optimistic UI: flip locally and
  // revert if the server rejects the change. Drives the "Pago a Empresa
  // Paquetería" KPI on the admin dashboard.
  const handleToggleSent = async (shipment) => {
    const next = !shipment.marked_sent;
    setShipments(prev => prev.map(s => s.id === shipment.id ? { ...s, marked_sent: next } : s));
    // Bump the animation tick so the courier truck icon does its fly-through
    // motion every time the user flips a checkbox — keeps the UI responsive.
    setCourierAnimTick(t => t + 1);
    try {
      await toggleShipmentSent(shipment.id, next);
      toast.success(next ? "Marcado como enviado" : "Marca removida");
    } catch (error) {
      setShipments(prev => prev.map(s => s.id === shipment.id ? { ...s, marked_sent: !next } : s));
      toast.error(error.response?.data?.detail || "Error al actualizar");
    }
  };

  // Build & download the courier manifest PDF for the currently active
  // week filter. Includes ALL shipments of that week regardless of status
  // (preparando, en tránsito, entregado, enviado). Total matches the widget.
  const handleExportCourierManifest = async () => {
    const filtered = (weekFilter === "all"
      ? shipments
      : shipments.filter(s => getWeekKey(s.created_at) === weekFilter)
    );

    if (filtered.length === 0) {
      toast.error("No hay envíos en el período seleccionado");
      return;
    }
    const periodLabel = (() => {
      if (weekFilter === "all") return "Todas las semanas";
      // Derive the label from a shipment in the selected week (filtered is
      // guaranteed non-empty here) — avoids the render-only `weekList`.
      return `Semana ${getWeekLabel(filtered[0].created_at)}`;
    })();
    try {
      await generateCourierManifestPDF({
        tenantName: tenantInfo.name,
        tenantLogo: tenantInfo.logo,
        periodLabel,
        shipments: filtered,
        categories: courierCats,
        tenantMode: tenantShippingMode,
      });
      toast.success("Manifiesto PDF generado");
    } catch (e) {
      console.error("PDF manifest error:", e);
      toast.error(`Error al generar PDF: ${e?.message || e}`);
    }
  };

  const handleUpdateTracking = async (shipmentId) => {
    // Filter out empty tracking numbers
    const validTrackings = trackingNumbers.filter(t => t.trim());
    
    if (validTrackings.length === 0) {
      toast.error("Ingresa al menos un número de tracking");
      return;
    }
    
    try {
      await updateTracking(shipmentId, { tracking_numbers: validTrackings });
      toast.success(`${validTrackings.length} tracking(s) guardado(s)`);
      setTrackingDialogOpen(null);
      setTrackingNumbers([""]);
      loadData();
    } catch (error) {
      toast.error("Error al actualizar tracking");
    }
  };

  const handleOpenTrackingDialog = (shipment) => {
    // Load existing tracking numbers or start with one empty field
    const existingTrackings = shipment.tracking_numbers?.length > 0 
      ? shipment.tracking_numbers 
      : (shipment.tracking_number ? [shipment.tracking_number] : [""]);
    setTrackingNumbers(existingTrackings.length > 0 ? existingTrackings : [""]);
    setTrackingDialogOpen(shipment.id);
  };

  const addTrackingField = () => {
    setTrackingNumbers([...trackingNumbers, ""]);
  };

  const removeTrackingField = (index) => {
    if (trackingNumbers.length > 1) {
      setTrackingNumbers(trackingNumbers.filter((_, i) => i !== index));
    }
  };

  const updateTrackingField = (index, value) => {
    const updated = [...trackingNumbers];
    updated[index] = value;
    setTrackingNumbers(updated);
  };

  const handleOpenEditDialog = (shipment) => {
    // Pre-fill the dialog with category-aware fields. We default custom_unit_cost
    // to the existing shipping_unit_cost so manual edits still round-trip.
    setEditForm({
      shipping_type: shipment.shipping_type || "",
      shipping_cost: shipment.shipping_cost?.toString() || "",
      shipping_unit_cost: shipment.shipping_unit_cost?.toString() || "",
      shipping_category: shipment.shipping_category || "",
      package_count: (shipment.package_count ?? "").toString(),
      packages: shipment.packages?.length > 1
        ? shipment.packages.map((p, i) => ({ id: i + 1, shipping_category: p.shipping_category || "", custom_unit_cost: p.shipping_category === "OTHER" ? String(p.unit_cost ?? "") : "", package_count: String(p.package_count ?? 1) }))
        : null,
      weight_pounds: shipment.weight_pounds?.toString() || "",
      address: shipment.address || "",
      country: shipment.country || "",
      phone: shipment.phone || "",
      additional_info: shipment.additional_info || "",
      tracking_numbers: shipment.tracking_numbers?.length > 0
        ? shipment.tracking_numbers
        : (shipment.tracking_number ? [shipment.tracking_number] : [])
    });
    setEditDialogOpen(shipment.id);
  };

  const handleSaveEdit = async (shipmentId) => {
    try {
      const data = {
        shipping_type: editForm.shipping_type || null,
        shipping_cost: parseFloat(editForm.shipping_cost) || 0,
        shipping_unit_cost: editForm.shipping_unit_cost === "" ? null : (parseFloat(editForm.shipping_unit_cost) || 0),
        shipping_category: editForm.shipping_category || null,
        package_count: editForm.package_count === "" ? null : (parseFloat(editForm.package_count) || 0),
        weight_pounds: parseFloat(editForm.weight_pounds) || 0,
        address: editForm.address || null,
        country: editForm.country || null,
        phone: editForm.phone || null,
        additional_info: editForm.additional_info || null,
        tracking_numbers: editForm.tracking_numbers?.filter((t) => t.trim()) || [],
        tracking_number: editForm.tracking_numbers?.[0] || null,
      };
      if (editForm.packages?.length) {
        data.packages = editForm.packages.map((p) => ({
          shipping_category: p.shipping_category,
          package_count: parseFloat(p.package_count) || 0,
          unit_cost: p.shipping_category === "OTHER" ? (parseFloat(p.custom_unit_cost) || 0) : undefined,
        }));
      }
      await updateShipment(shipmentId, data);
      toast.success("Envío actualizado");
      setEditDialogOpen(null);
      loadData();
    } catch (error) {
      toast.error("Error al actualizar envío");
    }
  };

  const handleDeleteShipment = async (shipmentId) => {
    if (!window.confirm("¿Estás seguro de eliminar este envío?")) return;
    try {
      await deleteShipment(shipmentId);
      toast.success("Envío eliminado");
      loadData();
    } catch (error) {
      toast.error("Error al eliminar envío");
    }
  };

  const getStatusLabel = (status) => {
    const labels = {
      preparing: "Preparando",
      in_transit: "En Tránsito",
      delivered: "Entregado"
    };
    return labels[status] || status;
  };

  const getStatusBadge = (status) => {
    const styles = {
      preparing: "bg-yellow-100 text-yellow-800",
      in_transit: "bg-blue-100 text-blue-800",
      delivered: "bg-green-100 text-green-800"
    };
    return (
      <Badge className={`${styles[status]} font-medium`}>
        {getStatusLabel(status)}
      </Badge>
    );
  };

  const filterByStatus = (status) => {
    let filtered = shipments;
    if (weekFilter !== "all") {
      filtered = filtered.filter(s => getWeekKey(s.created_at) === weekFilter);
    }
    if (status !== "all") {
      filtered = filtered.filter(s => s.status === status);
    }
    const code = customerFilter.trim().toUpperCase();
    if (code) {
      filtered = filtered.filter(s => (s.customer_id || "").toUpperCase().includes(code));
    }
    return filtered;
  };

  // Total package count for a given filtered list (respects shipping_mode)
  const sumPackages = (list) => {
    return list.reduce((sum, s) => {
      const qty = Number(s.package_count) || 0;
      return sum + qty;
    }, 0);
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
      <div className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
            <span className="font-bold text-slate-800">Envíos</span>
          </div>
          
          <Dialog open={createDialogOpen} onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) {
              // Clear all state when closing dialog
              setInvoiceData(null);
              setSelectedClient(null);
              setPendingPurchases([]);
              setSelectedPurchases([]);
              setSelectedInvoice(null);
              setClientInvoices([]);
              setClientSearch("");
            }
          }}>
            <DialogTrigger asChild>
              <Button 
                className="font-bold rounded-xl" style={{ background: '#1E3A5F', color: 'white' }}
                data-testid="create-shipment-trigger-hidden"
              >
                <Plus className="h-4 w-4 mr-2" />
                Nuevo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {invoiceData ? "Crear Envío para Factura" : "Crear Nuevo Envío"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                {/* Invoice Info Banner - when coming from invoice */}
                {invoiceData && (
                  <div className="p-4 rounded-xl bg-purple-50 border-2 border-purple-200 space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-purple-600" />
                      <span className="font-semibold text-purple-800">Factura #{invoiceData.invoice_number}</span>
                    </div>
                    <p className="text-sm text-purple-700">
                      Este envío incluirá los <strong>{invoiceData.purchases?.length || 0} productos</strong> de la factura seleccionada.
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge className="bg-purple-100 text-purple-700">
                        Subtotal: ${invoiceData.subtotal?.toFixed(2)}
                      </Badge>
                      <Badge className="bg-purple-100 text-purple-700">
                        Total: ${invoiceData.total?.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="p-2 bg-purple-100 rounded-lg flex items-start gap-2 mt-2">
                      <AlertCircle className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-purple-700">
                        El costo de envío se agregará a la factura final automáticamente.
                      </p>
                    </div>
                  </div>
                )}

                {/* Warning: invoice already has a shipment attached */}
                {invoiceData?.shipment_id && (
                  <div
                    className="p-4 rounded-xl bg-red-50 border-2 border-red-300 flex items-start gap-3"
                    data-testid="invoice-has-shipment-warning"
                    role="alert"
                  >
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="font-bold text-red-800 text-sm">Ya existe un envío en esta factura</p>
                      <p className="text-xs text-red-700 leading-relaxed">
                        La factura #{invoiceData.invoice_number} ya tiene un envío asociado. No puedes crear otro envío para la misma factura.
                      </p>
                      <p className="text-xs text-red-700">
                        Si necesitas modificarlo, edita el envío existente desde el listado o elimínalo primero.
                      </p>
                    </div>
                  </div>
                )}

                {/* Client Select with Search - disabled when coming from invoice */}
                <div>
                  <Label>Cliente</Label>
                  {invoiceData ? (
                    <div className="mt-1 p-3 bg-blue-50 rounded-xl border border-blue-200">
                      <span className="font-bold text-blue-800">#{invoiceData.customer_id}</span>
                      <span className="text-blue-700 ml-2">{invoiceData.client_name}</span>
                    </div>
                  ) : (
                    <Select onValueChange={handleClientSelect}>
                      <SelectTrigger className="h-12 rounded-xl mt-1 text-slate-800" data-testid="select-client">
                        <SelectValue placeholder="Seleccionar cliente" className="text-slate-800" />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        {/* Search Input */}
                        <div className="p-2 border-b sticky top-0 bg-white">
                          <Input
                            placeholder="Buscar cliente..."
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            className="h-10 rounded-lg"
                            data-testid="client-search-input"
                          />
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                          {filteredClients.length === 0 ? (
                            <div className="p-4 text-center text-gray-500 text-sm">
                              No se encontraron clientes
                            </div>
                          ) : (
                            filteredClients.map((client) => (
                              <SelectItem 
                                key={client.id} 
                                value={client.id}
                                className="text-slate-800 cursor-pointer hover:bg-gray-100"
                              >
                                <span className="font-medium text-slate-800">#{client.customer_id}</span>
                                <span className="text-slate-600 ml-2">{client.name}</span>
                              </SelectItem>
                            ))
                          )}
                        </div>
                      </SelectContent>
                    </Select>
                  )}
                  {selectedClient && !invoiceData && (
                    <div className="mt-2 p-2 bg-blue-50 rounded-lg text-sm text-blue-800">
                      Seleccionado: <span className="font-bold">#{selectedClient.customer_id} - {selectedClient.name}</span>
                    </div>
                  )}
                </div>

                {/* Invoice Selection (required) */}
                {selectedClient && !invoiceData && (
                  <div className="space-y-2">
                    <Label>Factura del Cliente *</Label>
                    {loadingInvoices ? (
                      <p className="text-sm text-gray-500">Cargando facturas...</p>
                    ) : clientInvoices.length === 0 ? (
                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center" data-testid="no-invoices-message">
                        <FileText className="h-8 w-8 text-amber-400 mx-auto mb-2" />
                        <p className="text-sm text-amber-800 font-semibold">Este cliente no tiene facturas disponibles</p>
                        <p className="text-xs text-amber-700 mt-1">Crea una factura primero para poder generar un envío.</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto" data-testid="invoice-selector-list">
                        {clientInvoices.map((invoice) => (
                          <div
                            key={invoice.id}
                            onClick={() => handleSelectInvoice(invoice)}
                            className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedInvoice?.id === invoice.id
                                ? "border-purple-500 bg-purple-50"
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                            data-testid={`invoice-option-${invoice.id}`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-purple-700">{invoice.invoice_number}</span>
                                  <Badge className={invoice.status === "approved" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}>
                                    {invoice.status === "approved" ? "Pagada" : "Pendiente"}
                                  </Badge>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  {invoice.purchase_count || invoice.purchase_ids?.length || 0} productos • {new Date(invoice.created_at).toLocaleDateString("es-ES")}
                                </p>
                              </div>
                              <span className="font-bold text-lg" style={{ color: '#1E3A5F' }}>
                                ${invoice.total?.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedInvoice && (
                      <div className="p-3 rounded-xl bg-purple-50 border border-purple-200" data-testid="selected-invoice-info">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4 text-purple-600" />
                          <span className="font-semibold text-purple-800">Factura {selectedInvoice.invoice_number}</span>
                        </div>
                        <p className="text-sm text-purple-700">
                          <strong>{selectedInvoice.purchases?.length || 0}</strong> productos • Total factura: <strong>${selectedInvoice.total?.toFixed(2)}</strong>
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Shipment details — show only after invoice is selected (or passed via invoiceData) */}
                {selectedClient && (selectedInvoice || invoiceData) && (
                  <>
                    {/* Products list (optional view) */}
                    {tenantSettings.shipment_show_product_list && pendingPurchases.length > 0 && (
                      <div>
                        <Label>Productos incluidos ({pendingPurchases.length})</Label>
                        <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                          {pendingPurchases.map((purchase) => (
                            <div key={purchase.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{purchase.item_name}</p>
                                <p className="text-xs text-gray-500">{purchase.store}</p>
                              </div>
                              <span className="font-semibold text-gray-700 shrink-0 ml-2">${(purchase.price || 0).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Multiple Packages Section */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">Paquetes *</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addPackage}
                          className="rounded-xl text-xs gap-1"
                          data-testid="add-package-btn"
                        >
                          <Plus className="h-3 w-3" /> Agregar Paquete
                        </Button>
                      </div>
                      
                      {packages.map((pkg, index) => (
                        <div key={pkg.id} className="border rounded-xl p-3 space-y-3 bg-slate-50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-600">Paquete {index + 1}</span>
                            {packages.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removePackage(pkg.id)}
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3">
                            {/* Category */}
                            <div>
                              <Label className="text-xs">Categoría</Label>
                              <Select
                                value={pkg.shipping_category}
                                onValueChange={(value) => updatePackage(pkg.id, "shipping_category", value)}
                              >
                                <SelectTrigger className="h-10 rounded-lg mt-1" data-testid={`select-category-${pkg.id}`}>
                                  <SelectValue placeholder="Categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                  {tenantSettings.shipping_categories.map((cat) => {
                                    const unit = tenantSettings.shipping_mode === "pounds" ? "lb" : "paq";
                                    const priceField = tenantSettings.shipping_mode === "pounds" ? "value_pounds" : "value_packages";
                                    const price = cat[priceField] ?? cat.value ?? 0;
                                    return (
                                      <SelectItem key={cat.key} value={cat.key}>
                                        {cat.label} — ${Number(price).toFixed(2)}/{unit}
                                      </SelectItem>
                                    );
                                  })}
                                  <SelectItem value="OTHER">Otro</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            
                            {/* Quantity */}
                            <div>
                              <Label className="text-xs">{tenantSettings.shipping_mode === "pounds" ? "Libras" : "Cantidad"}</Label>
                              <Input
                                type="number"
                                inputMode={tenantSettings.shipping_mode === "pounds" ? "decimal" : "numeric"}
                                step={tenantSettings.shipping_mode === "pounds" ? "0.01" : "1"}
                                min={tenantSettings.shipping_mode === "pounds" ? "0.1" : "1"}
                                placeholder="1"
                                value={pkg.package_count}
                                onChange={(e) => updatePackage(pkg.id, "package_count", e.target.value)}
                                onWheel={(e) => e.target.blur()}
                                className="h-10 rounded-lg mt-1"
                              />
                            </div>
                          </div>
                          
                          {/* Custom cost for OTHER */}
                          {pkg.shipping_category === "OTHER" && (
                            <div>
                              <Label className="text-xs">Costo por {tenantSettings.shipping_mode === "pounds" ? "libra" : "paquete"} ($)</Label>
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                placeholder="35.00"
                                value={pkg.custom_unit_cost}
                                onChange={(e) => updatePackage(pkg.id, "custom_unit_cost", e.target.value)}
                                onWheel={(e) => e.target.blur()}
                                className="h-10 rounded-lg mt-1"
                              />
                            </div>
                          )}
                          
                          {/* Package subtotal */}
                          {pkg.shipping_category && (
                            <div className="flex justify-between items-center text-sm bg-white rounded-lg px-3 py-2">
                              <span className="text-slate-500">
                                {parseFloat(pkg.package_count) || 1} × ${getPackageUnitCost(pkg).toFixed(2)}
                              </span>
                              <span className="font-semibold text-slate-700">${getPackageCost(pkg).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Total Cost */}
                    {packages.some(p => p.shipping_category) && (
                      <div className="bg-gradient-to-r from-[#1E3A5F] to-[#2a4a73] rounded-xl p-4 text-white">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm text-white/80">
                              {packages.length} tipo(s) de paquete · {getTotalPackageCount()} {tenantSettings.shipping_mode === "pounds" ? "libra(s)" : "paquete(s)"} total
                            </p>
                            <p className="text-sm font-semibold">Total envío:</p>
                          </div>
                          <span className="text-3xl font-extrabold" data-testid="total-shipment-cost">
                            ${getTotalShippingCost().toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Address - Optional */}
                    <div>
                      <Label className="text-gray-600">Dirección Completa (opcional)</Label>
                      <Textarea
                        placeholder="Calle, número, ciudad..."
                        value={shipmentForm.address}
                        onChange={(e) => setShipmentForm({ ...shipmentForm, address: e.target.value })}
                        className="mt-1 rounded-xl"
                        data-testid="shipment-address"
                      />
                    </div>

                    {/* Country & Phone - Optional */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-gray-600">País (opcional)</Label>
                        <Input
                          placeholder="Ecuador"
                          value={shipmentForm.country}
                          onChange={(e) => setShipmentForm({ ...shipmentForm, country: e.target.value })}
                          className="h-12 rounded-xl mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-gray-600">Teléfono (opcional)</Label>
                        <Input
                          placeholder="+593..."
                          value={shipmentForm.phone}
                          onChange={(e) => setShipmentForm({ ...shipmentForm, phone: e.target.value })}
                          className="h-12 rounded-xl mt-1"
                        />
                      </div>
                    </div>

                    {/* Additional Info */}
                    <div>
                      <Label>Información Adicional (opcional)</Label>
                      <Textarea
                        placeholder="Notas adicionales..."
                        value={shipmentForm.additional_info}
                        onChange={(e) => setShipmentForm({ ...shipmentForm, additional_info: e.target.value })}
                        className="mt-1 rounded-xl"
                      />
                    </div>

                    {/* Attachments */}
                    <div>
                      <Label className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4" />
                        Archivos Adjuntos (opcional)
                      </Label>
                      <p className="text-xs text-gray-500 mb-2">Pruebas de envío, fotos de paquetes, etc.</p>
                      
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center">
                        <input
                          type="file"
                          multiple
                          accept="image/*,video/*,.pdf"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="attachment-input"
                          data-testid="attachment-input"
                        />
                        <label 
                          htmlFor="attachment-input" 
                          className="cursor-pointer flex flex-col items-center"
                        >
                          <ImageIcon className="h-8 w-8 text-gray-400 mb-2" />
                          <span className="text-sm text-gray-600">Click para agregar archivos</span>
                          <span className="text-xs text-gray-400">Imágenes, videos o PDF</span>
                        </label>
                      </div>

                      {/* Preview selected files */}
                      {attachmentFiles.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {attachmentFiles.map((file, index) => (
                            <div key={index} className="flex items-center justify-between bg-gray-100 rounded-lg p-2">
                              <div className="flex items-center gap-2">
                                <ImageIcon className="h-4 w-4 text-gray-500" />
                                <span className="text-sm text-gray-700 truncate max-w-[200px]">{file.name}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeAttachment(index)}
                                className="h-6 w-6 p-0"
                              >
                                <X className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Mobile QR upload */}
                      {uploadSession && (
                        <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/50" data-testid="mobile-upload-qr-block">
                          <div className="flex items-start gap-3">
                            <div className="shrink-0">
                              <img
                                src={uploadSession.qr_data_url}
                                alt="QR code"
                                className="w-28 h-28 rounded-lg border-2 border-white shadow-sm"
                                data-testid="mobile-upload-qr-image"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-blue-900 flex items-center gap-1">
                                <Smartphone className="h-4 w-4" />
                                Subir desde el teléfono
                              </p>
                              <p className="text-xs text-blue-700 mt-1">
                                Escanea el QR con la cámara de tu teléfono para subir fotos o PDFs sin salir de esta pantalla.
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${remoteFiles.length > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                  <RefreshCw className="h-3 w-3 animate-spin-slow" />
                                  {remoteFiles.length > 0 ? `${remoteFiles.length} recibido(s)` : "Esperando..."}
                                </span>
                              </div>
                              {remoteFiles.length > 0 && (
                                <p className="text-xs text-green-700 mt-2">
                                  Los archivos se adjuntarán al envío al crearlo.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={handleCreateShipment}
                      className="w-full h-12 font-bold rounded-xl" style={{ background: '#1E3A5F', color: 'white' }}
                      data-testid="submit-shipment-btn"
                    >
                      <Truck className="h-5 w-5 mr-2" />
                      Crear Envío
                    </Button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Visible actions bar — the top header is hidden by the admin shell,
          so the primary action lives here to stay reachable. */}
      <div className="max-w-4xl mx-auto px-4 pt-4 flex items-center justify-between gap-3">
        <span className="font-bold text-slate-800 text-lg">Envíos</span>
        <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="rounded-xl text-sm gap-2 border-orange-300 text-orange-700 hover:bg-orange-50"
          onClick={() => navigate("/admin/pending-shipments")}
          data-testid="pending-shipments-btn"
        >
          <FileText className="h-4 w-4" />
          <span>Facturas sin Envío</span>
          <span className="rounded-full bg-orange-600 px-1.5 text-xs text-white" data-testid="pending-shipments-count">{pendingShipCount ?? "…"}</span>
        </Button>
        <Button
          className="font-bold rounded-xl"
          style={{ background: '#1E3A5F', color: 'white' }}
          onClick={() => setCreateDialogOpen(true)}
          data-testid="create-shipment-btn"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nuevo
        </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Week Filter */}
        {(() => {
          const weeks = {};
          shipments.forEach(s => {
            const key = getWeekKey(s.created_at);
            if (!weeks[key]) weeks[key] = { label: getWeekLabel(s.created_at), total: 0, count: 0 };
            weeks[key].total += s.shipping_cost || 0;
            weeks[key].count++;
          });
          // Always include the current week so the default filter has a matching option
          const nowIso = new Date().toISOString();
          const currentKey = getWeekKey(nowIso);
          if (!weeks[currentKey]) {
            weeks[currentKey] = { label: getWeekLabel(nowIso), total: 0, count: 0 };
          }
          const weekList = Object.entries(weeks).sort((a, b) => b[0].localeCompare(a[0]));

          const filtered = weekFilter === "all" ? shipments : shipments.filter(s => getWeekKey(s.created_at) === weekFilter);
          const totalShipping = filtered.reduce((sum, s) => sum + (s.shipping_cost || 0), 0);
          const totalPackages = filtered.reduce((sum, s) => sum + (s.package_count || 0), 0);

          // Live courier payment: ALL shipments in the current week filter
          // contribute (not only marked_sent), priced from the tenant's
          // per-category courier costs. When a shipment has no matching
          // category or the category has $0 courier rates, we fall back to
          // its shipping_cost so the total is never $0 while the admin is
          // still configuring rates. The `sentCount` breakdown still shows
          // how many are already dispatched vs pending.
          const catMap = {};
          (courierCats || []).forEach(c => { catMap[String(c.key || "").toUpperCase()] = c; });
          let courierPaymentTotal = 0;
          let sentCount = 0;
          let fallbackUsedCount = 0;
          filtered.forEach(s => {
            // "Enviado" = the shipment already left the warehouse. Either the
            // admin manually flipped the marked_sent checkbox OR the shipment
            // is already in_transit / delivered.
            if (s.marked_sent || s.status === "in_transit" || s.status === "delivered") {
              sentCount += 1;
            }
            const mode = s.shipping_mode || tenantShippingMode || "packages";
            const legacyQty = mode === "pounds" ? Number(s.weight_pounds || 0) : Number(s.package_count || 0);
            const computed = getShipmentParts(s, legacyQty).reduce((acc, part) => {
              const cat = catMap[part.category];
              const rate = cat ? (mode === "pounds" ? Number(cat.courier_cost_pounds || 0) : Number(cat.courier_cost_packages || 0)) : 0;
              return acc + part.qty * rate;
            }, 0);
            if (computed > 0) {
              courierPaymentTotal += computed;
            } else {
              // Fallback to what the shipment actually cost when no courier
              // rate is defined for its category.
              courierPaymentTotal += Number(s.shipping_cost || 0);
              fallbackUsedCount += 1;
            }
          });
          const totalCountedShipments = filtered.length;

          return (
            <>
              {/* ── Live courier payment widget ──
                  Total = Σ (cantidad × tarifa courier) over shipments with
                  marked_sent=true in the active week filter. The truck icon
                  animates on every checkbox toggle via the `courierAnimTick`
                  state, keyed into the element below to restart the CSS keyframe. */}
              <div className="mb-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 via-fuchsia-50 to-purple-50 p-4 shadow-sm" data-testid="courier-payment-widget">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Animated truck — re-mounted each tick so the keyframe restarts */}
                    <div className="relative w-12 h-12 flex items-center justify-center bg-white rounded-xl border-2 border-purple-200 overflow-hidden">
                      <Truck
                        key={courierAnimTick}
                        className="h-6 w-6 text-purple-700 courier-truck-anim"
                        style={{
                          animation: courierAnimTick > 0 ? "courierTruckFly 0.65s cubic-bezier(0.22,1,0.36,1)" : "none",
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-purple-700">
                        Pago a Empresa Paquetería
                      </p>
                      <p
                        key={`val-${courierAnimTick}`}
                        className="text-2xl font-extrabold text-purple-900 leading-tight"
                        style={{ animation: courierAnimTick > 0 ? "courierValuePop 0.4s ease-out" : "none" }}
                        data-testid="courier-payment-total"
                      >
                        ${courierPaymentTotal.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-purple-700/80 mt-0.5">
                        {totalCountedShipments} envío{totalCountedShipments === 1 ? '' : 's'} en la semana
                        {' · '}
                        <span className="text-green-700">{sentCount} enviado{sentCount === 1 ? '' : 's'}</span>
                        {fallbackUsedCount > 0 && (
                          <span className="ml-1 text-amber-700" title="Estos envíos no tienen tarifa courier definida por categoría; se suma su shipping_cost.">
                            · {fallbackUsedCount} sin tarifa courier
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {/* PDF button — available whenever there are shipments in
                      the current week filter, regardless of marked_sent flag. */}
                  {totalCountedShipments > 0 && (
                    <div className="flex items-end gap-3">
                      {courierCats && courierCats.length > 0 && (
                        <div className="text-right" data-testid="courier-prices-legend">
                          <p className="text-[9px] uppercase tracking-wider font-semibold text-purple-600/80 mb-0.5">Tarifas actuales</p>
                          <div className="flex flex-col gap-0.5 items-end">
                            {courierCats.map((p) => (
                              <span key={p.key} className="text-[10px] text-purple-700">
                                <strong>{p.key}:</strong> ${Number(p.courier_cost_packages || 0).toFixed(2)}/pkg · ${Number(p.courier_cost_pounds || 0).toFixed(2)}/lb
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <Button
                        type="button"
                        onClick={handleExportCourierManifest}
                        className="h-9 rounded-lg text-xs gap-1.5 bg-purple-700 hover:bg-purple-800 text-white shadow-sm"
                        data-testid="export-courier-pdf-btn"
                        title="Descargar manifiesto PDF para entregar a la paquetería"
                      >
                        <FileDown className="h-4 w-4" />
                        PDF Paquetería
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {/* Keyframes used by the courier-payment widget. Scoped via a
                  style tag so we don't need to edit the global stylesheet. */}
              <style>{`
                @keyframes courierTruckFly {
                  0%   { transform: translateX(-110%) translateY(0) rotate(-4deg); opacity: 0; }
                  35%  { transform: translateX(-30%)  translateY(-2px) rotate(0deg); opacity: 1; }
                  60%  { transform: translateX(0)     translateY(0); }
                  80%  { transform: translateX(8%)    translateY(0); }
                  100% { transform: translateX(0)     translateY(0); }
                }
                @keyframes courierValuePop {
                  0%   { transform: scale(1); color: rgb(88,28,135); }
                  35%  { transform: scale(1.18); color: rgb(126,34,206); }
                  100% { transform: scale(1); color: rgb(88,28,135); }
                }
              `}</style>
              {/* Total shipping + week selector */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <Card className="rounded-xl flex-1 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-200 rounded-xl flex items-center justify-center">
                        <DollarSign className="h-5 w-5 text-purple-700" />
                      </div>
                      <div>
                        <p className="text-2xl font-extrabold text-purple-800">${totalShipping.toFixed(2)}</p>
                        <p className="text-xs text-purple-600">
                          Envíos ({filtered.length}) · {(() => {
                            const pkgTotal = filtered.filter(s => s.shipping_mode !== "pounds").reduce((sum, s) => sum + (s.package_count || 0), 0);
                            const lbTotal = filtered.filter(s => s.shipping_mode === "pounds").reduce((sum, s) => sum + (s.package_count || 0), 0);
                            const parts = [];
                            if (pkgTotal > 0) parts.push(`${pkgTotal} paquete${pkgTotal === 1 ? '' : 's'}`);
                            if (lbTotal > 0) parts.push(`${lbTotal.toFixed(1)} lb`);
                            return parts.length ? parts.join(' • ') : '0';
                          })()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={weekFilter} onValueChange={setWeekFilter}>
                        <SelectTrigger className="w-48 h-9 rounded-lg text-xs bg-white" data-testid="week-filter">
                          <SelectValue placeholder="Filtrar por semana" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas las semanas</SelectItem>
                          {weekList.map(([key, w]) => (
                            <SelectItem key={key} value={key} className="text-xs">
                              {w.label} ({w.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Status Stats */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                <Card className="rounded-xl">
                  <CardContent className="p-3 text-center">
                    <Clock className="h-5 w-5 text-yellow-600 mx-auto mb-1" />
                    <p className="text-2xl font-extrabold text-slate-800">
                      {filtered.filter(s => s.status === "preparing").length}
                    </p>
                    <p className="text-xs text-gray-500">Preparando</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-3 text-center">
                    <Truck className="h-5 w-5 text-blue-600 mx-auto mb-1" />
                    <p className="text-2xl font-extrabold text-slate-800">
                      {filtered.filter(s => s.status === "in_transit").length}
                    </p>
                    <p className="text-xs text-gray-500">En Transito</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-3 text-center">
                    <CheckCircle className="h-5 w-5 text-green-600 mx-auto mb-1" />
                    <p className="text-2xl font-extrabold text-slate-800">
                      {filtered.filter(s => s.status === "delivered").length}
                    </p>
                    <p className="text-xs text-gray-500">Entregados</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-3 text-center">
                    <Package className="h-5 w-5 text-orange-600 mx-auto mb-1" />
                    {(() => {
                      const pkgTotal = filtered.filter(s => s.shipping_mode !== "pounds").reduce((sum, s) => sum + (s.package_count || 0), 0);
                      const lbTotal = filtered.filter(s => s.shipping_mode === "pounds").reduce((sum, s) => sum + (s.package_count || 0), 0);
                      if (pkgTotal > 0 && lbTotal > 0) {
                        return (
                          <>
                            <p className="text-lg font-extrabold text-slate-800 leading-tight">{pkgTotal} / {lbTotal.toFixed(1)}</p>
                            <p className="text-[10px] text-gray-500">Paquetes / Libras</p>
                          </>
                        );
                      }
                      if (lbTotal > 0) {
                        return (
                          <>
                            <p className="text-2xl font-extrabold text-slate-800">{lbTotal.toFixed(1)}</p>
                            <p className="text-xs text-gray-500">Libras</p>
                          </>
                        );
                      }
                      return (
                        <>
                          <p className="text-2xl font-extrabold text-slate-800">{pkgTotal}</p>
                          <p className="text-xs text-gray-500">Paquetes</p>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>
            </>
          );
        })()}

        {/* Customer filter — sticks to all status tabs */}
        <div className="mb-4">
          <div className="relative">
            <Input
              type="text"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              placeholder="Filtrar por código de cliente (ej: J2934)"
              className="h-11 rounded-xl pl-10 pr-24 bg-white border-slate-200 uppercase"
              data-testid="shipments-customer-filter"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            {customerFilter.trim() && (
              <button
                type="button"
                onClick={() => setCustomerFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-md bg-slate-100"
                data-testid="shipments-customer-filter-clear"
              >
                Limpiar
              </button>
            )}
          </div>
          {customerFilter.trim() && (() => {
            const code = customerFilter.trim().toUpperCase();
            const allForCustomer = shipments.filter(s => (s.customer_id || "").toUpperCase().includes(code));
            const totalPkg = sumPackages(allForCustomer);
            const mode = tenantSettings?.shipping_mode === "pounds" ? "lb" : "paq.";
            return (
              <div className="mt-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 flex items-center justify-between" data-testid="shipments-customer-filter-summary">
                <p className="text-xs text-blue-800">
                  Cliente <span className="font-bold">{code}</span> · {allForCustomer.length} envío(s)
                </p>
                <p className="text-xs font-extrabold text-blue-900">
                  {Number(totalPkg).toFixed(tenantSettings?.shipping_mode === "pounds" ? 1 : 0)} {mode}
                </p>
              </div>
            );
          })()}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-gray-100 rounded-xl p-1 h-auto mb-4">
            <TabsTrigger value="all" className="data-[state=active]:bg-white rounded-lg py-2 text-xs">
              Todos
            </TabsTrigger>
            <TabsTrigger value="preparing" className="data-[state=active]:bg-white rounded-lg py-2 text-xs">
              Preparando
            </TabsTrigger>
            <TabsTrigger value="in_transit" className="data-[state=active]:bg-white rounded-lg py-2 text-xs">
              Tránsito
            </TabsTrigger>
            <TabsTrigger value="delivered" className="data-[state=active]:bg-white rounded-lg py-2 text-xs">
              Entregados
            </TabsTrigger>
          </TabsList>

          {["all", "preparing", "in_transit", "delivered"].map((tabValue) => (
            <TabsContent key={tabValue} value={tabValue}>
              <ScrollArea className="h-[calc(100vh-400px)]">
                {filterByStatus(tabValue).length === 0 ? (
                  <Card className="rounded-2xl border-dashed border-2 border-gray-200">
                    <CardContent className="p-8 text-center">
                      <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 font-medium">No hay envíos</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {filterByStatus(tabValue).map((shipment) => (
                      <Card key={shipment.id} className="rounded-xl" data-testid="shipment-item">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="font-bold">
                                  #{shipment.customer_id}
                                </Badge>
                                <span className="font-bold text-slate-800">{shipment.user_name}</span>
                                {shipment.created_at && (
                                  <span
                                    className="text-[10px] text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded"
                                    data-testid={`shipment-created-at-${shipment.id}`}
                                    title={new Date(shipment.created_at).toLocaleString("es-ES")}
                                  >
                                    {new Date(shipment.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" })}
                                    {" · "}
                                    {new Date(shipment.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                                {shipment.created_by_name && (
                                  <span
                                    className={
                                      shipment.created_by_legacy
                                        ? "text-[10px] text-amber-700 font-semibold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded inline-flex items-center gap-1"
                                        : "text-[10px] text-blue-700 font-semibold bg-blue-50 border border-blue-100 px-2 py-0.5 rounded inline-flex items-center gap-1"
                                    }
                                    data-testid={`shipment-created-by-${shipment.id}`}
                                    title={
                                      shipment.created_by_legacy
                                        ? `Estimado: ${shipment.created_by_name} (envío anterior al registro de creadores)`
                                        : `Creado por ${shipment.created_by_name}`
                                    }
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                    {shipment.created_by_name}
                                    {shipment.created_by_legacy && <span className="opacity-70">(est.)</span>}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">
                                {(() => {
                                  if (shipment.packages?.length > 1) return formatShipmentParts(shipment);
                                  const categories = tenantSettings.shipping_categories || [];
                                  const cat = categories.find(c => c.key === shipment.shipping_category);
                                  if (cat) return cat.label;
                                  if (shipment.shipping_category === "OTHER") return "Personalizado";
                                  // Legacy fallback
                                  return shipment.shipping_type === 'with_family' ? 'Con Familiar USA'
                                    : shipment.shipping_type === 'without_family' ? 'Sin Familiar USA'
                                    : shipment.shipping_type || '';
                                })()}
                                {' - '}${shipment.shipping_cost.toFixed(2)}
                                {shipment.package_count > 0 && (() => {
                                  const isPounds = shipment.shipping_mode === "pounds";
                                  const qty = isPounds ? Number(shipment.package_count).toFixed(1) : shipment.package_count;
                                  const unit = isPounds ? 'lb' : `paquete${shipment.package_count === 1 ? '' : 's'}`;
                                  return ` • ${qty} ${unit}`;
                                })()}
                              </p>
                            </div>
                            {getStatusBadge(shipment.status)}
                          </div>

                          {/* Marked-sent checkbox: drives "Pago a Empresa Paquetería" KPI */}
                          <label
                            className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${
                              shipment.marked_sent
                                ? 'bg-purple-50 border-purple-200 hover:bg-purple-100'
                                : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                            }`}
                            data-testid={`marked-sent-toggle-${shipment.id}`}
                          >
                            <input
                              type="checkbox"
                              checked={!!shipment.marked_sent}
                              onChange={() => handleToggleSent(shipment)}
                              className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                            />
                            <span className={`text-xs font-bold uppercase tracking-wide ${shipment.marked_sent ? 'text-purple-800' : 'text-slate-600'}`}>
                              Enviado a paquetería
                            </span>
                            {shipment.marked_sent && shipment.marked_sent_at && (
                              <span className="text-[10px] text-purple-600 ml-auto">
                                {new Date(shipment.marked_sent_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                                {shipment.marked_sent_by_name ? ` · ${shipment.marked_sent_by_name}` : ''}
                              </span>
                            )}
                          </label>

                          <div className="bg-gray-50 rounded-xl p-3 mb-3 space-y-2">
                            <div className="flex items-start gap-2">
                              <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                              <p className="text-sm text-gray-600">{shipment.address}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-gray-400" />
                              <p className="text-sm text-gray-600">{shipment.phone}</p>
                            </div>
                            {/* Show multiple tracking numbers */}
                            {(shipment.tracking_numbers?.length > 0 || shipment.tracking_number) && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Navigation className="h-4 w-4 text-gray-400" />
                                  <span className="text-xs text-gray-500 font-medium">
                                    {(shipment.tracking_numbers?.length || 1)} paquete(s):
                                  </span>
                                </div>
                                {shipment.tracking_numbers?.length > 0 ? (
                                  shipment.tracking_numbers.map((tracking, idx) => (
                                    <div key={idx} className="ml-6 flex items-center gap-2">
                                      <Package className="h-3 w-3 text-blue-500" />
                                      <p className="text-sm font-mono font-bold text-blue-700">{tracking}</p>
                                    </div>
                                  ))
                                ) : shipment.tracking_number && (
                                  <div className="ml-6 flex items-center gap-2">
                                    <Package className="h-3 w-3 text-blue-500" />
                                    <p className="text-sm font-mono font-bold text-blue-700">{shipment.tracking_number}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2 items-center">
                            {/* Status Selector */}
                            <div className="flex-1">
                              <Select
                                value={shipment.status}
                                onValueChange={(value) => handleUpdateStatus(shipment.id, value)}
                                data-testid={`status-select-${shipment.id}`}
                              >
                                <SelectTrigger className="h-10 rounded-lg">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="preparing">
                                    <span className="flex items-center gap-2">
                                      <Clock className="h-4 w-4 text-yellow-600" /> Preparación
                                    </span>
                                  </SelectItem>
                                  <SelectItem value="in_transit">
                                    <span className="flex items-center gap-2">
                                      <Truck className="h-4 w-4 text-blue-600" /> En Tránsito
                                    </span>
                                  </SelectItem>
                                  <SelectItem value="delivered">
                                    <span className="flex items-center gap-2">
                                      <CheckCircle className="h-4 w-4 text-green-600" /> Completado
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Tracking Button - Using separate component */}
                            <TrackingDialog
                              shipment={shipment}
                              trackingDialogOpen={trackingDialogOpen}
                              setTrackingDialogOpen={setTrackingDialogOpen}
                              trackingNumbers={trackingNumbers}
                              setTrackingNumbers={setTrackingNumbers}
                              handleOpenTrackingDialog={handleOpenTrackingDialog}
                              handleUpdateTracking={handleUpdateTracking}
                              addTrackingField={addTrackingField}
                              removeTrackingField={removeTrackingField}
                              updateTrackingField={updateTrackingField}
                            />

                            {/* Edit Button - Using separate component */}
                            <ShipmentEditDialog
                              shipment={shipment}
                              editDialogOpen={editDialogOpen}
                              setEditDialogOpen={setEditDialogOpen}
                              editForm={editForm}
                              setEditForm={setEditForm}
                              handleOpenEditDialog={handleOpenEditDialog}
                              handleSaveEdit={handleSaveEdit}
                              tenantSettings={tenantSettings}
                            />

                            {/* Delete Button */}
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="rounded-lg text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => handleDeleteShipment(shipment.id)}
                              data-testid={`delete-shipment-${shipment.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Deep Diagnostic Dialog */}
      <Dialog open={diagDialogOpen} onOpenChange={setDiagDialogOpen}>
        <DialogContent className="rounded-2xl max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto" data-testid="diagnostic-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-5 w-5 text-amber-600" />
              Diagnóstico de envíos · {weekFilter === "all" ? "Semana actual" : weekFilter}
            </DialogTitle>
          </DialogHeader>

          {diagLoading && (
            <div className="text-center py-10 text-sm text-slate-500">
              <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin text-amber-600" />
              Consultando MongoDB y audit logs…
            </div>
          )}

          {!diagLoading && diagData?.error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800" data-testid="diagnostic-error">
              <p className="font-bold mb-1">Error</p>
              <p>{diagData.error}</p>
            </div>
          )}

          {!diagLoading && diagData && !diagData.error && (
            <div className="space-y-4 mt-2">
              {/* Range info */}
              <div className="text-[11px] text-slate-500 bg-slate-50 rounded px-2 py-1 font-mono">
                {diagData._range?.startISO} → {diagData._range?.endISO}
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                  <p className="text-[10px] uppercase font-bold text-blue-700">Creados en rango</p>
                  <p className="text-2xl font-extrabold text-blue-900" data-testid="diag-created-count">{diagData.summary.created_in_range_count}</p>
                  <p className="text-[10px] text-blue-700">{diagData.summary.total_packages_in_range} paquetes</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <p className="text-[10px] uppercase font-bold text-amber-700">Solo modificados</p>
                  <p className="text-2xl font-extrabold text-amber-900" data-testid="diag-updated-only-count">{diagData.summary.updated_only_count}</p>
                  <p className="text-[10px] text-amber-700">creados antes, editados aquí</p>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Con creator registrado</p>
                  <p className="text-2xl font-extrabold text-emerald-900" data-testid="diag-with-creator">{diagData.summary.created_with_created_by}</p>
                  <p className="text-[10px] text-emerald-700">de {diagData.summary.created_in_range_count}</p>
                </div>
                <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
                  <p className="text-[10px] uppercase font-bold text-rose-700">Con audit log</p>
                  <p className="text-2xl font-extrabold text-rose-900" data-testid="diag-with-audit">{diagData.summary.created_with_audit_log}</p>
                  <p className="text-[10px] text-rose-700">de {diagData.summary.created_in_range_count}</p>
                </div>
              </div>

              {/* Interpretation hint */}
              <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-[11px] text-indigo-900">
                <p className="font-bold mb-1">📖 Cómo leer este diagnóstico</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><b>Creados en rango</b>: envíos cuyo <code>created_at</code> en MongoDB cae en esta semana.</li>
                  <li><b>Con creator registrado</b>: tienen <code>created_by</code> guardado (código nuevo).</li>
                  <li><b>Con audit log</b>: existe entrada <code>action="create_shipment"</code> en <code>audit_logs</code> → confirma 100% que SÍ fueron creados en este rango.</li>
                  <li>Si <b>"Creados en rango"</b> = N pero <b>"Con audit log"</b> = 0 → producción tiene código viejo. Los envíos sí fueron creados (la fecha es real) pero sin auditoría.</li>
                </ul>
              </div>

              {/* Shipments created in range */}
              {diagData.shipments_created_in_range?.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                    Envíos creados en el rango ({diagData.shipments_created_in_range.length})
                  </div>
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {diagData.shipments_created_in_range.map((s) => (
                      <div key={s.id} className="px-3 py-2 text-xs space-y-1" data-testid={`diag-row-${s.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="font-mono text-[10px]">{s.customer_id}</Badge>
                            <span className="font-bold text-slate-800 truncate">{s.client_name}</span>
                            <span className="text-slate-500">· {formatShipmentParts(s)}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">{s.id.slice(0, 8)}…</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-600">
                          <div>📅 <b>created_at</b>: <span className="font-mono">{s.raw_created_at}</span></div>
                          <div>✏️ <b>updated_at</b>: <span className="font-mono">{s.raw_updated_at}</span></div>
                          <div>👤 <b>created_by</b>: {s.created_by ? <span className="text-emerald-700 font-bold">{s.created_by_resolved || s.created_by_name_in_doc || s.created_by.slice(0, 8)}</span> : <span className="text-rose-700 font-bold">NULL (legacy)</span>}</div>
                          <div>📝 <b>audit log</b>: {s.has_audit_create ? <span className="text-emerald-700 font-bold">{s.audit_create_user} @ {s.audit_create_at?.slice(0, 16).replace("T"," ")}</span> : <span className="text-rose-700 font-bold">SIN registro</span>}</div>
                        </div>
                        {s.login_proximity && (
                          <div className="text-[10px] bg-purple-50 border border-purple-200 rounded px-2 py-1 text-purple-900" data-testid={`diag-login-proximity-${s.id}`}>
                            🔐 <b>Sesión activa al momento de crear:</b>{" "}
                            <span className="font-bold">{s.login_proximity.user_name}</span>
                            {s.login_proximity.user_role && <span className="text-purple-600"> ({s.login_proximity.user_role})</span>}
                            <span className="text-purple-600"> · login {s.login_proximity.minutes_before} min antes ({s.login_proximity.login_at?.slice(0, 16).replace("T"," ")})</span>
                          </div>
                        )}
                        {!s.login_proximity && !s.has_audit_create && (
                          <div className="text-[10px] bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-900">
                            ⚠️ Sin login registrado ±2h antes — el insert puede haber sido por un script externo o un usuario con sesión muy antigua.
                          </div>
                        )}
                        {s.audit_log_count > 0 && (
                          <details className="text-[10px]">
                            <summary className="cursor-pointer text-blue-700 font-bold">Ver historial ({s.audit_log_count} entradas)</summary>
                            <div className="mt-1 pl-4 space-y-0.5 text-slate-600">
                              {s.audit_logs.map((log, idx) => (
                                <div key={idx}>
                                  <span className="font-mono text-slate-400">{log.created_at?.slice(0, 16).replace("T"," ")}</span>
                                  {" · "}
                                  <span className="font-bold">{log.action}</span>
                                  {" · "}
                                  <span>{log.user_name}</span>
                                  {log.user_role && <span className="text-slate-400"> ({log.user_role})</span>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Shipments only modified in range */}
              {diagData.shipments_updated_only_in_range?.length > 0 && (
                <div className="rounded-xl border border-amber-200 overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    Envíos creados ANTES pero modificados en el rango ({diagData.shipments_updated_only_in_range.length})
                  </div>
                  <div className="divide-y divide-amber-100 max-h-60 overflow-y-auto">
                    {diagData.shipments_updated_only_in_range.map((s) => (
                      <div key={s.id} className="px-3 py-2 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="font-mono text-[10px]">{s.customer_id}</Badge>
                            <span className="font-bold text-slate-800 truncate">{s.client_name}</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-600">
                          📅 created_at: <span className="font-mono">{s.raw_created_at}</span> · ✏️ updated_at: <span className="font-mono">{s.raw_updated_at}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diagData.summary.created_in_range_count === 0 && diagData.summary.updated_only_count === 0 && (
                <div className="text-center py-6 text-sm text-slate-500">
                  Sin envíos creados ni modificados en este rango.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
