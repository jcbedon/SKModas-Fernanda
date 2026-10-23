const fmtMoney = (v) => "$" + Number(v || 0).toFixed(2);

export const waUrl = (c, tenantName) => {
  let digits = String(c.whatsapp || "").replace(/[^0-9]/g, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = "593" + digits.slice(1);
  const msg = c.is_paid
    ? `Hola ${c.name}, gracias por tu pago de ${fmtMoney(c.last_payment_amount)}. Tu factura ya está cancelada. ¡Gracias por comprar con ${tenantName}!`
    : !c.has_payments
    ? `Hola ${c.name}, te recordamos que tienes un saldo pendiente de ${fmtMoney(c.remaining)} en tu factura. ¡Gracias! — ${tenantName}`
    : `Hola ${c.name}, recibimos tu abono de ${fmtMoney(c.last_payment_amount)}. Te falta pagar ${fmtMoney(c.remaining)} para completar tu factura. ¡Gracias! — ${tenantName}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
};
