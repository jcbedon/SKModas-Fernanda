import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { useState, useEffect, createContext, useContext } from "react";

import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import AccessPage from "@/pages/AccessPage";
import MobileUpload from "@/pages/MobileUpload";
import MobileRechargeUpload from "@/pages/MobileRechargeUpload";
import MobileSessionUpload from "@/pages/MobileSessionUpload";
import ClientDashboard from "@/pages/ClientDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminLive from "@/pages/AdminLive";
import AdminLiveModule from "@/pages/AdminLiveModule";
import AdminClients from "@/pages/AdminClients";
import AdminWallet from "@/pages/AdminWallet";
import AdminShipments from "@/pages/AdminShipments";
import AdminReports from "@/pages/AdminReports";
import AdminReferrals from "@/pages/AdminReferrals";
import AdminStats from "@/pages/AdminStats";
import AdminEmployees from "@/pages/AdminEmployees";
import AdminAuditLog from "@/pages/AdminAuditLog";
import AdminInvoices from "@/pages/AdminInvoices";
import AdminPackagesReport from "@/pages/AdminPackagesReport";
import AdminPendingShipments from "@/pages/AdminPendingShipments";
import AdminBankAccounts from "@/pages/AdminBankAccounts";
import AdminDepositMaintenance from "@/pages/AdminDepositMaintenance";
import AdminInventory from "@/pages/AdminInventory";
import AdminInventoryStats from "@/pages/AdminInventoryStats";
import AdminInventorySelect from "@/pages/AdminInventorySelect";
import SuperadminDashboard from "@/pages/SuperadminDashboard";
import { BrandBackgroundVideo } from "@/components/BrandBackgroundVideo";
import AstridSidebar from "@/components/AstridSidebar";

// Apply the saved theme as early as possible to avoid a flash of the wrong theme.
try {
  if (localStorage.getItem("astrid_theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch (_e) {
  /* ignore */
}

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Shared re-hydration helper. Reused by initial mount, `pageshow` (BFCache
  // restore) and `visibilitychange` — all of which can race with iOS Safari
  // discarding the webview when the file picker opens.
  const hydrateFromStorage = () => {
    try {
      const storedUser = localStorage.getItem("outletsusa_user");
      if (storedUser) {
        setUser(JSON.parse(storedUser));
        return true;
      }
    } catch (_e) {
      // Corrupted storage — treat as logged out.
    }
    return false;
  };

  useEffect(() => {
    const had = hydrateFromStorage();
    if (had) {
      // Refresh permissions and profile from server in the background.
      // Fixes stale localStorage when an admin updates an employee's permissions
      // while their session is still active.
      import("@/lib/api").then(({ authMe }) => {
        authMe()
          .then((res) => {
            const parsed = JSON.parse(localStorage.getItem("outletsusa_user") || "null");
            if (!parsed) return; // logged out mid-flight
            const fresh = { ...parsed, ...res.data };
            if (parsed.token) fresh.token = parsed.token; // preserve token
            setUser(fresh);
            localStorage.setItem("outletsusa_user", JSON.stringify(fresh));
          })
          .catch(() => {/* keep cached user if refresh fails (offline, expired token, etc.) */});
      });
    }
    setLoading(false);

    // iOS Safari discards the webview when the file picker opens under memory
    // pressure. When it comes back the page fires `pageshow` with
    // `event.persisted=true` (BFCache) — React state was lost, but
    // localStorage is intact. Re-hydrate so the user isn't kicked to /login.
    const onPageShow = (event) => {
      if (event.persisted) {
        hydrateFromStorage();
      }
    };
    // Similarly when the tab comes back to foreground (Android + iOS PWA).
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Only re-hydrate if the current user state is null but storage has a
        // record (avoids clobbering an in-progress logout).
        if (!localStorage.getItem("outletsusa_user")) return;
        setUser((prev) => prev || JSON.parse(localStorage.getItem("outletsusa_user")));
      }
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem("outletsusa_user", JSON.stringify(userData));
    // The login response omits some tenant fields (e.g. the dashboard banner).
    // Refresh the profile from /auth/me right away so the banner and any other
    // fresh fields appear instantly, without needing a manual page reload.
    import("@/lib/api").then(({ authMe }) => {
      authMe()
        .then((res) => {
          const current = JSON.parse(localStorage.getItem("outletsusa_user") || "null");
          if (!current) return; // logged out mid-flight
          const fresh = { ...current, ...res.data };
          if (current.token) fresh.token = current.token; // preserve token
          setUser(fresh);
          localStorage.setItem("outletsusa_user", JSON.stringify(fresh));
        })
        .catch(() => {/* keep the login payload if the refresh fails */});
    });
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("outletsusa_user");
  };

  const updateTenantLogo = (logoUrl) => {
    if (user) {
      const updated = { ...user, tenant_logo: logoUrl };
      setUser(updated);
      localStorage.setItem("outletsusa_user", JSON.stringify(updated));
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, updateTenantLogo }}>
      {children}
    </AuthContext.Provider>
  );
};

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  // Guard against transient null user during iOS Safari BFCache restore:
  // localStorage still holds the session but React state hasn't re-hydrated
  // yet (auth listener runs on the next tick). We render the spinner and let
  // the `pageshow` listener in AuthProvider set the user; if storage really
  // is empty this branch never fires.
  if (!user && typeof window !== "undefined" && localStorage.getItem("outletsusa_user")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === "superadmin") return <Navigate to="/superadmin" replace />;
    if (user.role === "admin" || user.role === "employee") return <Navigate to="/admin" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <BrandBackgroundVideo />
        <AstridSidebar />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/access/:token" element={<AccessPage />} />
          <Route path="/upload/:token" element={<MobileUpload />} />
          <Route path="/upload-recharge/:token" element={<MobileRechargeUpload />} />
          <Route path="/m/upload/:token" element={<MobileSessionUpload />} />

          <Route path="/dashboard" element={<ProtectedRoute allowedRoles={["client"]}><ClientDashboard /></ProtectedRoute>} />

          <Route path="/superadmin" element={<ProtectedRoute allowedRoles={["superadmin"]}><SuperadminDashboard /></ProtectedRoute>} />

          <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/live" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminLive /></ProtectedRoute>} />
          <Route path="/admin/live-module" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminLiveModule /></ProtectedRoute>} />
          <Route path="/admin/clients" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminClients /></ProtectedRoute>} />
          <Route path="/admin/wallet" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminWallet /></ProtectedRoute>} />
          <Route path="/admin/shipments" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminShipments /></ProtectedRoute>} />
          <Route path="/admin/reports" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminReports /></ProtectedRoute>} />
          <Route path="/admin/referrals" element={<ProtectedRoute allowedRoles={["admin"]}><AdminReferrals /></ProtectedRoute>} />
          <Route path="/admin/stats" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminStats /></ProtectedRoute>} />
          <Route path="/admin/employees" element={<ProtectedRoute allowedRoles={["admin"]}><AdminEmployees /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<ProtectedRoute allowedRoles={["admin"]}><AdminAuditLog /></ProtectedRoute>} />
          <Route path="/admin/invoices" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminInvoices /></ProtectedRoute>} />
          <Route path="/admin/packages-report" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminPackagesReport /></ProtectedRoute>} />
          <Route path="/admin/pending-shipments" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminPendingShipments /></ProtectedRoute>} />
          <Route path="/admin/bank-accounts" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminBankAccounts /></ProtectedRoute>} />
          <Route path="/admin/deposit-maintenance" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDepositMaintenance /></ProtectedRoute>} />
          <Route path="/admin/inventory" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminInventorySelect /></ProtectedRoute>} />
          <Route path="/admin/inventory/:location" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminInventory /></ProtectedRoute>} />
          <Route path="/admin/inventory-stats/:location" element={<ProtectedRoute allowedRoles={["admin", "employee"]}><AdminInventoryStats /></ProtectedRoute>} />

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <Toaster position="top-center" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
