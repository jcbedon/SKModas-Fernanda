import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { generateAccessToken } from "@/lib/api";

function loadImageWithDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve({
        dataURL: canvas.toDataURL("image/png"),
        width: img.width,
        height: img.height,
        aspectRatio: img.width / img.height,
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function generateInvoicePDF(invoiceData, tenantInfo) {
  const doc = new jsPDF();
  const tenant = {
    ...(invoiceData.tenant || {}),
    ...tenantInfo,
    logo_url: tenantInfo?.logo_url || invoiceData.tenant?.logo_url,
  };
  const inv = invoiceData;
  const cli = invoiceData.client;
  const shipment = inv.shipment;

  const colors = {
    background: [248, 250, 252],
    textPrimary: [15, 23, 42],
    textSecondary: [100, 116, 139],
    divider: [226, 232, 240],
    white: [255, 255, 255],
    paid: { bg: [220, 252, 231], text: [22, 101, 52] },
    pending: { bg: [254, 243, 199], text: [161, 98, 7] },
    cancelled: { bg: [254, 226, 226], text: [185, 28, 28] },
  };

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  doc.setFillColor(...colors.background);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  const containerX = 12;
  const containerY = 12;
  const containerWidth = pageWidth - 24;
  const containerHeight = pageHeight - containerY * 2;

  const drawPageBackground = () => {
    doc.setFillColor(...colors.background);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(200, 200, 200);
    doc.roundedRect(containerX + 1, containerY + 1, containerWidth, containerHeight, 6, 6, "F");
    doc.setFillColor(...colors.white);
    doc.roundedRect(containerX, containerY, containerWidth, containerHeight, 6, 6, "F");
  };

  drawPageBackground();

  let currentY = containerY + 20;

  // Logo
  let logoUrl = tenantInfo?.logo_url || tenant?.logo_url;
  let logoEndX = margin;
  if (logoUrl) {
    if (logoUrl.startsWith("/")) {
      logoUrl = (process.env.REACT_APP_BACKEND_URL || window.location.origin) + logoUrl;
    }
    try {
      const logoData = await loadImageWithDimensions(logoUrl);
      const targetHeight = 14;
      const logoWidth = targetHeight * logoData.aspectRatio;
      const isJpg = logoUrl.toLowerCase().includes(".jpg") || logoUrl.toLowerCase().includes(".jpeg");
      doc.addImage(logoData.dataURL, isJpg ? "JPEG" : "PNG", margin, currentY - 4, logoWidth, targetHeight);
      logoEndX = margin + logoWidth + 5;
    } catch (e) { /* skip logo */ }
  }

  // Company name
  doc.setTextColor(...colors.textPrimary);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(tenant?.business_name || "Outlets USA EC", logoEndX, currentY + 2);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...colors.textSecondary);
  const tenantEmail = tenantInfo?.email || tenant?.email || "";
  if (tenantEmail && !tenantEmail.startsWith("admin@")) {
    doc.text(tenantEmail, logoEndX, currentY + 8);
  }

  // Invoice number (right)
  const rightX = pageWidth - margin;
  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(10);
  doc.text("DETALLE DE COMPRA", rightX, currentY - 2, { align: "right" });
  doc.setTextColor(...colors.textPrimary);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(inv.invoice_number, rightX, currentY + 6, { align: "right" });
  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(new Date(inv.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }), rightX, currentY + 12, { align: "right" });

  // Status badge
  const statusConfig = inv.status === "approved" ? colors.paid : inv.status === "cancelled" ? colors.cancelled : colors.pending;
  const statusText = (inv.status === "approved" ? "PAGADA" : inv.status === "cancelled" ? "CANCELADA" : "PENDIENTE") + (inv.status === "approved" ? " ✓" : "");
  const badgeWidth = doc.getTextWidth(statusText) + 8;
  const badgeX = rightX - badgeWidth;
  doc.setFillColor(...statusConfig.bg);
  doc.roundedRect(badgeX, currentY + 16, badgeWidth, 7, 3, 3, "F");
  doc.setTextColor(...statusConfig.text);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(statusText, badgeX + badgeWidth / 2, currentY + 21, { align: "center" });

  currentY += 36;
  doc.setDrawColor(...colors.divider);
  doc.setLineWidth(0.3);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 12;

  // Client info
  const colWidth = (contentWidth - 10) / 2;
  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE", margin, currentY);
  currentY += 6;
  doc.setTextColor(...colors.textPrimary);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(cli?.name || "", margin, currentY);
  currentY += 5;
  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`ID: ${cli?.customer_id || ""}`, margin, currentY);
  currentY += 4;
  doc.text(`WhatsApp: ${cli?.whatsapp || ""}`, margin, currentY);

  // Details column
  const col2X = margin + colWidth + 10;
  let detailY = currentY - 15;
  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("DETALLES", col2X, detailY);
  detailY += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Fecha: ${new Date(inv.created_at).toLocaleDateString("es-ES")}`, col2X, detailY);
  detailY += 4;
  doc.text(`Items: ${inv.purchases?.length || 0}`, col2X, detailY);
  if (inv.approved_at) {
    detailY += 4;
    doc.setTextColor(...colors.paid.text);
    doc.text(`Aprobada: ${new Date(inv.approved_at).toLocaleDateString("es-ES")}`, col2X, detailY);
  }

  currentY += 12;

  // Products table - Show only final price to client, hide commission breakdown
  const tableData = (inv.purchases || []).map((p) => {
    const total = p.price + (p.commission || 0);
    return [
      "1", 
      p.item_name, 
      `$${total.toFixed(2)}`, 
      p.store || "", 
      "—", 
      `$${total.toFixed(2)}`,
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["CANTIDAD", "DETALLE", "COSTO", "TIENDA", "COMISION", "TOTAL"]],
    body: tableData,
    theme: "plain",
    headStyles: { fillColor: [241, 245, 249], textColor: colors.textSecondary, fontStyle: "bold", fontSize: 8, cellPadding: 4 },
    bodyStyles: { fontSize: 8, textColor: colors.textPrimary, cellPadding: 3 },
    alternateRowStyles: { fillColor: colors.white },
    columnStyles: {
      0: { cellWidth: 18, halign: "center" }, 1: { cellWidth: 50 }, 2: { cellWidth: 22, halign: "right" },
      3: { cellWidth: 30 }, 4: { cellWidth: 22, halign: "right" }, 5: { cellWidth: 25, halign: "right", fontStyle: "bold" },
    },
    margin: { left: margin, right: margin, top: 20, bottom: 18 },
    styles: { lineColor: colors.divider, lineWidth: 0.2 },
  });

  // Summary stats
  let finalY = doc.lastAutoTable.finalY + 8;

  // Helper: ensure we have enough vertical space; add a new page if not.
  // 35mm clear at the bottom: 25mm for footer + 10mm safety.
  const SAFE_BOTTOM = pageHeight - 35;
  const ensureSpace = (requiredMM) => {
    if (finalY + requiredMM > SAFE_BOTTOM) {
      doc.addPage();
      drawPageBackground();
      finalY = containerY + 18;
    }
  };

  // Only page-break before the stats box if it literally won't fit.
  ensureSpace(18);
  const totalArticulos = inv.purchases?.length || 0;
  const totalEtiqueta = inv.subtotal || 0;
  const shipmentMode = shipment?.shipping_mode;
  const packageCount = shipment?.package_count || 0;
  const weightPounds = shipment?.weight_pounds || 0;
  const isPoundsMode = shipmentMode === "pounds";
  // Header / value for the 3rd stat column
  const thirdStatLabel = isPoundsMode
    ? "Libras"
    : (shipmentMode === "packages" || packageCount > 0)
      ? "Paquetes"
      : "Peso en Libras";
  const thirdStatValue = isPoundsMode
    ? `${Number(packageCount).toFixed(1)} lb`
    : (shipmentMode === "packages" || packageCount > 0)
      ? `${packageCount}`
      : `${weightPounds} lbs`;

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, finalY - 2, contentWidth, 14, 2, 2, "F");
  const statWidth = contentWidth / 3;
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...colors.textSecondary);
  doc.text("Total de articulos", margin + statWidth * 0.5, finalY + 3, { align: "center" });
  doc.text("Total Etiqueta", margin + statWidth * 1.5, finalY + 3, { align: "center" });
  doc.text(thirdStatLabel, margin + statWidth * 2.5, finalY + 3, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(...colors.textPrimary);
  doc.text(totalArticulos.toString(), margin + statWidth * 0.5, finalY + 9, { align: "center" });
  doc.text(`$${totalEtiqueta.toFixed(2)}`, margin + statWidth * 1.5, finalY + 9, { align: "center" });
  doc.text(thirdStatValue, margin + statWidth * 2.5, finalY + 9, { align: "center" });

  finalY += 18;

  // Financial summary
  // No bulk pre-check here — we draw each block and call ensureSpace()
  // only before the critical lines below. This prevents gratuitous page
  // breaks that leave huge blank gaps after the products table.
  const totalsX = pageWidth - margin - 70;
  const baseSubtotal = inv.subtotal || 0;
  const totalCommission = inv.total_commission || 0;
  // Display subtotal and commission as SEPARATE lines (matching UI).
  // `grandTotal` still sums both so the math is unchanged.
  const displaySubtotal = baseSubtotal;
  const taxes = inv.total_tax || 0;
  const shippingCost = shipment?.shipping_cost || 0;
  const saldoPend = inv.saldo_pendiente || 0;
  const saldoFavorAnterior = inv.saldo_a_favor_anterior || 0;
  const appliedDeposits = inv.applied_deposits || [];
  const depositsApplied = inv.deposits_applied || 0;
  // Late Fee
  const lateFee = inv.late_fee_applied ? (inv.late_fee_amount || 0) : 0;
  const lateFeeDesc = inv.late_fee_description || "Recargo por mora";
  const grandTotal = displaySubtotal + totalCommission + taxes + shippingCost + saldoPend + lateFee;
  const totalCreditsPreview = depositsApplied + saldoFavorAnterior;
  // IMPORTANT: Always compute `total_a_pagar` and `saldo_a_favor` locally from
  // authoritative components instead of trusting the backend-persisted values.
  //
  // Why: `inv.total_a_pagar` and `inv.saldo_a_favor` are written by
  // `recalculate_client_invoices`, but they can go stale if the recalc ran
  // against a document whose `shipping_cost` field was $0 (the truth lives in
  // the linked shipment document). UI uses this same local formula, so PDF
  // must match to keep both views consistent even if stored values are stale.
  const totalAPagar = Math.max(0, grandTotal - totalCreditsPreview);
  const saldoFavor = Math.max(0, totalCreditsPreview - grandTotal);

  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Subtotal:", totalsX, finalY);
  doc.setTextColor(...colors.textPrimary);
  doc.text(`$${displaySubtotal.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });

  if (totalCommission > 0) {
    ensureSpace(7);
    finalY += 6;
    doc.setTextColor(...colors.textSecondary);
    doc.text("Comisiones:", totalsX, finalY);
    doc.setTextColor(...colors.textPrimary);
    doc.text(`$${totalCommission.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });
  }
  if (taxes > 0) { ensureSpace(7); finalY += 6; doc.setTextColor(...colors.textSecondary); doc.text("Taxes:", totalsX, finalY); doc.setTextColor(...colors.textPrimary); doc.text(`$${taxes.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" }); }
  if (shippingCost > 0) {
    ensureSpace(7);
    finalY += 6;
    doc.setTextColor(...colors.textSecondary);
    const shipmentMode = shipment?.shipping_mode;
    const qty = shipment?.package_count;
    let shipLabel = "Envio:";
    if (qty && qty > 0) {
      const unit = shipmentMode === "pounds"
        ? `${Number(qty).toFixed(1)} lb`
        : `${qty} paq.`;
      shipLabel = `Envio (${unit}):`;
    }
    doc.text(shipLabel, totalsX, finalY);
    doc.setTextColor(...colors.textPrimary);
    doc.text(`$${shippingCost.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });
  }
  if (saldoPend > 0) { ensureSpace(7); finalY += 6; doc.setTextColor(194, 65, 12); doc.text("Saldo Pendiente:", totalsX, finalY); doc.text(`$${saldoPend.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" }); }
  // Late Fee
  if (lateFee > 0) {
    ensureSpace(7);
    finalY += 6;
    doc.setTextColor(180, 83, 9); // Amber color
    doc.text(lateFeeDesc + ":", totalsX, finalY);
    doc.text(`$${lateFee.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });
  }

  finalY += 4;
  // Critical: "Total:" line must stay visible. If we're near the bottom, break now.
  ensureSpace(14);
  doc.setDrawColor(...colors.divider);
  doc.setLineWidth(0.3);
  doc.line(totalsX, finalY, pageWidth - margin, finalY);
  finalY += 8;
  doc.setTextColor(...colors.textPrimary);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Total:", totalsX, finalY);
  doc.setFontSize(13);
  doc.text(`$${grandTotal.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });

  if (appliedDeposits.length > 0) {
    finalY += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    appliedDeposits.forEach((dep, idx) => {
      ensureSpace(6);
      doc.setTextColor(...colors.textSecondary);
      doc.text(`Abono ${idx + 1}:`, totalsX, finalY);
      doc.setTextColor(22, 101, 52);
      doc.text(`-$${dep.amount_applied.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });
      finalY += 5;
    });
  }

  // Saldo a Favor anterior (credit applied to this invoice)
  if (saldoFavorAnterior > 0) {
    ensureSpace(7);
    if (appliedDeposits.length === 0) finalY += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.textSecondary);
    doc.text("Saldo a Favor (anterior):", totalsX, finalY);
    doc.setTextColor(22, 101, 52);
    doc.text(`-$${saldoFavorAnterior.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });
    finalY += 5;
  }

  finalY += 2;
  // Critical: "Total a pagar:" line must stay visible + its saldo-a-favor next-line if present.
  ensureSpace(saldoFavor > 0 ? 22 : 14);
  doc.setDrawColor(...colors.textPrimary);
  doc.setLineWidth(0.5);
  doc.line(totalsX, finalY, pageWidth - margin, finalY);
  finalY += 8;
  doc.setTextColor(totalAPagar > 0 ? 185 : 22, totalAPagar > 0 ? 28 : 101, totalAPagar > 0 ? 28 : 52);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Total a pagar:", totalsX, finalY);
  doc.setFontSize(14);
  doc.text(`$${totalAPagar.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });

  // Saldo a Favor para la próxima factura (credit carried forward)
  if (saldoFavor > 0) {
    finalY += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 101, 52);
    doc.text("Saldo a Favor (próxima factura):", totalsX, finalY);
    doc.setFontSize(10);
    doc.text(`+$${saldoFavor.toFixed(2)}`, pageWidth - margin, finalY, { align: "right" });
  }

  // Footer — always anchored to the bottom of the current page.
  // ensureSpace makes sure we have ~25mm of vertical room; if not, page-break first.
  ensureSpace(25);
  const footerY = pageHeight - 22;

  doc.setDrawColor(...colors.divider);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 8, pageWidth - margin, footerY - 8);
  doc.setTextColor(...colors.textPrimary);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Gracias por su compra", margin, footerY);
  doc.setTextColor(...colors.textSecondary);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`${tenant?.business_name || "Outlets USA EC"}`, margin, footerY + 5);
  doc.setFontSize(7);
  doc.text(`Generado: ${new Date().toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, margin, footerY + 12);

  // QR
  try {
    const tokenRes = await generateAccessToken({ customer_id: cli?.customer_id, invoice_id: inv.id });
    const qr = await QRCode.toDataURL(`https://didiershop.live/access/${tokenRes.data.token}`, { width: 200, margin: 1, color: { dark: "#0F172A", light: "#FFFFFF" } });
    doc.addImage(qr, "PNG", pageWidth - margin - 22, footerY - 6, 22, 22);
    doc.setFontSize(6);
    doc.setTextColor(...colors.textSecondary);
    doc.text("Escanea para ver tu portal", pageWidth - margin - 11, footerY + 18, { align: "center" });
  } catch (e) {
    try {
      const qr = await QRCode.toDataURL(`https://didiershop.live/login?user=${encodeURIComponent(cli?.customer_id || "")}`, { width: 200, margin: 1, color: { dark: "#0F172A", light: "#FFFFFF" } });
      doc.addImage(qr, "PNG", pageWidth - margin - 22, footerY - 6, 22, 22);
    } catch (e2) { /* skip QR */ }
  }

  doc.save(`Factura_${inv.invoice_number}_${cli?.customer_id || ""}.pdf`);
}
