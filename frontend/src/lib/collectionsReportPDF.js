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

  autoTable(doc, {
    head: [["#", "Cliente", "ID", "WhatsApp", "Último pago", "Monto último", "Abonado período", "Pagos", "Falta pagar", "Estado"]],
    body: clients.map((c, i) => [
      i + 1, c.name || "—", `#${c.customer_id}`, c.whatsapp || "—", fmtDate(c.last_payment_at),
      fmtMoney(c.last_payment_amount), fmtMoney(c.paid_in_period), c.payments_count,
      fmtMoney(c.remaining), c.is_paid ? "Pagado" : "Debe",
    ]),
    startY: 78,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8.5, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { fontStyle: "bold" }, 5: { halign: "right" }, 6: { halign: "right", textColor: [21, 128, 61], fontStyle: "bold" }, 7: { halign: "center" }, 8: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section === "body" && (data.column.index === 8 || data.column.index === 9)) {
        const c = clients[data.row.index];
        data.cell.styles.textColor = c?.is_paid ? [21, 128, 61] : [220, 38, 38];
      }
    },
  });

  const y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 78) + 24;
  doc.setTextColor(30, 41, 59);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    `Clientes: ${totals?.clients_count ?? clients.length}   ·   Abonado: ${fmtMoney(totals?.total_paid)}   ·   Falta por cobrar: ${fmtMoney(totals?.total_remaining)}   ·   Ya pagaron todo: ${totals?.paid_off_count ?? 0}`,
    margin, y
  );
  doc.save(`reporte_cobranza_${Date.now()}.pdf`);
}
