import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Package,
  Plus,
  Edit2,
  Trash2,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  BarChart3,
  Search,
  UserPlus,
  Check,
  Sparkles,
  FileText,
} from "lucide-react";
import {
  getPacas,
  createPaca,
  updatePaca,
  deletePaca,
  createPacaSale,
  getPacaSales,
  getAllClients,
} from "@/lib/api";
import { useHideFinancials } from "@/components/MoneyDisplay";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

const COMMISSION_OPTIONS = [
  { value: "50", label: "$50" },
  { value: "55", label: "$55" },
  { value: "60", label: "$60" },
  { value: "otro", label: "Otro" },
];

export default function AdminPacas() {
  const navigate = useNavigate();
  const { user, hideFinancials } = useAuth();
  const { formatMoney } = useHideFinancials();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;

  const [loading, setLoading] = useState(true);
  const [pacas, setPacas] = useState([]);
  const [sales, setSales] = useState([]);
  const [clients, setClients] = useState([]);

  // Dialogs
  const [pacaDialog, setPacaDialog] = useState(false);
  const [sellDialog, setSellDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [createClientDialog, setCreateClientDialog] = useState(false);

  // Form states
  const [editingPaca, setEditingPaca] = useState(null);
  const [pacaForm, setPacaForm] = useState({
    name: "",
    description: "",
    sale_price: "",
    commission: "",
  });
  const [commissionOption, setCommissionOption] = useState("50");

  // Sell states
  const [selectedPaca, setSelectedPaca] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [submittingSale, setSubmittingSale] = useState(false);

  // Delete state
  const [pacaToDelete, setPacaToDelete] = useState(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const clientSearchRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pacasRes, salesRes, clientsRes] = await Promise.all([
        getPacas(),
        getPacaSales("week"),
        getAllClients("active"),
      ]);
      setPacas(pacasRes.data || []);
      setSales(salesRes.data || []);
      setClients(clientsRes.data || []);
    } catch (err) {
      toast.error("Error cargando datos");
    } finally {
      setLoading(false);
    }
  };

  // Handle commission option change
  const handleCommissionChange = (value) => {
    setCommissionOption(value);
    if (value !== "otro") {
      setPacaForm({ ...pacaForm, commission: value });
    }
  };

  // Open create paca dialog
  const openCreatePaca = () => {
    setEditingPaca(null);
    setPacaForm({ name: "", description: "", sale_price: "", commission: "50" });
    setCommissionOption("50");
    setPacaDialog(true);
  };

  // Open edit paca dialog
  const openEditPaca = (paca) => {
    setEditingPaca(paca);
    const commVal = String(paca.commission);
    const isPreset = COMMISSION_OPTIONS.some(o => o.value === commVal && o.value !== "otro");
    setCommissionOption(isPreset ? commVal : "otro");
    setPacaForm({
      name: paca.name,
      description: paca.description || "",
      sale_price: String(paca.sale_price),
      commission: commVal,
    });
    setPacaDialog(true);
  };

  // Save paca
  const handleSavePaca = async () => {
    if (!pacaForm.name.trim()) {
      toast.error("Ingresa el nombre de la paca");
      return;
    }
    if (!pacaForm.sale_price || parseFloat(pacaForm.sale_price) <= 0) {
      toast.error("Ingresa un precio de venta válido");
      return;
    }
    if (!pacaForm.commission || parseFloat(pacaForm.commission) < 0) {
      toast.error("Ingresa una comisión válida");
      return;
    }

    try {
      const data = {
        name: pacaForm.name.trim(),
        description: pacaForm.description.trim() || null,
        sale_price: parseFloat(pacaForm.sale_price),
        commission: parseFloat(pacaForm.commission),
      };

      if (editingPaca) {
        await updatePaca(editingPaca.id, data);
        toast.success("Paca actualizada");
      } else {
        await createPaca(data);
        toast.success("Paca creada exitosamente");
      }
      setPacaDialog(false);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error guardando paca");
    }
  };

  // Delete paca
  const handleDeletePaca = async () => {
    if (!pacaToDelete) return;
    try {
      await deletePaca(pacaToDelete.id);
      toast.success("Paca eliminada");
      setDeleteDialog(false);
      setPacaToDelete(null);
      loadData();
    } catch (err) {
      toast.error("Error eliminando paca");
    }
  };

  // Open sell dialog
  const openSellDialog = (paca) => {
    setSelectedPaca(paca);
    setSelectedClient(null);
    setClientSearch("");
    setSellDialog(true);
    setTimeout(() => clientSearchRef.current?.focus(), 100);
  };

  // Select client for sale
  const selectClientForSale = (client) => {
    setSelectedClient(client);
    setClientSearch("");
  };

  // Handle paca sale
  const handleSell = async () => {
    if (!selectedPaca || !selectedClient) {
      toast.error("Selecciona una paca y un cliente");
      return;
    }
    setSubmittingSale(true);
    try {
      const res = await createPacaSale({
        paca_id: selectedPaca.id,
        customer_id: selectedClient.customer_id,
      });
      toast.success(`Paca vendida a ${res.data.client_name || selectedClient.name}`);
      setSellDialog(false);
      setSelectedPaca(null);
      setSelectedClient(null);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Error vendiendo paca");
    } finally {
      setSubmittingSale(false);
    }
  };

  // Filter pacas
  const filteredPacas = pacas.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.description || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter clients for search
  const filteredClients = clientSearch.length > 0
    ? clients.filter(c =>
        c.customer_id?.toLowerCase().includes(clientSearch.toLowerCase()) ||
        c.name?.toLowerCase().includes(clientSearch.toLowerCase())
      ).slice(0, 10)
    : [];

  // Stats
  const totalPacas = pacas.length;
  const totalSalesWeek = sales.length;
  const totalRevenue = sales.reduce((sum, s) => sum + (s.sale_price || 0), 0);
  const totalCommission = sales.reduce((sum, s) => sum + (s.commission || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-700 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/admin")}
                className="text-white hover:bg-white/20"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="h-10 w-10 rounded-full object-cover border-2 border-white/30"
                />
                <div>
                  <h1 className="text-xl font-bold flex items-center gap-2">
                    <Package className="h-6 w-6" />
                    Pacas
                  </h1>
                  <p className="text-amber-100 text-sm">Gestión de paquetes de productos</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigate("/admin/pacas/stats")}
                variant="outline"
                className="border-white/30 text-white hover:bg-white/20"
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Estadísticas
              </Button>
              <Button
                onClick={openCreatePaca}
                className="bg-white text-amber-700 hover:bg-amber-50"
                data-testid="new-paca-btn"
              >
                <Plus className="h-4 w-4 mr-2" />
                Nueva Paca
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Package className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-700">{totalPacas}</p>
                  <p className="text-xs text-amber-600">Pacas Registradas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <ShoppingCart className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-700">{totalSalesWeek}</p>
                  <p className="text-xs text-green-600">Ventas (Semana)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-700">{formatMoney(totalRevenue)}</p>
                  <p className="text-xs text-blue-600">Ingresos (Semana)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-700">{formatMoney(totalCommission)}</p>
                  <p className="text-xs text-purple-600">Ganancias (Semana)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar pacas..."
              className="pl-10"
            />
          </div>
        </div>

        {/* Pacas Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full text-center py-12 text-slate-500">
              Cargando pacas...
            </div>
          ) : filteredPacas.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <Package className="h-12 w-12 mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500">No hay pacas registradas</p>
              <Button onClick={openCreatePaca} className="mt-4 bg-amber-600 hover:bg-amber-700">
                <Plus className="h-4 w-4 mr-2" />
                Crear Primera Paca
              </Button>
            </div>
          ) : (
            filteredPacas.map((paca) => (
              <Card
                key={paca.id}
                className="hover:shadow-lg transition-all duration-300 border-l-4 border-l-amber-500 overflow-hidden"
                data-testid={`paca-card-${paca.id}`}
              >
                <CardContent className="p-0">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-4 text-white">
                    <h3 className="font-bold text-lg">{paca.name}</h3>
                    {paca.description && (
                      <p className="text-amber-100 text-sm mt-1 line-clamp-2">{paca.description}</p>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-xs text-slate-500">Precio de Venta</p>
                        <p className="text-2xl font-bold text-slate-800">{formatMoney(paca.sale_price)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Ganancia</p>
                        <Badge className="bg-green-100 text-green-700 text-lg font-bold px-3 py-1">
                          +{formatMoney(paca.commission)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => openSellDialog(paca)}
                        className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                        data-testid={`sell-paca-${paca.id}`}
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Vender
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openEditPaca(paca)}
                        className="border-slate-300"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => { setPacaToDelete(paca); setDeleteDialog(true); }}
                        className="border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Recent Sales */}
        {sales.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-amber-600" />
              Ventas Recientes (Esta Semana)
            </h2>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {sales.slice(0, 10).map((sale) => (
                    <div key={sale.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-lg">
                          <Package className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{sale.paca_name}</p>
                          <p className="text-sm text-slate-500">
                            <span className="text-amber-600 font-semibold">{sale.customer_id}</span>
                            {" · "}{sale.client_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="font-bold text-slate-800">{formatMoney(sale.sale_price)}</p>
                          <p className="text-xs text-green-600">+{formatMoney(sale.commission)}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => navigate(`/admin/invoices?customer_id=${sale.customer_id}&create=true`)}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          data-testid={`invoice-sale-${sale.id}`}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Facturar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create/Edit Paca Dialog */}
      <Dialog open={pacaDialog} onOpenChange={setPacaDialog}>
        <DialogContent className="max-w-md overflow-hidden border-0 shadow-2xl">
          <div className="-mx-6 -mt-6 mb-4 p-5 bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxjaXJjbGUgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuMSIgY3g9IjIwIiBjeT0iMjAiIHI9IjIiLz48L2c+PC9zdmc+')] opacity-50"></div>
            <div className="relative flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                {editingPaca ? <Edit2 className="h-6 w-6 text-white" /> : <Sparkles className="h-6 w-6 text-white animate-pulse" />}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  {editingPaca ? "Editar Paca" : "Nueva Paca"}
                </h2>
                <p className="text-white/80 text-sm">Paquete de productos</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-1">
            <div>
              <Label className="text-slate-700 font-semibold">Nombre de la Paca *</Label>
              <Input
                value={pacaForm.name}
                onChange={(e) => setPacaForm({ ...pacaForm, name: e.target.value })}
                placeholder="Ej: Paca de niño, Paca de maquillaje..."
                className="mt-1"
                data-testid="paca-name-input"
              />
            </div>

            <div>
              <Label className="text-slate-700 font-semibold">Descripción</Label>
              <Textarea
                value={pacaForm.description}
                onChange={(e) => setPacaForm({ ...pacaForm, description: e.target.value })}
                placeholder="Descripción opcional de la paca..."
                className="mt-1 resize-none"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-3 rounded-xl border border-blue-200">
                <Label className="text-blue-700 text-xs font-semibold flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  Precio de Venta *
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={pacaForm.sale_price}
                  onChange={(e) => setPacaForm({ ...pacaForm, sale_price: e.target.value })}
                  placeholder="0.00"
                  className="mt-1 h-10 text-lg font-semibold border-blue-300"
                  data-testid="paca-price-input"
                />
              </div>

              <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-3 rounded-xl border border-green-200">
                <Label className="text-green-700 text-xs font-semibold flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Comisión/Ganancia *
                </Label>
                <Select value={commissionOption} onValueChange={handleCommissionChange}>
                  <SelectTrigger className="mt-1 border-green-300">
                    <SelectValue placeholder="Selecciona..." />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMISSION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {commissionOption === "otro" && (
                  <Input
                    type="number"
                    step="0.01"
                    value={pacaForm.commission}
                    onChange={(e) => setPacaForm({ ...pacaForm, commission: e.target.value })}
                    placeholder="Ingresa monto"
                    className="mt-2 h-9 border-green-300"
                    data-testid="paca-commission-input"
                  />
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={() => setPacaDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSavePaca}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="save-paca-btn"
            >
              {editingPaca ? "Actualizar" : "Crear Paca"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sell Paca Dialog */}
      <Dialog open={sellDialog} onOpenChange={setSellDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-amber-600" />
              Vender Paca
            </DialogTitle>
            <DialogDescription>
              {selectedPaca && (
                <span className="text-amber-600 font-semibold">{selectedPaca.name}</span>
              )}
              {selectedPaca && ` · ${formatMoney(selectedPaca.sale_price)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="text-slate-700 font-semibold">Buscar Cliente *</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  ref={clientSearchRef}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar por código o nombre..."
                  className="pl-10"
                  data-testid="client-search-input"
                />
              </div>

              {/* Client suggestions */}
              {filteredClients.length > 0 && !selectedClient && (
                <div className="mt-2 border rounded-lg max-h-40 overflow-y-auto">
                  {filteredClients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => selectClientForSale(client)}
                      className="w-full p-2 text-left hover:bg-amber-50 flex items-center justify-between border-b last:border-b-0"
                    >
                      <span>
                        <span className="font-semibold text-amber-600">{client.customer_id}</span>
                        {" · "}{client.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* No results - option to create client */}
              {clientSearch.length > 2 && filteredClients.length === 0 && !selectedClient && (
                <div className="mt-2 p-3 border rounded-lg bg-slate-50 text-center">
                  <p className="text-sm text-slate-500 mb-2">No se encontró el cliente</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/admin/clients?action=create")}
                    className="border-amber-300 text-amber-600 hover:bg-amber-50"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Crear Cliente Nuevo
                  </Button>
                </div>
              )}

              {/* Selected client */}
              {selectedClient && (
                <div className="mt-2 p-3 border-2 border-green-300 rounded-lg bg-green-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-800">{selectedClient.customer_id}</p>
                      <p className="text-sm text-green-600">{selectedClient.name}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedClient(null)}
                    className="text-slate-500"
                  >
                    Cambiar
                  </Button>
                </div>
              )}
            </div>

            {selectedPaca && selectedClient && (
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-sm text-amber-700 mb-2">Resumen de la venta:</p>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{selectedPaca.name}</span>
                  <span className="font-bold text-lg">{formatMoney(selectedPaca.sale_price)}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-green-600 mt-1">
                  <span>Tu ganancia:</span>
                  <span className="font-semibold">+{formatMoney(selectedPaca.commission)}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSellDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSell}
              disabled={!selectedClient || submittingSale}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="confirm-sale-btn"
            >
              {submittingSale ? "Procesando..." : "Confirmar Venta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600">Eliminar Paca</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de eliminar <strong>{pacaToDelete?.name}</strong>? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleDeletePaca} className="bg-red-600 hover:bg-red-700 text-white">
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
