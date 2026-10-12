import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/App";
import { 
  getInventoryProducts, 
  createInventoryProduct, 
  updateInventoryProduct, 
  deleteInventoryProduct,
  adjustInventoryStock,
  transferInventoryStock,
  getProductsForTransfer,
  createInventorySale,
  getInventorySales,
  createPurchasesFromInventory,
  getLowStockAlerts,
  getAllClients
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ArrowLeft, 
  Package, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  ShoppingCart,
  DollarSign,
  AlertTriangle,
  BarChart3,
  Boxes,
  ArrowRightLeft,
  FileText,
  Bell,
  Check
} from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

function formatMoney(n) {
  return "$" + (n || 0).toFixed(2);
}

const LOCATION_CONFIG = {
  ecuador: {
    name: "Ecuador",
    color: "from-green-50 to-green-100",
    borderColor: "border-green-200",
    textColor: "text-green-700",
    bgColor: "bg-green-600",
    flag: "https://flagcdn.com/w40/ec.png",
    otherLocation: "usa",
    otherFlag: "https://flagcdn.com/w40/us.png",
    otherName: "USA"
  },
  usa: {
    name: "USA",
    color: "from-blue-50 to-blue-100",
    borderColor: "border-blue-200",
    textColor: "text-blue-700",
    bgColor: "bg-blue-600",
    flag: "https://flagcdn.com/w40/us.png",
    otherLocation: "ecuador",
    otherFlag: "https://flagcdn.com/w40/ec.png",
    otherName: "Ecuador"
  }
};

export default function AdminInventory() {
  const navigate = useNavigate();
  const { location } = useParams();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [lowStockAlerts, setLowStockAlerts] = useState([]);
  
  // Dialogs
  const [productDialog, setProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [saleDialog, setSaleDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [stockDialog, setStockDialog] = useState(false);
  const [stockProduct, setStockProduct] = useState(null);
  const [transferDialog, setTransferDialog] = useState(false);
  const [transferProduct, setTransferProduct] = useState(null);
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [alertsDialog, setAlertsDialog] = useState(false);
  
  // Clients for invoice
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [invoiceItems, setInvoiceItems] = useState([]);
  
  // Transfer data
  const [targetProducts, setTargetProducts] = useState([]);
  const [transferForm, setTransferForm] = useState({
    quantity: "1",
    targetProductId: "",
    createNew: false
  });
  
  // Form states
  const [productForm, setProductForm] = useState({
    name: "",
    cost: "",
    sale_price: "",
    tax_rate: "0",
    stock: "0",
    sku: "",
    description: ""
  });
  
  const [saleForm, setSaleForm] = useState({
    quantity: "1",
    customer_id: "",
    notes: ""
  });
  
  const [stockForm, setStockForm] = useState({
    adjustment: "",
    reason: ""
  });

  const config = LOCATION_CONFIG[location] || LOCATION_CONFIG.ecuador;

  useEffect(() => {
    if (!location || !["ecuador", "usa"].includes(location)) {
      navigate("/admin/inventory/ecuador");
      return;
    }
    loadData();
    loadLowStockAlerts();
  }, [location]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsRes, salesRes] = await Promise.all([
        getInventoryProducts(location),
        getInventorySales(location)
      ]);
      setProducts(productsRes.data || []);
      setSales(salesRes.data || []);
    } catch (e) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const loadLowStockAlerts = async () => {
    try {
      const res = await getLowStockAlerts(5, location);
      setLowStockAlerts(res.data?.products || []);
    } catch (e) {
      console.error("Error loading alerts:", e);
    }
  };

  const loadClients = async () => {
    try {
      const res = await getAllClients("active");
      setClients(res.data || []);
    } catch (e) {
      console.error("Error loading clients:", e);
    }
  };

  const loadTargetProducts = async () => {
    try {
      const res = await getProductsForTransfer(config.otherLocation);
      setTargetProducts(res.data || []);
    } catch (e) {
      console.error("Error loading target products:", e);
    }
  };

  // Product CRUD
  const openNewProduct = () => {
    setEditingProduct(null);
    setProductForm({
      name: "",
      cost: "",
      sale_price: "",
      tax_rate: "0",
      stock: "0",
      sku: "",
      description: ""
    });
    setProductDialog(true);
  };

  const openEditProduct = (product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      cost: product.cost.toString(),
      sale_price: product.sale_price.toString(),
      tax_rate: ((product.tax_rate || 0) * 100).toString(),
      stock: (product.stock || 0).toString(),
      sku: product.sku || "",
      description: product.description || ""
    });
    setProductDialog(true);
  };

  const handleSaveProduct = async () => {
    if (!productForm.name || !productForm.cost || !productForm.sale_price) {
      toast.error("Nombre, costo y precio de venta son obligatorios");
      return;
    }

    const data = {
      location: location,
      name: productForm.name,
      cost: parseFloat(productForm.cost),
      sale_price: parseFloat(productForm.sale_price),
      tax_rate: parseFloat(productForm.tax_rate || 0) / 100,
      stock: parseInt(productForm.stock || 0),
      sku: productForm.sku || null,
      description: productForm.description || null
    };

    try {
      if (editingProduct) {
        const { location: _, ...updateData } = data;
        await updateInventoryProduct(editingProduct.id, updateData);
        toast.success("Producto actualizado");
      } else {
        await createInventoryProduct(data);
        toast.success("Producto creado");
      }
      setProductDialog(false);
      loadData();
      loadLowStockAlerts();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al guardar");
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`¿Eliminar ${product.name}?`)) return;
    try {
      await deleteInventoryProduct(product.id);
      toast.success("Producto eliminado");
      loadData();
    } catch (e) {
      toast.error("Error al eliminar");
    }
  };

  // Sale
  const openSaleDialog = (product) => {
    setSelectedProduct(product);
    setSaleForm({ quantity: "1", customer_id: "", notes: "" });
    setSaleDialog(true);
  };

  const handleCreateSale = async () => {
    if (!selectedProduct) return;
    const qty = parseInt(saleForm.quantity || 1);
    if (qty < 1) {
      toast.error("Cantidad debe ser al menos 1");
      return;
    }
    try {
      await createInventorySale({
        product_id: selectedProduct.id,
        quantity: qty,
        customer_id: saleForm.customer_id || null,
        notes: saleForm.notes || null
      });
      toast.success("Venta registrada");
      setSaleDialog(false);
      loadData();
      loadLowStockAlerts();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al registrar venta");
    }
  };

  // Stock adjustment
  const openStockDialog = (product) => {
    setStockProduct(product);
    setStockForm({ adjustment: "", reason: "" });
    setStockDialog(true);
  };

  const handleAdjustStock = async () => {
    if (!stockProduct || !stockForm.adjustment) {
      toast.error("Ingresa la cantidad a ajustar");
      return;
    }
    try {
      await adjustInventoryStock(stockProduct.id, parseInt(stockForm.adjustment), stockForm.reason || null);
      toast.success("Stock ajustado");
      setStockDialog(false);
      loadData();
      loadLowStockAlerts();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al ajustar stock");
    }
  };

  // Transfer
  const openTransferDialog = (product) => {
    setTransferProduct(product);
    setTransferForm({ quantity: "1", targetProductId: "", createNew: false });
    loadTargetProducts();
    setTransferDialog(true);
  };

  const handleTransfer = async () => {
    if (!transferProduct) return;
    const qty = parseInt(transferForm.quantity || 1);
    if (qty < 1) {
      toast.error("Cantidad debe ser al menos 1");
      return;
    }
    if (!transferForm.createNew && !transferForm.targetProductId) {
      toast.error("Selecciona un producto destino o marca 'Crear nuevo'");
      return;
    }
    try {
      const res = await transferInventoryStock(
        transferProduct.id,
        qty,
        transferForm.createNew ? null : transferForm.targetProductId,
        transferForm.createNew
      );
      toast.success(res.data.message);
      setTransferDialog(false);
      loadData();
      loadLowStockAlerts();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error en transferencia");
    }
  };

  // Invoice
  const openInvoiceDialog = () => {
    setSelectedClient(null);
    setClientSearch("");
    setInvoiceItems([]);
    loadClients();
    setInvoiceDialog(true);
  };

  const toggleInvoiceItem = (product) => {
    const exists = invoiceItems.find(i => i.product_id === product.id);
    if (exists) {
      setInvoiceItems(invoiceItems.filter(i => i.product_id !== product.id));
    } else {
      setInvoiceItems([...invoiceItems, { 
        product_id: product.id, 
        name: product.name, 
        quantity: 1,
        price: product.sale_price,
        stock: product.stock || 0
      }]);
    }
  };

  const updateInvoiceItemQty = (productId, qty) => {
    setInvoiceItems(invoiceItems.map(i => 
      i.product_id === productId ? { ...i, quantity: Math.max(1, Math.min(qty, i.stock)) } : i
    ));
  };

  const handleCreateInvoicePurchases = async () => {
    if (!selectedClient) {
      toast.error("Selecciona un cliente");
      return;
    }
    if (invoiceItems.length === 0) {
      toast.error("Selecciona al menos un producto");
      return;
    }
    try {
      const items = invoiceItems.map(i => ({ product_id: i.product_id, quantity: i.quantity }));
      const res = await createPurchasesFromInventory(items, selectedClient.customer_id);
      
      if (res.data.errors?.length > 0) {
        res.data.errors.forEach(err => toast.error(`${err.product_name || err.product_id}: ${err.error}`));
      }
      
      if (res.data.created_count > 0) {
        toast.success(`${res.data.created_count} compras creadas para facturación`);
        
        // Show low stock alerts
        if (res.data.low_stock_alerts?.length > 0) {
          res.data.low_stock_alerts.forEach(alert => {
            toast.warning(`⚠️ Stock bajo: ${alert.name} - Solo quedan ${alert.stock} unidades`, { duration: 5000 });
          });
        }
        
        setInvoiceDialog(false);
        loadData();
        loadLowStockAlerts();
        
        // Navigate to client invoices
        navigate(`/admin/invoices?customer=${selectedClient.customer_id}`);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al crear compras");
    }
  };

  // Filter products
  const filteredProducts = products.filter(p => {
    if (!searchTerm) return p.is_active !== false;
    const term = searchTerm.toLowerCase();
    return (p.is_active !== false) && (
      p.name.toLowerCase().includes(term) ||
      (p.sku && p.sku.toLowerCase().includes(term))
    );
  });

  // Filter clients
  const filteredClients = clients.filter(c => {
    if (!clientSearch) return true;
    const term = clientSearch.toLowerCase();
    return c.name?.toLowerCase().includes(term) || 
           c.customer_id?.toLowerCase().includes(term) ||
           c.email?.toLowerCase().includes(term);
  });

  // Calculate totals
  const totalProducts = filteredProducts.length;
  const totalStock = filteredProducts.reduce((s, p) => s + (p.stock || 0), 0);
  const totalStockValue = filteredProducts.reduce((s, p) => s + p.cost * (p.stock || 0), 0);
  const lowStockCount = filteredProducts.filter(p => (p.stock || 0) < 5).length;

  // Invoice totals
  const invoiceTotal = invoiceItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg min-h-screen">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/inventory")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
          <span className="font-bold text-slate-800 flex items-center gap-2">
            Inventario <img src={config.flag} alt={config.name} className="h-5 inline-block" /> {config.name}
          </span>
          
          {/* Low stock alert badge */}
          {lowStockAlerts.length > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="relative"
              onClick={() => setAlertsDialog(true)}
              data-testid="alerts-btn"
            >
              <Bell className="h-5 w-5 text-red-500" />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {lowStockAlerts.length}
              </span>
            </Button>
          )}
          
          <div className="ml-auto flex gap-2">
            <Button
              onClick={openInvoiceDialog}
              variant="outline"
              size="sm"
              className="gap-2 border-green-500 text-green-700 hover:bg-green-50"
              data-testid="invoice-btn"
            >
              <FileText className="h-4 w-4" />
              Facturar
            </Button>
            <Button
              onClick={() => navigate(`/admin/inventory-stats/${location}`)}
              variant="outline"
              size="sm"
              className="gap-2"
              data-testid="inventory-stats-btn"
            >
              <BarChart3 className="h-4 w-4" />
              Estadísticas
            </Button>
            <Button
              onClick={openNewProduct}
              size="sm"
              className={`gap-2 ${config.bgColor} hover:opacity-90`}
              data-testid="new-product-btn"
            >
              <Plus className="h-4 w-4" />
              Nuevo
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Low Stock Alert Banner */}
        {lowStockAlerts.length > 0 && (
          <Card className="rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-700">
                  {lowStockAlerts.length} producto(s) con stock bajo
                </p>
                <p className="text-sm text-red-600">
                  {lowStockAlerts.slice(0, 3).map(p => p.name).join(", ")}
                  {lowStockAlerts.length > 3 && ` y ${lowStockAlerts.length - 3} más...`}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setAlertsDialog(true)}>
                Ver todos
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className={`rounded-xl bg-gradient-to-br ${config.color} ${config.borderColor}`}>
            <CardContent className="p-4">
              <Package className={`h-5 w-5 ${config.textColor} mb-2`} />
              <p className={`text-2xl font-extrabold ${config.textColor}`}>{totalProducts}</p>
              <p className={`text-xs ${config.textColor}`}>Productos</p>
            </CardContent>
          </Card>
          <Card className={`rounded-xl bg-gradient-to-br ${config.color} ${config.borderColor}`}>
            <CardContent className="p-4">
              <Boxes className={`h-5 w-5 ${config.textColor} mb-2`} />
              <p className={`text-2xl font-extrabold ${config.textColor}`}>{totalStock}</p>
              <p className={`text-xs ${config.textColor}`}>Stock Total</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
            <CardContent className="p-4">
              <DollarSign className="h-5 w-5 text-yellow-600 mb-2" />
              <p className="text-2xl font-extrabold text-yellow-700">{formatMoney(totalStockValue)}</p>
              <p className="text-xs text-yellow-600">Valor en Stock</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-red-50 to-red-100 border-red-200">
            <CardContent className="p-4">
              <AlertTriangle className="h-5 w-5 text-red-600 mb-2" />
              <p className="text-2xl font-extrabold text-red-700">{lowStockCount}</p>
              <p className="text-xs text-red-600">Stock Bajo (&lt;5)</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="search-products"
          />
        </div>

        {/* Products Table */}
        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Boxes className={`h-5 w-5 ${config.textColor}`} />
              Productos {config.name} ({filteredProducts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No hay productos en el inventario de {config.name}</p>
                <Button onClick={openNewProduct} className="mt-4" variant="outline">
                  Crear primer producto
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-2 font-medium">Producto</th>
                      <th className="text-right p-2 font-medium">Costo</th>
                      <th className="text-right p-2 font-medium">Precio</th>
                      <th className="text-center p-2 font-medium">Stock</th>
                      <th className="text-right p-2 font-medium">Margen</th>
                      <th className="text-center p-2 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const stock = product.stock || 0;
                      const margin = product.sale_price - product.cost;
                      const marginPercent = product.cost > 0 ? ((margin / product.cost) * 100).toFixed(0) : 0;
                      const isLowStock = stock < 5;
                      
                      return (
                        <tr 
                          key={product.id} 
                          className={`border-b hover:bg-gray-50 ${isLowStock ? 'bg-red-50/50' : ''}`}
                          data-testid={`product-row-${product.id}`}
                        >
                          <td className="p-2">
                            <div className="font-medium text-slate-800">{product.name}</div>
                            {product.sku && <div className="text-xs text-gray-500">SKU: {product.sku}</div>}
                          </td>
                          <td className="p-2 text-right font-mono">{formatMoney(product.cost)}</td>
                          <td className="p-2 text-right font-mono font-semibold text-green-700">
                            {formatMoney(product.sale_price)}
                          </td>
                          <td className="p-2 text-center">
                            <Badge variant={isLowStock ? "destructive" : "outline"} className="font-mono">
                              {stock}
                            </Badge>
                          </td>
                          <td className="p-2 text-right">
                            <span className="font-semibold text-blue-700">{formatMoney(margin)}</span>
                            <span className="text-xs text-gray-500 ml-1">({marginPercent}%)</span>
                          </td>
                          <td className="p-2">
                            <div className="flex justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openTransferDialog(product)}
                                title={`Transferir a ${config.otherName}`}
                                data-testid={`transfer-${product.id}`}
                              >
                                <ArrowRightLeft className="h-4 w-4 text-purple-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openSaleDialog(product)}
                                title="Registrar venta"
                                data-testid={`sell-${product.id}`}
                              >
                                <ShoppingCart className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openStockDialog(product)}
                                title="Ajustar stock"
                                data-testid={`adjust-${product.id}`}
                              >
                                <Boxes className="h-4 w-4 text-blue-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditProduct(product)}
                                title="Editar"
                                data-testid={`edit-${product.id}`}
                              >
                                <Edit2 className="h-4 w-4 text-gray-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteProduct(product)}
                                title="Eliminar"
                                data-testid={`delete-${product.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Sales */}
        {sales.length > 0 && (
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-green-600" />
                Ventas Recientes {config.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sales.slice(0, 10).map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-slate-800">{sale.product_name}</p>
                      <p className="text-xs text-gray-500">
                        {sale.quantity}x @ {formatMoney(sale.unit_price)}
                        {sale.customer_name && ` • ${sale.customer_name}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-700">{formatMoney(sale.total_amount)}</p>
                      <p className="text-xs text-blue-600">+{formatMoney(sale.profit)} ganancia</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Product Dialog */}
      <Dialog open={productDialog} onOpenChange={setProductDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Editar Producto" : `Nuevo Producto ${config.name}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Nombre *</Label>
              <Input value={productForm.name} onChange={(e) => setProductForm({...productForm, name: e.target.value})} data-testid="product-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Costo *</Label>
                <Input type="number" step="0.01" value={productForm.cost} onChange={(e) => setProductForm({...productForm, cost: e.target.value})} data-testid="product-cost-input" />
              </div>
              <div>
                <Label>Precio Venta *</Label>
                <Input type="number" step="0.01" value={productForm.sale_price} onChange={(e) => setProductForm({...productForm, sale_price: e.target.value})} data-testid="product-price-input" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Impuesto (%)</Label>
                <Input type="number" step="0.01" value={productForm.tax_rate} onChange={(e) => setProductForm({...productForm, tax_rate: e.target.value})} data-testid="product-tax-input" />
              </div>
              <div>
                <Label>Stock</Label>
                <Input type="number" value={productForm.stock} onChange={(e) => setProductForm({...productForm, stock: e.target.value})} data-testid="product-stock-input" />
              </div>
            </div>
            <div>
              <Label>SKU (opcional)</Label>
              <Input value={productForm.sku} onChange={(e) => setProductForm({...productForm, sku: e.target.value})} data-testid="product-sku-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveProduct} data-testid="save-product-btn">{editingProduct ? "Actualizar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sale Dialog */}
      <Dialog open={saleDialog} onOpenChange={setSaleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Venta</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4 py-4">
              <div className={`bg-gradient-to-br ${config.color} p-3 rounded-lg`}>
                <p className="font-bold">{selectedProduct.name}</p>
                <p className="text-sm">Precio: {formatMoney(selectedProduct.sale_price)} • Stock: {selectedProduct.stock || 0}</p>
              </div>
              <div>
                <Label>Cantidad</Label>
                <Input type="number" min="1" value={saleForm.quantity} onChange={(e) => setSaleForm({...saleForm, quantity: e.target.value})} data-testid="sale-quantity-input" />
              </div>
              <div>
                <Label>Cliente (opcional)</Label>
                <Input value={saleForm.customer_id} onChange={(e) => setSaleForm({...saleForm, customer_id: e.target.value})} placeholder="Código cliente" data-testid="sale-customer-input" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaleDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreateSale} className="bg-green-600 hover:bg-green-700" data-testid="confirm-sale-btn">Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Adjustment Dialog */}
      <Dialog open={stockDialog} onOpenChange={setStockDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajustar Stock</DialogTitle>
          </DialogHeader>
          {stockProduct && (
            <div className="space-y-4 py-4">
              <div className={`bg-gradient-to-br ${config.color} p-3 rounded-lg`}>
                <p className="font-bold">{stockProduct.name}</p>
                <p className="text-sm">Stock actual: {stockProduct.stock || 0}</p>
              </div>
              <div>
                <Label>Ajuste (+/-)</Label>
                <Input type="number" value={stockForm.adjustment} onChange={(e) => setStockForm({...stockForm, adjustment: e.target.value})} placeholder="Ej: 10 o -5" data-testid="stock-adjustment-input" />
              </div>
              <div>
                <Label>Razón (opcional)</Label>
                <Input value={stockForm.reason} onChange={(e) => setStockForm({...stockForm, reason: e.target.value})} data-testid="stock-reason-input" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockDialog(false)}>Cancelar</Button>
            <Button onClick={handleAdjustStock} data-testid="confirm-adjustment-btn">Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Transferir a <img src={config.otherFlag} alt={config.otherName} className="h-5 inline-block" /> {config.otherName}
            </DialogTitle>
          </DialogHeader>
          {transferProduct && (
            <div className="space-y-4 py-4">
              <div className={`bg-gradient-to-br ${config.color} p-3 rounded-lg`}>
                <p className="font-bold">{transferProduct.name}</p>
                <p className="text-sm">Stock disponible en {config.name}: {transferProduct.stock || 0}</p>
              </div>
              <div>
                <Label>Cantidad a transferir</Label>
                <Input type="number" min="1" max={transferProduct.stock || 0} value={transferForm.quantity} onChange={(e) => setTransferForm({...transferForm, quantity: e.target.value})} data-testid="transfer-quantity-input" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="create-new" 
                  checked={transferForm.createNew} 
                  onCheckedChange={(checked) => setTransferForm({...transferForm, createNew: checked, targetProductId: ""})}
                />
                <Label htmlFor="create-new" className="cursor-pointer">Crear producto nuevo en {config.otherName}</Label>
              </div>
              {!transferForm.createNew && (
                <div>
                  <Label>O seleccionar producto existente en {config.otherName}</Label>
                  <select
                    value={transferForm.targetProductId}
                    onChange={(e) => setTransferForm({...transferForm, targetProductId: e.target.value})}
                    className="w-full border rounded-md px-3 py-2 bg-white mt-1"
                    data-testid="transfer-target-select"
                  >
                    <option value="">-- Seleccionar --</option>
                    {targetProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="bg-purple-50 p-3 rounded-lg text-center">
                <ArrowRightLeft className="h-6 w-6 mx-auto text-purple-600 mb-2" />
                <p className="text-sm text-purple-700 flex items-center justify-center gap-2">
                  {transferForm.quantity || 0} unidades de <img src={config.flag} alt={config.name} className="h-4 inline-block" /> {config.name} → <img src={config.otherFlag} alt={config.otherName} className="h-4 inline-block" /> {config.otherName}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(false)}>Cancelar</Button>
            <Button onClick={handleTransfer} className="bg-purple-600 hover:bg-purple-700" data-testid="confirm-transfer-btn">Transferir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Dialog */}
      <Dialog open={invoiceDialog} onOpenChange={setInvoiceDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-600" />
              Facturar Productos de Inventario <img src={config.flag} alt={config.name} className="h-5 inline-block" />
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Client Selection */}
            <div>
              <Label className="font-semibold">1. Seleccionar Cliente</Label>
              <Input
                placeholder="Buscar cliente por nombre o código..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="mt-2"
                data-testid="client-search-input"
              />
              {selectedClient ? (
                <div className="mt-2 p-3 bg-green-50 rounded-lg border border-green-200 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-green-800">{selectedClient.name}</p>
                    <p className="text-sm text-green-600">{selectedClient.customer_id}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedClient(null)}>Cambiar</Button>
                </div>
              ) : (
                <div className="mt-2 max-h-40 overflow-y-auto border rounded-lg">
                  {filteredClients.slice(0, 20).map(client => (
                    <div
                      key={client.id}
                      onClick={() => setSelectedClient(client)}
                      className="p-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium">{client.name}</p>
                        <p className="text-xs text-gray-500">{client.customer_id}</p>
                      </div>
                      <Check className="h-4 w-4 text-gray-300" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Product Selection */}
            <div>
              <Label className="font-semibold">2. Seleccionar Productos</Label>
              <p className="text-xs text-gray-500 mb-2">Los productos se marcarán como [INVENTARIO] en la factura</p>
              <div className="mt-2 max-h-60 overflow-y-auto border rounded-lg">
                {filteredProducts.filter(p => (p.stock || 0) > 0).map(product => {
                  const isSelected = invoiceItems.find(i => i.product_id === product.id);
                  return (
                    <div
                      key={product.id}
                      className={`p-3 border-b last:border-b-0 ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={!!isSelected}
                          onCheckedChange={() => toggleInvoiceItem(product)}
                          data-testid={`invoice-item-${product.id}`}
                        />
                        <div className="flex-1">
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-gray-500">
                            {formatMoney(product.sale_price)} • Stock: {product.stock}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">Cant:</Label>
                            <Input
                              type="number"
                              min="1"
                              max={product.stock}
                              value={isSelected.quantity}
                              onChange={(e) => updateInvoiceItemQty(product.id, parseInt(e.target.value) || 1)}
                              className="w-16 h-8 text-center"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            {invoiceItems.length > 0 && (
              <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                <p className="font-semibold text-amber-800 mb-2">Resumen de Facturación</p>
                {invoiceItems.map(item => (
                  <div key={item.product_id} className="flex justify-between text-sm py-1">
                    <span>[INVENTARIO] {item.name} x{item.quantity}</span>
                    <span className="font-mono">{formatMoney(item.price * item.quantity)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold mt-2 pt-2 border-t border-amber-300">
                  <span>Total</span>
                  <span className="text-green-700">{formatMoney(invoiceTotal)}</span>
                </div>
                <p className="text-xs text-amber-600 mt-2">
                  * Se crearán compras pendientes que podrás facturar desde el módulo de Facturas
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceDialog(false)}>Cancelar</Button>
            <Button 
              onClick={handleCreateInvoicePurchases} 
              className="bg-green-600 hover:bg-green-700"
              disabled={!selectedClient || invoiceItems.length === 0}
              data-testid="create-invoice-purchases-btn"
            >
              Crear Compras para Facturar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Low Stock Alerts Dialog */}
      <Dialog open={alertsDialog} onOpenChange={setAlertsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              Alertas de Stock Bajo
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-500 mb-4">
              Productos con menos de 5 unidades en {config.name}
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {lowStockAlerts.map(product => (
                <div key={product.id} className="bg-red-50 p-3 rounded-lg border border-red-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{product.name}</p>
                      {product.sku && <p className="text-xs text-gray-500">SKU: {product.sku}</p>}
                    </div>
                    <Badge variant="destructive" className="font-mono">
                      {product.stock} uds
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setAlertsDialog(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
