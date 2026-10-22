import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Clock, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { setInvoiceLateFee } from "@/lib/api";

export const LateFeeToggle = ({ invoice, onChanged }) => {
  const applied = !!invoice.late_fee_applied;
  const [amount, setAmount] = useState(applied ? String(invoice.late_fee_amount || "") : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setAmount(invoice.late_fee_applied ? String(invoice.late_fee_amount || "") : ""); }, [invoice.id, invoice.late_fee_applied, invoice.late_fee_amount]);

  const save = async (enabled, value) => {
    setSaving(true);
    try {
      const num = parseFloat(value);
      await setInvoiceLateFee(invoice.id, { enabled, amount: enabled && num > 0 ? num : undefined });
      toast.success(enabled ? "Cobro por retraso agregado" : "Cobro por retraso quitado");
      await onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex items-center justify-between text-sm -mx-4 px-4 py-1.5 border-y ${applied ? "bg-amber-50 border-amber-200" : "border-transparent"}`} data-testid="late-fee-row">
      <label className="flex items-center gap-2 cursor-pointer text-amber-700 font-medium">
        <Checkbox className="border-amber-500 data-[state=checked]:bg-amber-600 data-[state=checked]:text-white" checked={applied} disabled={saving || invoice.is_annulled} onCheckedChange={(v) => save(!!v, amount)} data-testid="late-fee-checkbox" />
        <Clock className="h-3 w-3" />
        {invoice.late_fee_description || "Cobro por retraso"}
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </label>
      <Input
        type="number" step="0.01" value={amount} placeholder="Monto" onWheel={(e) => e.target.blur()}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={() => applied && parseFloat(amount) > 0 && parseFloat(amount) !== invoice.late_fee_amount && save(true, amount)}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        className={`h-7 w-24 text-right text-sm font-bold rounded px-2 ${applied ? "text-amber-700" : "text-gray-400"}`}
        data-testid="late-fee-amount-input"
      />
    </div>
  );
};
