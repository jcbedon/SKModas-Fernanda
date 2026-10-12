import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const stored = localStorage.getItem("outletsusa_user");
  if (stored) {
    const user = JSON.parse(stored);
    if (user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
  }
  return config;
});

// Auth
export const registerUser = (data) => api.post("/auth/register", data);
export const loginUser = (data) => api.post("/auth/login", data);
export const getUser = (userId) => api.get(`/auth/user/${userId}`);

// Superadmin
export const seedSuperadmin = () => api.post("/superadmin/seed");
export const getSuperadminStats = () => api.get("/superadmin/stats");
export const listTenants = () => api.get("/superadmin/tenants");
export const createTenant = (data) => api.post("/superadmin/tenants", data);
export const updateTenantStatus = (tenantId, status) => api.put(`/superadmin/tenants/${tenantId}?status=${status}`);
export const createAdminForTenant = (tenantId, data) => api.post(`/superadmin/tenants/${tenantId}/admin`, data);
export const resetTenantAdminPassword = (tenantId, newPassword) => api.put(`/superadmin/tenants/${tenantId}/reset-password`, { new_password: newPassword });
export const getTenantAdminInfo = (tenantId) => api.get(`/superadmin/tenants/${tenantId}/admin-info`);
export const updateTenantSettings = (tenantId, settings) => api.put(`/superadmin/tenants/${tenantId}/settings`, settings);

// Bank accounts (per-tenant)
export const getTenantBankAccounts = (tenantId) => api.get(`/superadmin/tenants/${tenantId}/bank-accounts`);
export const updateTenantBankAccounts = (tenantId, bank_accounts) => api.put(`/superadmin/tenants/${tenantId}/bank-accounts`, { bank_accounts });
export const listBankAccounts = () => api.get("/admin/bank-accounts");
export const getClientReport = (params) => api.get("/admin/reports/clients", { params });
export const reviewClientDeposits = (q) => api.get("/admin/maintenance/client-deposits", { params: { q } });
export const reassignDepositMaintenance = (deposit_id, invoice_number) => api.post("/admin/maintenance/reassign-deposit", { deposit_id, invoice_number });
export const updateBankAccounts = (bank_accounts) => api.put("/admin/bank-accounts", { bank_accounts });
export const getBankAccountsSummary = () => api.get("/admin/bank-accounts/summary");
export const getBankAccountTransactions = (accountId, params = {}) => api.get(`/admin/bank-accounts/${accountId}/transactions`, { params });
export const manualBankDeposit = (accountId, data) => api.post(`/admin/bank-accounts/${accountId}/deposit`, data);
export const manualBankWithdrawal = (accountId, data) => api.post(`/admin/bank-accounts/${accountId}/withdrawal`, data);
export const zeroOutBankAccount = (accountId, data) => api.post(`/admin/bank-accounts/${accountId}/zero-out`, data);
export const assignBankAccountToRecharge = (txId, bankAccountId) => api.put(`/admin/wallet-transactions/${txId}/assign-bank-account`, { bank_account_id: bankAccountId });
export const listUnassignedRecharges = () => api.get("/admin/bank-accounts/unassigned-recharges");
export const backfillBankAccountRecharges = (bankAccountId) => api.post("/admin/bank-accounts/backfill-recharges", { bank_account_id: bankAccountId });
export const getShippingCategoriesAdmin = () => api.get("/admin/settings/shipping-categories");

// Admin Tenant
export const getMyTenant = () => api.get("/admin/tenant");
export const uploadTenantLogo = (formData) => api.post("/admin/tenant/logo", formData, { headers: { "Content-Type": "multipart/form-data" } });

// Wallet
export const getWallet = (userId) => api.get(`/wallet/${userId}`);
export const getWalletByCustomerId = (customerId) => api.get(`/wallet/by-customer/${customerId}`);
export const requestDeposit = (data) => api.post("/wallet/deposit-request", data);
export const requestDepositWithProof = (formData) => api.post("/wallet/deposit-request-with-proof", formData, { headers: { "Content-Type": "multipart/form-data" } });
export const approveDeposit = (transactionId) => api.post(`/wallet/approve-deposit/${transactionId}`);
export const setDepositAmount = (transactionId, amount) => api.put(`/wallet/deposit/${transactionId}/amount`, { amount });
export const scanDepositProof = (transactionId) => api.post(`/wallet/deposit/${transactionId}/scan-proof`);
export const setDepositDate = (transactionId, depositDate) => api.put(`/wallet/${transactionId}/deposit-date`, { deposit_date: depositDate });
export const rejectDeposit = (transactionId) => api.post(`/wallet/reject-deposit/${transactionId}`);
export const getAllDeposits = (includeDeleted = false) => api.get(`/wallet/all-deposits?include_deleted=${includeDeleted ? 'true' : 'false'}`);
export const setDepositBankReviewed = (transactionId, reviewed) => api.post(`/wallet/deposit/${transactionId}/bank-reviewed`, { reviewed });
export const authMe = () => api.get("/auth/me");
export const adminBalanceAdjustment = (data) => api.post("/wallet/admin-adjustment", data);
export const adminCreateRecharge = (formData) => api.post("/wallet/admin-recharge", formData, { headers: { "Content-Type": "multipart/form-data" } });
export const getRechargeReport = () => api.get("/wallet/recharge-report");
export const getWalletTransactions = (userId) => api.get(`/wallet/transactions/${userId}`);
export const getPendingDeposits = () => api.get("/wallet/pending-deposits");
export const deleteDeposit = (transactionId, password) => api.post(`/wallet/delete-deposit/${transactionId}`, { password });
export const getDeletedDeposits = () => api.get("/wallet/deleted-deposits");

// Lives
export const createLive = (data) => api.post("/lives", data);
export const updateLive = (liveId, data) => api.put(`/lives/${liveId}`, data);
export const startLive = (liveId, data = {}) => api.post(`/lives/${liveId}/start`, data);
export const endLive = (liveId) => api.post(`/lives/${liveId}/end`);
export const getLives = (status) => api.get("/lives", { params: { status } });
export const getActiveLive = () => api.get("/lives/active");
export const reassignPurchaseLive = (purchaseId, liveId) => api.post(`/purchases/${purchaseId}/reassign-live`, { live_id: liveId });
export const getLive = (liveId) => api.get(`/lives/${liveId}`);
export const createLiveModulePurchases = (data) => api.post("/live-module/purchases", data);
export const getProductHistory = (q) => api.get("/live-module/product-history", { params: { q } });
export const updateStoreInvoice = (liveId, amount, itemsCount) => api.put(`/lives/${liveId}/store-invoice`, {
  store_invoice_amount: amount,
  ...(itemsCount !== undefined && itemsCount !== null && itemsCount !== "" ? { store_invoice_items_count: itemsCount } : {}),
});
export const uploadStoreInvoiceImage = (liveId, formData) => api.post(`/lives/${liveId}/store-invoice/upload`, formData, { headers: { "Content-Type": "multipart/form-data" } });
export const generateUploadQR = (liveId) => api.post(`/lives/${liveId}/generate-upload-qr`);
export const checkUploadStatus = (uploadToken) => api.get(`/lives/check-upload/${uploadToken}`);

// Recharge QR Upload
export const generateRechargeUploadQR = (userId) => api.post(`/wallet/generate-upload-qr/${userId}`);
export const checkRechargeUploadStatus = (uploadToken) => api.get(`/wallet/check-upload/${uploadToken}`);

// Purchases
export const createPurchase = (data) => api.post("/purchases", data);
export const getUserPurchases = (userId) => api.get(`/purchases/user/${userId}`);
export const updatePurchase = (purchaseId, data) => api.put(`/purchases/${purchaseId}`, data);
export const deletePurchase = (purchaseId, data) => api.delete(`/purchases/${purchaseId}`, data ? { data } : undefined);
export const getDeletePurchasePreview = (purchaseId) => api.get(`/purchases/${purchaseId}/delete-preview`);
export const getLivePurchases = (liveId) => api.get(`/purchases/live/${liveId}`);
export const getPendingShipmentPurchases = (userId) => api.get(`/purchases/pending-shipment/${userId}`);

// Shipments
export const createShipment = (data) => api.post("/shipments", data);
export const updateTracking = (shipmentId, data) =>
  api.put(`/shipments/${shipmentId}/tracking`, data);
export const updateShipmentStatus = (shipmentId, status) =>
  api.put(`/shipments/${shipmentId}/status`, null, { params: { status } });
export const toggleShipmentGuideVerified = (shipmentId, verified) =>
  api.put(`/shipments/${shipmentId}/verify-guide`, { verified });
export const toggleShipmentSent = (shipmentId, sent) =>
  api.put(`/shipments/${shipmentId}/toggle-sent`, { sent });
export const updateShipment = (shipmentId, data) => api.put(`/shipments/${shipmentId}`, data);
export const deleteShipment = (shipmentId) => api.delete(`/shipments/${shipmentId}`);
export const getUserShipments = (userId) => api.get(`/shipments/user/${userId}`);
export const getAllShipments = (status) => api.get("/shipments", { params: { status } });
export const uploadShipmentAttachment = (shipmentId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return api.post(`/shipments/${shipmentId}/attachments`, formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
};

// Notifications
export const getUserNotifications = (userId) => api.get(`/notifications/${userId}`);

// Admin
export const getAllClients = (status) => api.get("/admin/clients", { params: { status } });
export const getActiveClients = () => api.get("/admin/clients/active");
export const createClient = (data) => api.post("/admin/clients/create", data);
export const checkClientDuplicate = (data) => api.post("/admin/clients/check-duplicate", data);
export const toggleClientStatus = (userId) => api.put(`/admin/clients/${userId}/toggle-status`);
export const toggleClientReviewed = (userId) => api.put(`/admin/clients/${userId}/toggle-reviewed`);
export const deleteClient = (userId) => api.delete(`/admin/clients/${userId}`);
export const updateClientCommission = (userId, commissionFee) =>
  api.put(`/admin/clients/${userId}/commission?commission_fee=${commissionFee}`);
export const updateClient = (userId, data) => api.put(`/admin/clients/${userId}`, data);
export const getClientPassword = (userId) => api.get(`/admin/clients/${userId}/password`);
export const getClientInfo = (customerId) => api.get(`/admin/clients/${customerId}/info`);
export const getLiveReport = (liveId) => api.get(`/admin/reports/live/${liveId}`);
export const getReportsSummary = (period = "week", startDate = null, endDate = null) => {
  const params = new URLSearchParams({ period });
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return api.get(`/admin/reports/summary?${params.toString()}`);
};
export const getBuyersReport = (period = "week") => api.get(`/admin/reports/buyers?period=${period}`);
export const getBusinessStats = (period = "all") => api.get(`/admin/reports/business-stats?period=${period}`);
export const getClientsPurchasesReport = () => api.get("/admin/reports/clients-purchases");
export const getAllPurchasesReport = () => api.get("/admin/reports/all-purchases");
export const getClientsDebtsReport = () => api.get("/admin/reports/clients-debts");
export const getInactiveClientsReport = () => api.get("/admin/reports/inactive-clients");
export const getPurchasesWithoutTax = () => api.get("/admin/reports/purchases-without-tax");
export const getStoreProfitsReport = () => api.get("/admin/reports/store-profits");

// Settings - Referrals
export const getReferralBonus = () => api.get("/admin/settings/referral-bonus");
export const setReferralBonus = (amount) => api.put(`/admin/settings/referral-bonus?amount=${amount}`);
export const getReferralStats = () => api.get("/admin/referrals");

// Settings - Tax Options
export const getTenantSettings = () => api.get("/admin/settings");
export const updateTenantTaxOptions = (taxOptions) => api.put("/admin/settings/tax-options", { tax_options: taxOptions });
export const updateShippingCategories = (shippingCategories) =>
  api.put("/admin/settings/shipping-categories", { shipping_categories: shippingCategories });
export const updateShippingCategoriesSuperadmin = (tenantId, shippingCategories, shippingMode) =>
  api.put(`/superadmin/tenants/${tenantId}/shipping-categories`, {
    shipping_categories: shippingCategories,
    ...(shippingMode ? { shipping_mode: shippingMode } : {})
  });

// Mobile upload sessions (QR flow)
export const createUploadSession = () => api.post("/upload-sessions");
export const getUploadSession = (token) => api.get(`/upload-sessions/${token}`);
export const clearUploadSessionFiles = (token) => api.delete(`/upload-sessions/${token}/files`);
export const getUploadSessionPublicInfo = (token) => api.get(`/upload-sessions/${token}/public-info`);
export const attachSessionFilesToShipment = (shipmentId, token) =>
  api.post(`/shipments/${shipmentId}/attach-session`, { token });
export const uploadSessionFile = (token, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return api.post(`/upload-sessions/${token}/files`, formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
};

// Invoices
export const getPendingPurchases = (customerId) => api.get(`/invoices/client/${customerId}/pending-purchases`);
export const createInvoice = (data) => api.post("/invoices", data);
export const getClientPendingBalance = (customerId) => api.get(`/invoices/client-pending-balance/${customerId}`);
export const getClientAvailableDeposits = (customerId) => api.get(`/invoices/client-available-deposits/${customerId}`);
export const updateInvoiceSaldoPendiente = (invoiceId, saldoPendiente) => api.put(`/invoices/${invoiceId}/saldo-pendiente`, { saldo_pendiente: saldoPendiente });
export const getClientInvoices = (customerId, includeAnnulled = false) => api.get(`/invoices/client/${customerId}${includeAnnulled ? '?include_annulled=true' : ''}`);
export const getInvoiceDetail = (invoiceId) => api.get(`/invoices/${invoiceId}`);
export const getClientInvoicesForShipment = (customerId) => api.get(`/invoices/client/${customerId}/for-shipment`);
export const approveInvoice = (invoiceId) => api.put(`/invoices/${invoiceId}/approve`);
export const removeItemFromInvoice = (invoiceId, purchaseId) => api.put(`/invoices/${invoiceId}/remove-item`, { purchase_id: purchaseId });
export const addItemsToInvoice = (invoiceId, purchaseIds) => api.put(`/invoices/${invoiceId}/add-items`, { purchase_ids: purchaseIds });
export const reopenInvoice = (invoiceId) => api.put(`/invoices/${invoiceId}/reopen`);
export const getClientPurchaseHistory = (customerId) => api.get(`/invoices/client/${customerId}/history`);
export const annulInvoice = (invoiceId, password, deleteShipment = false) => api.put(`/invoices/${invoiceId}/annul`, { password, delete_shipment: deleteShipment });
export const annulInvoicePreview = (invoiceId) => api.get(`/invoices/${invoiceId}/annul-preview`);
export const listAnnulledInvoices = () => api.get("/invoices/annulled");
export const restoreInvoice = (invoiceId, password) => api.put(`/invoices/${invoiceId}/restore`, { password });
export const recalculateAllInvoices = () => api.post("/admin/recalculate-all-invoices");
export const recalculateClientInvoices = (customerId) => api.post(`/admin/recalculate-invoices/${customerId}`);
export const getFloatingDeposits = (customerId) => api.get(`/wallet/floating-deposits/${customerId}`);
export const assignDepositToInvoice = (transactionId, invoiceId) => api.put(`/wallet/deposit/${transactionId}/assign-invoice`, { invoice_id: invoiceId });
export const getInvoicesWithoutShipment = () => api.get("/admin/reports/invoices-without-shipment");
export const getSalesDetail = (start, end) => api.get("/admin/reports/sales-detail", { params: { start, end } });
export const auditInvoice = (invoiceId) => api.get(`/invoices/${invoiceId}/audit`);
export const recalcInvoice = (invoiceId) => api.post(`/invoices/${invoiceId}/recalc`);
export const searchInvoices = (query, statusFilter = "all") => api.get(`/invoices/search?q=${encodeURIComponent(query)}&status_filter=${statusFilter}`);

// Temporary Access Tokens (for QR codes)
export const generateAccessToken = (data) => api.post("/auth/generate-access-token", data);
export const verifyAccessToken = (token) => api.get(`/auth/verify-access-token/${token}`);

// Employees
export const getEmployees = () => api.get("/admin/employees");
export const createEmployee = (data) => api.post("/admin/employees", data);
export const getEmployeeDetail = (employeeId) => api.get(`/admin/employees/${employeeId}`);
export const updateEmployee = (employeeId, data) => api.put(`/admin/employees/${employeeId}`, data);
export const deleteEmployee = (employeeId) => api.delete(`/admin/employees/${employeeId}`);

// Audit Logs
export const getAuditLogs = (params) => api.get("/admin/audit-logs", { params });
export const getAuditUsers = () => api.get("/admin/audit-logs/users");
export const getAuditActions = () => api.get("/admin/audit-logs/actions");
export const getAuditHistory = (days = 7) => api.get(`/admin/audit-logs/history?days=${days}`);

// Diagnostics
export const diagnoseShipments = (startDate, endDate) =>
  api.get("/admin/diagnose-shipments", { params: { start_date: startDate, end_date: endDate } });
export const diagnoseInvoice = (invoiceId) =>
  api.get(`/admin/diagnose-invoice/${invoiceId}`);

// Superadmin - Tenant Settings
export const updateTenantTaxOptionsSuperadmin = (tenantId, taxOptions) => 
  api.put(`/superadmin/tenants/${tenantId}/tax-options`, { tax_options: taxOptions });
export const updateTenantTrackingUrl = (tenantId, trackingUrl) =>
  api.put(`/superadmin/tenants/${tenantId}/tracking-url`, { tracking_url_template: trackingUrl });
export const getTenantDetails = (tenantId) => api.get(`/superadmin/tenants/${tenantId}/details`);

// Inventory
export const getInventoryProducts = (location) => api.get("/inventory/products", { params: { location } });
export const getInventoryProduct = (productId) => api.get(`/inventory/products/${productId}`);
export const createInventoryProduct = (data) => api.post("/inventory/products", data);
export const updateInventoryProduct = (productId, data) => api.put(`/inventory/products/${productId}`, data);
export const deleteInventoryProduct = (productId) => api.delete(`/inventory/products/${productId}`);
export const adjustInventoryStock = (productId, adjustment, reason) => 
  api.post(`/inventory/products/${productId}/adjust-stock`, { adjustment, reason });
export const getInventorySales = (location, params = {}) => api.get("/inventory/sales", { params: { location, ...params } });
export const createInventorySale = (data) => api.post("/inventory/sales", data);
export const deleteInventorySale = (saleId) => api.delete(`/inventory/sales/${saleId}`);
export const getInventoryStats = (location, period = "week") => api.get("/inventory/stats", { params: { location, period } });

export default api;
