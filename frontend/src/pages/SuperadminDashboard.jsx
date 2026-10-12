import { useState, useEffect } from "react";
import { useAuth } from "@/App";
import { useNavigate } from "react-router-dom";
import { listTenants, createTenant, updateTenantStatus, getSuperadminStats, updateTenantTaxOptionsSuperadmin, updateTenantTrackingUrl, resetTenantAdminPassword, getTenantAdminInfo, updateTenantSettings, updateShippingCategoriesSuperadmin, getTenantBankAccounts, updateTenantBankAccounts } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building, Users, Shield, Plus, LogOut, Power, UserPlus, Percent, X, Link, Truck, Key, Eye, EyeOff, FileText, Package, DollarSign, Landmark, Trash2, Image as ImageIcon, Upload, Video } from "lucide-react";

export default function SuperadminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    business_name: "", slug: "", owner_name: "", email: ""
  });
  
  // Tax options configuration state
  const [taxDialogOpen, setTaxDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [taxOptions, setTaxOptions] = useState([]);
  const [newTaxValue, setNewTaxValue] = useState("");
  const [newTaxLabel, setNewTaxLabel] = useState("");
  
  // Tracking URL configuration state
  const [trackingDialogOpen, setTrackingDialogOpen] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState("");

  // Shipping categories state
  const [shipDialogOpen, setShipDialogOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [savingBankAccounts, setSavingBankAccounts] = useState(false);
  const [shippingCategories, setShippingCategories] = useState([]);
  const [shippingMode, setShippingMode] = useState("packages");

  // Banner dialog state
  const [bannerDialogOpen, setBannerDialogOpen] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  
  // Password reset state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [adminInfo, setAdminInfo] = useState(null);
  const [loadingAdminInfo, setLoadingAdminInfo] = useState(false);
  
  // Settings dialog state
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [tenantSettings, setTenantSettings] = useState({
    invoice_show_tax_per_item: true,
    invoice_show_tax_summary: true,
    shipment_show_product_list: true,
    allow_custom_client_id: false,
    live_module_enabled: false,
    // Late fee settings
    late_fee_enabled: false,
    late_fee_grace_hours: 24,
    late_fee_description: "Recargo por demora en pago",
    shipping_categories: []
  });

  const DEFAULT_TAX_OPTIONS = [
    { value: "8.25", label: "8.25%" },
    { value: "10", label: "10%" },
    { value: "15", label: "15%" },
    { value: "0", label: "Sin Taxes" },
    { value: "other", label: "Otro" }
  ];

  useEffect(() => { loadData(); }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadData());

  const loadData = async () => {
    try {
      const [tenantsRes, statsRes] = await Promise.all([listTenants(), getSuperadminStats()]);
      setTenants(tenantsRes.data);
      setStats(statsRes.data);
    } catch (error) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async () => {
    if (!form.business_name || !form.slug) {
      toast.error("Completa los campos obligatorios");
      return;
    }
    setSubmitting(true);
    try {
      await createTenant(form);
      toast.success("Tenant creado exitosamente");
      setDialogOpen(false);
      setForm({ business_name: "", slug: "", owner_name: "", email: "" });
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al crear tenant");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (tenantId, currentStatus) => {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    try {
      await updateTenantStatus(tenantId, newStatus);
      toast.success(`Tenant ${newStatus === "active" ? "activado" : "suspendido"}`);
      loadData();
    } catch (error) {
      toast.error("Error al actualizar estado");
    }
  };

  const handleLogout = () => { logout(); navigate("/login"); };
  const set = (key, val) => setForm({ ...form, [key]: val });

  const openTaxDialog = (tenant) => {
    setSelectedTenant(tenant);
    setTaxOptions(tenant.tax_options || DEFAULT_TAX_OPTIONS);
    setNewTaxValue("");
    setNewTaxLabel("");
    setTaxDialogOpen(true);
  };

  const handleAddTaxOption = () => {
    if (!newTaxValue || !newTaxLabel) {
      toast.error("Ingresa valor y etiqueta");
      return;
    }
    const otherIndex = taxOptions.findIndex(opt => opt.value === "other");
    const newOption = { value: newTaxValue, label: newTaxLabel };
    if (otherIndex >= 0) {
      const newOptions = [...taxOptions];
      newOptions.splice(otherIndex, 0, newOption);
      setTaxOptions(newOptions);
    } else {
      setTaxOptions([...taxOptions, newOption]);
    }
    setNewTaxValue("");
    setNewTaxLabel("");
  };

  const handleRemoveTaxOption = (index) => {
    const opt = taxOptions[index];
    if (opt.value === "0" || opt.value === "other") {
      toast.error("No se puede eliminar esta opción");
      return;
    }
    setTaxOptions(taxOptions.filter((_, i) => i !== index));
  };

  const handleSaveTaxOptions = async () => {
    if (!selectedTenant) return;
    try {
      await updateTenantTaxOptionsSuperadmin(selectedTenant.id, taxOptions);
      toast.success("Opciones de impuestos actualizadas");
      setTaxDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error("Error al guardar");
    }
  };

  const openTrackingDialog = (tenant) => {
    setSelectedTenant(tenant);
    setTrackingUrl(tenant.tracking_url_template || "");
    setTrackingDialogOpen(true);
  };

  const handleSaveTrackingUrl = async () => {
    if (!selectedTenant) return;
    try {
      await updateTenantTrackingUrl(selectedTenant.id, trackingUrl);
      toast.success("URL de tracking actualizado");
      setTrackingDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error("Error al guardar");
    }
  };

  const openShippingDialog = (tenant) => {
    setSelectedTenant(tenant);
    const cats = Array.isArray(tenant.shipping_categories) && tenant.shipping_categories.length > 0
      ? tenant.shipping_categories.map(c => ({
          key: c.key || "",
          label: c.label || "",
          value_packages: c.value_packages ?? c.value ?? 0,
          value_pounds: c.value_pounds ?? c.value ?? 0,
          courier_cost_packages: c.courier_cost_packages ?? 0,
          courier_cost_pounds: c.courier_cost_pounds ?? 0,
        }))
      : [
          { key: "G", label: "Categoría G (CON Núcleo Familiar)", value_packages: 32, value_pounds: 32, courier_cost_packages: 0, courier_cost_pounds: 0 },
          { key: "A", label: "Categoría A (Personal)", value_packages: 42, value_pounds: 42, courier_cost_packages: 0, courier_cost_pounds: 0 },
          { key: "B", label: "Categoría B (SIN Núcleo Familiar)", value_packages: 52, value_pounds: 52, courier_cost_packages: 0, courier_cost_pounds: 0 }
        ];
    setShippingCategories(cats);
    setShippingMode(tenant.shipping_mode === "pounds" ? "pounds" : "packages");
    setShipDialogOpen(true);
  };

  const updateShipField = (index, key, val) => {
    const next = [...shippingCategories];
    next[index] = { ...next[index], [key]: val };
    setShippingCategories(next);
  };

  const addShippingCategory = () => {
    setShippingCategories([...shippingCategories, { key: "", label: "", value_packages: 0, value_pounds: 0, courier_cost_packages: 0, courier_cost_pounds: 0 }]);
  };

  const removeShippingCategory = (index) => {
    setShippingCategories(shippingCategories.filter((_, i) => i !== index));
  };

  const handleSaveShippingCategories = async () => {
    if (!selectedTenant) return;
    // Validate
    const normalized = shippingCategories
      .map(c => ({
        key: String(c.key || "").trim().toUpperCase(),
        label: String(c.label || "").trim(),
        value_packages: parseFloat(c.value_packages) || 0,
        value_pounds: parseFloat(c.value_pounds) || 0,
        courier_cost_packages: parseFloat(c.courier_cost_packages) || 0,
        courier_cost_pounds: parseFloat(c.courier_cost_pounds) || 0,
      }))
      .filter(c => c.key && c.label && c.value_packages >= 0 && c.value_pounds >= 0 && c.courier_cost_packages >= 0 && c.courier_cost_pounds >= 0);
    if (normalized.length === 0) {
      toast.error("Agrega al menos una categoría válida");
      return;
    }
    const keys = normalized.map(c => c.key);
    if (new Set(keys).size !== keys.length) {
      toast.error("Las claves (key) no pueden repetirse");
      return;
    }
    if (keys.includes("OTHER")) {
      toast.error('La clave "OTHER" está reservada');
      return;
    }
    try {
      await updateShippingCategoriesSuperadmin(selectedTenant.id, normalized, shippingMode);
      toast.success("Categorías de envío actualizadas");
      setShipDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al guardar");
    }
  };

  // ── Bank accounts dialog (Superadmin → per-tenant) ──
  const openBankAccountsDialog = async (tenant) => {
    setSelectedTenant(tenant);
    setBankAccounts([]);
    setBankDialogOpen(true);
    try {
      const res = await getTenantBankAccounts(tenant.id);
      setBankAccounts(res.data.bank_accounts || []);
    } catch (e) {
      toast.error("Error al cargar cuentas bancarias");
    }
  };

  const updateBankField = (idx, key, val) => {
    setBankAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, [key]: val } : a)));
  };

  const addBankAccount = () => {
    setBankAccounts((prev) => [
      ...prev,
      { id: "", owner_name: "", owner_id: "", account_number: "", bank_name: "", currency: "USD", is_active: true },
    ]);
  };

  const removeBankAccount = (idx) => {
    setBankAccounts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveBankAccounts = async () => {
    if (!selectedTenant) return;
    const cleaned = bankAccounts
      .map((a) => ({
        ...a,
        owner_name: String(a.owner_name || "").trim(),
        owner_id: String(a.owner_id || "").trim(),
        account_number: String(a.account_number || "").trim(),
        bank_name: String(a.bank_name || "").trim(),
        currency: String(a.currency || "USD").trim().toUpperCase(),
      }))
      .filter((a) => a.owner_name && a.account_number && a.bank_name);    setSavingBankAccounts(true);
    try {
      await updateTenantBankAccounts(selectedTenant.id, cleaned);
      toast.success("Cuentas bancarias actualizadas");
      setBankDialogOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al guardar");
    } finally {
      setSavingBankAccounts(false);
    }
  };

  const openBannerDialog = (tenant) => {
    setSelectedTenant(tenant);
    setBannerDialogOpen(true);
  };

  const handleBannerUpload = async (file) => {
    if (!selectedTenant || !file) return;
    setBannerUploading(true);
    try {
      const backend = process.env.REACT_APP_BACKEND_URL;
      const token = JSON.parse(localStorage.getItem("outletsusa_user") || "{}").token;
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${backend}/api/superadmin/tenants/${selectedTenant.id}/banner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Update local tenant list so preview refreshes immediately
      setTenants((prev) => prev.map((t) => (t.id === selectedTenant.id ? { ...t, dashboard_banner_url: data.dashboard_banner_url } : t)));
      setSelectedTenant((prev) => (prev ? { ...prev, dashboard_banner_url: data.dashboard_banner_url } : prev));
      toast.success("Banner actualizado");
    } catch (e) {
      console.error(e);
      toast.error("Error al subir banner");
    } finally {
      setBannerUploading(false);
    }
  };

  const handleBannerRemove = async () => {
    if (!selectedTenant) return;
    setBannerUploading(true);
    try {
      const backend = process.env.REACT_APP_BACKEND_URL;
      const token = JSON.parse(localStorage.getItem("outletsusa_user") || "{}").token;
      const res = await fetch(`${backend}/api/superadmin/tenants/${selectedTenant.id}/banner`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTenants((prev) => prev.map((t) => (t.id === selectedTenant.id ? { ...t, dashboard_banner_url: null } : t)));
      setSelectedTenant((prev) => (prev ? { ...prev, dashboard_banner_url: null } : prev));
      toast.success("Banner eliminado");
    } catch (e) {
      console.error(e);
      toast.error("Error al eliminar banner");
    } finally {
      setBannerUploading(false);
    }
  };

  const openPasswordDialog = async (tenant) => {
    setSelectedTenant(tenant);
    setNewPassword("");
    setShowPassword(false);
    setAdminInfo(null);
    setLoadingAdminInfo(true);
    setPasswordDialogOpen(true);
    
    try {
      const res = await getTenantAdminInfo(tenant.id);
      setAdminInfo(res.data);
    } catch (error) {
      console.error("Error loading admin info:", error);
    } finally {
      setLoadingAdminInfo(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedTenant || !newPassword) {
      toast.error("Ingresa la nueva contraseña");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    try {
      await resetTenantAdminPassword(selectedTenant.id, newPassword);
      toast.success("Contraseña actualizada exitosamente");
      setPasswordDialogOpen(false);
      setNewPassword("");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al actualizar contraseña");
    }
  };

  const openSettingsDialog = (tenant) => {
    setSelectedTenant(tenant);
    setTenantSettings({
      invoice_show_tax_per_item: tenant.invoice_show_tax_per_item !== false,
      invoice_show_tax_summary: tenant.invoice_show_tax_summary !== false,
      shipment_show_product_list: tenant.shipment_show_product_list !== false,
      allow_custom_client_id: tenant.allow_custom_client_id === true,
      live_module_enabled: tenant.live_module_enabled === true,
      // Late fee settings
      late_fee_enabled: tenant.late_fee_enabled === true,
      late_fee_grace_hours: tenant.late_fee_grace_hours || 24,
      late_fee_description: tenant.late_fee_description || "Recargo por demora en pago",
      shipping_categories: tenant.shipping_categories || []
    });
    setSettingsDialogOpen(true);
  };

  const handleSaveSettings = async () => {
    if (!selectedTenant) return;
    try {
      await updateTenantSettings(selectedTenant.id, tenantSettings);
      toast.success("Configuración actualizada");
      setSettingsDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error("Error al guardar configuración");
    }
  };

  // One-click toggle of the Live module directly from the tenant card.
  const handleToggleLiveModule = async (tenant) => {
    const next = !tenant.live_module_enabled;
    setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, live_module_enabled: next } : t));
    try {
      await updateTenantSettings(tenant.id, { live_module_enabled: next });
      toast.success(next ? "Módulo Live ACTIVADO" : "Módulo Live desactivado");
    } catch (error) {
      setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, live_module_enabled: !next } : t));
      toast.error("No se pudo actualizar el módulo Live");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg">
      <div className="sticky top-0 z-50" style={{ background: '#1E3A5F' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#2ECC71' }}>
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-sm">Panel Superadmin</p>
              <p className="text-xs text-slate-400">{user?.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-300 hover:text-white" data-testid="superadmin-logout-btn">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="rounded-xl" data-testid="stat-tenants">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(30,58,95,0.1)' }}>
                <Building className="h-5 w-5" style={{ color: '#1E3A5F' }} />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-800">{stats?.tenant_count || 0}</p>
                <p className="text-xs text-gray-500">Tenants</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl" data-testid="stat-active-tenants">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,204,113,0.1)' }}>
                <Power className="h-5 w-5" style={{ color: '#2ECC71' }} />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-800">{stats?.active_tenants || 0}</p>
                <p className="text-xs text-gray-500">Activos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl" data-testid="stat-admins">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(30,58,95,0.1)' }}>
                <UserPlus className="h-5 w-5" style={{ color: '#1E3A5F' }} />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-800">{stats?.total_admins || 0}</p>
                <p className="text-xs text-gray-500">Admins</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl" data-testid="stat-total-clients">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,204,113,0.1)' }}>
                <Users className="h-5 w-5" style={{ color: '#2ECC71' }} />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-800">{stats?.total_clients || 0}</p>
                <p className="text-xs text-gray-500">Clientes</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Negocios (Tenants)</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl" data-testid="create-tenant-btn" style={{ background: '#2ECC71', color: 'white' }}>
                <Plus className="h-4 w-4 mr-2" /> Nuevo Tenant
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-md">
              <DialogHeader>
                <DialogTitle>Crear Nuevo Tenant</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Nombre del Negocio *</Label>
                  <Input data-testid="tenant-business-name" placeholder="Mi Tienda" className="rounded-xl mt-1 h-11"
                    value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
                </div>
                <div>
                  <Label>Slug (URL) *</Label>
                  <Input data-testid="tenant-slug" placeholder="mi-tienda" className="rounded-xl mt-1 h-11"
                    value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))} />
                  <p className="text-xs text-gray-500 mt-1">Este slug se usará para login del admin</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Propietario</Label>
                    <Input placeholder="Nombre" className="rounded-xl mt-1 h-11" value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
                  </div>
                  <div>
                    <Label>Email Negocio</Label>
                    <Input type="email" placeholder="contacto@..." className="rounded-xl mt-1 h-11" value={form.email} onChange={(e) => set("email", e.target.value)} />
                  </div>
                </div>

                <div className="p-3 bg-blue-50 rounded-xl">
                  <p className="text-xs text-blue-800">
                    <strong>Nota:</strong> Después de crear el tenant, usa el botón <strong>"Password"</strong> para asignar credenciales de acceso al administrador del negocio.
                  </p>
                </div>

                <Button onClick={handleCreateTenant} disabled={submitting} data-testid="submit-create-tenant-btn"
                  className="w-full h-12 font-bold rounded-xl" style={{ background: '#1E3A5F', color: 'white' }}>
                  {submitting ? "Creando..." : "Crear Tenant"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ScrollArea className="h-[calc(100vh-360px)]">
          {tenants.length === 0 ? (
            <Card className="rounded-2xl border-dashed border-2 border-gray-200">
              <CardContent className="p-8 text-center">
                <Building className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No hay tenants creados</p>
                <p className="text-gray-400 text-sm mt-1">Crea el primer negocio para comenzar</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {tenants.map((tenant) => (
                <Card key={tenant.id} className="rounded-xl hover:shadow-md transition-shadow" data-testid="tenant-item">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-slate-800 text-lg">{tenant.business_name}</p>
                          <Badge className={tenant.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                            {tenant.status === "active" ? "Activo" : "Suspendido"}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-500">Slug: <span className="font-mono font-medium" style={{ color: '#1E3A5F' }}>{tenant.slug}</span></p>
                        <div className="flex gap-4 mt-2 text-sm text-gray-500">
                          <span>{tenant.owner_name || "Sin propietario"}</span>
                          <span>{tenant.admin_count || 0} admins</span>
                          <span>{tenant.client_count || 0} clientes</span>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-green-200 text-green-600 hover:bg-green-50"
                          onClick={() => openPasswordDialog(tenant)}
                          data-testid={`reset-password-${tenant.id}`}
                        >
                          <Key className="h-4 w-4 mr-1" />
                          Password
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-blue-200 text-blue-600 hover:bg-blue-50"
                          onClick={() => openSettingsDialog(tenant)}
                          data-testid={`config-settings-${tenant.id}`}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Factura
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className={`rounded-lg ${tenant.live_module_enabled ? "border-rose-300 text-white bg-[#B84A5E] hover:bg-[#A33F52]" : "border-rose-200 text-rose-600 hover:bg-rose-50"}`}
                          onClick={() => handleToggleLiveModule(tenant)}
                          data-testid={`toggle-live-${tenant.id}`}
                        >
                          <Video className="h-4 w-4 mr-1" />
                          Live: {tenant.live_module_enabled ? "ON" : "OFF"}
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-blue-200 text-blue-600 hover:bg-blue-50"
                          onClick={() => openTaxDialog(tenant)}
                          data-testid={`config-taxes-${tenant.id}`}
                        >
                          <Percent className="h-4 w-4 mr-1" />
                          Taxes
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-purple-200 text-purple-600 hover:bg-purple-50"
                          onClick={() => openTrackingDialog(tenant)}
                          data-testid={`config-tracking-${tenant.id}`}
                        >
                          <Truck className="h-4 w-4 mr-1" />
                          Tracking
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => openShippingDialog(tenant)}
                          data-testid={`config-shipping-${tenant.id}`}
                        >
                          <DollarSign className="h-4 w-4 mr-1" />
                          Envíos
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                          onClick={() => openBankAccountsDialog(tenant)}
                          data-testid={`config-bank-accounts-${tenant.id}`}
                        >
                          <Landmark className="h-4 w-4 mr-1" />
                          Cuentas
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50"
                          onClick={() => openBannerDialog(tenant)}
                          data-testid={`config-banner-${tenant.id}`}
                        >
                          <ImageIcon className="h-4 w-4 mr-1" />
                          Banner
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className={`rounded-lg ${tenant.status === "active" ? "border-red-200 text-red-600 hover:bg-red-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}
                          onClick={() => handleToggleStatus(tenant.id, tenant.status)}
                          data-testid={`toggle-tenant-${tenant.id}`}
                        >
                          <Power className="h-4 w-4 mr-1" />
                          {tenant.status === "active" ? "Suspender" : "Activar"}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Tax Options Configuration Dialog */}
        <Dialog open={taxDialogOpen} onOpenChange={setTaxDialogOpen}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5 text-blue-600" />
                Configurar Impuestos - {selectedTenant?.business_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-500">
                Configura las opciones de impuestos que estarán disponibles para este Personal Shopper.
              </p>
              
              {/* Current tax options */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Opciones Actuales</Label>
                {taxOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-800">{opt.label}</Badge>
                      <span className="text-xs text-gray-500">valor: {opt.value}%</span>
                    </div>
                    {opt.value !== "0" && opt.value !== "other" && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleRemoveTaxOption(idx)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add new option */}
              <div className="border-t pt-4">
                <Label className="text-sm font-semibold">Agregar Nueva Opción</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Valor (ej: 12.5)"
                    value={newTaxValue}
                    onChange={(e) => setNewTaxValue(e.target.value)}
                    className="w-28 rounded-lg"
                  />
                  <Input
                    placeholder="Etiqueta (ej: 12.5%)"
                    value={newTaxLabel}
                    onChange={(e) => setNewTaxLabel(e.target.value)}
                    className="flex-1 rounded-lg"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddTaxOption}
                    className="rounded-lg"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Button
                onClick={handleSaveTaxOptions}
                className="w-full h-11 font-bold rounded-xl"
                style={{ background: '#1E3A5F', color: 'white' }}
              >
                Guardar Configuración
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Tracking URL Configuration Dialog */}
        <Dialog open={trackingDialogOpen} onOpenChange={setTrackingDialogOpen}>
          <DialogContent className="rounded-2xl max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-purple-600" />
                URL de Tracking - {selectedTenant?.business_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-500">
                Configura la URL para verificar el seguimiento de envíos. Usa <code className="bg-gray-100 px-1 rounded">{'{tracking}'}</code> donde irá el número de tracking.
              </p>
              
              <div className="space-y-2">
                <Label className="text-sm font-semibold">URL de Tracking</Label>
                <Input
                  placeholder="https://example.com/track?number={tracking}"
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  className="h-11 rounded-lg"
                />
              </div>
              
              <div className="p-3 bg-purple-50 rounded-xl">
                <p className="text-xs font-semibold text-purple-800 mb-2">Ejemplos de URLs:</p>
                <ul className="text-xs text-purple-700 space-y-1">
                  <li>• UPS: https://www.ups.com/track?tracknum={'{tracking}'}</li>
                  <li>• FedEx: https://www.fedex.com/fedextrack/?trknbr={'{tracking}'}</li>
                  <li>• USPS: https://tools.usps.com/go/TrackConfirmAction?tLabels={'{tracking}'}</li>
                  <li>• DHL: https://www.dhl.com/en/express/tracking.html?AWB={'{tracking}'}</li>
                </ul>
              </div>

              {trackingUrl && (
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Vista previa (con tracking "123456"):</p>
                  <p className="text-xs text-blue-600 break-all">
                    {trackingUrl.replace('{tracking}', '123456')}
                  </p>
                </div>
              )}

              <Button
                onClick={handleSaveTrackingUrl}
                className="w-full h-11 font-bold rounded-xl"
                style={{ background: '#1E3A5F', color: 'white' }}
              >
                Guardar URL de Tracking
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Shipping Categories Dialog */}
        <Dialog open={shipDialogOpen} onOpenChange={setShipDialogOpen}>
          <DialogContent className="rounded-2xl max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="shipping-categories-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                Categorías de Envío - {selectedTenant?.business_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-500">
                Define las categorías de envío que aparecerán al crear un envío. Cada categoría guarda <strong>dos precios independientes</strong>: uno para modo paquetes y otro para libras. El modo activo determina cuál se usa al cotizar.
              </p>

              {/* Mode toggle */}
              <div className="p-3 rounded-xl border-2 bg-slate-50" data-testid="shipping-mode-toggle">
                <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Modo de cálculo</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShippingMode("packages")}
                    className={`p-3 rounded-lg border-2 text-sm font-semibold transition ${shippingMode === "packages"
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                    data-testid="mode-packages"
                  >
                    Por Paquetes
                    <div className="text-xs font-normal mt-0.5 text-gray-500">Costo × # de paquetes</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShippingMode("pounds")}
                    className={`p-3 rounded-lg border-2 text-sm font-semibold transition ${shippingMode === "pounds"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                    data-testid="mode-pounds"
                  >
                    Por Libras
                    <div className="text-xs font-normal mt-0.5 text-gray-500">Costo × # de libras</div>
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {shippingCategories.map((cat, idx) => (
                  <div key={idx} className="p-3 border rounded-xl bg-gray-50 space-y-2" data-testid={`ship-cat-row-${idx}`}>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <Label className="text-xs font-semibold">Clave</Label>
                        <Input
                          value={cat.key}
                          onChange={(e) => updateShipField(idx, "key", e.target.value.toUpperCase())}
                          placeholder="G"
                          maxLength={6}
                          className="h-10 rounded-lg font-mono text-center uppercase"
                          data-testid={`ship-cat-key-${idx}`}
                        />
                      </div>
                      <div className="col-span-8">
                        <Label className="text-xs font-semibold">Nombre visible</Label>
                        <Input
                          value={cat.label}
                          onChange={(e) => updateShipField(idx, "label", e.target.value)}
                          placeholder="Categoría G (CON Núcleo Familiar)"
                          className="h-10 rounded-lg"
                          data-testid={`ship-cat-label-${idx}`}
                        />
                      </div>
                      <div className="col-span-1">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => removeShippingCategory(idx)}
                          className="h-10 w-10 p-0 text-red-500 hover:bg-red-50"
                          data-testid={`ship-cat-remove-${idx}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`p-2 rounded-lg border-2 ${shippingMode === "packages" ? "border-blue-400 bg-blue-50/40" : "border-gray-200 bg-white"}`}>
                        <Label className="text-xs font-semibold text-blue-800">
                          Costo por paquete {shippingMode === "packages" && <span className="text-[10px] font-normal">(modo activo)</span>}
                        </Label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cat.value_packages ?? 0}
                            onChange={(e) => updateShipField(idx, "value_packages", e.target.value)}
                            onWheel={(e) => e.target.blur()}
                            className="h-10 rounded-lg pl-6 font-bold"
                            data-testid={`ship-cat-value-packages-${idx}`}
                          />
                        </div>
                      </div>
                      <div className={`p-2 rounded-lg border-2 ${shippingMode === "pounds" ? "border-emerald-400 bg-emerald-50/40" : "border-gray-200 bg-white"}`}>
                        <Label className="text-xs font-semibold text-emerald-800">
                          Costo por libra {shippingMode === "pounds" && <span className="text-[10px] font-normal">(modo activo)</span>}
                        </Label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cat.value_pounds ?? 0}
                            onChange={(e) => updateShipField(idx, "value_pounds", e.target.value)}
                            onWheel={(e) => e.target.blur()}
                            className="h-10 rounded-lg pl-6 font-bold"
                            data-testid={`ship-cat-value-pounds-${idx}`}
                          />
                        </div>
                      </div>
                    </div>
                    {/* Courier-side costs: what the tenant pays to the shipping company.
                        Used by the "Pago a Empresa Paquetería" KPI. */}
                    <div className="mt-2 pt-2 border-t border-dashed border-slate-200">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-purple-700 mb-1.5">
                        Pago a Empresa Paquetería
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-lg border-2 border-purple-200 bg-purple-50/40">
                          <Label className="text-xs font-semibold text-purple-800">Por paquete</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={cat.courier_cost_packages ?? 0}
                              onChange={(e) => updateShipField(idx, "courier_cost_packages", e.target.value)}
                              onWheel={(e) => e.target.blur()}
                              className="h-10 rounded-lg pl-6 font-bold"
                              data-testid={`ship-cat-courier-packages-${idx}`}
                            />
                          </div>
                        </div>
                        <div className="p-2 rounded-lg border-2 border-purple-200 bg-purple-50/40">
                          <Label className="text-xs font-semibold text-purple-800">Por libra</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={cat.courier_cost_pounds ?? 0}
                              onChange={(e) => updateShipField(idx, "courier_cost_pounds", e.target.value)}
                              onWheel={(e) => e.target.blur()}
                              className="h-10 rounded-lg pl-6 font-bold"
                              data-testid={`ship-cat-courier-pounds-${idx}`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={addShippingCategory}
                className="w-full h-10 rounded-xl border-dashed"
                data-testid="ship-cat-add"
              >
                <Plus className="h-4 w-4 mr-2" /> Agregar categoría
              </Button>
              <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-800 space-y-1">
                <p><strong>Nota:</strong> La clave <code>OTHER</code> está reservada y no puede usarse — ya está siempre disponible como "Otro (costo personalizado)" en el formulario de envío.</p>
                <p>Las claves deben ser únicas y las usa el sistema para identificar la categoría.</p>
              </div>
              <Button
                onClick={handleSaveShippingCategories}
                className="w-full h-11 font-bold rounded-xl"
                style={{ background: '#1E3A5F', color: 'white' }}
                data-testid="ship-cat-save"
              >
                Guardar Categorías
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bank Accounts Dialog (Superadmin) */}
        <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
          <DialogContent className="rounded-2xl max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-indigo-600" />
                Cuentas Bancarias - {selectedTenant?.business_name}
              </DialogTitle>
              <p className="text-xs text-slate-500 mt-1">
                Configura aquí las cuentas donde los clientes pueden enviar sus recargas. El sistema usará el número de cuenta o el nombre del beneficiario para atribuir cada recarga aprobada.
              </p>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              {bankAccounts.length === 0 && (
                <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Landmark className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm text-slate-500 font-medium">Sin cuentas bancarias configuradas</p>
                  <p className="text-xs text-slate-400 mt-1">Agrega la primera para empezar a atribuir recargas</p>
                </div>
              )}

              {bankAccounts.map((acc, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-white p-3 space-y-2"
                  data-testid={`bank-account-row-${idx}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                      Cuenta #{idx + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBankAccount(idx)}
                      className="h-7 w-7 p-0 text-red-500 hover:bg-red-50"
                      data-testid={`remove-bank-account-${idx}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Nombre del banco</Label>
                      <Input
                        value={acc.bank_name || ""}
                        onChange={(e) => updateBankField(idx, "bank_name", e.target.value)}
                        placeholder="Ej: Banco Pichincha"
                        className="h-9 rounded-lg"
                        data-testid={`bank-name-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Número de cuenta</Label>
                      <Input
                        value={acc.account_number || ""}
                        onChange={(e) => updateBankField(idx, "account_number", e.target.value)}
                        placeholder="Ej: 2200123456"
                        className="h-9 rounded-lg font-mono"
                        data-testid={`account-number-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Nombre del dueño</Label>
                      <Input
                        value={acc.owner_name || ""}
                        onChange={(e) => updateBankField(idx, "owner_name", e.target.value)}
                        placeholder="Ej: Juan Pérez"
                        className="h-9 rounded-lg"
                        data-testid={`owner-name-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Cédula / ID</Label>
                      <Input
                        value={acc.owner_id || ""}
                        onChange={(e) => updateBankField(idx, "owner_id", e.target.value)}
                        placeholder="Ej: 1712345678"
                        className="h-9 rounded-lg font-mono"
                        data-testid={`owner-id-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Moneda</Label>
                      <Input
                        value={acc.currency || "USD"}
                        onChange={(e) => updateBankField(idx, "currency", e.target.value.toUpperCase())}
                        placeholder="USD"
                        maxLength={3}
                        className="h-9 rounded-lg uppercase"
                        data-testid={`currency-${idx}`}
                      />
                    </div>
                    <label className="flex items-end gap-2 pb-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acc.is_active !== false}
                        onChange={(e) => updateBankField(idx, "is_active", e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      <span className="text-xs font-semibold text-slate-700">Cuenta activa</span>
                    </label>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={addBankAccount}
                className="w-full h-10 rounded-xl border-dashed border-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                data-testid="add-bank-account-btn"
              >
                <Plus className="h-4 w-4 mr-2" />
                Agregar cuenta bancaria
              </Button>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-3">
              <Button type="button" variant="outline" onClick={() => setBankDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveBankAccounts}
                disabled={savingBankAccounts}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                data-testid="save-bank-accounts-btn"
              >
                {savingBankAccounts ? "Guardando..." : "Guardar Cuentas"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Password Reset Dialog */}
        <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-green-600" />
                Gestionar Contraseña - {selectedTenant?.business_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {loadingAdminInfo ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-green-600 border-t-transparent"></div>
                </div>
              ) : adminInfo?.has_admin ? (
                <>
                  {/* Admin Info */}
                  <div className="p-4 bg-gray-50 rounded-xl space-y-2">
                    <p className="text-sm font-semibold text-gray-700">Información del Admin</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Nombre:</span>
                        <p className="font-medium">{adminInfo.admin_name}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Email:</span>
                        <p className="font-medium text-blue-600">{adminInfo.admin_email}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">WhatsApp:</span>
                        <p className="font-medium">{adminInfo.admin_whatsapp || "N/A"}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Última actualización:</span>
                        <p className="font-medium">
                          {adminInfo.password_updated_at 
                            ? new Date(adminInfo.password_updated_at).toLocaleDateString('es-ES')
                            : "Nunca"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* New Password */}
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Nueva Contraseña</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Mínimo 6 caracteres"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="h-11 rounded-lg pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      El admin podrá usar esta contraseña para iniciar sesión con su email, slug o WhatsApp.
                    </p>
                  </div>

                  <Button
                    onClick={handleResetPassword}
                    disabled={!newPassword || newPassword.length < 6}
                    className="w-full h-11 font-bold rounded-xl"
                    style={{ background: '#2ECC71', color: 'white' }}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Actualizar Contraseña
                  </Button>
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500">Este tenant no tiene un admin asignado.</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Invoice Settings Dialog */}
        <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Configuración de Factura - {selectedTenant?.business_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-5 pt-2">
              {/* Invoice Settings */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-700 border-b pb-2">Opciones de Factura PDF</p>
                
                {/* Tax per item toggle */}
                <div 
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                    tenantSettings.invoice_show_tax_per_item 
                      ? 'bg-green-50 border-green-400' 
                      : 'bg-gray-50 border-gray-200'
                  }`}
                  onClick={() => setTenantSettings({...tenantSettings, invoice_show_tax_per_item: !tenantSettings.invoice_show_tax_per_item})}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Mostrar Tax por Producto</p>
                      <p className="text-xs text-gray-500 mt-1">Columna de impuestos en tabla de productos</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                      tenantSettings.invoice_show_tax_per_item 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-300 text-gray-600'
                    }`}>
                      {tenantSettings.invoice_show_tax_per_item ? 'ACTIVO' : 'INACTIVO'}
                    </div>
                  </div>
                </div>
                
                {/* Tax summary toggle */}
                <div 
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                    tenantSettings.invoice_show_tax_summary 
                      ? 'bg-green-50 border-green-400' 
                      : 'bg-gray-50 border-gray-200'
                  }`}
                  onClick={() => setTenantSettings({...tenantSettings, invoice_show_tax_summary: !tenantSettings.invoice_show_tax_summary})}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Mostrar Resumen de Tax</p>
                      <p className="text-xs text-gray-500 mt-1">Total de impuestos al final de la factura</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                      tenantSettings.invoice_show_tax_summary 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-300 text-gray-600'
                    }`}>
                      {tenantSettings.invoice_show_tax_summary ? 'ACTIVO' : 'INACTIVO'}
                    </div>
                  </div>
                </div>
              </div>

              <hr />

              {/* Shipment Settings */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-700 border-b pb-2">Opciones de Envíos</p>
                
                {/* Product list toggle */}
                <div 
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                    tenantSettings.shipment_show_product_list 
                      ? 'bg-green-50 border-green-400' 
                      : 'bg-gray-50 border-gray-200'
                  }`}
                  onClick={() => setTenantSettings({...tenantSettings, shipment_show_product_list: !tenantSettings.shipment_show_product_list})}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Mostrar Lista de Productos</p>
                      <p className="text-xs text-gray-500 mt-1">Detalle de productos al crear envío</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                      tenantSettings.shipment_show_product_list 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-300 text-gray-600'
                    }`}>
                      {tenantSettings.shipment_show_product_list ? 'ACTIVO' : 'INACTIVO'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Clientes Section */}
              <div className="border border-gray-200 rounded-xl p-4">
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Clientes
                </h4>
                <div className="space-y-3">
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                      tenantSettings.allow_custom_client_id 
                        ? 'bg-green-50 border border-green-200' 
                        : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                    }`}
                    onClick={() => setTenantSettings({...tenantSettings, allow_custom_client_id: !tenantSettings.allow_custom_client_id})}
                    data-testid="toggle-allow-custom-client-id"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Código de Cliente Manual</p>
                      <p className="text-xs text-gray-500 mt-1">Permitir ingresar código personalizado al crear cliente</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                      tenantSettings.allow_custom_client_id 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-300 text-gray-600'
                    }`}>
                      {tenantSettings.allow_custom_client_id ? 'ACTIVO' : 'INACTIVO'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Módulos Section */}
              <div className="border border-gray-200 rounded-xl p-4">
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Video className="h-4 w-4 text-rose-600" />
                  Módulos
                </h4>
                <div className="space-y-3">
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                      tenantSettings.live_module_enabled
                        ? 'bg-rose-50 border border-rose-200'
                        : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                    }`}
                    onClick={() => setTenantSettings({...tenantSettings, live_module_enabled: !tenantSettings.live_module_enabled})}
                    data-testid="toggle-live-module"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Módulo Live</p>
                      <p className="text-xs text-gray-500 mt-1">Ingreso rápido de productos a varios clientes (se marca como "LIVE")</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                      tenantSettings.live_module_enabled
                        ? 'bg-rose-600 text-white'
                        : 'bg-gray-300 text-gray-600'
                    }`}>
                      {tenantSettings.live_module_enabled ? 'ACTIVO' : 'INACTIVO'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Late Fee / Recargo por Mora Section */}
              <div className="border-2 border-amber-200 rounded-xl p-4 bg-amber-50/50">
                <h4 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                  Recargo por Mora
                </h4>
                
                {/* Enable toggle */}
                <div
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all mb-4 ${
                    tenantSettings.late_fee_enabled
                      ? 'bg-amber-100 border border-amber-300'
                      : 'bg-white border border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => setTenantSettings({...tenantSettings, late_fee_enabled: !tenantSettings.late_fee_enabled})}
                  data-testid="toggle-late-fee"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Habilitar Recargo por Mora</p>
                    <p className="text-xs text-gray-500 mt-1">Aplicar recargo automático después del tiempo de gracia</p>
                  </div>
                  <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    tenantSettings.late_fee_enabled
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-300 text-gray-600'
                  }`}>
                    {tenantSettings.late_fee_enabled ? 'ACTIVO' : 'INACTIVO'}
                  </div>
                </div>

                {/* Configuration fields - only shown when enabled */}
                {tenantSettings.late_fee_enabled && (
                  <div className="space-y-4 animate-in slide-in-from-top-2">
                    {/* Grace hours */}
                    <div>
                      <Label className="text-xs text-amber-800 font-semibold">Tiempo de Gracia (horas)</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type="number"
                          min="1"
                          value={tenantSettings.late_fee_grace_hours}
                          onChange={(e) => setTenantSettings({...tenantSettings, late_fee_grace_hours: Math.max(1, parseInt(e.target.value) || 24)})}
                          className="h-10 rounded-lg w-24 text-center font-bold"
                        />
                        <span className="text-sm text-gray-600">horas después de crear la factura</span>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <Label className="text-xs text-amber-800 font-semibold">Descripción del Recargo</Label>
                      <Input
                        value={tenantSettings.late_fee_description}
                        onChange={(e) => setTenantSettings({...tenantSettings, late_fee_description: e.target.value})}
                        placeholder="Ej: Recargo por demora en pago"
                        className="h-10 rounded-lg mt-1"
                      />
                    </div>

                    {/* Late fee per shipping category */}
                    <div>
                      <Label className="text-xs text-amber-800 font-semibold mb-2 block">Recargo por Categoría de Envío</Label>
                      <div className="space-y-2">
                        {(tenantSettings.shipping_categories || []).map((cat, idx) => (
                          <div key={cat.key || idx} className="flex items-center gap-3 p-2 bg-white rounded-lg border border-amber-200">
                            <span className="w-24 text-sm font-bold text-gray-700">{cat.key}</span>
                            <span className="flex-1 text-xs text-gray-500 truncate">{cat.label}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-gray-500">$</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={cat.late_fee || 0}
                                onChange={(e) => {
                                  const newCategories = [...tenantSettings.shipping_categories];
                                  newCategories[idx] = { ...cat, late_fee: parseFloat(e.target.value) || 0 };
                                  setTenantSettings({...tenantSettings, shipping_categories: newCategories});
                                }}
                                className="h-8 w-20 text-center font-bold rounded"
                              />
                            </div>
                          </div>
                        ))}
                        {(!tenantSettings.shipping_categories || tenantSettings.shipping_categories.length === 0) && (
                          <p className="text-xs text-amber-600 italic">No hay categorías de envío configuradas. Configúralas en "Categorías de Envío".</p>
                        )}
                      </div>
                    </div>

                    {/* Preview */}
                    {tenantSettings.shipping_categories?.some(c => c.late_fee > 0) && (
                      <div className="p-3 bg-amber-100 rounded-lg border border-amber-300">
                        <p className="text-xs font-semibold text-amber-800 mb-1">Vista previa:</p>
                        <p className="text-xs text-amber-700">
                          Si una factura con envío de categoría{' '}
                          {tenantSettings.shipping_categories.filter(c => c.late_fee > 0).map(c => 
                            <span key={c.key} className="font-bold">{c.key} (${c.late_fee})</span>
                          ).reduce((prev, curr, i) => [prev, i === 0 ? '' : ', ', curr], [])}
                          {' '}no se paga en {tenantSettings.late_fee_grace_hours}h, se aplicará el recargo correspondiente.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Button
                onClick={handleSaveSettings}
                className="w-full h-11 font-bold rounded-xl"
                style={{ background: '#1E3A5F', color: 'white' }}
              >
                Guardar Configuración
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Banner Upload Dialog */}
        <Dialog open={bannerDialogOpen} onOpenChange={setBannerDialogOpen}>
          <DialogContent className="rounded-2xl max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-pink-600" />
                Banner del Dashboard
              </DialogTitle>
            </DialogHeader>
            {selectedTenant && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-slate-600">
                    <span className="font-semibold">{selectedTenant.business_name}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Se muestra al tope del dashboard principal (mismo image en escritorio y móvil). Se recomienda una imagen horizontal 2000×760 o similar; se ajusta con object-fit: cover.
                  </p>
                </div>

                {selectedTenant.dashboard_banner_url ? (
                  <div className="rounded-xl overflow-hidden border border-slate-200">
                    <img
                      src={
                        selectedTenant.dashboard_banner_url.startsWith("http")
                          ? selectedTenant.dashboard_banner_url
                          : `${process.env.REACT_APP_BACKEND_URL}${selectedTenant.dashboard_banner_url}`
                      }
                      alt="Banner actual"
                      className="w-full h-40 object-cover bg-slate-50"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-slate-200 h-40 flex items-center justify-center text-sm text-slate-400">
                    Sin banner configurado
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      data-testid="banner-upload-input"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleBannerUpload(f);
                        e.target.value = "";
                      }}
                      disabled={bannerUploading}
                    />
                    <div className="w-full h-11 rounded-xl bg-pink-600 hover:bg-pink-700 text-white flex items-center justify-center gap-2 text-sm font-semibold transition">
                      <Upload className="h-4 w-4" />
                      {bannerUploading ? "Subiendo..." : selectedTenant.dashboard_banner_url ? "Cambiar imagen" : "Subir imagen"}
                    </div>
                  </label>
                  {selectedTenant.dashboard_banner_url && (
                    <Button
                      variant="outline"
                      className="w-full h-11 rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                      onClick={handleBannerRemove}
                      disabled={bannerUploading}
                      data-testid="banner-remove-btn"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Quitar banner
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
