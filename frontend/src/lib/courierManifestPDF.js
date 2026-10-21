import { getShipmentParts } from "@/lib/shipmentPackages";
// Courier Manifest PDF — Modern layout meant to be handed off to the
// shipping company. Lists every shipment marked as "Enviado a paquetería"
// in the active period, broken down by category and totals at the bottom.
import jsPDF from "jspdf";

const fmtMoney = (v) =>
  `$${Number(v || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
};

const loadImage = (src) =>
  new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

/**
 * Generate a courier manifest PDF.
 *
 * @param {Object} args
 * @param {string} args.tenantName
 * @param {string} args.tenantLogo  Absolute URL to the company logo (PNG/JPG).
 * @param {string} args.periodLabel  Human-readable period (e.g. "Semana 18-25 May 2026").
 * @param {Array}  args.shipments    Shipments with: customer_id, customer_name OR client_name OR client.name,
 *                                   shipping_category, shipping_mode, package_count, weight_pounds,
 *                                   tracking_numbers OR tracking_number, created_at, marked_sent_at.
 * @param {Array}  args.categories   Tenant shipping categories with courier_cost_packages/pounds.
 * @param {string} args.tenantMode   "packages" | "pounds"
 */
export async function generateCourierManifestPDF({
  tenantName,
  tenantLogo,
  periodLabel,
  shipments,
  categories,
  tenantMode,
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  const catMap = {};
  (categories || []).forEach((c) => {
    catMap[String(c.key || "").toUpperCase()] = c;
  });

  // ── Palette (pastel lilac + gray, black text) ──
  const LILAC = [237, 233, 254];       // pastel lilac fill (#EDE9FE)
  const LILAC_SOFT = [245, 243, 255];  // even softer lilac for alternating rows
  const LILAC_BORDER = [196, 181, 253]; // lilac border (#C4B5FD)
  const INK = [17, 24, 39];            // near-black text (#111827)
  const GRAY = [107, 114, 128];        // secondary gray text (#6B7280)

  // ── HEADER: white background with a lilac border box, black text ──────
  const headerY = 16;
  const headerH = 82;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(LILAC_BORDER[0], LILAC_BORDER[1], LILAC_BORDER[2]);
  doc.setLineWidth(1.5);
  doc.roundedRect(margin, headerY, pageW - margin * 2, headerH, 10, 10, "FD");

  const logo = await loadImage(tenantLogo);
  if (logo) {
    const targetH = 54;
    const ratio = logo.width / logo.height;
    const w = targetH * ratio;
    try {
      doc.addImage(logo.dataUrl, "PNG", margin + 14, headerY + 14, w, targetH);
    } catch { /* ignore bad image */ }
  }

  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text("MANIFIESTO DE ENVÍOS", pageW - margin - 14, headerY + 28, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  doc.text(tenantName || "", pageW - margin - 14, headerY + 46, { align: "right" });
  const today = new Date().toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" });
  doc.text(`Emitido: ${today}`, pageW - margin - 14, headerY + 62, { align: "right" });

  // ── META block ───────────────────────────────────────────────────────
  let y = 128;

  // TOTAL ENVÍOS as a right-aligned pastel-lilac pill with soft gray text.
  // (Previously it sat at a fixed x and a long PERÍODO label overlapped it.)
  const pillText = `TOTAL ENVÍOS: ${shipments.length}`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const pillTextW = doc.getTextWidth(pillText);
  const padX = 12;
  const pillW = pillTextW + padX * 2;
  const pillH = 22;
  const pillX = pageW - margin - pillW;
  const pillY = y - 15;
  doc.setFillColor(237, 233, 254); // pastel lilac (#EDE9FE)
  doc.roundedRect(pillX, pillY, pillW, pillH, 11, 11, "F");
  doc.setTextColor(107, 114, 128); // gray-500
  doc.text(pillText, pillX + pillW / 2, y, { align: "center" });

  // PERÍODO on the left; clip only as a safety net so it never reaches the pill.
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("PERÍODO:", margin, y);
  doc.setFont("helvetica", "normal");
  const maxPeriodW = pillX - (margin + 70) - 14;
  let periodTxt = periodLabel || "Todos";
  if (doc.getTextWidth(periodTxt) > maxPeriodW) {
    while (periodTxt.length > 4 && doc.getTextWidth(periodTxt + "…") > maxPeriodW) {
      periodTxt = periodTxt.slice(0, -1);
    }
    periodTxt = periodTxt.trimEnd() + "…";
  }
  doc.text(periodTxt, margin + 70, y);
  y += 18;

  // Per-category totals (for the courier company)
  const catTotals = {}; // key -> { qty, amount }
  let grandQty = 0;
  let grandTotal = 0;
  const enriched = shipments.map((s) => {
    const mode = s.shipping_mode || tenantMode || "packages";
    const legacyQty = mode === "pounds" ? Number(s.weight_pounds || 0) : Number(s.package_count || 0);
    const parts = getShipmentParts(s, legacyQty);
    let qty = 0, amount = 0, computedAll = 0;
    parts.forEach((part) => {
      const cat = catMap[part.category];
      const rate = !cat ? 0 : mode === "pounds" ? Number(cat.courier_cost_pounds || 0) : Number(cat.courier_cost_packages || 0);
      const computed = part.qty * rate;
      // Fallback: if no courier rate configured, use the part's shipping cost.
      const partAmount = computed > 0 ? computed : part.cost;
      const key = part.category || "—";
      if (!catTotals[key]) catTotals[key] = { qty: 0, amount: 0, mode };
      catTotals[key].qty += part.qty;
      catTotals[key].amount += partAmount;
      qty += part.qty;
      amount += partAmount;
      computedAll += computed;
    });
    grandQty += qty;
    grandTotal += amount;
    const rate = qty > 0 ? amount / qty : 0;
    return { ...s, _qty: qty, _rate: rate, _amount: amount, _mode: mode, _isFallback: computedAll <= 0, _catLabel: parts.map((p) => p.category || "—").join("+") };
  });

  // ── Category summary cards ──────────────────────────────────────────
  y += 6;
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("RESUMEN POR CATEGORÍA", margin, y);
  doc.setDrawColor(LILAC_BORDER[0], LILAC_BORDER[1], LILAC_BORDER[2]);
  doc.line(margin, y + 4, pageW - margin, y + 4);
  y += 14;

  const catKeys = Object.keys(catTotals);
  if (catKeys.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text("Sin envíos marcados como enviados", pageW / 2, y + 16, { align: "center" });
    y += 36;
  } else {
    const cardCount = Math.max(catKeys.length, 1);
    const cardW = (pageW - margin * 2 - 6 * (cardCount - 1)) / cardCount;
    catKeys.forEach((key, i) => {
      const total = catTotals[key];
      const cat = catMap[key];
      const x = margin + i * (cardW + 6);
      doc.setFillColor(LILAC_SOFT[0], LILAC_SOFT[1], LILAC_SOFT[2]);
      doc.setDrawColor(LILAC_BORDER[0], LILAC_BORDER[1], LILAC_BORDER[2]);
      doc.setLineWidth(0.75);
      doc.roundedRect(x, y, cardW, 60, 6, 6, "FD");
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`CATEGORÍA ${key}`, x + 8, y + 14);
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(cat?.label?.slice(0, 28) || "", x + 8, y + 26);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const qtyLabel = total.mode === "pounds" ? `${total.qty.toFixed(1)} lb` : `${total.qty} pkg`;
      doc.text(qtyLabel, x + 8, y + 42);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.setFontSize(13);
      doc.text(fmtMoney(total.amount), x + cardW - 8, y + 42, { align: "right" });
    });
    y += 76;
  }

  // ── Shipments table ──────────────────────────────────────────────────
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("DETALLE DE ENVÍOS", margin, y);
  doc.setDrawColor(LILAC_BORDER[0], LILAC_BORDER[1], LILAC_BORDER[2]);
  doc.line(margin, y + 4, pageW - margin, y + 4);
  y += 12;

  // Column layout
  const colX = {
    idx: margin,
    customer: margin + 26,
    tracking: margin + 178,
    cat: margin + 310,
    qty: margin + 350,
    rate: margin + 410,
    amount: pageW - margin - 4,
  };
  const drawTableHeader = (yy) => {
    doc.setFillColor(LILAC[0], LILAC[1], LILAC[2]);
    doc.rect(margin, yy - 10, pageW - margin * 2, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text("#", colX.idx, yy);
    doc.text("CLIENTE", colX.customer, yy);
    doc.text("TRACKING", colX.tracking, yy);
    doc.text("CAT.", colX.cat, yy);
    doc.text("CANT.", colX.qty, yy);
    doc.text("TARIFA", colX.rate, yy);
    doc.text("MONTO", colX.amount, yy, { align: "right" });
  };
  drawTableHeader(y);
  y += 12;

  if (enriched.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text("Sin envíos en el período seleccionado", pageW / 2, y + 18, { align: "center" });
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    enriched.forEach((s, idx) => {
      if (y > pageH - 80) {
        doc.addPage();
        y = margin + 10;
        drawTableHeader(y);
        y += 12;
      }
      // Alternating pastel-lilac row background.
      if (idx % 2 === 1) {
        doc.setFillColor(LILAC_SOFT[0], LILAC_SOFT[1], LILAC_SOFT[2]);
        doc.rect(margin, y - 12, pageW - margin * 2, 22, "F");
      }
      doc.setTextColor(INK[0], INK[1], INK[2]);
      const customer = (s.user_name || s.customer_name || s.client_name || (s.client && s.client.name) || "—").slice(0, 28);
      const tracking =
        (Array.isArray(s.tracking_numbers) && s.tracking_numbers[0]) ||
        s.tracking_number ||
        "—";
      const qtyLabel = s._mode === "pounds" ? `${s._qty.toFixed(1)} lb` : `${s._qty} pkg`;

      doc.text(String(idx + 1), colX.idx, y);
      doc.text(customer, colX.customer, y);
      // Customer ID line (smaller)
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 140);
      doc.text(`#${s.customer_id || ""}`, colX.customer, y + 9);
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);

      doc.text(String(tracking).slice(0, 22), colX.tracking, y);
      doc.text(s._catLabel, colX.cat, y);
      doc.text(qtyLabel, colX.qty, y);
      doc.text(fmtMoney(s._rate), colX.rate, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text(fmtMoney(s._amount), colX.amount, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(INK[0], INK[1], INK[2]);

      y += 22;
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y - 10, pageW - margin, y - 10);
    });
  }

  // ── Grand total band ────────────────────────────────────────────────
  if (y > pageH - 110) { doc.addPage(); y = margin + 10; }
  y += 4;
  doc.setFillColor(LILAC[0], LILAC[1], LILAC[2]);
  doc.setDrawColor(LILAC_BORDER[0], LILAC_BORDER[1], LILAC_BORDER[2]);
  doc.setLineWidth(1);
  doc.roundedRect(margin, y, pageW - margin * 2, 50, 8, 8, "FD");
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TOTAL A PAGAR A EMPRESA DE PAQUETERÍA", margin + 16, y + 20);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFontSize(22);
  doc.text(fmtMoney(grandTotal), pageW - margin - 16, y + 30, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  doc.text(`${enriched.length} envío${enriched.length === 1 ? "" : "s"}`, margin + 16, y + 36);
  y += 70;

  // ── Signature blocks ────────────────────────────────────────────────
  if (y > pageH - 100) { doc.addPage(); y = margin + 10; }
  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.5);
  const colWidth = (pageW - margin * 2 - 30) / 2;
  doc.line(margin + 10, y + 30, margin + colWidth, y + 30);
  doc.line(pageW - margin - colWidth, y + 30, pageW - margin - 10, y + 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("ENTREGADO POR", margin + 10, y + 42);
  doc.text("RECIBIDO POR (EMPRESA DE PAQUETERÍA)", pageW - margin - colWidth, y + 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(tenantName || "", margin + 10, y + 52);
  doc.text("Nombre / Firma / Fecha", pageW - margin - colWidth, y + 52);

  // ── Footer with page numbers ────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${tenantName} · Manifiesto generado ${today} · Página ${i} de ${pageCount}`,
      pageW / 2,
      pageH - 14,
      { align: "center" }
    );
  }

  const safeName = String(periodLabel || "todos").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const filename = `manifiesto_paqueteria_${safeName}_${Date.now()}.pdf`;

  // Cross-platform delivery. On desktop we force a real download via an anchor.
  // On iOS/Safari the `download` attribute is unreliable and octet-stream blobs
  // fail silently ("no se descarga nada"), so we open the PDF in a new tab where
  // the user can view, save or share it from the browser's built-in viewer.
  const ua = navigator.userAgent || "";
  const isIOS = /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const testAnchor = document.createElement("a");
  const supportsDownload = "download" in testAnchor && !isIOS && !isSafari;

  try {
    const blob = new Blob([doc.output("blob")], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    if (supportsDownload) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
        URL.revokeObjectURL(url);
      }, 15000);
    } else {
      // Mobile / Safari: open in a new tab (allowed inside the click gesture).
      const win = window.open(url, "_blank");
      if (!win) {
        // Popup blocked — navigate the current tab to the PDF as a last resort.
        window.location.href = url;
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return;
  } catch (e) {
    console.error("Blob delivery failed, trying doc.save:", e);
  }
  try {
    doc.save(filename);
    return;
  } catch (e) {
    console.error("doc.save failed, opening in new tab:", e);
  }
  // Last resort: open the PDF in a new tab so the user can save it manually.
  try {
    doc.output("dataurlnewwindow");
  } catch (e) {
    console.error("dataurlnewwindow also failed:", e);
    throw new Error("El navegador bloqueó la descarga del PDF. Intenta con otro navegador o desactiva bloqueadores.");
  }
}
