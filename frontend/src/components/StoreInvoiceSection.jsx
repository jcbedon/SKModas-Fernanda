import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { 
  Receipt, 
  Camera, 
  QrCode, 
  Upload, 
  CheckCircle, 
  DollarSign,
  TrendingUp,
  TrendingDown,
  Loader2,
  Image,
  Smartphone,
  Package
} from "lucide-react";
import { updateStoreInvoice, uploadStoreInvoiceImage, generateUploadQR, checkUploadStatus } from "@/lib/api";
import QRCode from "qrcode";

export default function StoreInvoiceSection({ live, onUpdate, compact = false }) {
  // Initialize with empty string - only use live value if explicitly set
  const [invoiceAmount, setInvoiceAmount] = useState("");
  // Tax from store invoice (paid by shopper, reduces commission profit)
  const [invoiceTax, setInvoiceTax] = useState("");
  // Total physical items the admin bought at the store. Independent from
  // `live.purchase_count` (number of items registered to clients).
  const [invoiceItemsCount, setInvoiceItemsCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [showExpandedDialog, setShowExpandedDialog] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [polling, setPolling] = useState(false);
  const fileInputRef = useRef(null);
  const pollingRef = useRef(null);

  const APP_URL = process.env.REACT_APP_BACKEND_URL?.replace('/api', '') || window.location.origin;

  // Update invoice amount when live changes - only if it has a value
  useEffect(() => {
    if (live?.store_invoice_amount !== undefined && live?.store_invoice_amount !== null && live?.store_invoice_amount !== 0) {
      setInvoiceAmount(live.store_invoice_amount);
    } else {
      setInvoiceAmount(""); // Reset to empty for new stores without invoice
    }
    // Tax: keep stored value or reset.
    if (live?.store_invoice_tax !== undefined && live?.store_invoice_tax !== null && live?.store_invoice_tax !== 0) {
      setInvoiceTax(live.store_invoice_tax);
    } else {
      setInvoiceTax("");
    }
    // Items count: keep stored value or reset.
    if (live?.store_invoice_items_count !== undefined && live?.store_invoice_items_count !== null) {
      setInvoiceItemsCount(live.store_invoice_items_count);
    } else {
      setInvoiceItemsCount("");
    }
  }, [live?.id, live?.store_invoice_amount, live?.store_invoice_tax, live?.store_invoice_items_count]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const handleSaveAmount = async () => {
    if (!invoiceAmount || isNaN(parseFloat(invoiceAmount))) {
      toast.error("Ingresa un monto válido");
      return;
    }
    // Tax is optional but must be a valid non-negative number when provided
    let taxToSend = null;
    if (invoiceTax !== "" && invoiceTax !== null && invoiceTax !== undefined) {
      const parsedTax = parseFloat(invoiceTax);
      if (Number.isNaN(parsedTax) || parsedTax < 0) {
        toast.error("Tax inválido");
        return;
      }
      taxToSend = parsedTax;
    }
    // items count is optional but must be a valid non-negative integer when provided
    let itemsCountToSend = null;
    if (invoiceItemsCount !== "" && invoiceItemsCount !== null && invoiceItemsCount !== undefined) {
      const parsed = parseInt(invoiceItemsCount, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        toast.error("Cantidad de artículos inválida");
        return;
      }
      itemsCountToSend = parsed;
    }

    try {
      setSaving(true);
      await updateStoreInvoice(live.id, parseFloat(invoiceAmount), itemsCountToSend, taxToSend);
      toast.success("Factura de tienda guardada");
      if (onUpdate) onUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      await uploadStoreInvoiceImage(live.id, formData);
      toast.success("Imagen de factura subida");
      if (onUpdate) onUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al subir imagen");
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateQR = async () => {
    try {
      const res = await generateUploadQR(live.id);
      const token = res.data.upload_token;
      setUploadToken(token);
      
      // Generate QR code
      const uploadUrl = `${APP_URL}/upload/${token}`;
      const qr = await QRCode.toDataURL(uploadUrl, {
        width: 300,
        margin: 2,
        color: { dark: "#1E3A5F", light: "#ffffff" }
      });
      setQrCodeUrl(qr);
      setShowQRDialog(true);
      
      // Start polling to check if image was uploaded
      setPolling(true);
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await checkUploadStatus(token);
          if (statusRes.data.used && statusRes.data.image_url) {
            clearInterval(pollingRef.current);
            setPolling(false);
            setShowQRDialog(false);
            toast.success("¡Imagen recibida desde el teléfono!");
            if (onUpdate) onUpdate();
          }
        } catch (err) {
          // Token might be expired
          clearInterval(pollingRef.current);
          setPolling(false);
        }
      }, 3000); // Poll every 3 seconds
      
    } catch (error) {
      toast.error("Error al generar código QR");
    }
  };

  const handleCloseQR = () => {
    setShowQRDialog(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    setPolling(false);
  };

  // Calculate profit (considering store invoice tax reduces commission profit)
  const totalSales = live?.total_sales || 0;
  const totalCommissions = live?.total_commissions || 0;
  const totalTaxesPaid = live?.total_taxes_paid || 0;  // Taxes per product
  const storeAmount = parseFloat(invoiceAmount) || 0;
  const storeTax = parseFloat(invoiceTax) || 0;  // Tax from store invoice
  const profit = totalSales - storeAmount;
  // Net commission profit = commissions - product taxes - store invoice tax
  const netCommissionProfit = totalCommissions - totalTaxesPaid - storeTax;
  const hasImage = !!live?.store_invoice_image;
  const hasAmount = live?.store_invoice_amount !== null && live?.store_invoice_amount !== undefined;

  // Compact inline version for header
  if (compact) {
    return (
      <>
        <div 
          className="flex items-center gap-2 bg-white/10 rounded-xl px-2.5 py-1.5 cursor-pointer hover:bg-white/20 transition-colors whitespace-nowrap"
          onClick={() => setShowExpandedDialog(true)}
        >
          <Receipt className="h-3.5 w-3.5 text-white/70 shrink-0" />
          <div className="text-left">
            <p className="text-[10px] text-white/60 leading-tight">Factura Tienda</p>
            {hasAmount ? (
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold text-white leading-tight">${storeAmount.toFixed(2)}</p>
                {live?.store_invoice_items_count != null && (
                  <span className="text-[10px] text-white/70 flex items-center gap-0.5" data-testid="store-invoice-items-badge">
                    <Package className="h-2.5 w-2.5" />
                    {live.store_invoice_items_count}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-white/50 leading-tight">Sin registrar</p>
            )}
          </div>
          {hasAmount && (
            <div className={`text-right ${profit >= 0 ? "text-green-300" : "text-red-300"}`}>
              <p className="text-[10px] opacity-70 leading-tight">Ganancia</p>
              <p className="text-xs font-bold leading-tight">{profit >= 0 ? "+" : ""}${profit.toFixed(2)}</p>
              {storeTax > 0 && (
                <p className="text-[9px] text-amber-300 leading-tight">Tax: -${storeTax.toFixed(2)}</p>
              )}
            </div>
          )}
          {hasImage && <CheckCircle className="h-3.5 w-3.5 text-green-300 shrink-0" />}
        </div>

        {/* Expanded Dialog */}
        <Dialog open={showExpandedDialog} onOpenChange={setShowExpandedDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={{ color: "#1E3A5F" }}>
                <Receipt className="h-5 w-5" />
                Factura de la Tienda
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Amount Input */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Monto de la Factura
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                      onWheel={(e) => e.target.blur()}
                      className="pl-10 h-12 text-xl font-bold"
                    />
                  </div>
                  <Button
                    onClick={handleSaveAmount}
                    disabled={saving}
                    className="h-12 px-6"
                    style={{ background: "#1E3A5F" }}
                    data-testid="save-store-invoice-btn"
                  >
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
              </div>

              {/* Tax Input - Store invoice tax paid by shopper */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Tax de la Factura
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-amber-500" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={invoiceTax}
                    onChange={(e) => setInvoiceTax(e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    className="pl-10 h-12 font-medium border-amber-200 focus:border-amber-400"
                    data-testid="store-invoice-tax"
                  />
                </div>
                <p className="text-[11px] text-amber-600 mt-1">
                  Este tax lo asume la personal shopper y se resta de las ganancias de comisiones.
                </p>
              </div>

              {/* Items Count Input — admin-entered, independent from purchase_count */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Cantidad de artículos comprados en la tienda
                </label>
                <div className="relative">
                  <Package className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="Ej: 30"
                    value={invoiceItemsCount}
                    onChange={(e) => setInvoiceItemsCount(e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    className="pl-10 h-12 font-medium"
                    data-testid="store-invoice-items-count"
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Total real comprado en la tienda. Se guarda al presionar "Guardar" arriba.
                  {live?.purchase_count > 0 && (
                    <> Registrados a clientes: <span className="font-bold text-gray-700">{live.purchase_count}</span></>
                  )}
                </p>
              </div>

              {/* Profit */}
              {hasAmount && (
                <div className="space-y-2">
                  <div className={`p-3 rounded-xl flex items-center justify-between ${profit >= 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                    <div>
                      <p className="text-sm text-gray-600">Ganancia Bruta</p>
                      <p className="text-xs text-gray-500">(Ventas ${totalSales.toFixed(2)} - Factura ${storeAmount.toFixed(2)})</p>
                    </div>
                    <span className={`text-2xl font-bold ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${profit.toFixed(2)}
                    </span>
                  </div>
                  
                  {/* Commission Profit with Taxes */}
                  {(totalCommissions > 0 || storeTax > 0 || totalTaxesPaid > 0) && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-amber-800">Ganancia Neta Comisiones</p>
                        <span className={`text-xl font-bold ${netCommissionProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          ${netCommissionProfit.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-amber-700 space-y-0.5">
                        <p>Comisiones: +${totalCommissions.toFixed(2)}</p>
                        {totalTaxesPaid > 0 && <p>Taxes por producto: -${totalTaxesPaid.toFixed(2)}</p>}
                        {storeTax > 0 && <p>Tax factura tienda: -${storeTax.toFixed(2)}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Image Upload */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Foto de la Factura
                </label>
                {hasImage ? (
                  <div className="space-y-3">
                    {/* Current Image - Clickable to view full size */}
                    <div 
                      className="relative rounded-xl overflow-hidden border border-green-300 bg-gray-100 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setShowImagePreview(true)}
                    >
                      <img 
                        src={`${process.env.REACT_APP_BACKEND_URL}${live.store_invoice_image}`}
                        alt="Factura de Tienda" 
                        className="w-full h-32 object-cover"
                        onLoad={() => console.log('Image loaded:', live.store_invoice_image)}
                        onError={(e) => {
                          console.error('Image load error:', live.store_invoice_image);
                          // Try alternative URL
                          const altUrl = `${process.env.REACT_APP_BACKEND_URL}/api/uploads/${live.store_invoice_image.split('/').pop()}`;
                          console.log('Trying alternative:', altUrl);
                          e.target.src = altUrl;
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors">
                        <span className="text-white opacity-0 hover:opacity-100 text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
                          Click para ampliar
                        </span>
                      </div>
                    </div>
                    {/* Change Image Options */}
                    <div className="flex gap-2">
                      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                      <Button
                        variant="outline"
                        className="flex-1 h-10"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Camera className="h-4 w-4 mr-2" /> Cambiar Foto</>}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10 px-4 border-blue-300 text-blue-600"
                        onClick={handleGenerateQR}
                        title="Escanear QR desde teléfono"
                      >
                        <Smartphone className="h-4 w-4 mr-1" />
                        <QrCode className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                    <Button
                      variant="outline"
                      className="flex-1 h-12"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Upload className="h-5 w-5 mr-2" /> Subir Foto</>}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 px-4 border-blue-300 text-blue-600"
                      onClick={handleGenerateQR}
                      title="Escanear QR desde teléfono"
                    >
                      <Smartphone className="h-4 w-4 mr-1" />
                      <QrCode className="h-5 w-5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* QR Dialog */}
        <Dialog open={showQRDialog} onOpenChange={handleCloseQR}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={{ color: "#1E3A5F" }}>
                <QrCode className="h-5 w-5" />
                Escanea con tu Teléfono
              </DialogTitle>
            </DialogHeader>
            <div className="text-center py-4">
              {qrCodeUrl && <img src={qrCodeUrl} alt="QR Code" className="mx-auto rounded-xl shadow-lg" />}
              <p className="text-sm text-gray-600 mt-4">Escanea para subir la foto desde tu teléfono</p>
              {polling && (
                <div className="flex items-center justify-center gap-2 mt-4 text-blue-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Esperando imagen...</span>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Full version (not used anymore but kept for compatibility)
  return (
    <>
      <Card className="border border-orange-200 bg-orange-50/30 mt-3">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-gray-700">Factura de Tienda</span>
              {hasAmount && (
                <Badge className="bg-blue-100 text-blue-700 text-xs py-0">
                  ${storeAmount.toFixed(2)}
                </Badge>
              )}
              {hasAmount && (
                <span className={`text-sm font-bold ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {profit >= 0 ? "+" : ""}{profit.toFixed(2)} ganancia
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowExpandedDialog(true)}
              className="text-orange-600 hover:text-orange-700 hover:bg-orange-100 h-7 px-2"
            >
              {hasAmount && hasImage ? "Ver" : "Ingresar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* QR Code Dialog */}
      <Dialog open={showQRDialog} onOpenChange={handleCloseQR}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: "#1E3A5F" }}>
              <QrCode className="h-5 w-5" />
              Escanea con tu Teléfono
            </DialogTitle>
          </DialogHeader>
          
          <div className="text-center py-4">
            {qrCodeUrl && (
              <img src={qrCodeUrl} alt="QR Code" className="mx-auto rounded-xl shadow-lg" />
            )}
            
            <p className="text-sm text-gray-600 mt-4">
              Escanea este código QR con la cámara de tu teléfono para abrir la página de carga
            </p>
            
            {polling && (
              <div className="flex items-center justify-center gap-2 mt-4 text-blue-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Esperando imagen...</span>
              </div>
            )}
            
            <p className="text-xs text-gray-400 mt-4">
              El código expira en 10 minutos
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
