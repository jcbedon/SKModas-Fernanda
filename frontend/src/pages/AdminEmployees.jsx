import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { getEmployees, createEmployee, updateEmployee, deleteEmployee, getEmployeeDetail } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { toast } from "sonner";
import { Users, Plus, Edit, Trash2, Eye, EyeOff, Shield, UserCheck, UserX, ArrowLeft, User } from "lucide-react";

const PERMISSION_GROUPS = [
  {
    title: "Módulos principales",
    items: [
      { key: "manage_clients", label: "Gestionar Clientes", description: "Crear, editar y eliminar clientes" },
      { key: "manage_purchases", label: "Gestionar Compras", description: "Crear, editar y eliminar compras" },
      { key: "manage_lives", label: "Gestionar Lives", description: "Crear, iniciar y cerrar sesiones live" },
      { key: "approve_recharges", label: "Aprobar Recargas", description: "Aprobar o rechazar solicitudes de recarga" },
      { key: "assign_deposits", label: "Asignar Recargas a Facturas", description: "Reasignar manualmente recargas disponibles a facturas específicas del cliente" },
      { key: "manage_shipments", label: "Gestionar Envíos", description: "Crear y administrar envíos" },
      { key: "manage_invoices", label: "Gestionar Facturas", description: "Generar y aprobar facturas" },
      { key: "adjust_wallet", label: "Ajustar Saldos", description: "Realizar ajustes de saldo en wallets" },
      { key: "view_reports", label: "Ver Reportes", description: "Acceder a los reportes del sistema" },
    ],
  },
  {
    title: "Módulos administrativos",
    items: [
      { key: "manage_employees", label: "Empleados", description: "Acceso al módulo de empleados y permisos" },
      { key: "manage_referrals", label: "Referidos", description: "Configurar bonos de referidos" },
      { key: "manage_bank_accounts", label: "Cuentas Bancarias", description: "Acceso al ledger bancario" },
      { key: "view_audit", label: "Auditoría", description: "Ver registro de auditoría e historial" },
    ],
  },
  {
    title: "Visibilidad financiera",
    items: [
      { key: "hide_financial_values", label: "🔒 Ocultar valores de dinero", description: "Oculta TODOS los valores monetarios en la app: ventas, comisiones, ganancias, saldos, facturas, cuentas bancarias, estadísticas. El empleado ve la info pero sin montos." },
    ],
  },
  {
    title: "Estadísticas",
    items: [
      { key: "view_statistics", label: "Acceso al módulo Estadísticas", description: "Permite entrar a /admin/stats (toggle maestro)" },
      { key: "stats_view_money_kpis", label: "Ver KPIs de dinero (cabecera)", description: "Muestra las tarjetas de dinero (Ventas, Comisiones, Envíos) arriba del Dashboard y la cabecera de Estadísticas. Si está apagado, el empleado no ve esos números del negocio." },
      { key: "stats_resumen", label: "Pestaña: Resumen", description: "" },
      { key: "stats_tiendas", label: "Pestaña: Tiendas", description: "" },
      { key: "stats_deudas", label: "Pestaña: Deudas", description: "" },
      { key: "stats_inactivos", label: "Pestaña: Inactivos", description: "" },
      { key: "stats_graficas", label: "Pestaña: Gráficas", description: "" },
      { key: "stats_detalle", label: "Pestaña: Detalle", description: "" },
    ],
  },
];
// Flat list kept for backwards compatibility with any code still referencing it
const PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items);

export default function AdminEmployees() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";
  
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showPassword, setShowPassword] = useState({});
  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    whatsapp: "",
    password: "",
    permissions: {},
    status: "active"
  });

  useEffect(() => {
    loadEmployees();
  }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadEmployees());

  const loadEmployees = async () => {
    try {
      const response = await getEmployees();
      setEmployees(response.data);
    } catch (error) {
      toast.error("Error al cargar empleados");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (employee = null) => {
    if (employee) {
      setEditingEmployee(employee);
      setFormData({
        name: employee.name,
        username: employee.username || "",
        email: employee.email,
        whatsapp: employee.whatsapp || "",
        password: employee.password_plain || "",
        permissions: employee.permissions || {},
        status: employee.status
      });
    } else {
      setEditingEmployee(null);
      setFormData({
        name: "",
        username: "",
        email: "",
        whatsapp: "",
        password: "",
        permissions: {},
        status: "active"
      });
    }
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.email) {
      toast.error("Nombre y email son requeridos");
      return;
    }
    if (!editingEmployee && !formData.password) {
      toast.error("La contraseña es requerida para nuevos empleados");
      return;
    }

    try {
      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, formData);
        toast.success("Empleado actualizado");
      } else {
        await createEmployee(formData);
        toast.success("Empleado creado");
      }
      setDialogOpen(false);
      loadEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al guardar empleado");
    }
  };

  const handleDelete = async (employee) => {
    if (!confirm(`¿Eliminar a ${employee.name}?`)) return;
    try {
      await deleteEmployee(employee.id);
      toast.success("Empleado eliminado");
      loadEmployees();
    } catch (error) {
      toast.error("Error al eliminar empleado");
    }
  };

  const handleToggleStatus = async (employee) => {
    const newStatus = employee.status === "active" ? "inactive" : "active";
    try {
      await updateEmployee(employee.id, { status: newStatus });
      toast.success(`Empleado ${newStatus === "active" ? "activado" : "desactivado"}`);
      loadEmployees();
    } catch (error) {
      toast.error("Error al cambiar estado");
    }
  };

  const toggleShowPassword = (id) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handlePermissionChange = (key, checked) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: checked
      }
    }));
  };

  const countActivePermissions = (permissions) => {
    return Object.values(permissions || {}).filter(Boolean).length;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="app-bg min-h-screen">
      {/* Header con logo */}
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Empleados</span>
          <Button 
            onClick={() => handleOpenDialog()} 
            data-testid="add-employee-btn"
            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-lg rounded-xl"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Empleado
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {employees.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="py-12 text-center">
            <div className="bg-gradient-to-r from-indigo-100 to-purple-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="h-10 w-10 text-indigo-500" />
            </div>
            <p className="text-slate-500 mb-4">No hay empleados registrados</p>
            <Button 
              onClick={() => handleOpenDialog()}
              className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white"
            >
              Crear primer empleado
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {employees.map((employee) => (
            <Card 
              key={employee.id} 
              className={`overflow-hidden transition-all duration-200 hover:shadow-lg ${
                employee.status === "inactive" ? "opacity-60 bg-slate-50" : "bg-white"
              }`}
            >
              <div className={`h-1 ${employee.status === "active" ? "bg-gradient-to-r from-green-400 to-emerald-500" : "bg-slate-300"}`} />
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${
                      employee.status === "active" 
                        ? "bg-gradient-to-br from-green-100 to-emerald-100" 
                        : "bg-slate-100"
                    }`}>
                      {employee.status === "active" ? (
                        <UserCheck className="h-5 w-5 text-green-600" />
                      ) : (
                        <UserX className="h-5 w-5 text-slate-400" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-lg text-slate-800">{employee.name}</CardTitle>
                      <p className="text-sm text-slate-500">{employee.email}</p>
                    </div>
                  </div>
                  <Badge 
                    className={employee.status === "active" 
                      ? "bg-green-100 text-green-700 border-green-200" 
                      : "bg-slate-100 text-slate-600"
                    }
                  >
                    {employee.status === "active" ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Username for login */}
                <div className="flex items-center gap-2 bg-indigo-50 p-2 rounded-lg">
                  <User className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm text-indigo-700">
                    Login: <span className="font-mono font-semibold">{employee.username || employee.name}</span>
                  </span>
                </div>
                
                {employee.whatsapp && (
                  <p className="text-sm text-slate-600">WhatsApp: {employee.whatsapp}</p>
                )}
                
                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg">
                  <span className="text-sm text-slate-500">Contraseña:</span>
                  <code className="bg-white px-2 py-1 rounded text-sm font-mono border border-slate-200 flex-1">
                    {showPassword[employee.id] ? employee.password_plain : "••••••••"}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-indigo-600"
                    onClick={() => toggleShowPassword(employee.id)}
                  >
                    {showPassword[employee.id] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                <div className="flex items-center gap-2 bg-indigo-50 p-2 rounded-lg">
                  <Shield className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm text-indigo-700 font-medium">
                    {countActivePermissions(employee.permissions)} permisos activos
                  </span>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={employee.status === "active"}
                      onCheckedChange={() => handleToggleStatus(employee)}
                    />
                    <span className="text-sm text-slate-500">
                      {employee.status === "active" ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300"
                      onClick={() => handleOpenDialog(employee)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                      onClick={() => handleDelete(employee)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] bg-gradient-to-b from-white to-slate-50">
          <DialogHeader className="border-b pb-4">
            <DialogTitle className="text-xl font-bold text-slate-800 flex items-center gap-2">
              {editingEmployee ? (
                <>
                  <Edit className="h-5 w-5 text-indigo-500" />
                  Editar Empleado
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5 text-green-500" />
                  Nuevo Empleado
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Nombre *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Nombre completo"
                    className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                    data-testid="employee-name-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Usuario para login</Label>
                  <Input
                    value={formData.username}
                    onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/\s/g, '_') }))}
                    placeholder={formData.name ? formData.name.toLowerCase().replace(/\s/g, '_') : "usuario_ejemplo"}
                    className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                    data-testid="employee-username-input"
                  />
                  <p className="text-xs text-slate-500">El empleado usará esto para iniciar sesión (o su nombre)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Email *</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="email@ejemplo.com"
                    className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                    data-testid="employee-email-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">WhatsApp</Label>
                  <Input
                    value={formData.whatsapp}
                    onChange={(e) => setFormData(prev => ({ ...prev, whatsapp: e.target.value }))}
                    placeholder="+593999999999"
                    className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Contraseña {!editingEmployee && "*"}</Label>
                  <div className="relative">
                    <Input
                      type={showPassword.form ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                      placeholder={editingEmployee ? "Dejar vacío para mantener" : "Contraseña"}
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 pr-10"
                      data-testid="employee-password-input"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowPassword(prev => ({ ...prev, form: !prev.form }))}
                    >
                      {showPassword.form ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Label className="text-base font-semibold text-slate-800">Permisos</Label>
                <div className="space-y-5">
                  {PERMISSION_GROUPS.map((group) => {
                    const groupActive = group.items.filter((p) => formData.permissions[p.key]).length;
                    return (
                      <div key={group.title} data-testid={`permission-group-${group.title}`}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                            {group.title}
                          </p>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {groupActive}/{group.items.length}
                            </Badge>
                            <button
                              type="button"
                              onClick={() => {
                                const allOn = groupActive === group.items.length;
                                const next = { ...formData.permissions };
                                group.items.forEach((p) => { next[p.key] = !allOn; });
                                setFormData({ ...formData, permissions: next });
                              }}
                              className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                              data-testid={`toggle-group-${group.title}`}
                            >
                              {groupActive === group.items.length ? "Quitar todos" : "Marcar todos"}
                            </button>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          {group.items.map((perm) => {
                            const isChecked = formData.permissions[perm.key] || false;
                            return (
                              <div
                                key={perm.key}
                                onClick={() => handlePermissionChange(perm.key, !isChecked)}
                                className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 border-2 ${
                                  isChecked
                                    ? "bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-400 shadow-sm"
                                    : "bg-slate-50 border-transparent hover:bg-slate-100 hover:border-slate-200"
                                }`}
                                data-testid={`permission-${perm.key}`}
                              >
                                <div className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                                  isChecked
                                    ? "bg-gradient-to-r from-indigo-500 to-purple-500 shadow-md"
                                    : "bg-white border-2 border-slate-300"
                                }`}>
                                  {isChecked && (
                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </div>
                                <div className="flex-1">
                                  <Label htmlFor={perm.key} className={`font-medium cursor-pointer ${isChecked ? "text-indigo-900" : "text-slate-700"}`}>
                                    {perm.label}
                                  </Label>
                                  {perm.description && (
                                    <p className={`text-xs ${isChecked ? "text-indigo-600" : "text-slate-500"}`}>{perm.description}</p>
                                  )}
                                </div>
                                {isChecked && (
                                  <div className="text-indigo-500">
                                    <Shield className="h-4 w-4" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-300">
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmit} 
              data-testid="save-employee-btn"
              className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md"
            >
              {editingEmployee ? "Guardar Cambios" : "Crear Empleado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
