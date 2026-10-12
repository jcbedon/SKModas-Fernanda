import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { 
  getInventoryProducts, 
  createInventoryProduct, 
  updateInventoryProduct, 
  deleteInventoryProduct,
  adjustInventoryStock,
  createInventorySale,
  getInventorySales
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  Package, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  ShoppingCart,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Boxes,
  MapPin
} from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

function formatMoney(n) {
  return "$" + (n || 0).toFixed(2);
}

export default function AdminInventory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("products");
  
  // Dialogs
  const [productDialog, setProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [saleDialog, setSaleDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [stockDialog, setStockDialog] = useState(false);
  const [stockProduct, setStockProduct] = useState(null);
  
  // Form states
  const [productForm, setProductForm] = useState({
    name: "",
    cost: "",
    sale_price: "",
    tax_rate: "0",
    stock_ecuador: "0",
    stock_usa: "0",
    sku: "",
    description: ""
  });
  
  const [saleForm, setSaleForm] = useState({
    quantity: "1",
    location: "ecuador",
    customer_id: "",
    notes: ""
  });
  
  const [stockForm, setStockForm] = useState({
    adjustment: "",
    location: "ecuador",
    reason: ""
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsRes, salesRes] = await Promise.all([
        getInventoryProducts(),
        getInventorySales()
      ]);
      setProducts(productsRes.data || []);
      setSales(salesRes.data || []);
    } catch (e) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const openNewProduct = () => {
    setEditingProduct(null);
    setProductForm({
      name: "",
      cost: "",
      sale_price: "",
      tax_rate: "0",
      stock_ecuador: "0",
      stock_usa: "0",
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
      tax_rate: (product.tax_rate * 100).toString(),
      stock_ecuador: product.stock_ecuador.toString(),
      stock_usa: product.stock_usa.toString(),
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
      name: productForm.name,
      cost: parseFloat(productForm.cost),
      sale_price: parseFloat(productForm.sale_price),
      tax_rate: parseFloat(productForm.tax_rate || 0) / 100,
      stock_ecuador: parseInt(productForm.stock_ecuador || 0),
      stock_usa: parseInt(productForm.stock_usa || 0),
      sku: productForm.sku || null,
      description: productForm.description || null
    };

    try {
      if (editingProduct) {
        await updateInventoryProduct(editingProduct.id, data);
        toast.success("Producto actualizado");
      } else {
        await createInventoryProduct(data);
        toast.success("Producto creado");
      }
      setProductDialog(false);
      loadData();
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

  const openSaleDialog = (product) => {
    setSelectedProduct(product);
    setSaleForm({
      quantity: "1",
      location: "ecuador",
      customer_id: "",
      notes: ""
    });
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
        location: saleForm.location,
        customer_id: saleForm.customer_id || null,
        notes: saleForm.notes || null
      });
      toast.success("Venta registrada");
      setSaleDialog(false);
      loadData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al registrar venta");
    }
  };

  const openStockDialog = (product) => {
    setStockProduct(product);
    setStockForm({
      adjustment: "",
      location: "ecuador",
      reason: ""
    });
    setStockDialog(true);
  };

  const handleAdjustStock = async () => {
    if (!stockProduct || !stockForm.adjustment) {
      toast.error("Ingresa la cantidad a ajustar");
      return;
    }

    try {
      await adjustInventoryStock(
        stockProduct.id,
        parseInt(stockForm.adjustment),
        stockForm.location,
        stockForm.reason || null
      );
      toast.success("Stock ajustado");
      setStockDialog(false);
      loadData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al ajustar stock");
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

  // Calculate summary stats
  const totalProducts = filteredProducts.length;
  const totalStockEcuador = filteredProducts.reduce((s, p) => s + (p.stock_ecuador || 0), 0);
  const totalStockUSA = filteredProducts.reduce((s, p) => s + (p.stock_usa || 0), 0);
  const totalStockValue = filteredProducts.reduce((s, p) => s + p.cost * ((p.stock_ecuador || 0) + (p.stock_usa || 0)), 0);
  const lowStockCount = filteredProducts.filter(p => (p.stock_ecuador || 0) + (p.stock_usa || 0) < 5).length;

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
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
          <span className="font-bold text-slate-800">Inventario</span>
          <div className="ml-auto flex gap-2">
            <Button
              onClick={() => navigate("/admin/inventory-stats")}
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
              className="gap-2 bg-blue-600 hover:bg-blue-700"
              data-testid="new-product-btn"
            >
              <Plus className="h-4 w-4" />
              Nuevo Producto
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-4">
              <Package className="h-5 w-5 text-blue-600 mb-2" />
              <p className="text-2xl font-extrabold text-blue-700">{totalProducts}</p>
              <p className="text-xs text-blue-600">Productos</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-4">
              <MapPin className="h-5 w-5 text-green-600 mb-2" />
              <p className="text-2xl font-extrabold text-green-700">{totalStockEcuador}</p>
              <p className="text-xs text-green-600">Stock Ecuador</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="p-4">
              <MapPin className="h-5 w-5 text-purple-600 mb-2" />
              <p className="text-2xl font-extrabold text-purple-700">{totalStockUSA}</p>
              <p className="text-xs text-purple-600">Stock USA</p>
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
              <Boxes className="h-5 w-5 text-blue-600" />
              Productos ({filteredProducts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No hay productos en el inventario</p>
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
                      <th className="text-right p-2 font-medium">Precio Venta</th>
                      <th className="text-right p-2 font-medium">Impuesto</th>
                      <th className="text-center p-2 font-medium">Ecuador</th>
                      <th className="text-center p-2 font-medium">USA</th>
                      <th className="text-right p-2 font-medium">Margen</th>
                      <th className="text-center p-2 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const totalStock = (product.stock_ecuador || 0) + (product.stock_usa || 0);
                      const margin = product.sale_price - product.cost;
                      const marginPercent = product.cost > 0 ? ((margin / product.cost) * 100).toFixed(0) : 0;
                      const isLowStock = totalStock < 5;
                      
                      return (
                        <tr 
                          key={product.id} 
                          className={`border-b hover:bg-gray-50 ${isLowStock ? 'bg-red-50/50' : ''}`}
                          data-testid={`product-row-${product.id}`}
                        >
                          <td className="p-2">
                            <div className="font-medium text-slate-800">{product.name}</div>
                            {product.sku && (
                              <div className="text-xs text-gray-500">SKU: {product.sku}</div>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono">{formatMoney(product.cost)}</td>
                          <td className="p-2 text-right font-mono font-semibold text-green-700">
                            {formatMoney(product.sale_price)}
                          </td>
                          <td className="p-2 text-right text-gray-600">
                            {((product.tax_rate || 0) * 100).toFixed(1)}%
                          </td>
                          <td className="p-2 text-center">
                            <Badge 
                              variant={product.stock_ecuador < 5 ? "destructive" : "outline"}
                              className="font-mono"
                            >
                              {product.stock_ecuador || 0}
                            </Badge>
                          </td>
                          <td className="p-2 text-center">
                            <Badge 
                              variant={product.stock_usa < 5 ? "destructive" : "secondary"}
                              className="font-mono"
                            >
                              {product.stock_usa || 0}
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
                Ventas Recientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sales.slice(0, 10).map((sale) => (
                  <div 
                    key={sale.id} 
                    className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                    data-testid={`sale-row-${sale.id}`}
                  >
                    <div>
                      <p className="font-medium text-slate-800">{sale.product_name}</p>
                      <p className="text-xs text-gray-500">
                        {sale.quantity}x @ {formatMoney(sale.unit_price)} • {sale.location.toUpperCase()}
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
            <DialogTitle>
              {editingProduct ? "Editar Producto" : "Nuevo Producto"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={productForm.name}
                onChange={(e) => setProductForm({...productForm, name: e.target.value})}
                placeholder="Nombre del producto"
                data-testid="product-name-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Costo *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={productForm.cost}
                  onChange={(e) => setProductForm({...productForm, cost: e.target.value})}
                  placeholder="0.00"
                  data-testid="product-cost-input"
                />
              </div>
              <div>
                <Label>Precio Venta *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={productForm.sale_price}
                  onChange={(e) => setProductForm({...productForm, sale_price: e.target.value})}
                  placeholder="0.00"
                  data-testid="product-price-input"
                />
              </div>
            </div>
            <div>
              <Label>Impuesto (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={productForm.tax_rate}
                onChange={(e) => setProductForm({...productForm, tax_rate: e.target.value})}
                placeholder="8.25"
                data-testid="product-tax-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Stock Ecuador</Label>
                <Input
                  type="number"
                  value={productForm.stock_ecuador}
                  onChange={(e) => setProductForm({...productForm, stock_ecuador: e.target.value})}
                  placeholder="0"
                  data-testid="product-stock-ecuador-input"
                />
              </div>
              <div>
                <Label>Stock USA</Label>
                <Input
                  type="number"
                  value={productForm.stock_usa}
                  onChange={(e) => setProductForm({...productForm, stock_usa: e.target.value})}
                  placeholder="0"
                  data-testid="product-stock-usa-input"
                />
              </div>
            </div>
            <div>
              <Label>SKU (opcional)</Label>
              <Input
                value={productForm.sku}
                onChange={(e) => setProductForm({...productForm, sku: e.target.value})}
                placeholder="Código de producto"
                data-testid="product-sku-input"
              />
            </div>
            <div>
              <Label>Descripción (opcional)</Label>
              <Input
                value={productForm.description}
                onChange={(e) => setProductForm({...productForm, description: e.target.value})}
                placeholder="Descripción breve"
                data-testid="product-description-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveProduct} data-testid="save-product-btn">
              {editingProduct ? "Actualizar" : "Crear"}
            </Button>
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
              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="font-bold text-slate-800">{selectedProduct.name}</p>
                <p className="text-sm text-gray-600">
                  Precio: {formatMoney(selectedProduct.sale_price)}
                  {selectedProduct.tax_rate > 0 && ` + ${(selectedProduct.tax_rate * 100).toFixed(1)}% imp.`}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span>Ecuador: <strong>{selectedProduct.stock_ecuador}</strong></span>
                  <span>USA: <strong>{selectedProduct.stock_usa}</strong></span>
                </div>
              </div>
              <div>
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min="1"
                  value={saleForm.quantity}
                  onChange={(e) => setSaleForm({...saleForm, quantity: e.target.value})}
                  data-testid="sale-quantity-input"
                />
              </div>
              <div>
                <Label>Ubicación</Label>
                <select
                  value={saleForm.location}
                  onChange={(e) => setSaleForm({...saleForm, location: e.target.value})}
                  className="w-full border rounded-md px-3 py-2 bg-white"
                  data-testid="sale-location-select"
                >
                  <option value="ecuador">Ecuador</option>
                  <option value="usa">USA</option>
                </select>
              </div>
              <div>
                <Label>Código Cliente (opcional)</Label>
                <Input
                  value={saleForm.customer_id}
                  onChange={(e) => setSaleForm({...saleForm, customer_id: e.target.value})}
                  placeholder="Ej: ABC123"
                  data-testid="sale-customer-input"
                />
              </div>
              <div>
                <Label>Notas (opcional)</Label>
                <Input
                  value={saleForm.notes}
                  onChange={(e) => setSaleForm({...saleForm, notes: e.target.value})}
                  placeholder="Notas adicionales"
                  data-testid="sale-notes-input"
                />
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span>{formatMoney(selectedProduct.sale_price * (parseInt(saleForm.quantity) || 1))}</span>
                </div>
                {selectedProduct.tax_rate > 0 && (
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Impuesto:</span>
                    <span>{formatMoney(selectedProduct.sale_price * (parseInt(saleForm.quantity) || 1) * selectedProduct.tax_rate)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold mt-1 pt-1 border-t">
                  <span>Total:</span>
                  <span className="text-green-700">
                    {formatMoney(
                      selectedProduct.sale_price * (parseInt(saleForm.quantity) || 1) * (1 + (selectedProduct.tax_rate || 0))
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-blue-600 mt-1">
                  <span>Ganancia:</span>
                  <span>
                    {formatMoney((selectedProduct.sale_price - selectedProduct.cost) * (parseInt(saleForm.quantity) || 1))}
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaleDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateSale} className="bg-green-600 hover:bg-green-700" data-testid="confirm-sale-btn">
              Registrar Venta
            </Button>
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
              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="font-bold text-slate-800">{stockProduct.name}</p>
                <div className="flex gap-4 mt-2 text-sm">
                  <span>Ecuador: <strong>{stockProduct.stock_ecuador}</strong></span>
                  <span>USA: <strong>{stockProduct.stock_usa}</strong></span>
                </div>
              </div>
              <div>
                <Label>Ajuste (+/-)</Label>
                <Input
                  type="number"
                  value={stockForm.adjustment}
                  onChange={(e) => setStockForm({...stockForm, adjustment: e.target.value})}
                  placeholder="Ej: 10 o -5"
                  data-testid="stock-adjustment-input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Positivo para agregar, negativo para restar
                </p>
              </div>
              <div>
                <Label>Ubicación</Label>
                <select
                  value={stockForm.location}
                  onChange={(e) => setStockForm({...stockForm, location: e.target.value})}
                  className="w-full border rounded-md px-3 py-2 bg-white"
                  data-testid="stock-location-select"
                >
                  <option value="ecuador">Ecuador</option>
                  <option value="usa">USA</option>
                </select>
              </div>
              <div>
                <Label>Razón (opcional)</Label>
                <Input
                  value={stockForm.reason}
                  onChange={(e) => setStockForm({...stockForm, reason: e.target.value})}
                  placeholder="Ej: Ingreso de mercadería"
                  data-testid="stock-reason-input"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAdjustStock} data-testid="confirm-adjustment-btn">
              Aplicar Ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
