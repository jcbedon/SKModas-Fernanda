import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Boxes } from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminInventorySelect() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;

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
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <Boxes className="h-16 w-16 mx-auto text-slate-600 mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Selecciona el Inventario</h1>
          <p className="text-gray-500">Elige la ubicación para gestionar productos y ventas</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Ecuador */}
          <Card 
            className="rounded-2xl cursor-pointer hover:shadow-xl transition-all duration-300 hover:scale-105 border-2 border-transparent hover:border-green-400 overflow-hidden"
            onClick={() => navigate("/admin/inventory/ecuador")}
            data-testid="inventory-ecuador-card"
          >
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-green-500 to-green-600 p-6 text-center">
                <span className="text-6xl">🇪🇨</span>
              </div>
              <div className="p-6 text-center bg-white">
                <h2 className="text-xl font-bold text-slate-800 mb-1">Ecuador</h2>
                <p className="text-sm text-gray-500">Productos y ventas en Ecuador</p>
              </div>
            </CardContent>
          </Card>

          {/* USA */}
          <Card 
            className="rounded-2xl cursor-pointer hover:shadow-xl transition-all duration-300 hover:scale-105 border-2 border-transparent hover:border-blue-400 overflow-hidden"
            onClick={() => navigate("/admin/inventory/usa")}
            data-testid="inventory-usa-card"
          >
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-center">
                <span className="text-6xl">🇺🇸</span>
              </div>
              <div className="p-6 text-center bg-white">
                <h2 className="text-xl font-bold text-slate-800 mb-1">USA</h2>
                <p className="text-sm text-gray-500">Productos y ventas en Estados Unidos</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
