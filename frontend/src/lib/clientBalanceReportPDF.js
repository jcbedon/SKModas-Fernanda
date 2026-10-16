import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const fmtMoney = (v) =>
  "$" + Number(v || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const waLink = (w) => {
  const digits = String(w || "").replace(/[^0-9]/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
};

/**
 * Professional client balance report using jsPDF + jspdf-autotable.
 * Shows total abonado, consumido and saldo for each client.
 */
export function generateClientBalanceReportPDF({ tenantName, clients, totals }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  // ── Header band ──
  doc.setFillColor(30, 58, 95);
  doc.rect(0, 0, pageW, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(tenantName || "Reporte", margin, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Reporte de Abonos y Consumos por Cliente", margin, 48);
  doc.setFontSize(8);
  doc.text(`Generado: ${new Date().toLocaleString("es-EC")}`, pageW - margin, 26, { align: "right" });
  doc.setTextColor(200, 214, 235);
  doc.text(`${clients.length} clientes con actividad`, pageW - margin, 42, { align: "right" });

  const head = [[
    "Cliente", "ID", "WhatsApp", "Total Abonado", "Total Compras", "Envíos", "Total Consumido", "Saldo",
  ]];
  
  const body = clients.map((c) => [
    c.name || "—",
    `#${c.customer_id || ""}`,
    c.whatsapp || "—",
    fmtMoney(c.total_abonado),
    fmtMoney(c.total_compras),
    fmtMoney(c.total_envios),
    fmtMoney(c.total_consumido),
    fmtMoney(c.saldo),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 78,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8.5, cellPadding: 6, valign: "middle", lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [46, 204, 113], textColor: 255, fontStyle: "bold", fontSize: 8.5, halign: "left" },
    alternateRowStyles: { fillColor: [240, 253, 244] },
    columnStyles: {
      0: { cellWidth: 140, fontStyle: "bold" },
      1: { cellWidth: 60, halign: "center" },
      2: { cellWidth: 100, textColor: [21, 128, 61] },
      3: { halign: "right", fontStyle: "bold", textColor: [21, 128, 61] },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold", textColor: [239, 68, 68] },
      7: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      // Highlight saldo column based on value
      if (data.section === "body" && data.column.index === 7) {
        const c = clients[data.row.index];
        if (c) {
          if (c.saldo >= 0) {
            data.cell.styles.textColor = [21, 128, 61]; // green
          } else {
            data.cell.styles.textColor = [220, 38, 38]; // red
          }
        }
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 2) {
        const c = clients[data.row.index];
        const link = waLink(c && c.whatsapp);
        if (link) {
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: link });
        }
      }
    },
  });

  // ── Summary band ──
  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 78) + 20;
  if (y > pageH - 100) {
    doc.addPage();
    y = 60;
  }
  doc.setFillColor(46, 204, 113);
  doc.roundedRect(margin, y, pageW - margin * 2, 70, 8, 8, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("RESUMEN GENERAL", margin + 18, y + 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const col1 = margin + 18;
  const col2 = margin + 220;
  const col3 = margin + 420;
  
  doc.text(`Clientes con actividad: ${totals?.clients_count ?? clients.length}`, col1, y + 40);
  doc.text(`Total Abonado: ${fmtMoney(totals?.total_abonado)}`, col1, y + 56);
  
  doc.text(`Total Consumido: ${fmtMoney(totals?.total_consumido)}`, col2, y + 40);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const saldoTotal = totals?.total_saldo ?? 0;
  const saldoLabel = saldoTotal >= 0 ? "Saldo Total a Favor:" : "Deuda Total:";
  doc.text(`${saldoLabel} ${fmtMoney(Math.abs(saldoTotal))}`, col3, y + 48);

  // Legend
  y += 86;
  if (y < pageH - 20) {
    doc.setTextColor(120, 120, 140);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.text("Toca el número de WhatsApp para abrir el chat. Saldo positivo = cliente tiene saldo a favor. Saldo negativo = cliente debe.", margin, y);
  }

  // ── Cross-platform delivery ──
  const filename = `reporte_abonos_consumos_${Date.now()}.pdf`;
  const ua = navigator.userAgent || "";
  const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const supportsDownload = "download" in document.createElement("a") && !isIOS && !isSafari;
  try {
    const blob = new Blob([doc.output("blob")], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    if (supportsDownload) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
        URL.revokeObjectURL(url);
      }, 15000);
    } else {
      const win = window.open(url, "_blank");
      if (!win) window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return;
  } catch (e) {
    console.error("Blob delivery failed, trying doc.save:", e);
  }
  try {
    doc.save(filename);
  } catch (e) {
    doc.output("dataurlnewwindow");
  }
}
