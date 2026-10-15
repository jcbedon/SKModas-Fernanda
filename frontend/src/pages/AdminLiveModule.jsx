import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/App";
import { useNavigate } from "react-router-dom";
import {
  getLives,
  createLive,
  startLive,
  getTenantSettings,
  getAllClients,
  getClientInfo,
  getProductHistory,
  createLiveModulePurchases,
  getLivePurchases,
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Video, Plus, Search, X, DollarSign, Store, Radio, CheckCircle,
  AlertTriangle, Trash2, ArrowLeft, Loader2, Users, Tag, Package, UserPlus,
} from "lucide-react";

const getEffectiveTaxRate = (taxOption, customTax) => {
  if (taxOption === "0") return 0;
  if (taxOption === "other") return parseFloat(customTax) / 100 || 0;
  return parseFloat(taxOption) / 100;
};

export default function AdminLiveModule() {
  const { user, hideFinancials } = useAuth();
  const navigate = useNavigate();
  const logoUrl = user?.tenant_logo || "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";
  const moduleEnabled = !!user?.live_module_enabled;
  
  // Format money with hideFinancials support
  const formatMoney = (v) => {
    if (hideFinancials) return "••••";
    return "$" + Number(v || 0).toFixed(2);
  };

  const [lives, setLives] = useState([]);
  const [selectedLive, setSelectedLive] = useState(null);
  const [taxOptions, setTaxOptions] = useState([
    { value: "8.25", label: "8.25%" }, { value: "0", label: "Sin Taxes" }, { value: "other", label: "Otro" },
  ]);

  // Create-live form
  const [showCreate, setShowCreate] = useState(false);
  const [newLive, setNewLive] = useState({ store: "", taxOption: "0", customTax: "" });
  const [creating, setCreating] = useState(false);

  // Product form
  const [product, setProduct] = useState({ item_name: "", price: "", commission: "" });
  const [history, setHistory] = useState([]);

  // Clients
  const [allClients, setAllClients] = useState([]);
  const [clientQuery, setClientQuery] = useState("");
  const [selectedClients, setSelectedClients] = useState([]); // [{customer_id,name,wallet_balance,pending_to_invoice,owes}]
  const [submitting, setSubmitting] = useState(false);
  const priceRef = useRef(null);
  const clientSearchRef = useRef(null);

  // Registered products grid
  const [livePurchases, setLivePurchases] = useState([]);
  const [groupedProducts, setGroupedProducts] = useState([]);
  const [addToProductModal, setAddToProductModal] = useState(null); // { item_name, price, commission }
  const [addClientQuery, setAddClientQuery] = useState("");
  const [addingClients, setAddingClients] = useState([]);
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const addClientRef = useRef(null);

  useEffect(() => {
    if (!moduleEnabled) return;
    loadLives();
    getTenantSettings().then(res => {
      if (res.data?.tax_options?.length) setTaxOptions(res.data.tax_options);
    }).catch(() => {});
    getAllClients().then(res => setAllClients(res.data || [])).catch(() => {});
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleEnabled]);

  const loadLives = async () => {
    try {
      const res = await getLives();
      setLives(res.data || []);
      // keep selected live fresh
      if (selectedLive) {
        const fresh = (res.data || []).find(l => l.id === selectedLive.id);
        if (fresh) setSelectedLive(fresh);
      }
    } catch (_e) { /* noop */ }
  };

  const loadLivePurchases = async (liveId) => {
    if (!liveId) return;
    try {
      const res = await getLivePurchases(liveId);
      const purchases = res.data || [];
      setLivePurchases(purchases);
      
      // Group by item_name + price + commission to show unique products
      const grouped = {};
      purchases.forEach(p => {
        const commAmount = p.commission || p.commission_amount || 0;
        const key = `${p.item_name}|${p.price}|${commAmount}`;
        if (!grouped[key]) {
          grouped[key] = {
            item_name: p.item_name,
            price: p.price,
            commission: commAmount,
            customers: [],
          };
        }
        grouped[key].customers.push({
          customer_id: p.customer_id,
          customer_name: p.customer_name || p.customer_id,
        });
      });
      setGroupedProducts(Object.values(grouped));
    } catch (_e) {
      setLivePurchases([]);
      setGroupedProducts([]);
    }
  };

  // Load purchases when live changes
  useEffect(() => {
    if (selectedLive?.id) {
      loadLivePurchases(selectedLive.id);
    } else {
      setLivePurchases([]);
      setGroupedProducts([]);
    }
  }, [selectedLive?.id]);

  const refreshHistory = async (q = "") => {
    try {
      const res = await getProductHistory(q);
      setHistory(res.data?.items || []);
    } catch (_e) { /* noop */ }
  };

  const taxLabel = (live) => {
    if (!live?.apply_tax || !live?.tax_rate) return "Sin impuesto";
    return `Impuesto ${(live.tax_rate * 100).toFixed(2).replace(/\.00$/, "")}%`;
  };

  const handleCreateLive = async () => {
    if (!newLive.store.trim()) { toast.error("Ingresa el nombre de la tienda"); return; }
    // Auto-build the title: store name + current date.
    const autoTitle = `${newLive.store.trim()} ${new Date().toLocaleDateString('es-EC')}`;
    const apply = newLive.taxOption !== "0";
    const rate = getEffectiveTaxRate(newLive.taxOption, newLive.customTax);
    setCreating(true);
    try {
      const res = await createLive({ title: autoTitle, store: newLive.store.trim(), tax_rate: rate, apply_tax: apply });
      const liveId = res.data?.live_id;
      try { await startLive(liveId); } catch (_e) { /* already fine */ }
      toast.success("Live creado");
      setShowCreate(false);
      setNewLive({ store: "", taxOption: "0", customTax: "" });
      const livesRes = await getLives();
      setLives(livesRes.data || []);
      const created = (livesRes.data || []).find(l => l.id === liveId);
      if (created) setSelectedLive(created);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al crear el Live");
    } finally {
      setCreating(false);
    }
  };

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return [];
    return (allClients || [])
      .filter(c =>
        (c.customer_id || "").toLowerCase().includes(q) ||
        (c.name || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [clientQuery, allClients]);

  const addClient = async (client) => {
    if (!client) return;
    if (selectedClients.some(c => c.customer_id === client.customer_id)) {
      setClientQuery("");
      clientSearchRef.current?.focus();
      return;
    }
    // optimistic add with quantity=1, then enrich with owes info
    const base = {
      customer_id: client.customer_id,
      name: client.name,
      wallet_balance: client.wallet_balance ?? 0,
      pending_to_invoice: 0,
      owes: false,
      loading: true,
      quantity: 1, // Default quantity per client
    };
    setSelectedClients(prev => [base, ...prev]);
    setClientQuery("");
    clientSearchRef.current?.focus();
    try {
      const res = await getClientInfo(client.customer_id);
      const d = res.data;
      const pending = Number(d.pending_to_invoice || 0);
      setSelectedClients(prev => prev.map(c => c.customer_id === client.customer_id
        ? { ...c, wallet_balance: Number(d.wallet_balance || 0), pending_to_invoice: pending, owes: pending > 0, loading: false }
        : c));
    } catch (_e) {
      setSelectedClients(prev => prev.map(c => c.customer_id === client.customer_id ? { ...c, loading: false } : c));
    }
  };

  const updateClientQuantity = (customerId, quantity) => {
    const qty = Math.max(1, parseInt(quantity) || 1);
    setSelectedClients(prev => prev.map(c => 
      c.customer_id === customerId ? { ...c, quantity: qty } : c
    ));
  };

  const handleClientKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = clientQuery.trim().toLowerCase();
      // exact code match first, else first filtered
      const exact = (allClients || []).find(c => (c.customer_id || "").toLowerCase() === q);
      addClient(exact || filteredClients[0]);
    }
  };

  const removeClient = (cid) => setSelectedClients(prev => prev.filter(c => c.customer_id !== cid));

  const priceNum = parseFloat(product.price) || 0;
  const commissionNum = product.commission === "" ? 0 : (parseFloat(product.commission) || 0);
  const unitValue = priceNum + commissionNum;
  // Calculate total based on each client's quantity
  const totalQuantity = selectedClients.reduce((sum, c) => sum + (c.quantity || 1), 0);
  const finalValue = unitValue * totalQuantity;

  const handleRegister = async () => {
    if (!selectedLive) { toast.error("Selecciona o crea un Live"); return; }
    if (!product.item_name.trim()) { toast.error("Ingresa el nombre del producto"); return; }
    if (priceNum <= 0) { toast.error("Ingresa un precio válido"); return; }
    if (product.commission === "" || commissionNum < 0) { toast.error("Ingresa la comisión"); return; }
    if (selectedClients.length === 0) { toast.error("Agrega al menos un cliente"); return; }
    setSubmitting(true);
    try {
      const res = await createLiveModulePurchases({
        live_id: selectedLive.id,
        item_name: product.item_name.trim(),
        store: selectedLive.store || "",
        price: priceNum,
        commission_amount: commissionNum,
        // Send customer_ids with their quantities
        customer_ids: selectedClients.map(c => c.customer_id),
        quantities: selectedClients.map(c => c.quantity || 1), // Array of quantities matching customer_ids order
      });
      const created = res.data?.created?.length || 0;
      const failed = res.data?.failed || [];
      toast.success(`${created} compra(s) registrada(s) en el Live`);
      if (failed.length) {
        toast.error(`${failed.length} no se registraron: ${failed.map(f => f.customer_id).join(", ")}`);
      }
      // Reset product + clients, keep live
      setProduct({ item_name: "", price: "", commission: "" });
      setSelectedClients([]);
      refreshHistory();
      loadLives();
      loadLivePurchases(selectedLive.id); // Refresh the products grid
      // focus product name for the next entry
      setTimeout(() => document.getElementById("live-product-name")?.focus(), 50);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  };

  // === Add clients to existing product ===
  const filteredAddClients = useMemo(() => {
    const q = addClientQuery.trim().toLowerCase();
    if (!q) return [];
    // Exclude clients already in this product
    const existingIds = addToProductModal?.existingCustomerIds || [];
    const alreadyAdding = addingClients.map(c => c.customer_id);
    return (allClients || [])
      .filter(c =>
        !existingIds.includes(c.customer_id) &&
        !alreadyAdding.includes(c.customer_id) &&
        ((c.customer_id || "").toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [addClientQuery, allClients, addToProductModal, addingClients]);

  const openAddToProduct = (product) => {
    // Find all customer IDs already in this product
    const existingIds = groupedProducts
      .find(p => p.item_name === product.item_name && p.price === product.price && p.commission === product.commission)
      ?.customers.map(c => c.customer_id) || [];
    setAddToProductModal({ ...product, existingCustomerIds: existingIds });
    setAddClientQuery("");
    setAddingClients([]);
    setTimeout(() => addClientRef.current?.focus(), 100);
  };

  const addClientToModal = async (client) => {
    if (!client) return;
    if (addingClients.some(c => c.customer_id === client.customer_id)) {
      setAddClientQuery("");
      addClientRef.current?.focus();
      return;
    }
    const base = {
      customer_id: client.customer_id,
      name: client.name,
      wallet_balance: client.wallet_balance ?? 0,
      loading: true,
    };
    setAddingClients(prev => [base, ...prev]);
    setAddClientQuery("");
    addClientRef.current?.focus();
    try {
      const res = await getClientInfo(client.customer_id);
      const d = res.data;
      setAddingClients(prev => prev.map(c => c.customer_id === client.customer_id
        ? { ...c, wallet_balance: Number(d.wallet_balance || 0), loading: false }
        : c));
    } catch (_e) {
      setAddingClients(prev => prev.map(c => c.customer_id === client.customer_id ? { ...c, loading: false } : c));
    }
  };

  const handleAddClientKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = addClientQuery.trim().toLowerCase();
      const exact = (allClients || []).find(c => (c.customer_id || "").toLowerCase() === q);
      addClientToModal(exact || filteredAddClients[0]);
    }
  };

  const removeAddingClient = (cid) => setAddingClients(prev => prev.filter(c => c.customer_id !== cid));

  const handleAddToExistingProduct = async () => {
    if (!addToProductModal || addingClients.length === 0) return;
    setSubmittingAdd(true);
    try {
      const res = await createLiveModulePurchases({
        live_id: selectedLive.id,
        item_name: addToProductModal.item_name,
        store: selectedLive.store || "",
        price: addToProductModal.price,
        commission_amount: addToProductModal.commission || null,
        customer_ids: addingClients.map(c => c.customer_id),
      });
      const created = res.data?.created?.length || 0;
      toast.success(`${created} cliente(s) agregado(s) a "${addToProductModal.item_name}"`);
      setAddToProductModal(null);
      setAddingClients([]);
      loadLives();
      loadLivePurchases(selectedLive.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al agregar clientes");
    } finally {
      setSubmittingAdd(false);
    }
  };

  if (!moduleEnabled) {
    return (
      <div className="app-bg min-h-screen flex items-center justify-center p-6">
        <Card className="rounded-2xl max-w-md w-full">
          <CardContent className="p-8 text-center space-y-3">
            <div className="h-14 w-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto">
              <Video className="h-7 w-7 text-rose-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-800">Módulo Live no activo</h2>
            <p className="text-sm text-slate-500">Este módulo debe ser activado por el Superadministrador para tu tienda.</p>
            <Button variant="outline" className="rounded-xl" onClick={() => navigate("/admin")} data-testid="live-module-back">
              <ArrowLeft className="h-4 w-4 mr-2" /> Volver al Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-bg" data-testid="live-module-page">
      {/* Header (same shell as other modules) */}
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Módulo Live</span>
          <Badge className="text-white text-sm px-3 py-1" style={{ background: "#B84A5E" }}>
            <Video className="h-3 w-3 mr-2 inline" /> LIVE
          </Badge>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        {/* ===== TOP: Live info / selector ===== */}
        {selectedLive ? (
          <Card className="rounded-2xl overflow-hidden border-0" style={{ background: "linear-gradient(135deg,#7F2A3C,#B84A5E)" }}>
            <CardContent className="p-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Radio className="h-4 w-4 animate-pulse" />
                    <span className="text-[11px] uppercase tracking-wider opacity-80">Live activo</span>
                  </div>
                  <h2 className="text-xl font-bold truncate" data-testid="live-module-title">{selectedLive.title}</h2>
                  <div className="flex items-center gap-3 mt-1 text-sm opacity-90">
                    {selectedLive.store && <span className="flex items-center gap-1"><Store className="h-3.5 w-3.5" />{selectedLive.store}</span>}
                    <span className="flex items-center gap-1"><Tag className="h-3.5 w-3.5" />{taxLabel(selectedLive)}</span>
                  </div>
                </div>
                <Button
                  variant="secondary" size="sm"
                  className="bg-white/15 hover:bg-white/25 text-white border-0 rounded-lg shrink-0"
                  onClick={() => setSelectedLive(null)}
                  data-testid="live-module-change"
                >
                  Cambiar live
                </Button>
              </div>
              <div className="flex flex-nowrap items-center gap-x-5 mt-4 pt-4 border-t border-white/20">
                <div><p className="text-[11px] opacity-70">Ventas</p><p className="text-lg font-bold leading-tight">{selectedLive.purchase_count || 0}</p></div>
                <div><p className="text-[11px] opacity-70">Total</p><p className="text-lg font-bold leading-tight">{formatMoney(selectedLive.total_sales)}</p></div>
                <div><p className="text-[11px] opacity-70">Comisiones</p><p className="text-lg font-bold leading-tight">{formatMoney(selectedLive.total_commissions)}</p></div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-800 flex items-center gap-2"><Video className="h-5 w-5 text-rose-600" /> Selecciona o crea un Live</h2>
                <Button onClick={() => setShowCreate(v => !v)} className="rounded-xl bg-[#B84A5E] hover:bg-[#A33F52] text-white" data-testid="live-module-new-btn">
                  <Plus className="h-4 w-4 mr-1" /> Nuevo Live
                </Button>
              </div>

              {showCreate && (
                <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4 space-y-3" data-testid="live-module-create-form">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Tienda *</Label>
                      <Input value={newLive.store} onChange={e => setNewLive({ ...newLive, store: e.target.value })}
                        placeholder="Ej: PRIMARK" className="h-10 rounded-lg mt-1" autoFocus data-testid="new-live-store" />
                    </div>
                    <div>
                      <Label className="text-xs">Impuesto (Tax)</Label>
                      <Select value={newLive.taxOption} onValueChange={v => setNewLive({ ...newLive, taxOption: v })}>
                        <SelectTrigger className="h-10 rounded-lg mt-1" data-testid="new-live-tax"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {taxOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {newLive.taxOption === "other" && (
                      <div>
                        <Label className="text-xs">Tax personalizado (%)</Label>
                        <Input type="number" value={newLive.customTax} onChange={e => setNewLive({ ...newLive, customTax: e.target.value })}
                          placeholder="Ej: 12" className="h-10 rounded-lg mt-1" data-testid="new-live-custom-tax" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500" data-testid="new-live-name-preview">
                    El Live se llamará: <span className="font-semibold text-rose-600">{newLive.store.trim() ? `${newLive.store.trim()} ${new Date().toLocaleDateString('es-EC')}` : `Tienda ${new Date().toLocaleDateString('es-EC')}`}</span>
                  </p>
                  <Button onClick={handleCreateLive} disabled={creating} className="w-full h-11 rounded-xl bg-[#B84A5E] hover:bg-[#A33F52] text-white font-bold" data-testid="new-live-submit">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear Live"}
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                {lives.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No hay lives. Crea uno para empezar.</p>}
                {lives.map(live => (
                  <button
                    key={live.id}
                    onClick={() => setSelectedLive(live)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-rose-300 hover:bg-rose-50/40 transition-colors text-left"
                    data-testid={`live-module-pick-${live.id}`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{live.title}</p>
                      <p className="text-xs text-slate-500">{live.store || "—"} · {taxLabel(live)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">{live.purchase_count || 0} items</Badge>
                      <Badge className={`text-[10px] ${live.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {live.status === "active" ? "EN VIVO" : "Finalizado"}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== PRODUCT + CLIENTS (only when a live is selected) ===== */}
        {selectedLive && (
          <>
            {/* Product */}
            <Card className="rounded-2xl">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Tag className="h-4 w-4 text-rose-600" /> Producto</h3>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr,130px,130px,140px] gap-3 items-end">
                  <div>
                    <Label className="text-xs">Nombre del producto *</Label>
                    <Input
                      id="live-product-name"
                      list="live-product-history"
                      value={product.item_name}
                      onChange={e => { setProduct({ ...product, item_name: e.target.value }); }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); priceRef.current?.focus(); } }}
                      placeholder="Ej: Pijama dumbo"
                      className="h-11 rounded-lg mt-1"
                      autoFocus
                      data-testid="live-product-name"
                    />
                    <datalist id="live-product-history">
                      {history.map((n, i) => <option key={i} value={n} />)}
                    </datalist>
                  </div>
                  <div>
                    <Label className="text-xs">Precio *</Label>
                    <div className="relative mt-1">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input ref={priceRef} type="number" step="0.01" value={product.price}
                        onChange={e => setProduct({ ...product, price: e.target.value })}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); clientSearchRef.current?.focus(); } }}
                        placeholder="0.00" className="h-11 rounded-lg pl-8" data-testid="live-product-price" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Comisión *</Label>
                    <div className="relative mt-1">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input type="number" step="0.01" value={product.commission}
                        onChange={e => setProduct({ ...product, commission: e.target.value })}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); clientSearchRef.current?.focus(); } }}
                        placeholder="0.00" className={`h-11 rounded-lg pl-8 ${product.commission === "" ? "border-red-300 focus:border-red-400" : ""}`} data-testid="live-product-commission" />
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900 text-white px-3 py-2 text-center" data-testid="live-final-value">
                    <p className="text-[10px] opacity-70 leading-tight">Valor unitario</p>
                    <p className="text-lg font-bold leading-tight">{formatMoney(unitValue)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Clients */}
            <Card className="rounded-2xl">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><Users className="h-4 w-4 text-rose-600" /> Clientes que compran</h3>
                  <Badge variant="outline" className="font-bold" data-testid="live-clients-count">{selectedClients.length}</Badge>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    ref={clientSearchRef}
                    value={clientQuery}
                    onChange={e => setClientQuery(e.target.value)}
                    onKeyDown={handleClientKeyDown}
                    placeholder="Buscar por código o nombre y Enter para agregar…"
                    className="h-11 rounded-lg pl-9"
                    data-testid="live-client-search"
                  />
                  {filteredClients.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden" data-testid="live-client-suggestions">
                      {filteredClients.map(c => (
                        <button key={c.customer_id} onClick={() => addClient(c)}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-rose-50 text-left text-sm"
                          data-testid={`live-client-suggest-${c.customer_id}`}>
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-bold text-rose-600 shrink-0">{c.customer_id}</span>
                            <span className="truncate text-slate-700">{c.name}</span>
                          </span>
                          <span className="text-xs text-slate-500 shrink-0">{formatMoney(c.wallet_balance)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {selectedClients.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">Agrega los clientes que recibirán este producto.</p>
                  )}
                  {selectedClients.map(c => {
                    // Calculate: DEBE = Total Recargas - Total Compras
                    // pending_to_invoice represents what they owe (purchases not yet invoiced)
                    // wallet_balance is current balance
                    // So: Total spent/owed = pending_to_invoice
                    const totalDeposits = Number(c.wallet_balance || 0) + Number(c.pending_to_invoice || 0);
                    const totalPurchases = Number(c.pending_to_invoice || 0);
                    const calculatedOwes = totalPurchases;
                    const clientTotal = unitValue * (c.quantity || 1);
                    
                    return (
                    <div key={c.customer_id}
                      className={`flex items-center justify-between p-3 rounded-xl border ${c.owes ? "border-red-200 bg-red-50/50" : "border-slate-200"}`}
                      data-testid={`live-client-chip-${c.customer_id}`}>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-[11px] font-bold text-rose-600 shrink-0">{c.customer_id}</span>
                        <span className="font-medium text-slate-800 truncate">{c.name}</span>
                        {c.loading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                        ) : c.owes ? (
                          <Badge className="bg-red-100 text-red-700 text-[10px] flex items-center gap-1" title={hideFinancials ? "Valores ocultos" : `Recargas: ${formatMoney(totalDeposits)} - Compras: ${formatMoney(totalPurchases)}`}>
                            <AlertTriangle className="h-3 w-3" /> Debe {formatMoney(calculatedOwes)}
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 text-[10px] flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> Al día
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Quantity input per client */}
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-1">
                          <button 
                            onClick={() => updateClientQuantity(c.customer_id, (c.quantity || 1) - 1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-700 font-bold"
                            disabled={(c.quantity || 1) <= 1}
                          >−</button>
                          <Input 
                            type="number" 
                            min="1" 
                            value={c.quantity || 1}
                            onChange={e => updateClientQuantity(c.customer_id, e.target.value)}
                            className="w-10 h-7 text-center font-bold text-sm border-0 bg-transparent p-0"
                            data-testid={`live-client-qty-${c.customer_id}`}
                          />
                          <button 
                            onClick={() => updateClientQuantity(c.customer_id, (c.quantity || 1) + 1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-700 font-bold"
                          >+</button>
                        </div>
                        <span className="text-xs text-slate-600 font-semibold w-16 text-right">{formatMoney(clientTotal)}</span>
                        <button onClick={() => removeClient(c.customer_id)} className="text-slate-400 hover:text-rose-600" data-testid={`live-client-remove-${c.customer_id}`}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )})}
                </div>

                <Button
                  onClick={handleRegister}
                  disabled={submitting || selectedClients.length === 0 || !product.item_name.trim() || priceNum <= 0 || product.commission === ""}
                  className="w-full h-12 rounded-xl bg-[#B84A5E] hover:bg-[#A33F52] text-white font-bold text-base"
                  data-testid="live-register-btn"
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>Registrar {totalQuantity > selectedClients.length ? `${totalQuantity} unidades` : ''} en {selectedClients.length} cliente(s) · {formatMoney(finalValue)}</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* === Products Grid - Already registered === */}
            {groupedProducts.length > 0 && (
              <Card className="rounded-2xl">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Package className="h-4 w-4 text-rose-600" /> Productos Registrados
                    </h3>
                    <Badge variant="outline" className="font-bold">{groupedProducts.length} productos</Badge>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="live-products-grid">
                    {groupedProducts.map((prod, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-200 rounded-xl p-3 hover:border-rose-200 hover:bg-rose-50/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-semibold text-slate-800 text-sm leading-tight truncate flex-1" title={prod.item_name}>
                            {prod.item_name}
                          </h4>
                          <Badge className="bg-slate-100 text-slate-600 text-[10px] shrink-0">
                            {prod.customers.length} cliente{prod.customers.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            {formatMoney(prod.price)}
                          </span>
                          <span className="text-slate-400">+</span>
                          <span className="text-green-600">
                            {formatMoney(prod.commission)}
                          </span>
                          <span className="text-slate-400">=</span>
                          <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                            {formatMoney(prod.price + (prod.commission || 0))}
                          </span>
                        </div>
                        
                        {/* Customer chips */}
                        <div className="flex flex-wrap gap-1 mb-3">
                          {prod.customers.slice(0, 5).map((c, cIdx) => (
                            <span
                              key={cIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-full text-[10px] text-slate-600"
                              title={c.customer_name}
                            >
                              <span className="font-bold text-rose-600">{c.customer_id}</span>
                            </span>
                          ))}
                          {prod.customers.length > 5 && (
                            <span className="inline-flex items-center px-2 py-0.5 bg-slate-200 rounded-full text-[10px] text-slate-500">
                              +{prod.customers.length - 5} más
                            </span>
                          )}
                        </div>
                        
                        {/* Add client button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAddToProduct(prod)}
                          className="w-full rounded-lg text-xs h-8 border-rose-200 text-rose-600 hover:bg-rose-50"
                          data-testid={`add-to-product-${idx}`}
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1" />
                          Agregar cliente
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* === Modal: Add clients to existing product === */}
      {addToProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAddToProductModal(null)}>
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800">Agregar clientes</h3>
                <button onClick={() => setAddToProductModal(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Producto: <span className="font-semibold text-rose-600">{addToProductModal.item_name}</span>
              </p>
              <p className="text-xs text-slate-400">
                {formatMoney(addToProductModal.price)} + {formatMoney(addToProductModal.commission)} = {formatMoney(addToProductModal.price + addToProductModal.commission)}
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Search clients */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  ref={addClientRef}
                  value={addClientQuery}
                  onChange={e => setAddClientQuery(e.target.value)}
                  onKeyDown={handleAddClientKeyDown}
                  placeholder="Buscar cliente por código o nombre..."
                  className="h-11 rounded-lg pl-9"
                  data-testid="add-product-client-search"
                />
                {filteredAddClients.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    {filteredAddClients.map(c => (
                      <button
                        key={c.customer_id}
                        onClick={() => addClientToModal(c)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-rose-50 text-left text-sm"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-bold text-rose-600 shrink-0">{c.customer_id}</span>
                          <span className="truncate text-slate-700">{c.name}</span>
                        </span>
                        <span className="text-xs text-slate-500 shrink-0">{formatMoney(c.wallet_balance)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected clients for adding */}
              <div className="space-y-2">
                {addingClients.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">Busca y selecciona los clientes a agregar</p>
                )}
                {addingClients.map(c => (
                  <div
                    key={c.customer_id}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[11px] font-bold text-rose-600 shrink-0">{c.customer_id}</span>
                      <span className="font-medium text-slate-800 truncate">{c.name}</span>
                      {c.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                    </div>
                    <button onClick={() => removeAddingClient(c.customer_id)} className="text-slate-400 hover:text-rose-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Submit button */}
              <Button
                onClick={handleAddToExistingProduct}
                disabled={submittingAdd || addingClients.length === 0}
                className="w-full h-12 rounded-xl bg-[#B84A5E] hover:bg-[#A33F52] text-white font-bold"
                data-testid="add-product-submit"
              >
                {submittingAdd ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>Agregar {addingClients.length} cliente(s) · {formatMoney((addToProductModal.price + addToProductModal.commission) * addingClients.length)}</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
