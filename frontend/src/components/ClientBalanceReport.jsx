import { useState, useEffect, useMemo } from "react";
import { getClientBalanceReport } from "@/lib/api";
import { generateClientBalanceReportPDF } from "@/lib/clientBalanceReportPDF";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDown, Users, Search, Loader2, Calendar } from "lucide-react";
import { useAuth } from "@/App";

const fmtMoney = (v) => "$" + Number(v || 0).toFixed(2);

// Get week key (Monday of the week) for a date
const getWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const jsDay = local.getDay();
  const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1;
  local.setDate(local.getDate() - daysSinceMonday);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Get week label
const getWeekLabel = (key) => {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  const startMonday = new Date(y, m - 1, d);
  const endSunday = new Date(startMonday);
  endSunday.setDate(startMonday.getDate() + 6);
  const fmt = (dt) => {
    const day = dt.getDate();
    const monthRaw = dt.toLocaleDateString('es-ES', { month: 'short' });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).replace('.', '');
    return `${day} ${month}`;
  };
  return `${fmt(startMonday)} - ${fmt(endSunday)}`;
};

// Get current week key
const getCurrentWeekKey = () => getWeekKey(new Date().toISOString());

// Get today's date as YYYY-MM-DD
const getTodayKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Generate last 30 days for day filter
const getLast30Days = () => {
  const days = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    const label = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    days.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return days;
};

// Generate last 12 weeks for week filter
const getLast12Weeks = () => {
  const weeks = [];
  const seen = new Set();
  for (let i = 0; i < 84; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = getWeekKey(d.toISOString());
    if (key && !seen.has(key)) {
      seen.add(key);
      weeks.push({ key, label: getWeekLabel(key) });
    }
    if (weeks.length >= 12) break;
  }
  return weeks;
};

export default function ClientBalanceReport() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  
  // Filter state
  const [filterType, setFilterType] = useState("week"); // "week" or "day"
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekKey());
  const [selectedDay, setSelectedDay] = useState(getTodayKey());

  const weeks = useMemo(() => getLast12Weeks(), []);
  const days = useMemo(() => getLast30Days(), []);

  // Compute date range based on filter
  const dateRange = useMemo(() => {
    if (filterType === "day") {
      return { date_from: selectedDay, date_to: selectedDay };
    } else {
      // Week: Monday to Sunday
      const [y, m, d] = selectedWeek.split("-").map(Number);
      const monday = new Date(y, m - 1, d);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const toKey = (dt) => {
        const yy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const dd = String(dt.getDate()).padStart(2, "0");
        return `${yy}-${mm}-${dd}`;
      };
      return { date_from: toKey(monday), date_to: toKey(sunday) };
    }
  }, [filterType, selectedWeek, selectedDay]);

  useEffect(() => {
    loadData();
  }, [dateRange]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getClientBalanceReport(dateRange);
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
      const periodLabel = filterType === "day" 
        ? days.find(d => d.key === selectedDay)?.label || selectedDay
        : weeks.find(w => w.key === selectedWeek)?.label || selectedWeek;
      
      generateClientBalanceReportPDF({
        tenantName: user?.tenant_name || "Reporte de Abonos y Consumos",
        clients: filteredClients,
        totals: data.totals,
        periodLabel,
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

  const { totals } = data || { totals: {} };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Filtrar por</label>
          <div className="flex gap-1">
            <Button
              variant={filterType === "week" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterType("week")}
              className={`rounded-l-xl rounded-r-none ${filterType === "week" ? "bg-green-600 hover:bg-green-700" : ""}`}
              data-testid="filter-type-week"
            >
              Semana
            </Button>
            <Button
              variant={filterType === "day" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterType("day")}
              className={`rounded-r-xl rounded-l-none ${filterType === "day" ? "bg-green-600 hover:bg-green-700" : ""}`}
              data-testid="filter-type-day"
            >
              Día
            </Button>
          </div>
        </div>
        
        {filterType === "week" ? (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Semana</label>
            <Select value={selectedWeek} onValueChange={setSelectedWeek}>
              <SelectTrigger className="w-48 rounded-xl h-9" data-testid="week-selector">
                <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((w) => (
                  <SelectItem key={w.key} value={w.key}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Día</label>
            <Select value={selectedDay} onValueChange={setSelectedDay}>
              <SelectTrigger className="w-48 rounded-xl h-9" data-testid="day-selector">
                <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="relative flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-gray-600 mb-1 block">Buscar</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Nombre, ID o WhatsApp..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl h-9"
              data-testid="balance-report-search"
            />
          </div>
        </div>
        
        <Button
          onClick={handleDownloadPDF}
          disabled={generating || !filteredClients.length}
          className="rounded-xl bg-green-600 hover:bg-green-700 text-white gap-2 h-9"
          data-testid="download-balance-pdf-btn"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Descargar PDF
        </Button>
      </div>

      {/* Loading state */}
      {loading ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Cargando reporte...</p>
          </CardContent>
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-8 text-center">
            <Users className="h-10 w-10 text-gray-300 mx-auto" />
            <p className="text-gray-500 mt-2">No hay clientes con actividad en este período</p>
          </CardContent>
        </Card>
      ) : (
        /* Clients Table */
        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-600" />
                Lista de Clientes ({filteredClients.length})
              </span>
              <span className="text-xs font-normal text-gray-500">
                Totales: <span className="text-green-600 font-semibold">{fmtMoney(totals.total_abonado)}</span> abonado · 
                <span className="text-red-600 font-semibold ml-1">{fmtMoney(totals.total_consumido)}</span> consumido · 
                <span className={`font-semibold ml-1 ${totals.total_saldo >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                  {fmtMoney(totals.total_saldo)}
                </span> saldo
              </span>
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
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
