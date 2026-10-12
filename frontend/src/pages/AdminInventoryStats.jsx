import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getInventoryStats } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  DollarSign, 
  TrendingUp, 
  Package, 
  ShoppingCart,
  BarChart3,
  PieChart,
  AlertTriangle,
  Calendar
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

function formatMoney(n) {
  return "$" + (n || 0).toFixed(2);
}

// Week boundary helpers (same logic as AdminDashboard)
function getWeekRange(weeksBack = 0) {
  const now = new Date();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const daysSinceMonday = (day - 1 + 7) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceMonday);
  start.setHours(12, 0, 0, 0);
  if (start > now) start.setDate(start.getDate() - 7);
  start.setDate(start.getDate() - weeksBack * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const fmt = (dt) => {
    const d = dt.getDate();
    const monthRaw = dt.toLocaleDateString("es-ES", { month: "short" });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).replace(".", "");
    return `${d}-${month}`;
  };
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    label: `${fmt(start)} → ${fmt(end)}`,
  };
}

const COLORS = ['#1E3A5F', '#2ECC71', '#E74C3C', '#F39C12', '#9B59B6', '#3498DB', '#1ABC9C', '#E67E22'];

export default function AdminInventoryStats() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("week");

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async (p) => {
    try {
      setLoading(true);
      const res = await getInventoryStats(p || period);
      setStats(res.data);
    } catch (e) {
      toast.error("Error al cargar estadísticas");
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    loadStats(newPeriod);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  const summary = stats?.summary || {};
  const stock = stats?.stock || {};
  const topProducts = stats?.top_products || [];
  const lowStockAlerts = stats?.low_stock_alerts || [];
  const dailyTrend = stats?.daily_trend || [];

  // Prepare pie chart data
  const pieData = topProducts.slice(0, 6).map((p, i) => ({
    name: p.product_name,
    value: p.total_sales
  }));

  return (
    <div className="app-bg min-h-screen">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/inventory")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
          <span className="font-bold text-slate-800">Estadísticas de Inventario</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Period Filter */}
        <div className="flex flex-wrap gap-2" data-testid="period-filter">
          <Button
            variant={period === "week" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            style={period === "week" ? { background: '#1E3A5F', color: 'white' } : {}}
            onClick={() => handlePeriodChange("week")}
            data-testid="period-week"
          >
            Esta semana
          </Button>
          {[1, 2, 3, 4].map((n) => (
            <Button
              key={n}
              variant={period === `w${n}` ? "default" : "outline"}
              size="sm"
              className="rounded-xl"
              style={period === `w${n}` ? { background: '#1E3A5F', color: 'white' } : {}}
              onClick={() => handlePeriodChange(`w${n}`)}
              data-testid={`period-w${n}`}
            >
              {getWeekRange(n).label}
            </Button>
          ))}
          <Button
            variant={period === "month" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            style={period === "month" ? { background: '#1E3A5F', color: 'white' } : {}}
            onClick={() => handlePeriodChange("month")}
            data-testid="period-month"
          >
            Este mes
          </Button>
          <Button
            variant={period === "all" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            style={period === "all" ? { background: '#1E3A5F', color: 'white' } : {}}
            onClick={() => handlePeriodChange("all")}
            data-testid="period-all"
          >
            Todo
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="rounded-xl bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-4">
              <DollarSign className="h-5 w-5 text-green-600 mb-2" />
              <p className="text-2xl font-extrabold text-green-700">{formatMoney(summary.total_sales)}</p>
              <p className="text-xs text-green-600">Ventas Totales</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-4">
              <Package className="h-5 w-5 text-blue-600 mb-2" />
              <p className="text-2xl font-extrabold text-blue-700">{formatMoney(summary.total_cost)}</p>
              <p className="text-xs text-blue-600">Costo Total</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
            <CardContent className="p-4">
              <TrendingUp className="h-5 w-5 text-yellow-600 mb-2" />
              <p className="text-2xl font-extrabold text-yellow-700">{formatMoney(summary.total_profit)}</p>
              <p className="text-xs text-yellow-600">Ganancia Neta</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="p-4">
              <BarChart3 className="h-5 w-5 text-purple-600 mb-2" />
              <p className="text-2xl font-extrabold text-purple-700">{summary.margin_percent}%</p>
              <p className="text-xs text-purple-600">Margen</p>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Card className="rounded-xl">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-slate-800">{summary.sale_count || 0}</p>
              <p className="text-xs text-gray-500">Transacciones</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-slate-800">{summary.total_quantity || 0}</p>
              <p className="text-xs text-gray-500">Unidades Vendidas</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-slate-800">{formatMoney(summary.total_tax)}</p>
              <p className="text-xs text-gray-500">Impuestos</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-green-700">{stock.ecuador || 0}</p>
              <p className="text-xs text-gray-500">Stock Ecuador</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-purple-700">{stock.usa || 0}</p>
              <p className="text-xs text-gray-500">Stock USA</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-slate-800">{formatMoney(stock.total_value)}</p>
              <p className="text-xs text-gray-500">Valor Stock</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Sales Trend */}
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                Tendencia de Ventas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(d) => d.slice(5)} 
                      fontSize={11}
                    />
                    <YAxis 
                      tickFormatter={(v) => `$${v}`}
                      fontSize={11}
                    />
                    <Tooltip 
                      formatter={(value, name) => [
                        name === 'sales' ? formatMoney(value) : 
                        name === 'profit' ? formatMoney(value) : value,
                        name === 'sales' ? 'Ventas' : 
                        name === 'profit' ? 'Ganancia' : 'Cantidad'
                      ]}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="sales" 
                      stroke="#2ECC71" 
                      strokeWidth={2}
                      name="Ventas"
                      dot={{ r: 4 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="profit" 
                      stroke="#3498DB" 
                      strokeWidth={2}
                      name="Ganancia"
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-gray-400">
                  Sin datos para este período
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sales Distribution Pie */}
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <PieChart className="h-5 w-5 text-purple-600" />
                Distribución de Ventas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <RechartsPieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) => `${name.slice(0, 10)}${name.length > 10 ? '...' : ''} (${(percent * 100).toFixed(0)}%)`}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatMoney(value)} />
                  </RechartsPieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-gray-400">
                  Sin datos para este período
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Products */}
        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-green-600" />
              Productos Más Vendidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-2 font-medium">#</th>
                      <th className="text-left p-2 font-medium">Producto</th>
                      <th className="text-right p-2 font-medium">Cantidad</th>
                      <th className="text-right p-2 font-medium">Ventas</th>
                      <th className="text-right p-2 font-medium">Costo</th>
                      <th className="text-right p-2 font-medium">Ganancia</th>
                      <th className="text-right p-2 font-medium">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product, index) => (
                      <tr 
                        key={product.product_id} 
                        className="border-b hover:bg-gray-50"
                        data-testid={`top-product-${index}`}
                      >
                        <td className="p-2">
                          <Badge 
                            className={
                              index === 0 ? 'bg-yellow-500' : 
                              index === 1 ? 'bg-gray-400' : 
                              index === 2 ? 'bg-orange-500' : 'bg-slate-300'
                            }
                          >
                            {index + 1}
                          </Badge>
                        </td>
                        <td className="p-2 font-medium text-slate-800">{product.product_name}</td>
                        <td className="p-2 text-right font-mono">{product.quantity}</td>
                        <td className="p-2 text-right font-mono text-green-700">{formatMoney(product.total_sales)}</td>
                        <td className="p-2 text-right font-mono text-gray-600">{formatMoney(product.total_cost)}</td>
                        <td className="p-2 text-right font-mono font-semibold text-blue-700">{formatMoney(product.profit)}</td>
                        <td className="p-2 text-right">
                          <Badge 
                            variant={product.margin_percent >= 30 ? 'default' : 'outline'}
                            className={product.margin_percent >= 30 ? 'bg-green-600' : ''}
                          >
                            {product.margin_percent}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Sin ventas en este período</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        {lowStockAlerts.length > 0 && (
          <Card className="rounded-xl border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Alertas de Stock Bajo
                <Badge variant="destructive">{lowStockAlerts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {lowStockAlerts.map((product) => (
                  <div 
                    key={product.id}
                    className="bg-red-50 p-3 rounded-lg border border-red-200"
                    data-testid={`low-stock-${product.id}`}
                  >
                    <p className="font-medium text-slate-800">{product.name}</p>
                    <div className="flex gap-4 mt-1 text-sm">
                      <span className="text-red-700">
                        Ecuador: <strong>{product.stock_ecuador}</strong>
                      </span>
                      <span className="text-red-700">
                        USA: <strong>{product.stock_usa}</strong>
                      </span>
                    </div>
                    <p className="text-xs text-red-600 mt-1">
                      Total: {product.total_stock} unidades
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
