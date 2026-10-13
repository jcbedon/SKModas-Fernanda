# Test Credentials

## Admin
- identifier: admin@outletsusaec.com
- password: 123456

## Superadmin
- identifier: superadmin@outletsusaec.com
- password: super123

## Empleado (Maria)
- identifier: maria@outletsusaec.com
- password: empleado123

## Empleado Sin Valores Financieros (NUEVO)
- identifier: empleado_sindinero
- email: sindinero@test.com
- password: 123456
- Permiso especial: `hide_financial_values: true`
- Este empleado tiene acceso a todo pero los valores de dinero aparecen como "••••"

## Cliente seed (100 clientes, todos con la misma password)
- identifier: customer_id (ej: J2934, A2824, A5905)
- password: 123

## Tenant DEMO para pruebas (demo-pruebas) — data en todos los módulos
- Admin: admin@demo.com / demo123
- Clientes (login con customer_id): D1001 / 123 (Ana Torres, activo), D1002 / 123 (Luis Mora, activo), D1003 / 123 (Sofia Vega, inactivo)
- Contiene: 3 clientes, 12 facturas (4 semanas), 27 compras (1 sin facturar=mercadería estancada), 12 recargas (3 pendientes por aprobar), 4 envíos (estados variados), 2 cuentas bancarias, categorías de envío G/A/B con costo courier.
- MÓDULO LIVE: el tenant demo tiene `live_module_enabled=true`. Se crearon wallets para D1001/D1002/D1003 (requerido por compras). El tenant principal (outletsusaec) tiene el módulo DESACTIVADO por defecto.
