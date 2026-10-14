import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Warehouse, Store, Package, History } from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminInventoryEcuadorSelect() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;

  const subInventories = [
    {
      id: "bodega",
      name: "Bodega",
      description: "Almacén principal",
      icon: Warehouse,
      color: "from-amber-500 to-amber-600",
      hoverBorder: "hover:border-amber-400",
    },
    {
      id: "local",
      name: "Local",
      description: "Tienda física",
      icon: Store,
      color: "from-emerald-500 to-emerald-600",
      hoverBorder: "hover:border-emerald-400",
    },
    {
      id: "ali",
      name: "Ali",
      description: "Productos AliExpress",
      icon: Package,
      color: "from-orange-500 to-orange-600",
      hoverBorder: "hover:border-orange-400",
    },
  ];

  return (
    <div className="app-bg min-h-screen">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/inventory")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
          <div className="flex items-center gap-2">
            <img src="https://flagcdn.com/w40/ec.png" alt="Ecuador" className="h-6 rounded shadow-sm" />
            <span className="font-bold text-slate-800">Inventario Ecuador</span>
          </div>
          <div className="ml-auto">
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => navigate("/admin/inventory/history")}
              data-testid="history-btn"
            >
              <History className="h-4 w-4" />
              Historial
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <div className="flex justify-center items-center gap-3 mb-4">
            <img src="https://flagcdn.com/w80/ec.png" alt="Ecuador" className="h-12 rounded shadow-md" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Inventarios Ecuador</h1>
          <p className="text-gray-500">Selecciona el inventario que deseas gestionar</p>
        </div>

        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
          {subInventories.map((inv) => {
            const Icon = inv.icon;
            return (
              <Card 
                key={inv.id}
                className={`rounded-xl cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 border-2 border-transparent ${inv.hoverBorder} overflow-hidden`}
                onClick={() => navigate(`/admin/inventory/ecuador/${inv.id}`)}
                data-testid={`inventory-${inv.id}-card`}
              >
                <CardContent className="p-0">
                  <div className={`bg-gradient-to-br ${inv.color} p-4 flex justify-center items-center`}>
                    <Icon className="h-10 w-10 text-white" />
                  </div>
                  <div className="p-3 text-center bg-white">
                    <h2 className="text-base font-bold text-slate-800">{inv.name}</h2>
                    <p className="text-xs text-gray-500">{inv.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Info de transferencias */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            Puedes transferir productos entre <span className="font-semibold">Bodega</span>, <span className="font-semibold">Local</span>, <span className="font-semibold">Ali</span> y también hacia <span className="font-semibold">USA</span>
          </p>
        </div>
      </div>
    </div>
  );
}
