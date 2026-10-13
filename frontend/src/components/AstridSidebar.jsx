import { useState, useEffect } from "react";
import { useAuth } from "@/App";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  LayoutDashboard,
  Radio,
  Users,
  FileText,
  Wallet,
  Truck,
  Gift,
  BarChart3,
  TrendingUp,
  Landmark,
  UserCog,
  ClipboardList,
  Wrench,
  ArrowLeft,
  Menu,
  X,
  LogOut,
  Video,
  Boxes,
  Package,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

// Ordered nav for admins/employees. Client dashboards use their own tabbed UI
// so they don't get the sidebar.
const ADMIN_NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/live", label: "Live Shopping", icon: Radio },
  { to: "/admin/clients", label: "Clientes", icon: Users },
  { to: "/admin/invoices", label: "Facturas", icon: FileText },
  { to: "/admin/wallet", label: "Recargas", icon: Wallet },
  { to: "/admin/shipments", label: "Envíos", icon: Truck },
  { to: "/admin/inventory", label: "Inventario", icon: Boxes },
  { to: "/admin/pacas", label: "Pacas", icon: Package },
  { to: "/admin/referrals", label: "Referidos", icon: Gift },
  { to: "/admin/reports", label: "Reportes", icon: BarChart3 },
  { to: "/admin/stats", label: "Estadísticas", icon: TrendingUp },
  { to: "/admin/bank-accounts", label: "Cuentas", icon: Landmark },
  { to: "/admin/deposit-maintenance", label: "Mant. Recargas", icon: Wrench },
  { to: "/admin/employees", label: "Empleados", icon: UserCog },
  { to: "/admin/audit", label: "Auditoría", icon: ClipboardList },
];

const ROUTE_TITLES = ADMIN_NAV.reduce((acc, n) => {
  acc[n.to] = n.label;
  return acc;
}, {});
ROUTE_TITLES["/admin/live-module"] = "Live";

// Red-accented "Live" fast-entry module, inserted right after Live Shopping
// but only for tenants that have the module enabled.
const LIVE_MODULE_ITEM = { to: "/admin/live-module", label: "Live", icon: Video, iconColor: "#E11D48" };

/**
 * Fixed left sidebar (desktop) + compact back-button header (mobile) shown on
 * every admin/employee route for every tenant. Client dashboards and public
 * routes are untouched.
 */
export const AstridSidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Only for admin/employee routes. Skip login, register, client dashboard, etc.
  const isAdminRoute = location.pathname.startsWith("/admin");
  const isAdminUser = user && (user.role === "admin" || user.role === "employee");

  // Tag the body while the sidebar is mounted so global CSS can shift the
  // content sideways and hide the legacy in-page top header on admin pages.
  useEffect(() => {
    if (!isAdminRoute || !isAdminUser) return undefined;
    document.body.classList.add("astrid-admin-shell");
    return () => document.body.classList.remove("astrid-admin-shell");
  }, [isAdminRoute, isAdminUser]);

  if (!isAdminRoute || !isAdminUser) return null;

  const isDashboardHome = location.pathname === "/admin";
  const currentTitle = ROUTE_TITLES[location.pathname] || "Astrid Shop";

  // Inject the Live module link (after Live Shopping) only when enabled for the tenant.
  const navItems = user?.live_module_enabled
    ? [ADMIN_NAV[0], ADMIN_NAV[1], LIVE_MODULE_ITEM, ...ADMIN_NAV.slice(2)]
    : ADMIN_NAV;

  const isActive = (item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <>
      <style>{`
        /* Push admin page content right on desktop to make room for the sidebar. */
        @media (min-width: 1024px) {
          .astrid-sidebar-shift { padding-left: 240px; }
        }
        /* Reserve top space on mobile for the compact header. */
        @media (max-width: 1023px) {
          .astrid-mobile-topbar-shift { padding-top: 56px; }
        }
        .astrid-nav-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; border-radius: 12px;
          color: #64748B; font-size: 14px; font-weight: 500;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .astrid-nav-item:hover { background: #F1F5F9; color: #1E293B; }
        .astrid-nav-item.active {
          background: linear-gradient(135deg, #1E3A5F, #2a4f7f);
          color: #ffffff;
        }
        .astrid-nav-item.active svg { color: #ffffff; }
      `}</style>

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex fixed inset-y-0 left-0 w-60 bg-white border-r border-slate-200 z-40 flex-col"
        data-testid="astrid-sidebar"
      >
        <div className="px-5 py-5 border-b border-slate-100">
          <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Admin</p>
          <p className="text-sm font-bold text-slate-800 truncate">{user?.tenant_name || "Panel"}</p>
          <p className="text-xs text-slate-500 truncate">{user?.name || user?.email}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`astrid-nav-item ${active ? "active" : ""}`}
                data-testid={`astrid-nav-${item.to.replace(/\//g, "-")}`}
              >
                <Icon className="h-4 w-4 shrink-0" style={item.iconColor && !active ? { color: item.iconColor } : undefined} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={handleLogout}
            className="astrid-nav-item flex-1"
            data-testid="astrid-sidebar-logout"
          >
            <LogOut className="h-4 w-4" />
            <span>Salir</span>
          </button>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile compact top bar */}
      <div
        className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-slate-200 z-40 flex items-center px-3 gap-2"
        data-testid="astrid-mobile-topbar"
      >
        {isDashboardHome ? (
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-slate-100"
            data-testid="astrid-mobile-menu-btn"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5 text-slate-700" />
          </button>
        ) : (
          <button
            onClick={() => navigate("/admin")}
            className="p-2 rounded-lg hover:bg-slate-100"
            data-testid="astrid-mobile-back-btn"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5 text-slate-700" />
          </button>
        )}
        <p className="flex-1 text-sm font-semibold text-slate-800 truncate" data-testid="astrid-mobile-title">
          {currentTitle}
        </p>
        <ThemeToggle />
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg hover:bg-slate-100"
          data-testid="astrid-mobile-menu-open"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5 text-slate-700" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          data-testid="astrid-mobile-drawer"
        >
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative bg-white w-72 h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{user?.tenant_name || "Panel"}</p>
                <p className="text-sm font-bold text-slate-800 truncate">{user?.name || user?.email}</p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-100"
                aria-label="Cerrar"
                data-testid="astrid-mobile-drawer-close"
              >
                <X className="h-5 w-5 text-slate-700" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={`astrid-nav-item ${active ? "active" : ""}`}
                    data-testid={`astrid-drawer-nav-${item.to.replace(/\//g, "-")}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={item.iconColor && !active ? { color: item.iconColor } : undefined} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="px-3 py-3 border-t border-slate-100">
              <button
                onClick={() => {
                  setMobileOpen(false);
                  handleLogout();
                }}
                className="astrid-nav-item w-full"
                data-testid="astrid-drawer-logout"
              >
                <LogOut className="h-4 w-4" />
                <span>Salir</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AstridSidebar;
