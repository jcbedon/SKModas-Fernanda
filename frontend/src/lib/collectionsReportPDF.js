import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const fmtMoney = (v) =>
  "$" + Number(v || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => (s ? new Date(s).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function generateCollectionsReportPDF({ tenantName, clients, totals, periodLabel }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFillColor(30, 58, 95);
  doc.rect(0, 0, pageW, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(tenantName || "Reporte", margin, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Reporte de Cobranza${periodLabel ? ` — ${periodLabel}` : ""}`, margin, 48);
  doc.setFontSize(8);
  doc.text(`Generado: ${new Date().toLocaleString("es-EC")}`, pageW - margin, 26, { align: "right" });

  const pageH = doc.internal.pageSize.getHeight();
  let y = 78;
  const section = (title, list, color) => {
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFillColor(...color);
    doc.roundedRect(margin, y, pageW - margin * 2, 22, 4, 4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const paid = list.reduce((a, c) => a + (c.paid_in_period || 0), 0);
    const owed = list.reduce((a, c) => a + (c.remaining || 0), 0);
    doc.text(`${title} (${list.length})`, margin + 10, y + 15);
    doc.text(`Abonado ${fmtMoney(paid)}  ·  Falta ${fmtMoney(owed)}`, pageW - margin - 10, y + 15, { align: "right" });
    y += 28;
    if (!list.length) {
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.text("Ningún cliente en esta sección", margin + 10, y + 10);
      y += 30;
      return;
    }
    autoTable(doc, {
      head: [["#", "Cliente", "ID", "WhatsApp", "Último pago", "Monto último", "Abonado", "Pagos", "Falta pagar", "Estado", "Paquetes"]],
      body: list.map((c, i) => [
        i + 1, c.name || "—", `#${c.customer_id}`, c.whatsapp || "—", fmtDate(c.last_payment_at),
        fmtMoney(c.last_payment_amount), fmtMoney(c.paid_in_period), c.payments_count,
        fmtMoney(c.remaining),
        c.paid_without_shipment ? `Pagado sin envío: ${(c.unshipped_paid_invoices || []).join(", ")}` : c.is_paid ? "Pagado" : "Debe",
        c.packages_total > 0 ? `${c.packages_total} (${c.packages_breakdown})` : "Sin paquetes",
      ]),
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4, lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { fontStyle: "bold" }, 5: { halign: "right" }, 6: { halign: "right", textColor: [21, 128, 61], fontStyle: "bold" }, 7: { halign: "center" }, 8: { halign: "right", fontStyle: "bold" }, 9: { cellWidth: 95 }, 10: { fontStyle: "bold" } },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const c = list[data.row.index];
        if (data.column.index === 8) data.cell.styles.textColor = c?.is_paid ? [21, 128, 61] : [220, 38, 38];
        if (data.column.index === 9) data.cell.styles.textColor = c?.paid_without_shipment ? [194, 65, 12] : c?.is_paid ? [21, 128, 61] : [220, 38, 38];
      },
    });
    y = doc.lastAutoTable.finalY + 22;
  };

  section("Con paquetes", clients.filter((c) => c.packages_total > 0), [79, 70, 229]);
  section("Sin paquetes", clients.filter((c) => !(c.packages_total > 0)), [100, 116, 139]);

  if (y > pageH - 40) { doc.addPage(); y = 40; }
  doc.setTextColor(30, 41, 59);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    `Clientes: ${clients.length}   ·   Abonado: ${fmtMoney(totals?.total_paid)}   ·   Falta por cobrar: ${fmtMoney(totals?.total_remaining)}   ·   Ya pagaron todo: ${totals?.paid_off_count ?? 0}   ·   Pagado sin envío: ${clients.filter((c) => c.paid_without_shipment).length}`,
    margin, y
  );
  doc.save(`reporte_cobranza_${Date.now()}.pdf`);
}
