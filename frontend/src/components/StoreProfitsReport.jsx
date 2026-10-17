import { useState, useEffect } from "react";
import { getStoreProfitsReport } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Store, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Receipt, 
  Image,
  Loader2,
  Calendar,
  ShoppingBag,
  Percent
} from "lucide-react";

export default function StoreProfitsReport() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await getStoreProfitsReport();
      setData(res.data);
    } catch (error) {
      toast.error("Error al cargar reporte de ganancias");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) return null;

  const { stores, summary } = data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Store className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Lives con Factura</p>
                <p className="text-xl font-bold" style={{ color: "#1E3A5F" }}>
                  {summary.lives_with_invoice} / {summary.total_lives}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Ventas</p>
                <p className="text-xl font-bold text-green-600">
                  ${summary.total_sales.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                <Receipt className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Costo Tiendas</p>
                <p className="text-xl font-bold text-orange-600">
                  ${summary.total_store_cost.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.total_profit >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${summary.total_profit >= 0 ? "bg-green-200" : "bg-red-200"}`}>
                {summary.total_profit >= 0 ? (
                  <TrendingUp className="h-5 w-5 text-green-700" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-700" />
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Ganancia Total</p>
                <p className={`text-xl font-bold ${summary.total_profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                  ${summary.total_profit.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Earnings Breakdown */}
      {(summary.total_commissions > 0 || summary.total_manual_commissions > 0) && (
        <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-600" />
              Desglose de Ganancias
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="text-center p-3 bg-white rounded-xl shadow-sm">
                <p className="text-xs text-gray-500 mb-1">Comisiones Productos</p>
                <p className="text-lg font-bold text-blue-600">${(summary.total_commissions || 0).toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-white rounded-xl shadow-sm">
                <p className="text-xs text-gray-500 mb-1">Comisiones Manuales</p>
                <p className="text-lg font-bold text-purple-600">${(summary.total_manual_commissions || 0).toFixed(2)}</p>
              </div>
              <div className="text-center p-3 bg-white rounded-xl shadow-sm md:col-span-1 col-span-2">
                <p className="text-xs text-gray-500 mb-1">Margen Tiendas</p>
                <p className={`text-lg font-bold ${(summary.total_sales - summary.total_store_cost - (summary.total_commissions || 0) - (summary.total_manual_commissions || 0)) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(summary.total_sales - summary.total_store_cost - (summary.total_commissions || 0) - (summary.total_manual_commissions || 0)).toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profit margin */}
      {summary.avg_profit_margin > 0 && (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
          <Percent className="h-4 w-4" />
          Margen de ganancia promedio: <span className="font-bold text-green-600">{summary.avg_profit_margin}%</span>
        </div>
      )}

      {/* Store List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" style={{ color: "#1E3A5F" }}>
            Detalle por Live / Tienda
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No hay lives completados</p>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-3">
                {stores.map((store, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border ${
                      store.profit !== null
                        ? store.profit >= 0
                          ? "bg-green-50/50 border-green-200"
                          : "bg-red-50/50 border-red-200"
                        : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold" style={{ color: "#1E3A5F" }}>
                            {store.live_title}
                          </h3>
                          {store.store_invoice_image && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-blue-600"
                              onClick={() => setSelectedImage(`${process.env.REACT_APP_BACKEND_URL}${store.store_invoice_image.replace('/api', '')}`)}
                            >
                              <Image className="h-3 w-3 mr-1" /> Ver factura
                            </Button>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Store className="h-3 w-3" />
                            {store.store || "Sin tienda"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {store.date ? new Date(store.date).toLocaleDateString("es-ES") : "—"}
                          </span>
                          <span className="flex items-center gap-1">
                            <ShoppingBag className="h-3 w-3" />
                            {store.purchase_count} productos
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        {store.profit !== null ? (
                          <>
                            <p className={`text-xl font-bold ${store.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {store.profit >= 0 ? "+" : ""}${store.profit.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-500">
                              Ventas ${store.total_sales.toFixed(2)} - Costo ${store.store_invoice_amount?.toFixed(2)}
                              {store.manual_commission > 0 && ` + $${store.manual_commission.toFixed(2)} manual`}
                            </p>
                            {store.manual_commission > 0 && store.manual_commission_note && (
                              <p className="text-xs text-purple-500 italic">{store.manual_commission_note}</p>
                            )}
                            {store.profit_margin !== null && (
                              <Badge className={`mt-1 ${store.profit_margin >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                {store.profit_margin}% margen
                              </Badge>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-lg font-bold text-gray-600">
                              ${store.total_sales.toFixed(2)}
                              {store.manual_commission > 0 && (
                                <span className="text-purple-600 text-sm ml-1">+ ${store.manual_commission.toFixed(2)}</span>
                              )}
                            </p>
                            {store.manual_commission > 0 && store.manual_commission_note && (
                              <p className="text-xs text-purple-500 italic">{store.manual_commission_note}</p>
                            )}
                            <Badge className="bg-gray-100 text-gray-500 mt-1">
                              Sin factura registrada
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Image Preview Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: "#1E3A5F" }}>
              <Receipt className="h-5 w-5" />
              Factura de Tienda
            </DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <img src={selectedImage} alt="Factura" className="w-full rounded-xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
