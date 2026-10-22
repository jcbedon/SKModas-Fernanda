// Business week: Thursday 00:00 → Wednesday 23:59 (local). Key = start Thursday yyyy-mm-dd.
export function getWeekKey(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  local.setDate(local.getDate() - ((local.getDay() - 4 + 7) % 7));
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${local.getFullYear()}-${m}-${day}`;
}
