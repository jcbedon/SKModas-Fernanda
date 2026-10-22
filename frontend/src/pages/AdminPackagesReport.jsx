import { getWeekKey } from "@/lib/weekKey";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getAllShipments, getTenantSettings, getAllClients, getInvoicesWithoutShipment, toggleShipmentGuideVerified } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Package, Search, Users, Layers, DollarSign, ClipboardCheck, CheckCircle2, AlertCircle, FileText, FileWarning,
} from "lucide-react";
import { getShipmentParts, formatShipmentParts } from "@/lib/shipmentPackages";

function getWeekLabel(weekKey) {
  const start = new Date(`${weekKey}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (dt) => {
    const day = dt.getDate();
    // Month name capitalized (es-ES returns lowercase like "abril").
    const monthRaw = dt.toLocaleDateString("es-ES", { month: "long" });
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
    return `${day}-${month}`;
  };
  return `Jueves ${fmt(start)} - Miércoles ${fmt(end)}`;
}

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function AdminPackagesReport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;
  const [loading, setLoading] = useState(true);
  const [shipments, setShipments] = useState([]);
  const [clientsByCode, setClientsByCode] = useState({}); // customer_id (UPPER) -> name
  const [categories, setCategories] = useState([]); // [{key, label, value_packages, value_pounds}]
  const [shippingMode, setShippingMode] = useState("packages");
  const [weekFilter, setWeekFilter] = useState(() => getWeekKey(new Date().toISOString()));
  const [customerFilter, setCustomerFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [customerListDialog, setCustomerListDialog] = useState(null); // {label, customers: [{customer_id, name}]}
  const [detailCustomerFilter, setDetailCustomerFilter] = useState("");
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyWeek, setVerifyWeek] = useState(() => getWeekKey(new Date().toISOString()));
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("all"); // "all" | "approved" | "pending" | "annulled" | "none"
  const [invoicesWithoutShipment, setInvoicesWithoutShipment] = useState(null); // { clients, invoices_count, clients_count }
  const [loadingInvoicesWithoutShipment, setLoadingInvoicesWithoutShipment] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [shipsRes, tenantRes, clientsRes] = await Promise.all([
          getAllShipments(),
          getTenantSettings(),
          getAllClients(),
        ]);
        setShipments(shipsRes.data || []);
        const cats = (tenantRes.data?.shipping_categories || []).map((c) => ({
          ...c,
          value_packages: c.value_packages ?? c.value ?? 0,
          value_pounds: c.value_pounds ?? c.value ?? 0,
        }));
        setCategories(cats);
        setShippingMode(tenantRes.data?.shipping_mode === "pounds" ? "pounds" : "packages");
        // Build customer_id -> name lookup so we can resolve missing names on shipments.
        const lookup = {};
        (clientsRes.data || []).forEach((c) => {
          if (c.customer_id) lookup[String(c.customer_id).toUpperCase()] = c.name || "";
        });
        setClientsByCode(lookup);
      } catch (e) {
        toast.error("No se pudo cargar el reporte de paquetes");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Lazy-load invoices-without-shipment whenever the verify dialog opens.
  useEffect(() => {
    if (!verifyDialogOpen) return;
    let cancelled = false;
    (async () => {
      setLoadingInvoicesWithoutShipment(true);
      try {
        const res = await getInvoicesWithoutShipment();
        if (!cancelled) setInvoicesWithoutShipment(res.data || null);
      } catch {
        if (!cancelled) setInvoicesWithoutShipment(null);
      } finally {
        if (!cancelled) setLoadingInvoicesWithoutShipment(false);
      }
    })();
    return () => { cancelled = true; };
  }, [verifyDialogOpen]);

  // Derive every week present in the data, sorted desc.
  // Always ensure the current week is included so the default filter has a matching option.
  const weekOptions = useMemo(() => {
    const set = new Set();
    shipments.forEach((s) => set.add(getWeekKey(s.created_at)));
    set.add(getWeekKey(new Date().toISOString()));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [shipments]);

  // Filtered list (week + customer + category)
  const filtered = useMemo(() => {
    let rows = shipments;
    if (weekFilter !== "all") rows = rows.filter((s) => getWeekKey(s.created_at) === weekFilter);
    const code = customerFilter.trim().toUpperCase();
    if (code) rows = rows.filter((s) => (s.customer_id || "").toUpperCase().includes(code));
    if (categoryFilter !== "all") rows = rows.filter((s) => getShipmentParts(s).some((p) => p.category === categoryFilter));
    return rows;
  }, [shipments, weekFilter, customerFilter, categoryFilter]);

  // Aggregations
  const summary = useMemo(() => {
    const byCustomer = {}; // customer_id -> { name, total_qty, total_cost, by_cat: { key: { qty, cost } } }
    const byCategory = {}; // category_key -> { label, qty, cost, customers_set }
    let grandQty = 0;
    let grandCost = 0;

    filtered.forEach((s) => {
      const custId = (s.customer_id || "—").toUpperCase();
      // Prefer the shipment's own field; fallback to the live client lookup.
      const custName = s.customer_name || clientsByCode[custId] || "";
      if (!byCustomer[custId]) byCustomer[custId] = { customer_id: custId, name: custName, total_qty: 0, total_cost: 0, by_cat: {} };
      // Update the name if we just got a non-empty one and previously stored an empty one.
      if (custName && !byCustomer[custId].name) byCustomer[custId].name = custName;
      getShipmentParts(s).filter((part) => categoryFilter === "all" || part.category === categoryFilter).forEach((part) => {
      const catKey = part.category || "OTHER";
      const cat = categories.find((c) => c.key === catKey);
      const qty = part.qty;
      const cost = part.cost;
      grandQty += qty;
      grandCost += cost;

      // by customer
      byCustomer[custId].total_qty += qty;
      byCustomer[custId].total_cost += cost;
      if (!byCustomer[custId].by_cat[catKey]) byCustomer[custId].by_cat[catKey] = { qty: 0, cost: 0, label: cat?.label || catKey };
      byCustomer[custId].by_cat[catKey].qty += qty;
      byCustomer[custId].by_cat[catKey].cost += cost;

      // by category
      if (!byCategory[catKey]) byCategory[catKey] = { key: catKey, label: cat?.label || catKey, qty: 0, cost: 0, customers: new Map() };
      byCategory[catKey].qty += qty;
      byCategory[catKey].cost += cost;
      // Map customer_id -> { name, qty } so we can show quantity-per-customer in the dialog.
      const prev = byCategory[catKey].customers.get(custId) || { name: custName || "", qty: 0 };
      prev.qty += qty;
      if (custName && !prev.name) prev.name = custName;
      byCategory[catKey].customers.set(custId, prev);
      });
    });

    return {
      grandQty,
      grandCost,
      byCustomer: Object.values(byCustomer).sort((a, b) => b.total_qty - a.total_qty),
      byCategory: Object.values(byCategory).map((c) => ({
        ...c,
        customer_count: c.customers.size,
        customers_list: Array.from(c.customers.entries())
          .map(([id, info]) => ({ customer_id: id, name: info.name, qty: info.qty }))
          .sort((a, b) => b.qty - a.qty || a.customer_id.localeCompare(b.customer_id)),
      })).sort((a, b) => b.qty - a.qty),
    };
  }, [filtered, categories, clientsByCode, categoryFilter]);

  const isPounds = shippingMode === "pounds";
  const unitLabel = isPounds ? "lb" : "paq.";
  const fmtQty = (q) => Number(q).toFixed(isPounds ? 1 : 0);

  // Toggle the manual `guide_verified` flag of a shipment with optimistic UI.
  const handleToggleGuideVerified = async (shipmentId, currentVal) => {
    const next = !currentVal;
    // Optimistic update so the check responds instantly
    setShipments((prev) => prev.map((s) => (
      s.id === shipmentId ? { ...s, guide_verified: next, guide_verified_at: next ? new Date().toISOString() : null } : s
    )));
    try {
      await toggleShipmentGuideVerified(shipmentId, next);
      toast.success(next ? "Guía marcada como verificada" : "Verificación removida");
    } catch (e) {
      // Roll back on failure
      setShipments((prev) => prev.map((s) => (
        s.id === shipmentId ? { ...s, guide_verified: currentVal } : s
      )));
      toast.error("No se pudo actualizar la verificación");
    }
  };

  // Verification view: shipments grouped by client, showing if guide (tracking) was created.
  // Totals/chips ALWAYS reflect the full week (so filters can be re-applied);
  // only the grouped list is filtered when an invoice status chip is clicked.
  const verifyData = useMemo(() => {
    const allRows = shipments.filter((s) => getWeekKey(s.created_at) === verifyWeek);

    // Aggregate counts over the full unfiltered set
    let aggPackages = 0;
    let aggGuides = 0;
    let aggWithGuides = 0;
    let cntApproved = 0;
    let cntPending = 0;
    let cntAnnulled = 0;
    let cntNoInvoice = 0;
    let cntWithInvoice = 0;
    allRows.forEach((s) => {
      const tracks = Array.isArray(s.tracking_numbers) ? s.tracking_numbers.filter((t) => (t || "").trim()) : [];
      const legacyTrack = s.tracking_number && tracks.length === 0 ? [s.tracking_number] : [];
      const allTracks = tracks.length ? tracks : legacyTrack;
      aggPackages += Number(s.package_count) || 0;
      aggGuides += allTracks.length;
      // "tiene guía" = manual confirmation by admin (paper in hand)
      if (s.guide_verified) aggWithGuides += 1;
      const st = s.invoice_status || null;
      if (st === "approved") cntApproved += 1;
      else if (st === "annulled") cntAnnulled += 1;
      else if (st === "pending") cntPending += 1;
      else cntNoInvoice += 1;
      if (st) cntWithInvoice += 1;
    });

    // Filter rows for the displayed list
    const rows = invoiceStatusFilter === "all"
      ? allRows
      : allRows.filter((s) => {
          const st = s.invoice_status || null;
          if (invoiceStatusFilter === "none") return !st;
          return st === invoiceStatusFilter;
        });
    const groups = {}; // customer_id -> { name, items: [...], totals }
    rows.forEach((s) => {
      const cid = (s.customer_id || "—").toUpperCase();
      const name = s.user_name || s.customer_name || clientsByCode[cid] || "Sin nombre";
      const tracks = Array.isArray(s.tracking_numbers) ? s.tracking_numbers.filter((t) => (t || "").trim()) : [];
      const legacyTrack = s.tracking_number && tracks.length === 0 ? [s.tracking_number] : [];
      const allTracks = tracks.length ? tracks : legacyTrack;
      const verified = !!s.guide_verified;
      const pkgs = Number(s.package_count) || 0;
      if (!groups[cid]) groups[cid] = { customer_id: cid, name, items: [], total_pkgs: 0, total_guides: 0 };
      groups[cid].items.push({
        id: s.id,
        created_at: s.created_at,
        created_by_name: s.created_by_name || "",
        created_by_legacy: !!s.created_by_legacy,
        package_count: pkgs,
        shipping_mode: s.shipping_mode,
        shipping_category: s.packages?.length > 1 ? formatShipmentParts(s) : (s.shipping_category || ""),
        tracking_count: allTracks.length,
        has_guide: verified,
        guide_verified: verified,
        guide_verified_at: s.guide_verified_at || null,
        guide_verified_by_name: s.guide_verified_by_name || "",
        status: s.status || "preparing",
        invoice_status: s.invoice_status || null,
        invoice_number: s.invoice_number || "",
      });
      groups[cid].total_pkgs += pkgs;
      groups[cid].total_guides += allTracks.length;
    });
    // Sort each group's items by date desc
    Object.values(groups).forEach((g) => {
      g.items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    });
    return {
      groups: Object.values(groups).sort((a, b) => a.customer_id.localeCompare(b.customer_id)),
      totalPackages: aggPackages,
      totalGuides: aggGuides,
      totalShipments: allRows.length,
      shipmentsWithGuides: aggWithGuides,
      shipmentsWithoutGuides: allRows.length - aggWithGuides,
      shipmentsApproved: cntApproved,
      shipmentsPending: cntPending,
      shipmentsAnnulled: cntAnnulled,
      shipmentsNoInvoice: cntNoInvoice,
      shipmentsWithInvoice: cntWithInvoice,
      filteredCount: rows.length,
    };
  }, [shipments, verifyWeek, invoiceStatusFilter, clientsByCode]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="app-bg min-h-screen pb-12">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Detalle de Paquetes</span>
          <Button
            onClick={() => setVerifyDialogOpen(true)}
            className="rounded-xl bg-orange-600 hover:bg-orange-700 text-white h-9 px-3 text-xs font-bold"
            data-testid="open-verify-dialog-btn"
          >
            <ClipboardCheck className="h-4 w-4 mr-1.5" />
            Verificar
          </Button>
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <Package className="h-5 w-5 text-orange-600" />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">

        {/* Filters */}
        <Card className="rounded-2xl border-slate-100 mb-4">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Semana</label>
                <Select value={weekFilter} onValueChange={setWeekFilter}>
                  <SelectTrigger className="h-10 rounded-xl bg-white" data-testid="week-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las semanas</SelectItem>
                    {weekOptions.map((wk) => (
                      <SelectItem key={wk} value={wk}>{getWeekLabel(wk)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Cliente</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={customerFilter}
                    onChange={(e) => setCustomerFilter(e.target.value)}
                    placeholder="Código de cliente"
                    className="h-10 rounded-xl pl-9 uppercase"
                    data-testid="customer-filter"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Categoría</label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 rounded-xl bg-white" data-testid="category-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                    <SelectItem value="OTHER">Otra</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card className="rounded-2xl bg-orange-50 border-orange-100" data-testid="kpi-total-qty">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-orange-700 text-[10px] uppercase font-bold">
                <Package className="h-3.5 w-3.5" /> Total {unitLabel}
              </div>
              <p className="text-xl font-extrabold text-orange-900 mt-1">{fmtQty(summary.grandQty)}</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl bg-purple-50 border-purple-100" data-testid="kpi-total-cost">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-purple-700 text-[10px] uppercase font-bold">
                <DollarSign className="h-3.5 w-3.5" /> Total a Cobrar
              </div>
              <p className="text-xl font-extrabold text-purple-900 mt-1">${summary.grandCost.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl bg-blue-50 border-blue-100" data-testid="kpi-customers">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-blue-700 text-[10px] uppercase font-bold">
                <Users className="h-3.5 w-3.5" /> Clientes
              </div>
              <p className="text-xl font-extrabold text-blue-900 mt-1">{summary.byCustomer.length}</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl bg-slate-50 border-slate-100" data-testid="kpi-shipments">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-slate-600 text-[10px] uppercase font-bold">
                <Layers className="h-3.5 w-3.5" /> Envíos
              </div>
              <p className="text-xl font-extrabold text-slate-800 mt-1">{filtered.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* By Category */}
        <Card className="rounded-2xl mb-4">
          <CardContent className="p-4">
            <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4" /> Resumen por Categoría
            </h2>
            {summary.byCategory.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">Sin datos para esta semana.</p>
            ) : (
              <div className="space-y-2">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                  <div className="col-span-5">Categoría</div>
                  <div className="col-span-2 text-center">Cant. de Paquetes</div>
                  <div className="col-span-2 text-center">Cant. de Clientes</div>
                  <div className="col-span-3 text-right">Total a Pagar</div>
                </div>
                {summary.byCategory.map((cat) => (
                  <div key={cat.key} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-xl px-3 py-2 text-xs" data-testid={`cat-row-${cat.key}`}>
                    <div className="col-span-5 min-w-0 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">{cat.key}</Badge>
                      <span className="text-slate-700 font-semibold whitespace-normal">{cat.label}</span>
                    </div>
                    <div className="col-span-2 text-center">
                      <p className="font-extrabold text-slate-800">{fmtQty(cat.qty)}</p>
                    </div>
                    <div className="col-span-2 text-center">
                      <button
                        type="button"
                        onClick={() => setCustomerListDialog({ label: cat.label, customers: cat.customers_list })}
                        className="font-extrabold text-blue-700 hover:underline"
                        data-testid={`cat-${cat.key}-clients-btn`}
                      >
                        {cat.customer_count}
                      </button>
                    </div>
                    <div className="col-span-3 text-right">
                      <p className="font-extrabold text-purple-700">${cat.cost.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Customer */}
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Users className="h-4 w-4" /> Detalle por Cliente
              </h2>
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  value={detailCustomerFilter}
                  onChange={(e) => setDetailCustomerFilter(e.target.value)}
                  placeholder="Filtrar por código"
                  className="h-9 rounded-xl pl-8 text-xs uppercase"
                  data-testid="detail-customer-filter"
                />
              </div>
            </div>
            {(() => {
              const code = detailCustomerFilter.trim().toUpperCase();
              const list = code
                ? summary.byCustomer.filter((c) => c.customer_id.includes(code))
                : summary.byCustomer;
              if (list.length === 0) {
                return <p className="text-xs text-slate-500 text-center py-4">Sin datos para esta búsqueda.</p>;
              }
              return (
                <div className="space-y-3">
                  {list.map((cust) => (
                    <div key={cust.customer_id} className="rounded-xl border border-slate-100 bg-white" data-testid={`cust-row-${cust.customer_id}`}>
                      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-t-xl">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="font-mono">{cust.customer_id}</Badge>
                          <span className="text-xs font-bold text-slate-800 truncate" data-testid={`cust-${cust.customer_id}-name`}>
                            {cust.name || "Sin nombre"}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase font-bold text-slate-500">Total</p>
                          <p className="text-sm font-extrabold text-purple-700">${cust.total_cost.toFixed(2)} · {fmtQty(cust.total_qty)} {unitLabel}</p>
                        </div>
                      </div>
                      <div className="px-3 py-2 space-y-1.5">
                        {Object.entries(cust.by_cat).map(([catKey, c]) => (
                          <div key={catKey} className="flex items-center justify-between text-xs" data-testid={`cust-${cust.customer_id}-cat-${catKey}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge variant="outline" className="font-mono text-[10px]">{catKey}</Badge>
                              <span className="text-slate-600 truncate">{c.label}</span>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-slate-700 font-bold">{fmtQty(c.qty)} {unitLabel}</span>
                              <span className="text-purple-700 font-extrabold">${c.cost.toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Customers per Category Dialog */}
        <Dialog open={!!customerListDialog} onOpenChange={(open) => !open && setCustomerListDialog(null)}>
          <DialogContent className="rounded-2xl max-w-md w-[95vw] max-h-[80vh] overflow-y-auto" data-testid="customers-by-category-dialog">
            <DialogHeader>
              <DialogTitle className="text-base">
                Clientes en {customerListDialog?.label || ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5 mt-2">
              {(customerListDialog?.customers || []).map((c) => (
                <div key={c.customer_id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs gap-2" data-testid={`dialog-customer-${c.customer_id}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant="outline" className="font-mono flex-shrink-0">{c.customer_id}</Badge>
                    <span className="text-slate-700 font-semibold truncate">{c.name || "Sin nombre"}</span>
                  </div>
                  <span className="text-purple-700 font-extrabold flex-shrink-0">
                    {fmtQty(c.qty)} {unitLabel}
                  </span>
                </div>
              ))}
              {(customerListDialog?.customers || []).length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">Sin clientes.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Verification Dialog: Paquetes vs Guías */}
        <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
          <DialogContent className="rounded-2xl max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto" data-testid="verify-dialog">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-orange-600" />
                Verificar Paquetes vs Guías Creadas
              </DialogTitle>
            </DialogHeader>

            {/* Week filter */}
            <div className="flex items-center gap-3 mt-3 mb-3">
              <label className="text-[10px] uppercase font-bold text-slate-500">Semana</label>
              <Select value={verifyWeek} onValueChange={setVerifyWeek}>
                <SelectTrigger className="h-9 rounded-xl bg-white text-xs flex-1" data-testid="verify-week-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekOptions.map((wk) => (
                    <SelectItem key={wk} value={wk}>{getWeekLabel(wk)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
                <p className="text-[10px] uppercase font-bold text-orange-700">Paquetes</p>
                <p className="text-xl font-extrabold text-orange-900" data-testid="verify-total-packages">{fmtQty(verifyData.totalPackages)}</p>
                <p className="text-[10px] text-orange-700 mt-0.5">{verifyData.totalShipments} envío{verifyData.totalShipments === 1 ? "" : "s"}</p>
              </div>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-700">Guías Verificadas</p>
                <p className="text-xl font-extrabold text-blue-900" data-testid="verify-total-guides">{verifyData.shipmentsWithGuides}</p>
                <p className="text-[10px] text-blue-700 mt-0.5">de {verifyData.totalShipments} envío{verifyData.totalShipments === 1 ? "" : "s"}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                <p className="text-[10px] uppercase font-bold text-emerald-700">Cobertura</p>
                <p className="text-xl font-extrabold text-emerald-900" data-testid="verify-coverage">
                  {verifyData.totalShipments
                    ? `${Math.round((verifyData.shipmentsWithGuides / verifyData.totalShipments) * 100)}%`
                    : "—"}
                </p>
                <p className="text-[10px] text-emerald-700 mt-0.5">guías verificadas</p>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
                <p className="text-[10px] uppercase font-bold text-rose-700">Pendientes</p>
                <p className="text-xl font-extrabold text-rose-900" data-testid="verify-missing">{verifyData.shipmentsWithoutGuides}</p>
                <p className="text-[10px] text-rose-700 mt-0.5">sin verificar</p>
              </div>
            </div>

            {/* Invoice status row — chips are clickable filters */}
            <div className="flex items-center gap-2 flex-wrap mb-3 text-[11px]">
              <span className="font-bold text-slate-500 uppercase text-[10px]">Facturas:</span>
              <button
                type="button"
                onClick={() => setInvoiceStatusFilter("all")}
                className={`px-2 py-0.5 rounded font-bold border transition-all ${invoiceStatusFilter === "all" ? "bg-slate-800 text-white border-slate-800 ring-2 ring-slate-300" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                data-testid="verify-inv-filter-all"
              >
                Todas ({verifyData.totalShipments})
              </button>              <button
                type="button"
                onClick={() => setInvoiceStatusFilter(invoiceStatusFilter === "approved" ? "all" : "approved")}
                className={`px-2 py-0.5 rounded font-bold border transition-all ${invoiceStatusFilter === "approved" ? "bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-300" : "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200"}`}
                data-testid="verify-inv-approved"
              >
                ✓ {verifyData.shipmentsApproved} aprobada{verifyData.shipmentsApproved === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => setInvoiceStatusFilter(invoiceStatusFilter === "pending" ? "all" : "pending")}
                className={`px-2 py-0.5 rounded font-bold border transition-all ${invoiceStatusFilter === "pending" ? "bg-amber-600 text-white border-amber-600 ring-2 ring-amber-300" : "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200"}`}
                data-testid="verify-inv-pending"
              >
                ⌛ {verifyData.shipmentsPending} pendiente{verifyData.shipmentsPending === 1 ? "" : "s"}
              </button>
              {verifyData.shipmentsAnnulled > 0 && (
                <button
                  type="button"
                  onClick={() => setInvoiceStatusFilter(invoiceStatusFilter === "annulled" ? "all" : "annulled")}
                  className={`px-2 py-0.5 rounded font-bold border transition-all ${invoiceStatusFilter === "annulled" ? "bg-slate-700 text-white border-slate-700 ring-2 ring-slate-300" : "bg-slate-200 text-slate-700 border-slate-300 hover:bg-slate-300"}`}
                  data-testid="verify-inv-annulled"
                >
                  ✕ {verifyData.shipmentsAnnulled} anulada{verifyData.shipmentsAnnulled === 1 ? "" : "s"}
                </button>
              )}
              {verifyData.shipmentsNoInvoice > 0 && (
                <button
                  type="button"
                  onClick={() => setInvoiceStatusFilter(invoiceStatusFilter === "none" ? "all" : "none")}
                  className={`px-2 py-0.5 rounded font-bold border transition-all ${invoiceStatusFilter === "none" ? "bg-slate-600 text-white border-slate-600 ring-2 ring-slate-300" : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"}`}
                  data-testid="verify-inv-none"
                >
                  — {verifyData.shipmentsNoInvoice} sin factura
                </button>
              )}
              {invoiceStatusFilter !== "all" && (
                <span className="text-[10px] text-slate-500 italic">
                  · mostrando {verifyData.filteredCount} de {verifyData.totalShipments}
                </span>
              )}
            </div>

            {/* Paquetes vs Facturas — totals + invoices missing a shipment */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 mb-3" data-testid="verify-packages-vs-invoices">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[11px] font-bold text-blue-800 uppercase flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Paquetes vs Facturas
                </p>
                <p className="text-[10px] text-blue-700">Datos globales (todas las semanas)</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2">
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Con paquete asignado</p>
                  <p className="text-lg font-extrabold text-emerald-900" data-testid="verify-paq-with-invoice">
                    {verifyData.shipmentsWithInvoice}
                  </p>
                  <p className="text-[10px] text-emerald-700">envío{verifyData.shipmentsWithInvoice === 1 ? "" : "s"} con factura</p>
                </div>
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2">
                  <p className="text-[10px] uppercase font-bold text-rose-700 flex items-center gap-1">
                    <FileWarning className="h-3 w-3" /> Facturas sin paquete
                  </p>
                  <p className="text-lg font-extrabold text-rose-900" data-testid="verify-inv-no-shipment">
                    {loadingInvoicesWithoutShipment ? "…" : (invoicesWithoutShipment?.invoices_count ?? 0)}
                  </p>
                  <p className="text-[10px] text-rose-700">
                    {invoicesWithoutShipment?.clients_count || 0} cliente{invoicesWithoutShipment?.clients_count === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              {/* List of invoices missing a shipment */}
              {!loadingInvoicesWithoutShipment && invoicesWithoutShipment && invoicesWithoutShipment.clients?.length > 0 && (
                <details className="mt-2 group" data-testid="verify-inv-no-shipment-details">
                  <summary className="cursor-pointer text-[11px] font-bold text-rose-700 hover:text-rose-900 select-none">
                    Ver facturas sin paquete asignado ▾
                  </summary>
                  <div className="mt-2 space-y-2 max-h-64 overflow-y-auto pr-1">
                    {invoicesWithoutShipment.clients.map((c) => (
                      <div key={c.customer_id} className="rounded-lg border border-rose-100 bg-white" data-testid={`verify-inv-missing-client-${c.customer_id}`}>
                        <div className="flex items-center justify-between px-2 py-1.5 bg-rose-50 rounded-t-lg gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="font-mono text-[10px]">{c.customer_id}</Badge>
                            <span className="text-[11px] font-bold text-slate-800 truncate">{c.name || "Sin nombre"}</span>
                          </div>
                          <Badge className="bg-rose-500 hover:bg-rose-500 text-[10px] flex-shrink-0">
                            {c.invoices.length} factura{c.invoices.length === 1 ? "" : "s"}
                          </Badge>
                        </div>
                        <div className="divide-y divide-rose-50">
                          {c.invoices.map((inv) => (
                            <div key={inv.id} className="flex items-center justify-between px-2 py-1.5 text-[11px]" data-testid={`verify-inv-missing-${inv.id}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-3 w-3 text-rose-500 flex-shrink-0" />
                                <span className="font-mono font-bold text-slate-700">{inv.invoice_number}</span>
                                <span className="text-[10px] text-slate-500">
                                  {new Date(inv.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" })}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${inv.status === "approved" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200"}`}>
                                  {inv.status === "approved" ? "Aprobada" : "Pendiente"}
                                </span>
                                <span className="font-extrabold text-slate-800">${(inv.total || 0).toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {!loadingInvoicesWithoutShipment && invoicesWithoutShipment && invoicesWithoutShipment.invoices_count === 0 && (
                <p className="text-[10px] text-emerald-700 text-center mt-1 italic">Todas las facturas tienen paquete asignado ✓</p>
              )}
            </div>

            {/* Grouped list by client */}
            {verifyData.groups.length === 0 ? (
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-6 text-center">
                <p className="text-sm text-slate-500">Sin envíos en esta semana.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {verifyData.groups.map((g) => {
                  const fullCoverage = g.items.every((it) => it.has_guide);
                  return (
                    <div key={g.customer_id} className="rounded-xl border border-slate-100 bg-white overflow-hidden" data-testid={`verify-group-${g.customer_id}`}>
                      <div className={`flex items-center justify-between px-3 py-2 ${fullCoverage ? "bg-emerald-50" : "bg-slate-50"}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="font-mono">{g.customer_id}</Badge>
                          <span className="text-xs font-bold text-slate-800 truncate">{g.name}</span>
                          {fullCoverage ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">Completo</Badge>
                          ) : (
                            <Badge className="bg-amber-500 hover:bg-amber-500 text-[10px]">{g.items.filter((it) => !it.has_guide).length} pendiente{g.items.filter((it) => !it.has_guide).length === 1 ? "" : "s"}</Badge>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-600 flex-shrink-0">
                          {fmtQty(g.total_pkgs)} {unitLabel} · {g.total_guides} guía{g.total_guides === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {g.items.map((it) => (
                          <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs" data-testid={`verify-item-${it.id}`}>
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => handleToggleGuideVerified(it.id, it.guide_verified)}
                                className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center border-2 transition-all hover:scale-110 cursor-pointer ${it.guide_verified ? "bg-emerald-100 border-emerald-500 hover:bg-emerald-200" : "bg-white border-rose-300 hover:bg-rose-50"}`}
                                title={it.guide_verified ? `✓ Guía verificada${it.guide_verified_by_name ? ` por ${it.guide_verified_by_name}` : ""}${it.guide_verified_at ? ` el ${new Date(it.guide_verified_at).toLocaleDateString("es-ES")}` : ""} — click para desmarcar` : "Click para marcar guía como verificada (papel en mano)"}
                                data-testid={it.guide_verified ? `verify-check-yes-${it.id}` : `verify-check-no-${it.id}`}
                                aria-label={it.guide_verified ? "Desmarcar guía verificada" : "Marcar guía como verificada"}
                              >
                                {it.guide_verified ? (
                                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                ) : (
                                  <AlertCircle className="h-5 w-5 text-rose-400" />
                                )}
                              </button>
                              <div className="min-w-0">
                                <p className="text-slate-700 truncate">
                                  {new Date(it.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                                  {" · "}
                                  {new Date(it.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                                  {it.shipping_category && (
                                    <span className="ml-2 text-slate-400">· {it.shipping_category}</span>
                                  )}
                                </p>
                                {it.created_by_name && (
                                  <p className={`text-[10px] mt-0.5 ${it.created_by_legacy ? "text-amber-700" : "text-blue-700"} font-semibold`}>
                                    {it.created_by_legacy ? "(est.)" : ""} {it.created_by_name}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-bold text-slate-800">
                                {fmtQty(it.package_count)} {it.shipping_mode === "pounds" ? "lb" : "paq."}
                              </p>
                              <p className={`text-[10px] mt-0.5 ${it.guide_verified ? "text-emerald-700" : "text-rose-600"} font-semibold`}>
                                {it.guide_verified ? "✓ Guía verificada" : "Sin verificar"}
                              </p>
                              {it.invoice_status ? (
                                <span
                                  className={
                                    it.invoice_status === "approved"
                                      ? "inline-block mt-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200"
                                      : it.invoice_status === "annulled"
                                        ? "inline-block mt-1 text-[10px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded border border-slate-300"
                                        : "inline-block mt-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200"
                                  }
                                  title={it.invoice_number ? `Factura ${it.invoice_number}` : ""}
                                  data-testid={`verify-invoice-status-${it.id}`}
                                >
                                  {it.invoice_status === "approved" ? "✓ Aprobada" : it.invoice_status === "annulled" ? "Anulada" : "Pendiente"}
                                </span>
                              ) : (
                                <span className="inline-block mt-1 text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200" data-testid={`verify-invoice-status-${it.id}`}>
                                  Sin factura
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
