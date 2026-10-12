import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getInventoryMovementHistory } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  ArrowRightLeft,
  ShoppingCart,
  Boxes,
  FileText,
  History,
  Filter
} from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

function formatMoney(n) {
  return "$" + (n || 0).toFixed(2);
}

function formatDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const ACTION_CONFIG = {
  inventory_sale: {
    label: "Venta",
    color: "bg-green-100 text-green-800",
    icon: ShoppingCart
  },
  inventory_transfer: {
    label: "Transferencia",
    color: "bg-purple-100 text-purple-800",
    icon: ArrowRightLeft
  },
  inventory_stock_adjustment: {
    label: "Ajuste Stock",
    color: "bg-blue-100 text-blue-800",
    icon: Boxes
  },
  inventory_invoice_purchase: {
    label: "Facturación",
    color: "bg-amber-100 text-amber-800",
    icon: FileText
  }
};

const LOCATION_FLAGS = {
  ecuador: "https://flagcdn.com/w40/ec.png",
  usa: "https://flagcdn.com/w40/us.png"
};

export default function AdminInventoryHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    location: "",
    action_type: ""
  });

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter.location) params.location = filter.location;
      if (filter.action_type) params.action_type = filter.action_type;
      params.limit = 200;
      
      const res = await getInventoryMovementHistory(params);
      setMovements(res.data?.movements || []);
    } catch (e) {
      toast.error("Error al cargar historial");
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilter(prev => ({ ...prev, [key]: value }));
  };

  const applyFilter = () => {
    loadHistory();
  };

  const renderMovementDetails = (movement) => {
    const { action, details, entity_name } = movement;
    
    switch (action) {
      case "inventory_transfer":
        return (
          <div className="text-sm">
            <p className="font-medium text-slate-800">{entity_name}</p>
            <div className="flex items-center gap-2 mt-1 text-gray-600">
              <span>{details?.quantity} unidades</span>
              <span>•</span>
              <div className="flex items-center gap-1">
                <img src={LOCATION_FLAGS[details?.source_location]} alt="" className="h-4" />
                <span>{details?.source_location?.toUpperCase()}</span>
              </div>
              <span>→</span>
              <div className="flex items-center gap-1">
                <img src={LOCATION_FLAGS[details?.target_location]} alt="" className="h-4" />
                <span>{details?.target_location?.toUpperCase()}</span>
              </div>
            </div>
            {details?.created_new && (
              <span className="text-xs text-purple-600">Producto nuevo creado</span>
            )}
          </div>
        );
      
      case "inventory_sale":
        return (
          <div className="text-sm">
            <p className="font-medium text-slate-800">{entity_name}</p>
            <div className="flex items-center gap-2 mt-1 text-gray-600">
              <span>{details?.quantity}x @ {formatMoney(details?.unit_price)}</span>
              <span>•</span>
              <span className="text-green-700 font-medium">{formatMoney(details?.total_amount)}</span>
              {details?.location && (
                <>
                  <span>•</span>
                  <img src={LOCATION_FLAGS[details?.location]} alt="" className="h-4" />
                </>
              )}
            </div>
            {details?.customer_name && (
              <p className="text-xs text-gray-500">Cliente: {details.customer_name} ({details.customer_id})</p>
            )}
          </div>
        );
      
      case "inventory_stock_adjustment":
        return (
          <div className="text-sm">
            <p className="font-medium text-slate-800">{entity_name}</p>
            <div className="flex items-center gap-2 mt-1 text-gray-600">
              <span className={details?.adjustment > 0 ? "text-green-700" : "text-red-700"}>
                {details?.adjustment > 0 ? "+" : ""}{details?.adjustment} unidades
              </span>
              <span>•</span>
              <span>{details?.previous_stock} → {details?.new_stock}</span>
              {details?.location && (
                <>
                  <span>•</span>
                  <img src={LOCATION_FLAGS[details?.location]} alt="" className="h-4" />
                </>
              )}
            </div>
            {details?.reason && (
              <p className="text-xs text-gray-500">Razón: {details.reason}</p>
            )}
          </div>
        );
      
      case "inventory_invoice_purchase":
        return (
          <div className="text-sm">
            <p className="font-medium text-slate-800">[INVENTARIO] {entity_name}</p>
            <div className="flex items-center gap-2 mt-1 text-gray-600">
              <span>{details?.quantity} unidades</span>
              <span>•</span>
              <span className="text-green-700 font-medium">{formatMoney(details?.total_amount)}</span>
              {details?.location && (
                <>
                  <span>•</span>
                  <img src={LOCATION_FLAGS[details?.location]} alt="" className="h-4" />
                </>
              )}
            </div>
            {details?.customer_name && (
              <p className="text-xs text-gray-500">Cliente: {details.customer_name} ({details.customer_id})</p>
            )}
          </div>
        );
      
      default:
        return (
          <div className="text-sm">
            <p className="font-medium text-slate-800">{entity_name}</p>
            <p className="text-xs text-gray-500">{JSON.stringify(details)}</p>
          </div>
        );
    }
  };

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
            <History className="h-5 w-5" />
            Historial de Movimientos
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Filters */}
        <Card className="rounded-xl">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Filtros:</span>
              </div>
              
              <select
                value={filter.location}
                onChange={(e) => handleFilterChange("location", e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Todas las ubicaciones</option>
                <option value="ecuador">🇪🇨 Ecuador</option>
                <option value="usa">🇺🇸 USA</option>
              </select>
              
              <select
                value={filter.action_type}
                onChange={(e) => handleFilterChange("action_type", e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos los movimientos</option>
                <option value="inventory_sale">Ventas</option>
                <option value="inventory_transfer">Transferencias</option>
                <option value="inventory_stock_adjustment">Ajustes de Stock</option>
                <option value="inventory_invoice_purchase">Facturación</option>
              </select>
              
              <Button size="sm" onClick={applyFilter}>
                Aplicar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="rounded-xl bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-4 text-center">
              <ShoppingCart className="h-5 w-5 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">
                {movements.filter(m => m.action === "inventory_sale").length}
              </p>
              <p className="text-xs text-green-600">Ventas</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="p-4 text-center">
              <ArrowRightLeft className="h-5 w-5 text-purple-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-purple-700">
                {movements.filter(m => m.action === "inventory_transfer").length}
              </p>
              <p className="text-xs text-purple-600">Transferencias</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-4 text-center">
              <Boxes className="h-5 w-5 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">
                {movements.filter(m => m.action === "inventory_stock_adjustment").length}
              </p>
              <p className="text-xs text-blue-600">Ajustes</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
            <CardContent className="p-4 text-center">
              <FileText className="h-5 w-5 text-amber-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-amber-700">
                {movements.filter(m => m.action === "inventory_invoice_purchase").length}
              </p>
              <p className="text-xs text-amber-600">Facturaciones</p>
            </CardContent>
          </Card>
        </div>

        {/* Movements List */}
        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-slate-600" />
              Movimientos ({movements.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No hay movimientos registrados</p>
              </div>
            ) : (
              <div className="space-y-3">
                {movements.map((movement) => {
                  const config = ACTION_CONFIG[movement.action] || {
                    label: movement.action,
                    color: "bg-gray-100 text-gray-800",
                    icon: History
                  };
                  const IconComponent = config.icon;
                  
                  return (
                    <div 
                      key={movement.id} 
                      className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className={`p-2 rounded-lg ${config.color}`}>
                        <IconComponent className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={config.color}>{config.label}</Badge>
                          <span className="text-xs text-gray-500">{formatDate(movement.created_at)}</span>
                        </div>
                        {renderMovementDetails(movement)}
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        <p>{movement.user_name}</p>
                        <p className="text-gray-400">{movement.user_role}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
