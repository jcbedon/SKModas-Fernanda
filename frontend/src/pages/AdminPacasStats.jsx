import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft,
  Package,
  DollarSign,
  TrendingUp,
  BarChart3,
  ShoppingCart,
  Calendar,
} from "lucide-react";
import { getPacaStats } from "@/lib/api";
import { useHideFinancials } from "@/components/MoneyDisplay";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

const COLORS = ["#f59e0b", "#ea580c", "#d97706", "#b45309", "#92400e", "#78350f"];

export default function AdminPacasStats() {
  const navigate = useNavigate();
  const { user, hideFinancials } = useAuth();
  const { formatMoney } = useHideFinancials();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("week");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const res = await getPacaStats(period);
      setStats(res.data);
    } catch (err) {
      toast.error("Error cargando estadísticas");
    } finally {
      setLoading(false);
    }
  };

  const periodLabel = period === "week" ? "Esta Semana" : period === "month" ? "Este Mes" : "Todo el Tiempo";

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
                onClick={() => navigate("/admin/pacas")}
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
                    <BarChart3 className="h-6 w-6" />
                    Estadísticas de Pacas
                  </h1>
                  <p className="text-amber-100 text-sm">{periodLabel}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-40 bg-white/10 border-white/30 text-white">
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Esta Semana</SelectItem>
                  <SelectItem value="month">Este Mes</SelectItem>
                  <SelectItem value="all">Todo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12 text-slate-500">Cargando estadísticas...</div>
        ) : stats ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
                <CardContent className="p-4 text-center">
                  <ShoppingCart className="h-8 w-8 mx-auto text-amber-600 mb-2" />
                  <p className="text-3xl font-bold text-amber-700">{stats.total_count}</p>
                  <p className="text-xs text-amber-600">Pacas Vendidas</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
                <CardContent className="p-4 text-center">
                  <DollarSign className="h-8 w-8 mx-auto text-blue-600 mb-2" />
                  <p className="text-3xl font-bold text-blue-700">{formatMoney(stats.total_sales)}</p>
                  <p className="text-xs text-blue-600">Ventas Totales</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                <CardContent className="p-4 text-center">
                  <TrendingUp className="h-8 w-8 mx-auto text-green-600 mb-2" />
                  <p className="text-3xl font-bold text-green-700">{formatMoney(stats.total_commission)}</p>
                  <p className="text-xs text-green-600">Ganancias Totales</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200">
                <CardContent className="p-4 text-center">
                  <Package className="h-8 w-8 mx-auto text-purple-600 mb-2" />
                  <p className="text-3xl font-bold text-purple-700">{formatMoney(stats.avg_sale)}</p>
                  <p className="text-xs text-purple-600">Promedio por Venta</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200">
                <CardContent className="p-4 text-center">
                  <TrendingUp className="h-8 w-8 mx-auto text-pink-600 mb-2" />
                  <p className="text-3xl font-bold text-pink-700">{formatMoney(stats.avg_commission)}</p>
                  <p className="text-xs text-pink-600">Ganancia Promedio</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Trend Chart */}
              {stats.daily_trend && stats.daily_trend.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-amber-600" />
                      Tendencia de Ventas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={stats.daily_trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip
                          formatter={(value, name) => [
                            hideFinancials ? "••••" : `$${value.toFixed(2)}`,
                            name === "sales" ? "Ventas" : name === "commission" ? "Ganancias" : "Cantidad"
                          ]}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="sales" name="Ventas" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b" }} />
                        <Line type="monotone" dataKey="commission" name="Ganancias" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* By Paca Type - Bar Chart */}
              {stats.by_paca && stats.by_paca.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Package className="h-5 w-5 text-amber-600" />
                      Ventas por Tipo de Paca
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={stats.by_paca} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(value) => hideFinancials ? "••••" : value}
                        />
                        <Bar dataKey="count" name="Cantidad" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* By Paca Type - Pie Chart */}
              {stats.by_paca && stats.by_paca.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-green-600" />
                      Distribución de Ganancias
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={stats.by_paca}
                          dataKey="commission"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          labelLine={true}
                        >
                          {stats.by_paca.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => hideFinancials ? "••••" : `$${value.toFixed(2)}`}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Table of Paca Types */}
              {stats.by_paca && stats.by_paca.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg">Detalle por Tipo de Paca</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-slate-50">
                            <th className="text-left p-3 font-semibold text-slate-600">Paca</th>
                            <th className="text-center p-3 font-semibold text-slate-600">Cantidad</th>
                            <th className="text-right p-3 font-semibold text-slate-600">Ventas</th>
                            <th className="text-right p-3 font-semibold text-slate-600">Ganancias</th>
                            <th className="text-right p-3 font-semibold text-slate-600">% del Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.by_paca.map((paca, idx) => (
                            <tr key={idx} className="border-b hover:bg-slate-50">
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                                  />
                                  <span className="font-medium">{paca.name}</span>
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <Badge variant="outline">{paca.count}</Badge>
                              </td>
                              <td className="p-3 text-right font-semibold text-blue-600">
                                {formatMoney(paca.sales)}
                              </td>
                              <td className="p-3 text-right font-semibold text-green-600">
                                {formatMoney(paca.commission)}
                              </td>
                              <td className="p-3 text-right text-slate-500">
                                {stats.total_count > 0
                                  ? ((paca.count / stats.total_count) * 100).toFixed(1)
                                  : 0}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-amber-50 font-bold">
                            <td className="p-3">Total</td>
                            <td className="p-3 text-center">{stats.total_count}</td>
                            <td className="p-3 text-right text-blue-700">{formatMoney(stats.total_sales)}</td>
                            <td className="p-3 text-right text-green-700">{formatMoney(stats.total_commission)}</td>
                            <td className="p-3 text-right">100%</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* No data message */}
            {stats.total_count === 0 && (
              <div className="text-center py-12">
                <Package className="h-16 w-16 mx-auto text-slate-300 mb-4" />
                <p className="text-slate-500 text-lg">No hay ventas de pacas en este período</p>
                <Button
                  onClick={() => navigate("/admin/pacas")}
                  className="mt-4 bg-amber-600 hover:bg-amber-700"
                >
                  Ir a Pacas
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-slate-500">No se pudieron cargar las estadísticas</div>
        )}
      </div>
    </div>
  );
}
