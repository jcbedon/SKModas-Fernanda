import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateExpenseCategories } from "@/lib/api";
import { CATEGORY_COLORS, CATEGORY_ICONS, iconFor } from "./categoryIcons";

export const CategoryManager = ({ open, onOpenChange, categories, onSaved }) => {
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setRows(categories.map((c) => ({ ...c }))); }, [open, categories]);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    setSaving(true);
    try {
      const r = await updateExpenseCategories(rows);
      toast.success("Categorías guardadas");
      onSaved(r.data.categories);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl" data-testid="category-manager-dialog">
        <DialogHeader><DialogTitle>Categorías de gasto</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
          {rows.map((c, i) => {
            const Icon = iconFor(c.icon);
            return (
              <div key={c.key || i} className="flex items-center gap-2 border border-slate-100 rounded-2xl p-2" data-testid={`category-row-${i}`}>
                <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${c.color}1a`, color: c.color }}><Icon className="h-4 w-4" /></span>
                <Input value={c.label} onChange={(e) => set(i, "label", e.target.value)} className="h-9 rounded-xl" data-testid={`category-label-${i}`} />
                <select value={c.icon} onChange={(e) => set(i, "icon", e.target.value)} className="h-9 rounded-xl border px-1 text-xs" data-testid={`category-icon-${i}`}>
                  {Object.keys(CATEGORY_ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <div className="flex gap-0.5">
                  {CATEGORY_COLORS.slice(0, 5).map((col) => (
                    <button key={col} type="button" onClick={() => set(i, "color", col)} className={`h-5 w-5 rounded-full ${c.color === col ? "ring-2 ring-offset-1 ring-slate-400" : ""}`} style={{ backgroundColor: col }} />
                  ))}
                </div>
                <button type="button" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="p-1" data-testid={`category-remove-${i}`}><Trash2 className="h-4 w-4 text-rose-400" /></button>
              </div>
            );
          })}
        </div>
        <Button variant="outline" className="rounded-xl gap-1" data-testid="category-add-btn"
          onClick={() => setRows((r) => [...r, { key: "", label: "", icon: "tag", color: CATEGORY_COLORS[r.length % CATEGORY_COLORS.length] }])}>
          <Plus className="h-4 w-4" /> Agregar categoría
        </Button>
        <Button onClick={save} disabled={saving} className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white" data-testid="category-save-btn">Guardar</Button>
      </DialogContent>
    </Dialog>
  );
};
