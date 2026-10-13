import { useAuth } from "@/App";

/**
 * MoneyDisplay - Shows monetary values or hides them based on user permissions
 * 
 * Usage:
 * <MoneyDisplay value={123.45} />  // Shows "$123.45" or "••••" if hidden
 * <MoneyDisplay value={123.45} prefix="Total: " />  // Shows "Total: $123.45"
 * <MoneyDisplay value={123.45} className="text-green-600 font-bold" />
 */
export function MoneyDisplay({ value, prefix = "", suffix = "", className = "", showZero = true }) {
  const { hideFinancials } = useAuth();
  
  // Handle null/undefined
  if (value === null || value === undefined) {
    return <span className={className}>{prefix}$0.00{suffix}</span>;
  }
  
  // Handle zero
  if (value === 0 && !showZero) {
    return null;
  }
  
  if (hideFinancials) {
    return (
      <span className={`${className} text-slate-400`} title="Valor oculto">
        {prefix}••••{suffix}
      </span>
    );
  }
  
  const formatted = typeof value === "number" 
    ? "$" + value.toFixed(2)
    : "$" + parseFloat(value || 0).toFixed(2);
  
  return <span className={className}>{prefix}{formatted}{suffix}</span>;
}

/**
 * useHideFinancials - Hook to check if financials should be hidden
 * Returns { hideFinancials, formatMoney }
 */
export function useHideFinancials() {
  const { hideFinancials } = useAuth();
  
  const formatMoney = (value, fallback = "••••") => {
    if (hideFinancials) return fallback;
    if (value === null || value === undefined) return "$0.00";
    return "$" + (typeof value === "number" ? value : parseFloat(value || 0)).toFixed(2);
  };
  
  return { hideFinancials, formatMoney };
}

export default MoneyDisplay;
