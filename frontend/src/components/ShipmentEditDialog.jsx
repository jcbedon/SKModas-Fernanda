import { useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Save, Plus, Trash2, Package, Scale } from "lucide-react";

const DEFAULT_CATEGORIES = [
  { key: "G", label: "Categoría G (CON Núcleo Familiar)", value_packages: 32, value_pounds: 32 },
  { key: "A", label: "Categoría A (Personal)", value_packages: 42, value_pounds: 42 },
  { key: "B", label: "Categoría B (SIN Núcleo Familiar)", value_packages: 52, value_pounds: 52 },
];

export default function ShipmentEditDialog({
  shipment,
  editDialogOpen,
  setEditDialogOpen,
  editForm,
  setEditForm,
  handleOpenEditDialog,
  handleSaveEdit,
  tenantSettings,
}) {
  const mode = tenantSettings?.shipping_mode === "pounds" ? "pounds" : "packages";
  const categories = (tenantSettings?.shipping_categories?.length ? tenantSettings.shipping_categories : DEFAULT_CATEGORIES);
  const isOpen = editDialogOpen === shipment.id;

  // Derive the unit cost from the chosen category (or manual cost in OTHER mode).
  const unitCost = useMemo(() => {
    if (!editForm?.shipping_category) return 0;
    if (editForm.shipping_category === "OTHER") {
      return parseFloat(editForm.shipping_unit_cost) || 0;
    }
    const cat = categories.find((c) => c.key === editForm.shipping_category);
    if (!cat) return 0;
    const priceField = mode === "pounds" ? "value_pounds" : "value_packages";
    return parseFloat(cat[priceField] ?? cat.value ?? 0) || 0;
  }, [editForm?.shipping_category, editForm?.shipping_unit_cost, categories, mode]);

  // Recompute total cost when category / quantity / unit cost changes.
  // We only auto-update shipping_cost while the dialog is open, so legacy
  // shipments without a category still keep their stored shipping_cost intact
  // until the admin picks a category.
  const multi = Array.isArray(editForm?.packages) && editForm.packages.length > 0;
  const partUnit = (pkg) => {
    if (pkg.shipping_category === "OTHER") return parseFloat(pkg.custom_unit_cost) || 0;
    const cat = categories.find((c) => c.key === pkg.shipping_category);
    return cat ? parseFloat(cat[mode === "pounds" ? "value_pounds" : "value_packages"] ?? cat.value ?? 0) || 0 : 0;
  };
  const partQty = (pkg) => {
    const q = parseFloat(pkg.package_count) || 0;
    return mode === "pounds" ? Math.max(q, 0) : Math.max(Math.round(q), 0);
  };
  const updatePart = (id, field, value) =>
    setEditForm((prev) => ({ ...prev, packages: prev.packages.map((p) => (p.id === id ? { ...p, [field]: value } : p)) }));

  // Multi-package: total is the sum of each package priced by its own category.
  useEffect(() => {
    if (!isOpen || !multi) return;
    const total = editForm.packages.reduce((sum, p) => sum + Math.round(partUnit(p) * partQty(p) * 100) / 100, 0);
    setEditForm((prev) => ({ ...prev, shipping_cost: total.toFixed(2) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, multi, JSON.stringify(editForm?.packages), mode]);

  useEffect(() => {
    if (!isOpen) return;
    if (multi) return;
    if (!editForm?.shipping_category) return;
    const rawQty = parseFloat(editForm.package_count) || 0;
    const qty = mode === "pounds" ? Math.max(rawQty, 0) : Math.max(Math.round(rawQty), 0);
    const total = Math.round(unitCost * qty * 100) / 100;
    if (Number.isFinite(total)) {
      setEditForm((prev) => ({ ...prev, shipping_cost: total.toFixed(2) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editForm?.shipping_category, editForm?.package_count, editForm?.shipping_unit_cost, mode, unitCost]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) setEditDialogOpen(null); }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={() => handleOpenEditDialog(shipment)}
          data-testid={`edit-shipment-${shipment.id}`}
        >
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Envío</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          {multi ? (
            <div className="space-y-3" data-testid="edit-shipment-packages">
              {editForm.packages.map((pkg, idx) => (
                <div key={pkg.id} className="border rounded-xl p-3 space-y-2 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">Paquete {idx + 1}</span>
                    {editForm.packages.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500"
                        onClick={() => setEditForm((prev) => ({ ...prev, packages: prev.packages.filter((p) => p.id !== pkg.id) }))}
                        data-testid={`edit-remove-package-${idx}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <Select value={pkg.shipping_category || ""} onValueChange={(v) => updatePart(pkg.id, "shipping_category", v)}>
                        <SelectTrigger className="h-10 rounded-lg" data-testid={`edit-package-category-${idx}`}>
                          <SelectValue placeholder="Categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.key} value={cat.key}>
                              {cat.label} — ${mode === "pounds" ? cat.value_pounds : cat.value_packages}
                            </SelectItem>
                          ))}
                          <SelectItem value="OTHER">Otra (precio personalizado)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Input type="number" step={mode === "pounds" ? "0.1" : "1"} min="0" value={pkg.package_count}
                      onChange={(e) => updatePart(pkg.id, "package_count", e.target.value)} onWheel={(e) => e.target.blur()}
                      className="h-10 rounded-lg" data-testid={`edit-package-qty-${idx}`} />
                  </div>
                  {pkg.shipping_category === "OTHER" && (
                    <Input type="number" step="0.01" value={pkg.custom_unit_cost} placeholder="Costo unitario"
                      onChange={(e) => updatePart(pkg.id, "custom_unit_cost", e.target.value)} onWheel={(e) => e.target.blur()}
                      className="h-10 rounded-lg" data-testid={`edit-package-unit-${idx}`} />
                  )}
                  <p className="text-xs text-slate-500" data-testid={`edit-package-subtotal-${idx}`}>
                    {partQty(pkg)} × ${partUnit(pkg).toFixed(2)} = <span className="font-bold text-slate-800">${(partUnit(pkg) * partQty(pkg)).toFixed(2)}</span>
                  </p>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-full rounded-lg gap-1"
                onClick={() => setEditForm((prev) => ({ ...prev, packages: [...prev.packages, { id: Math.max(...prev.packages.map((p) => p.id)) + 1, shipping_category: "", custom_unit_cost: "", package_count: "1" }] }))}
                data-testid="edit-add-package">
                <Plus className="h-4 w-4" /> Agregar Paquete
              </Button>
            </div>
          ) : (
            <>
          {/* Category selector */}
          <div>
            <Label>Categoría de envío</Label>
            <Select
              value={editForm.shipping_category || ""}
              onValueChange={(value) => setEditForm({ ...editForm, shipping_category: value })}
            >
              <SelectTrigger className="h-12 rounded-xl mt-1" data-testid="edit-shipment-category">
                <SelectValue placeholder="Selecciona una categoría" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => {
                  const v = mode === "pounds" ? cat.value_pounds : cat.value_packages;
                  return (
                    <SelectItem key={cat.key} value={cat.key}>
                      {cat.label} — ${v}/{mode === "pounds" ? "lb" : "paq"}
                    </SelectItem>
                  );
                })}
                <SelectItem value="OTHER">Otra (precio personalizado)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom unit cost only for OTHER */}
          {editForm.shipping_category === "OTHER" && (
            <div>
              <Label>Costo unitario personalizado (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={editForm.shipping_unit_cost}
                onChange={(e) => setEditForm({ ...editForm, shipping_unit_cost: e.target.value })}
                onWheel={(e) => e.target.blur()}
                className="h-12 rounded-xl mt-1"
                placeholder="Ej: 38.00"
              />
            </div>
          )}

          {/* Quantity (packages or pounds, depending on tenant mode) */}
          <div>
            <Label className="flex items-center gap-2">
              {mode === "pounds" ? <Scale className="h-4 w-4" /> : <Package className="h-4 w-4" />}
              {mode === "pounds" ? "Libras" : "Paquetes"}
            </Label>
            <Input
              type="number"
              step={mode === "pounds" ? "0.1" : "1"}
              min={mode === "pounds" ? "0.1" : "1"}
              value={editForm.package_count}
              onChange={(e) => setEditForm({ ...editForm, package_count: e.target.value })}
              onWheel={(e) => e.target.blur()}
              className="h-12 rounded-xl mt-1"
              placeholder={mode === "pounds" ? "Ej: 5.5" : "Ej: 2"}
              data-testid="edit-shipment-qty"
            />
            {editForm.shipping_category && unitCost > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                ${unitCost.toFixed(2)} × {editForm.package_count || 0} {mode === "pounds" ? "lb" : "paq"} = <span className="font-bold text-slate-800">${(parseFloat(editForm.shipping_cost) || 0).toFixed(2)}</span>
              </p>
            )}
          </div>

            </>
          )}

          {/* Total cost (auto-calculated, manually editable for backwards compat) */}
          <div>
            <Label>Costo Total del Envío (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={editForm.shipping_cost}
              onChange={(e) => setEditForm({ ...editForm, shipping_cost: e.target.value })}
              onWheel={(e) => e.target.blur()}
              className="h-12 rounded-xl mt-1 font-bold"
              readOnly={multi}
              data-testid="edit-shipment-total-cost"
            />
            <p className="text-[10px] text-slate-400 mt-0.5">{multi ? "Suma de todos los paquetes según su categoría." : "Se recalcula automáticamente al cambiar categoría o cantidad. Puedes ajustarlo manualmente."}</p>
          </div>

          {/* Type (legacy) */}
          <div>
            <Label>Tipo de Envío</Label>
            <Select
              value={editForm.shipping_type}
              onValueChange={(value) => setEditForm({ ...editForm, shipping_type: value })}
            >
              <SelectTrigger className="h-12 rounded-xl mt-1">
                <SelectValue placeholder="Selecciona tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="with_family">Con Familiar en USA</SelectItem>
                <SelectItem value="without_family">Sin Familiar en USA</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Address / phone / country */}
          <div>
            <Label>Dirección</Label>
            <Textarea
              value={editForm.address}
              onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
              className="rounded-xl mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>País</Label>
              <Input
                value={editForm.country}
                onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                className="h-12 rounded-xl mt-1"
              />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="h-12 rounded-xl mt-1"
              />
            </div>
          </div>

          {/* Tracking numbers (preserved) */}
          <div>
            <Label className="flex items-center gap-2 mb-2">
              <Package className="h-4 w-4" />
              Tracking Numbers ({editForm.tracking_numbers?.length || 0} paquetes)
            </Label>
            <div className="space-y-2">
              {(editForm.tracking_numbers || []).map((tracking, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-500 w-6">#{index + 1}</span>
                  <Input
                    value={tracking}
                    onChange={(e) => {
                      const updated = [...(editForm.tracking_numbers || [])];
                      updated[index] = e.target.value;
                      setEditForm({ ...editForm, tracking_numbers: updated });
                    }}
                    className="h-10 rounded-lg flex-1"
                    placeholder={`Tracking paquete ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const updated = editForm.tracking_numbers.filter((_, i) => i !== index);
                      setEditForm({ ...editForm, tracking_numbers: updated });
                    }}
                    className="h-10 w-10 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditForm({
                  ...editForm,
                  tracking_numbers: [...(editForm.tracking_numbers || []), ""],
                })}
                className="w-full h-10 rounded-lg border-dashed"
              >
                <Plus className="h-4 w-4 mr-2" />
                Agregar Tracking
              </Button>
            </div>
          </div>

          <div>
            <Label>Información Adicional</Label>
            <Textarea
              value={editForm.additional_info}
              onChange={(e) => setEditForm({ ...editForm, additional_info: e.target.value })}
              className="rounded-xl mt-1"
            />
          </div>

          <Button
            onClick={() => handleSaveEdit(shipment.id)}
            className="w-full h-12 font-bold rounded-xl"
            style={{ background: '#1E3A5F', color: 'white' }}
            data-testid="save-shipment-edit"
          >
            <Save className="h-5 w-5 mr-2" />
            Guardar Cambios
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
