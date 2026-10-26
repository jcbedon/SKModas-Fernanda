import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const m = (v) => "$" + Number(v || 0).toFixed(2);

export function generateAccountingPDF({ tenantName, periodLabel, summary, expenses, accounts }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const L = 40;
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(tenantName || "Contabilidad", L, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Balance contable — ${periodLabel}`, L, 52);

  const inc = summary.income;
  autoTable(doc, {
    startY: 90, margin: { left: L, right: L }, theme: "plain",
    body: [
      ["Comisiones de productos", m(inc.product_commissions)],
      ["Comisiones manuales (Live Shopping)", m(inc.manual_commissions)],
      ["Comisiones de Pacas", m(inc.pacas_commissions)],
      ["(−) Tax de facturas de tienda", `-${m(inc.store_invoice_taxes)}`],
      ["Ganancias del período", m(inc.total)],
      ["(−) Gastos del negocio", `-${m(summary.expenses_total)}`],
      ["BALANCE NETO", m(summary.net)],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => {
      if (d.row.index === 4) d.cell.styles.fillColor = [236, 253, 245];
      if (d.row.index === 6) { d.cell.styles.fillColor = summary.net >= 0 ? [16, 185, 129] : [244, 63, 94]; d.cell.styles.textColor = 255; d.cell.styles.fontStyle = "bold"; d.cell.styles.fontSize = 12; }
    },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 20, margin: { left: L, right: L },
    head: [["Gastos por categoría", "Monto", "%"]],
    body: summary.by_category.map((c) => [c.label, m(c.amount), summary.expenses_total ? `${((c.amount / summary.expenses_total) * 100).toFixed(1)}%` : "0%"]),
    headStyles: { fillColor: [15, 23, 42] }, styles: { fontSize: 9 }, columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
  });

  const accs = Object.fromEntries(accounts.map((a) => [a.id, `${a.bank_name}`]));
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 20, margin: { left: L, right: L },
    head: [["Fecha", "Categoría", "Descripción", "Cuenta", "Monto"]],
    body: expenses.map((e) => [e.date, e.category_label, e.description || "—", accs[e.bank_account_id] || "Efectivo", m(e.amount)]),
    headStyles: { fillColor: [244, 63, 94] }, styles: { fontSize: 8.5 }, columnStyles: { 4: { halign: "right", fontStyle: "bold" } },
  });
  doc.save(`contabilidad_${Date.now()}.pdf`);
}
