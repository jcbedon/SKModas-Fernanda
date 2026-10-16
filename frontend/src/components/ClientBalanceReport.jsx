import { useState, useEffect } from "react";
import { getClientBalanceReport } from "@/lib/api";
import { generateClientBalanceReportPDF } from "@/lib/clientBalanceReportPDF";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileDown, Users, Search, Loader2 } from "lucide-react";
import { useAuth } from "@/App";

const fmtMoney = (v) => "$" + Number(v || 0).toFixed(2);

export default function ClientBalanceReport() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getClientBalanceReport();
      setData(res.data);
    } catch (e) {
      toast.error("Error al cargar el reporte");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = () => {
    if (!data?.clients?.length) {
      toast.error("No hay datos para generar el PDF");
      return;
    }
    setGenerating(true);
    try {
      generateClientBalanceReportPDF({
        tenantName: user?.tenant_name || "Reporte de Abonos y Consumos",
        clients: filteredClients,
        totals: data.totals,
      });
      toast.success("PDF generado exitosamente");
    } catch (e) {
      toast.error("Error al generar el PDF");
    } finally {
      setGenerating(false);
    }
  };

  const filteredClients = (data?.clients || []).filter((c) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(term) ||
      (c.customer_id || "").toLowerCase().includes(term) ||
      (c.whatsapp || "").includes(term)
    );
  });

  if (loading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent mx-auto"></div>
          <p className="text-sm text-gray-500 mt-2">Cargando reporte...</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.clients?.length) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="p-8 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto" />
          <p className="text-gray-500 mt-2">No hay clientes con actividad</p>
        </CardContent>
      </Card>
    );
  }

  const { totals } = data;

  return (
    <div className="space-y-4">
      {/* Search and Download */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por nombre, ID o WhatsApp..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
            data-testid="balance-report-search"
          />
        </div>
        <Button
          onClick={handleDownloadPDF}
          disabled={generating || !filteredClients.length}
          className="rounded-xl bg-green-600 hover:bg-green-700 text-white gap-2"
          data-testid="download-balance-pdf-btn"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Descargar PDF
        </Button>
      </div>

      {/* Clients Table */}
      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-600" />
            Lista de Clientes ({filteredClients.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-2 font-medium">Cliente</th>
                  <th className="text-left p-2 font-medium">ID</th>
                  <th className="text-right p-2 font-medium text-green-600">Abonado</th>
                  <th className="text-right p-2 font-medium text-red-600">Consumido</th>
                  <th className="text-right p-2 font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => (
                  <tr key={client.id} className="border-b hover:bg-gray-50" data-testid={`balance-row-${client.customer_id}`}>
                    <td className="p-2">
                      <div className="font-medium text-slate-800">{client.name}</div>
                      {client.whatsapp && (
                        <a
                          href={`https://wa.me/${String(client.whatsapp).replace(/[^0-9]/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-green-600 hover:underline"
                        >
                          {client.whatsapp}
                        </a>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className="text-xs">#{client.customer_id}</Badge>
                    </td>
                    <td className="p-2 text-right font-semibold text-green-600" data-testid={`abonado-${client.customer_id}`}>
                      {fmtMoney(client.total_abonado)}
                    </td>
                    <td className="p-2 text-right">
                      <span className="font-semibold text-red-600">{fmtMoney(client.total_consumido)}</span>
                      {(client.total_envios || 0) > 0 && (
                        <div className="text-xs text-gray-400">
                          Compras: {fmtMoney(client.total_compras)} | Envíos: {fmtMoney(client.total_envios)}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <span className={`font-bold ${client.saldo >= 0 ? 'text-emerald-600' : 'text-orange-600'}`} data-testid={`saldo-${client.customer_id}`}>
                        {client.saldo >= 0 ? '+' : ''}{fmtMoney(client.saldo)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredClients.length === 0 && (
              <p className="text-center text-gray-400 py-8">No se encontraron clientes con los filtros aplicados</p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
