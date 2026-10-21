// Splits a shipment into its per-category parts. Multi-package shipments use
// `packages`; legacy ones are a single part with the caller's quantity.
export const getShipmentParts = (s, legacyQty) => {
  if (Array.isArray(s.packages) && s.packages.length > 0) {
    return s.packages.map((p) => ({
      category: String(p.shipping_category || "").toUpperCase(),
      qty: Number(p.package_count) || 0,
      cost: Number(p.cost) || 0,
    }));
  }
  return [{
    category: String(s.shipping_category || "").toUpperCase(),
    qty: legacyQty !== undefined ? legacyQty : Number(s.package_count) || 0,
    cost: Number(s.shipping_cost) || 0,
  }];
};

export const formatShipmentParts = (s) =>
  getShipmentParts(s).map((p) => `${p.category || "—"}×${p.qty}`).join(" · ");
