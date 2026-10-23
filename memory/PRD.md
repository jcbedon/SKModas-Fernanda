# PRD — Outlets USA EC (Personal Shoppers SaaS)

## Problem Statement
Multi-tenant SaaS para personal shoppers con live shopping, wallets, facturación dinámica, shipments y portal de clientes.

## Personas
- Superadmin · Admin tenant · Empleado · Cliente

## Stack
- Frontend: React + Tailwind + Shadcn UI
- Backend: FastAPI + Motor (MongoDB)
- AI OCR: emergentintegrations (Gemini Vision)
- PDFs: jsPDF · Object Store: Emergent internal

## Changelog (Oct 2026)
- **[16-oct-2026]** **Reporte de Abonos y Consumos por Cliente**:
  - Nueva funcionalidad en Gestión de Recargas → pestaña "Reporte".
  - Sub-tabs: "Abonos y Consumos" (nuevo, verde) y "Detalle Recargas" (existente, azul).
  - Muestra lista consolidada de clientes con: Total Abonado (recargas aprobadas), Total Consumido (compras + envíos), Saldo (diferencia).
  - KPIs: Total Abonado, Total Consumido, Saldo Total (a favor o deuda), Cantidad de clientes.
  - Búsqueda por nombre, ID o WhatsApp.
  - Botón "Descargar PDF" genera reporte profesional con:
    - Header con nombre del tenant y fecha de generación.
    - Tabla con columnas: Cliente, ID, WhatsApp (clickeable), Abonado, Compras, Envíos, Consumido, Saldo.
    - Colores: verde para saldo a favor, rojo para deuda.
    - Resumen al final con totales.
  - Backend: nuevo endpoint `GET /api/wallet/client-balance-report`.
  - Frontend: nuevo componente `ClientBalanceReport.jsx` + `clientBalanceReportPDF.js`.
- **[11-oct-2026]** **Rediseño completo de la página de login (Didier Shop)**:
  - Nuevo diseño elegante con fondo negro satinado (#08090B) y líneas luminosas rosa suave.
  - Video promocional con controles personalizados (play/pause, mute, seek, fullscreen).
  - Formulario de login con efecto glassmorphism, borde rosa luminoso y gradiente superior rosa.
  - Botón principal rosa (#F3AEC3) con texto negro.
  - Dos botones de WhatsApp: Ecuador (+593998541082) y USA (+12019954770).
  - Sin opción "¿Olvidaste tu contraseña?".
  - Footer con iconos: 100% Seguro, Envíos confiables, Soporte personalizado (solo desktop).
  - Layout responsive: 2 columnas en desktop (62% video + 38% form), 1 columna en móvil.
  - Fuente Poppins agregada para títulos.
  - Funcionalidad de login intacta (no se modificó backend ni redirecciones).
- **[11-oct-2026]** **Formulario de creación de clientes mejorado**:
  - Email vacío por defecto con placeholder "cliente@email.com" y texto explicativo.
  - Contraseña ahora es **opcional** — si se deja vacía, el cliente no puede loguearse hasta que se le asigne una. Campo destacado en recuadro gris con icono de llave.
  - Comisión por defecto cambiada de $3 a **$0** — campo destacado en recuadro verde con icono de dólar y texto explicativo.
  - Backend: `AdminClientCreate.password` ahora es `Optional[str]`, `commission_fee` default 0. Modelo `User.password_hash` ahora es `Optional[str]`.

## Changelog (Feb 2026)
- **[13-feb-2026]** **Fix crítico recalc respeta asignaciones históricas** (commit 6a53481): `recalculate_client_invoices` ahora tiene 3 niveles de prioridad — (1) manual `target_invoice_id`, (2) snapshot de `invoice.applied_deposits[]` previos si la factura sigue no-anulada, (3) corte semanal Mon-Sun. Antes: al ejecutar recalc, todos los depósitos históricos (asignados bajo lógica pre-corte-semanal) quedaban flotantes → ejemplo J2934 tenía $314 flotantes falsos y deuda inflada +$186. Ahora: recalc conserva la data histórica intacta, y solo los depósitos verdaderamente nuevos sin factura misma-semana quedan flotantes. Validado via 11/11 tests en `/app/backend/tests/test_recalc_preserves_historic.py`.
- **[08-feb-2026]** Fix truncamiento histórico: `.to_list(100)` y `.to_list(500)` reemplazados por `.to_list(20000)` en 25 endpoints (recargas, lives, shipments, invoices, empleados, audit logs, etc.). Restaura el fix previo que el rollback a Aug-21 había revertido. Validado: `/api/wallet/all-deposits` ahora devuelve 309 depósitos con historial completo desde Feb 8 — antes cortaba en 100.
- **[08-feb-2026]** Fix visibilidad `floating_deposits`: el cálculo en `GET /api/wallet/{id}` ahora NO depende de `invoice.applied_deposits[]` (que puede quedar obsoleto tras un cambio de reglas sin recalc). En cambio recorre las recargas aprobadas y para cada una computa `_billing_week_bounds()`; si esa semana Mon-Sun (GYE) no tiene invoice no anulado → cuenta como flotante. Determinístico y siempre correcto. Cierra el bug del cliente #L4 en producción que tenía una recarga de $104.15 y mostraba $0 disponible.
- **[08-feb-2026]** UI simplificada del wallet en ClientDashboard: eliminado el grid de 2 columnas ("Debes" + "Tienes disponible"). Ahora solo la cifra grande arriba (Saldo Neto a Favor o Debes en Total) + un texto pequeño debajo "Saldo disponible para compras esta semana: $X" con `data-testid="wallet-available-inline"`. Más limpio y directo.
- **[08-feb-2026]** Wallet card del cliente rediseñada para claridad: (1) Título dinámico "Saldo Neto a Favor" (verde) o "Debes en Total" (rojo) según `netPosition = (saldo_a_favor + floating_deposits) − pending_debt`. (2) Grid de 2 sub-tarjetas debajo — **Debes $X** (roja, deuda última factura, `wallet-owes`) y **Tienes disponible $Y** (verde, saldo_a_favor + recargas flotantes, `wallet-available`) con leyenda explicativa que discrimina si viene de saldo a favor, de recargas sin aplicar, o de ambos. Ahora el cliente ve a la vez cuánto debe y cuánto tiene disponible para próximas facturas.
- **[08-feb-2026]** Permiso granular `assign_deposits` en el módulo de Empleados: (1) `EmployeePermissions` modelo agrega el campo boolean. (2) Endpoint `PUT /api/wallet/deposit/{id}/assign-invoice` bloquea a empleados sin el permiso (403 "No tienes permiso para asignar recargas a facturas"). (3) `AdminEmployees` muestra el checkbox "Asignar Recargas a Facturas" en la sección de módulos principales. (4) `AdminClients` frontend: la pill "Recargas Disponibles" es botón clickeable solo si el usuario tiene el permiso (admin siempre lo tiene); sin permiso muestra la misma info pero como texto plano. Admin `canAssignDeposits = isAdmin || user.permissions.assign_deposits`.
- **[08-feb-2026]** **Cierre de semana dominical (v2)** activo: recalc ahora usa `_billing_week_bounds()` (Mon 00:00 – Sun 23:59 America/Guayaquil, UTC-5) para asignar depósitos. Un depósito solo auto-aplica a facturas de su MISMA semana calendario; si no hay factura esa semana → queda flotante ("Recargas Disponibles") hasta que se cree una en la próxima semana. Manual override sigue disponible via `target_invoice_id`. Cambio importante: al re-ejecutarse el recalc para un cliente antiguo, sus depósitos históricos pueden reasignarse según semanas → conviene correr "Recalcular Todo" en producción para dejar la BD consistente después del Publish.
- **[08-feb-2026]** Feature "Recargas Disponibles + reasignación manual": (1) recalc ahora deja como flotantes las recargas creadas DESPUÉS de la última factura no anulada — no reducen deuda de facturas viejas automáticamente. (2) Modelo `WalletTransaction` con `target_invoice_id: Optional[str]` que overridea la lógica por fecha. (3) `/api/admin/clients` y `/api/wallet/{id}` exponen `floating_deposits`. (4) Nuevo endpoint `GET /api/wallet/floating-deposits/{customer_id}` lista el detalle de recargas sin asignar. (5) Nuevo endpoint `PUT /api/wallet/deposit/{tx_id}/assign-invoice` que set/unset `target_invoice_id` y dispara recalc. (6) `AdminClients` pill sky-blue "Recargas Disponibles: $X → Asignar" clickeable abre diálogo `reassign-recharge-dialog` con lista de recargas flotantes izquierda + facturas pendientes/cerradas derecha. (7) `ClientDashboard` banner cyan visible cuando hay flotantes. Validado en preview con A2824 (4 flotantes / 1 factura pendiente) end-to-end.
- **[05-may]** **Cascada `saldo_pendiente` dinámica** (`recalculate_client_invoices`): ahora la deuda heredada se propaga entre facturas vivas en cada recálculo. Antes el campo `saldo_pendiente` quedaba congelado al crear la factura, y al anular una factura intermedia, las posteriores conservaban deuda inflada. Ahora F(n+1).saldo_pendiente = F(n).total_a_pagar de la factura viva anterior. La primera factura conserva su `saldo_pendiente` original (puede ser deuda legacy de onboarding). Tests en `/app/backend/tests/test_recalc_chain.py` cubren: cadena completa, anulación intermedia, depósitos en cadena, saldo a favor sobrante.
- Inline editing purchase items + sync LIVE.
- Auto-recalculo de `saldo_a_favor` en cadenas de facturas.
- Shipments mapeados 1-a-1 a invoices.
- Toggle tenant Paquetes/Libras (Superadmin).
- Wallet recharges con Gemini Vision OCR.
- Mobile tabs con labels + QR uploads.
- PDFs unificados con breakdown de Saldo a Favor.
- Fallback message en Client Dashboard cuando IA detecta $0.
- Shipping categories con **precios independientes por modo** (packages/pounds).
- **[hoy]** PDFs:
  - Fix: contenido ya no se corta abajo cuando hay muchos items/líneas financieras (paginación con `ensureSpace`, redibujo del container en cada página, footer garantizado al final).
  - Fix: PDF siempre re-consulta la factura al backend antes de generar → si el admin quitó un ítem o editó un precio, el PDF refleja los valores correctos.
- **[hoy]** Backend `remove_item_from_invoice` y `update_purchase` ahora disparan `recalculate_client_invoices` → `total_a_pagar`, `saldo_a_favor`, `saldo_pendiente` y `applied_deposits` se actualizan automáticamente en toda la cadena.
- **[27-feb]** Envíos Pendientes: filtro semanal en formato corto (lunes 12:00 → lunes 12:00) con KPIs dinámicos.
- **[27-feb]** Clientes: botón **Mostrar/Ocultar contraseña actual** en el modal Editar Cliente.
  - Backend: nuevo campo `password_plain` en `User` + endpoint `GET /admin/clients/{user_id}/password`.
  - Se llena al crear cliente (admin o self-register) y al cambiar la contraseña.
  - Para clientes legacy (antes de esta fecha) se muestra mensaje "No disponible — restablece la contraseña".
- **[27-feb]** Backend: `NoCacheMiddleware` agregado antes de `CORSMiddleware` → todas las respuestas `/api/*` traen `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0`.
- **[27-feb]** **Permisos de empleado en vivo VERIFICADO**: `/auth/me` devuelve permisos frescos para empleado y admin; al refrescar la página, la UI hidrata las nuevas tarjetas (Facturas/Envíos) sin re-login. Confirmado E2E con screenshots.
- **[28-feb]** **Auto-refresh on tab focus**: nuevo hook `useRefreshOnTabFocus` cableado a las 12 páginas principales (AdminDashboard, AdminStats, AdminLive, AdminShipments, AdminWallet, AdminInvoices, AdminClients, AdminEmployees, AdminAuditLog, AdminReferrals, ClientDashboard, SuperadminDashboard). Cuando el usuario regresa a la pestaña, la página recarga su data automáticamente. Verificado E2E disparando `visibilitychange` (pasó de 4 → 6 fetches a `/api/admin/clients`).
- **[28-feb]** **Audit + Historial**:
  - `delete_purchase` ahora registra audit log con snapshot completo (cliente, tienda, live, ítem, monto, quién eliminó). Se guarda **antes** del delete para preservar el contexto.
  - Eventos `login` ocultos del feed de auditoría (siguen en BD para forensics).
  - Nueva pestaña **Historial** en `/admin/audit`: 3 secciones (Productos Eliminados, Facturas Anuladas, Recargas Aprobadas) con rango 7/14/30/60/90 días, KPIs y filtro de texto unificado. Para deletes anteriores al fix se muestra un fallback desde `wallet_transactions` tipo refund (etiquetado `legacy`, sin tienda/live).
  - Endpoint `GET /admin/audit-logs/history?days=N`.
- **[28-feb]** **Restaurar producto eliminado**: endpoint `POST /admin/audit-logs/restore-purchase/{audit_log_id}` que recrea el `purchase` desde el snapshot, revierte el reembolso (`wallet_transactions` is_deleted + `wallets.available -= amount`), restaura totales del live y dispara `recalculate_client_invoices`. Marca el audit log original como `restored=true` para evitar doble-restore. Verificado E2E: balance vuelve a su estado original ($17.24 → $99.74 → $17.24).
- **[28-feb]** **`delete_purchase` ahora actualiza la factura asociada**: si el producto pertenece a una factura, se quita del `purchase_ids`, se recalculan `subtotal/total_tax/total_commission/total` (mismo patrón que `remove_item_from_invoice`) y se llama a `recalculate_client_invoices` para mantener saldos consistentes en toda la cadena. Verificado E2E: factura 2-items → eliminar 1 → factura queda con 1-item, totales correctos, saldo a favor del cliente actualizado.
- **[28-feb]** **Preview de eliminación de producto**: nuevo endpoint `GET /api/purchases/{id}/delete-preview` y `AlertDialog` en `AdminLive.jsx` que muestra antes de confirmar: producto + tienda + cliente, monto del reembolso, factura asociada (si la hay) con conteo de ítems y total antes/después, y aviso especial si es el último ítem (caja roja). Verificado E2E.
- **[28-feb]** **Recalcular factura desde el diálogo de Auditoría**: el endpoint `POST /invoices/{id}/recalc` ahora recompone también `subtotal/total_tax/total_commission/total` desde las purchases vivas, limpia ids huérfanos y luego dispara el chain. Botón "Recalcular factura" siempre visible al inicio del modal de Auditoría (caja azul). Verificado E2E corrompiendo la factura en BD: subtotal $999.99→$75, total $9999.99→$80, 1 id fantasma limpiado.
- **[28-feb]** **Cliente Revisado**: nuevo flag `reviewed` en `User`, endpoint `PUT /admin/clients/{user_id}/toggle-reviewed`, checkbox al lado de "Activo" en la lista de clientes; cuando está marcado, el nombre se resalta con fondo verde claro. Persistente entre reloads.
- **[28-feb]** **Editar envío con categorías y modo dinámico**: `ShipmentEditDialog` ahora recibe `tenantSettings` y muestra selector de categoría (G/A/B/OTHER), input dinámico de Paquetes/Libras según `shipping_mode`, y costo total auto-recalculado (editable manualmente). Backend `ShipmentUpdate` extendido con `shipping_category`, `shipping_unit_cost`, `package_count`, `tracking_numbers` (array). Verificado E2E.
- **[28-feb]** **Origen de Live en compras pendientes**: el endpoint `GET /invoices/client/{customer_id}/pending-purchases` ahora devuelve `live_title` y `live_status` enriqueciendo cada compra con el nombre del Live de origen. En el modal Nueva Factura cada compra muestra un badge violeta con icono 📡 + nombre del Live (o badge gris "Sin live" si fue registro manual). Permite distinguir productos de distintos Lives en la misma tienda. Verificado E2E.
- **[28-feb]** **Cantidad de artículos en Factura de Tienda**: nuevo campo `store_invoice_items_count: int` en el modelo Live. Endpoint `PUT /lives/{id}/store-invoice` lo acepta opcional y preserva el valor cuando solo se actualiza el monto. Frontend `StoreInvoiceSection` añade input con icono 📦 + helper "Registrados a clientes: N" comparando con `purchase_count`. Útil cuando compras 30 ítems en la tienda pero distribuyes solo 15 a clientes. Verificado E2E.
- **[28-feb]** **Diagnóstico de origen en compras pendientes**: el badge ahora distingue 3 casos (`with_live`, `deleted_live`, `no_live`) en lugar de 2. Compras de Live eliminado muestran badge ámbar "Live eliminado" con el `live_id` truncado en el tooltip. Nuevo endpoint `GET /admin/diagnose-pending/{customer_id}` que lista cada compra con su origen, fecha, monto y datos del live (cuando existe). Útil para auditar diferencias entre conteos del Live y la Factura.
- **[28-feb]** **Bug de productos LIVE duplicados — fix de race condition**: agregado guard sincrónico (`useRef`) en `handleSubmitPurchase` y `actuallySubmitPurchase` que bloquea instantáneamente segundas invocaciones cuando el usuario hace doble-click o spamea Enter. Antes el `disabled={submitting}` no protegía porque `setSubmitting(true)` ocurría asíncronamente dentro de `actuallySubmitPurchase`, dejando una ventana de race en la que el segundo evento iniciaba un `createPurchase` paralelo que duplicaba el producto. Liberación del lock en el `finally`.
- **[28-feb]** **Live ID parcial en badge violeta**: el badge de origen del Live ahora muestra `#xxxxxx` (los primeros 6 caracteres del UUID) además del título, para distinguir cuando dos Lives tienen el mismo nombre. Endpoint `POST /purchases/{id}/reassign-live` listo en backend para mover compras huérfanas a un Live activo (UI pendiente de cablear).
- **[28-feb]** **🐛 BUG MAYOR FIXEADO — Live cortaba a 500 compras**: el endpoint `GET /purchases/live/{live_id}` tenía `.to_list(500)`. Para Lives de alto volumen (ej: COSTCO con 500+) las compras más antiguas no se mostraban en la vista del Live, mientras que el modal de Factura sí las traía completas (otro endpoint distinto). Esto explicaba por qué el cliente AH8 aparecía con 6 compras en el Live COSTCO pero la factura traía 11 del mismo Live. Aumentado a `.to_list(5000)`.
- **[28-feb]** **Tarjeta Paquetes con conteo de envíos**: el endpoint `/admin/reports/summary` ahora también devuelve `shipments_count`. La tarjeta del dashboard muestra "{N} Paquetes · {M} envíos" para distinguir cajas vs documentos de envío. Soluciona la confusión cuando un envío con `package_count=22` parece "muchos envíos".
- **[29-abr]** **Creador del envío en tarjeta + filtro semanal por defecto**:
  - Backend: nuevos campos `created_by` y `created_by_name` en el modelo `Shipment`. Se setean al crear desde `current_user` (lookup en `users`/`employees`). El endpoint `GET /api/shipments` rellena `created_by_name` para envíos antiguos vía batch lookup.
  - Frontend: badge azul con ícono de usuario en cada tarjeta de envío al lado de la fecha (oculto si el envío legacy no tiene creador registrado).
  - `weekFilter` ahora arranca por defecto en la **semana actual** (lunes 12:00 → lunes 12:00) en lugar de "Todas". La semana actual siempre aparece en el dropdown aunque no haya envíos en ella.
- **[29-abr]** **Verificar Paquetes vs Guías Creadas** (`/admin/packages-report`):
  - Botón "Verificar Paquetes vs Guías" en el header de la página de detalle de paquetes (gradient naranja, icono `ClipboardCheck`).
  - Diálogo modal con: filtro de semana (lunes 12:00 → lunes 12:00, **default = semana actual**, siempre incluida en el dropdown aunque no haya envíos), 4 KPIs (paquetes totales, guías creadas, % cobertura, envíos pendientes sin guía), **fila de chips con totales de facturas (aprobadas/pendientes/anuladas/sin factura)**, y lista de envíos **agrupados por cliente** mostrando para cada uno: ✓ verde si tiene guía / ⚠ rojo si no, fecha+hora, nombre del creador (badge azul para reales / ámbar `(est.)` para legacy), categoría, cantidad de paquetes/libras, conteo de guías y **chip de estado de factura** (verde "✓ Aprobada", ámbar "Pendiente", gris "Anulada" o "Sin factura"). Cada grupo muestra un badge "Completo" verde si todos sus envíos tienen guía o "N pendiente(s)" ámbar si faltan.
  - Heurística de "tiene guía": `tracking_numbers.length > 0` con fallback a `tracking_number` legacy.
  - Backend: `GET /api/shipments` ahora enriquece la respuesta con `invoice_status` (`approved`/`pending`/`annulled`) e `invoice_number` vía batch lookup en `db.invoices`.
  - Default `weekFilter` de la página principal también cambiado a la semana actual.
- **[29-abr]** **Diálogo de anulación con preview del envío vinculado**:
  - Bug: al anular una factura, el envío vinculado solo quedaba **desvinculado** (sin factura asociada) pero seguía existiendo. El admin tenía que recordarlo y eliminarlo manualmente.
  - Fix backend: nuevo endpoint `GET /api/invoices/{id}/annul-preview` (admin-only) devuelve invoice + shipment + purchases + conteos. `PUT /api/invoices/{id}/annul` ahora acepta `{"delete_shipment": true|false}` — si `true` elimina el shipment y registra audit log `delete_shipment` con `triggered_by: "invoice_annulment"`; si `false` solo desvincula (comportamiento anterior para compatibilidad).
  - Fix frontend: el diálogo de anulación ahora precarga el preview y muestra en caja ámbar todos los datos del envío (categoría, paquetes/libras, costo, estado, fecha creación, creador, guías) con un **checkbox** "Eliminar también el envío (recomendado)" activado por defecto. También preview de compras que vuelven a pending. Botón cambia entre "Eliminar factura + envío" y "Eliminar factura" según el toggle.
  - Verificado E2E con curl: endpoint `/annul-preview` devuelve `counts: {purchases: 1, deposits_freed: 0, has_shipment: true}` con shipment completo ($128, 4 paquetes) para factura J2934-015.
- **[29-abr]** **Diagnóstico de Factura — Timeline completo** (`InvoiceDialog` → botón ámbar `Stethoscope`):
  - Backend: nuevo endpoint admin `GET /api/admin/diagnose-invoice/{invoice_id}` que retorna estado actual de la factura, linked purchases (incluidos soft-deleted), shipment vinculado, **toda la cadena de facturas del cliente** (para ver la cascada de saldos), todas las transacciones de wallet del cliente, todos los audit logs relacionados (de la factura, sus compras, su shipment) + los audit logs de **otras facturas en la cadena** (anulaciones/aprobaciones que disparen recálculo).
  - Frontend: nuevo componente `InvoiceDiagnosticDialog.jsx` con:
    - Estado actual de la factura (todos los campos financieros).
    - **Cadena de facturas del cliente**: lista cronológica con totales, envíos, saldos anteriores, depósitos aplicados y total a pagar — la factura actual destacada en ámbar.
    - **Compras vinculadas**: incluye soft-deleted con badge ELIMINADA y line-through.
    - **Depósitos del cliente**: lista de wallet_transactions con badges según estado.
    - **Timeline unificado**: eventos de toda la factura + cadena en orden cronológico inverso, cada uno con badge coloreado por tipo de acción (`create_purchase`, `delete_purchase`, `update_purchase`, `invoice_annulled`, `wallet_deposit_*`, etc.), usuario que lo hizo y `<details>` colapsable con detalles JSON.
    - Caja indigo con guía de interpretación.
  - **Verificación E2E**: factura J2934-015 → 21 facturas en cadena, 18 audit logs en cadena (5 anulaciones → cascada), 13 wallet txs, 31 eventos totales en el timeline.
- **[29-abr] (v2)** **Fix definitivo: PDF usaba valor persistido stale del backend**:
  - Aunque `recalculate_client_invoices` ya sincroniza `shipping_cost` desde el shipment, el valor `inv.total_a_pagar` persistido en BD podía estar obsoleto si el recalc corrió antes del fix o si alguna operación posterior desactualizó el campo. El UI calculaba `total_a_pagar` **localmente** con la fórmula correcta, mientras que el PDF confiaba en `inv.total_a_pagar` del backend → divergían.
  - **Fix**: PDF (`invoicePDF.js`), listado de facturas (`AdminInvoices.jsx`) y diálogo de factura (`InvoiceDialog.jsx`) ahora **todos** usan la misma fórmula local:
    ```
    total_a_pagar = max(0, subtotal + commission + tax + shipping + saldo_pendiente − deposits − saldo_a_favor_anterior)
    saldo_a_favor = max(0, credits − grandTotal)
    ```
  - El campo `inv.total_a_pagar` del backend queda como "referencia informativa" pero nunca se usa para render. Consistencia garantizada independiente de cuándo/cómo corrió el recalc.
  - **Verificación**: mismo caso de Paola — `grandTotal = 460.13 + 62 + 43.67 + 84 + 292.01 = $941.81`. `credits = 751.32 + 0 = $751.32`. `total_a_pagar = $190.49` en UI, listado y PDF.
- **[29-abr]** **Fix: PDF y listado de facturas mostraban valores diferentes después del recalc**:
  - **Causa raíz #1**: `recalculate_client_invoices` calculaba `total_a_pagar` usando `invoice.shipping_cost`, pero el costo real estaba en `shipment.shipping_cost`. Si el shipment se creaba/editaba después de la factura, el invoice.shipping_cost quedaba en 0 → `total_a_pagar` quedaba mal calculado.
  - **Causa raíz #2**: El listado de facturas (`/admin/invoices`) mostraba `invoice.total` (solo items) mientras el PDF mostraba `total_a_pagar` (items + envío + saldo_pendiente − depósitos − saldo_a_favor_anterior). Cuando había créditos acumulados, divergían visualmente.
  - **Causa raíz #3**: `update_invoice_saldo_pendiente` actualizaba `saldo_pendiente` pero NO disparaba la cadena de recálculo → `total_a_pagar` quedaba stale.
  - **Causa raíz #4**: Frontend `handleRecalcInvoice` actualizaba `currentInvoice` pero no reseteaba el estado local `editSaldoPendiente`, causando que el UI usara el valor viejo del input mientras el PDF usaba el nuevo del backend.
  - **Fixes**:
    1. `recalculate_client_invoices` ahora hace batch lookup de shipments por `invoice_id` y usa el `shipping_cost` del shipment como fuente de verdad. También persiste de vuelta al `invoice.shipping_cost` para que listado/PDF siempre coincidan.
    2. Listado de facturas ahora muestra `total_a_pagar` como número grande, con subtítulo `items: $X · saldo: -$Y` cuando difieren del total bruto. Tooltip explica la composición.
    3. `update_invoice_saldo_pendiente` ahora dispara `recalculate_client_invoices` después de modificar el campo.
    4. `handleRecalcInvoice` resetea `editSaldoPendiente` con el valor fresco del backend.
  - **Verificación E2E**: factura J2934-015 con `total=$44`, `shipping=$128`, `saldo_a_favor_anterior=$249` → `total_a_pagar=$0` (correcto: créditos cubren todo, queda $77 de crédito para la próxima). PDF, listado y diálogo ahora muestran el mismo valor.
- **[29-abr]** **Diagnóstico profundo de envíos** (`/admin/shipments` → botón ámbar "Diagnóstico"):
  - Backend: nuevo endpoint `GET /api/admin/diagnose-shipments?start_date=&end_date=` (admin-only) que devuelve para un rango ISO:
    - `shipments_created_in_range`: envíos cuyo `created_at` cae en el rango, con metadata cruda de Mongo (`raw_created_at`, `raw_updated_at`, `created_by`, `created_by_name`, audit logs correlacionados con `entity_type=shipment`).
    - `shipments_updated_only_in_range`: envíos con `created_at < start_date` pero `updated_at` en rango (los "editados pero no creados aquí").
    - `summary`: KPIs de cuántos tienen `created_by` registrado y cuántos tienen audit log de `create_shipment`.
  - Frontend: botón "🩺 Diagnóstico" al lado del filtro de semana en `/admin/shipments`. Diálogo modal muestra 4 KPIs, sección "Cómo leer este diagnóstico" con interpretación, lista detallada de envíos con `created_at` raw, `updated_at` raw, `created_by` (verde/rojo), audit log (verde/rojo) y `<details>` colapsable con historial completo de auditoría por envío.
  - Permite al admin verificar con datos crudos de la BD si un envío realmente fue creado en una semana o solo modificado, y si producción tiene el código nuevo (audit log de `create_shipment`) o el viejo (sin audit log → "creator NULL legacy").
- **[29-abr]** **Verificación manual de guías físicas (papel en mano)**:
  - Backend: nuevos campos en `Shipment`: `guide_verified: bool`, `guide_verified_at`, `guide_verified_by`, `guide_verified_by_name`. Endpoint nuevo `PUT /api/shipments/{id}/verify-guide` que acepta `{"verified": true|false}` (o toggle si no se envía body). Snapshot del actor que verificó. Verificado E2E con curl: ON marca con timestamp + nombre, OFF limpia los campos.
  - Frontend: la caja de check del verificador es **clicable**. Click → toggle optimista, llama al endpoint, muestra toast. Tooltip indica quién verificó y cuándo. Es **independiente** del campo `tracking_numbers`: este check refleja la confirmación física del operador ("tengo el papel en la mano"), no la presencia de tracking en la BD.
  - KPIs y % cobertura ahora se calculan sobre `guide_verified === true` (no sobre tracking presence).
  - Texto del lado derecho de cada fila cambia entre "✓ Guía verificada" (verde) y "Sin verificar" (rojo).
- **[29-abr]** **Verificar Paquetes vs Guías — chips clicables y panel "Facturas sin paquete"**:
  - **Chips de estado de factura ahora son botones filtro**: click sobre "✓ Aprobadas / ⌛ Pendientes / ✕ Anuladas / — Sin factura" filtra la lista agrupada por cliente debajo. Click de nuevo desactiva el filtro. Indicador "mostrando N de M" cuando hay filtro activo. Botón "Todas (N)" siempre presente para reset rápido.
  - **Check de "Guía creada" más visible**: cada fila ahora muestra una caja cuadrada de 28x28 con borde verde y `CheckCircle2` cuando hay guía, o caja blanca con borde rosa y `AlertCircle` cuando falta. Mucho más fácil de escanear visualmente.
  - **Panel "Paquetes vs Facturas"** dentro del diálogo: 2 mini-KPIs (envíos con factura asignada vs facturas sin paquete) más un `<details>` colapsable con el listado completo de facturas sin paquete agrupado por cliente. Cada factura muestra: número, fecha, estado (aprobada/pendiente) y total. Datos vienen del endpoint existente `GET /admin/reports/invoices-without-shipment`. Verificado E2E: 5 facturas sin paquete en 4 clientes.
- **[29-abr]** **Fix: filtros del Dashboard usan SOLO `created_at` (no fecha de modificación)**:
  - Bug: el selector de semanas pasadas (w1, w2, …) en el dashboard llamaba a `/admin/reports/summary?period=week` sin importar la semana elegida → siempre devolvía datos de la **semana actual**. El usuario veía "el mismo total" en todas las semanas y conclusión incorrecta de que se contaban fechas de modificación.
  - Backend: `/admin/reports/summary` ahora acepta `start_date`/`end_date` ISO opcionales que **sobrescriben** el cálculo automático de semana. Filtra estrictamente por `created_at` (la fecha de creación nunca se modifica al editar shipments/purchases/invoices).
  - Backend: `total_shipping` ahora se calcula directamente desde `shipments.shipping_cost` filtrado por `shipment.created_at` (antes lo agregaba desde `invoices.shipping_cost`, lo que atribuía el costo a la semana de creación de la factura aunque el envío se creara semanas después).
  - Frontend: `getReportsSummary(period, startDate, endDate)` y `AdminDashboard.loadData` resuelven el rango Monday→Monday cuando se pica `wN` y lo envían al backend.
  - Verificado E2E con curl: rangos diferentes devuelven counts distintos (semana actual: 0 / hace 2 semanas: 0 / all-time: 6 envíos · 10.5 paquetes · $252.50).
- **[29-abr]** **Auditoría completa — todas las acciones del combobox**: el dropdown listaba 23 acciones pero solo ~8 registraban eventos realmente. Agregadas llamadas a `log_audit_action` en los endpoints faltantes:
  - **Clientes**: `create_client`, `update_client`, `delete_client`
  - **Compras**: `create_purchase`, `update_purchase`
  - **Envíos**: `create_shipment` (en sesión anterior), `update_shipment`, `delete_shipment`
  - **Facturas**: `create_invoice`, `approve_invoice`, `reopen_invoice`, `invoice_annulled` (refactorizado para usar el helper `log_audit_action` y guardar `user_role` + `details` como dict en vez de string)
  - **Lives**: `create_live`, `start_live`, `end_live`
  - Helper nuevo `get_actor_name(user_id)` que resuelve el nombre del actor en `users` con fallback a `employees` y "Sistema". Verificado E2E con curl creando/iniciando/finalizando un live de prueba: cada acción aparece en `/api/admin/audit-logs?action=<X>` con `user_name`, `user_role`, `entity_name` y `details` correctos.
- **[29-abr]** **Fallback legacy en envíos antiguos**: para envíos creados antes del nuevo modelo, el endpoint `GET /api/shipments` atribuye el creador al **admin primario del tenant** (más antiguo del rol `admin`) y devuelve `created_by_legacy: true`. La UI los renderiza con badge **ámbar** y sufijo "(est.)" para distinguirlos de los datos reales.

## Roadmap
### P0 técnico
- Refactor `server.py` (5400+ líneas) → routers modulares.
- Refactor `InvoiceDialog.jsx` (~1500 líneas).

### P1
- Email notifications facturas/shipments.
- Validar vista de facturas Anuladas (E2E test pending).

### P2
- WhatsApp Cloud API · PWA instalable.

### P3
- AI OCR confidence indicator en Admin Wallet.

## Changelog (May 2026)
- **[23-may]** **Flujo OCR Banking "Sin asignar" VERIFICADO E2E**:
  - Backend: `_find_matching_bank_account` requiere match doble (último-4 cuenta + token de owner), `GET /admin/bank-accounts/unassigned-recharges` lista recargas aprobadas sin `bank_account_id` con sugerencia de cuenta, `PUT /admin/wallet-transactions/{tx_id}/assign-bank-account` reasigna y sincroniza el `bank_transactions` ledger (delete old + insert new). `GET /admin/bank-accounts/summary` expone `unassigned_recharges_count`.
  - Frontend: `/admin/bank-accounts` muestra banner "N recarga(s) sin cuenta asignada" + modal "Recargas sin cuenta identificada" con dropdown por fila y botón "Asignar".
  - Probado: 17 → 16 sin asignar al asignar 1; reasignar de Pichincha → Guayaquil mueve el saldo correctamente; validaciones 404 para tx/cuenta inválidas.

## Known Env Issues
- Object Store falla al init en preview; OK en producción.

## Key Files
- `/app/backend/server.py`
- `/app/frontend/src/lib/invoicePDF.js`
- `/app/frontend/src/lib/bankStatementPDF.js`
- `/app/frontend/src/lib/courierManifestPDF.js`
- `/app/frontend/src/components/InvoiceDialog.jsx`
- `/app/frontend/src/pages/ClientDashboard.jsx`
- `/app/frontend/src/pages/AdminShipments.jsx`
- `/app/frontend/src/pages/AdminWallet.jsx`
- `/app/frontend/src/pages/AdminBankAccounts.jsx`
- `/app/frontend/src/pages/SuperadminDashboard.jsx`

## 2026-06 — Fix banner + solape sidebar
- Banner hero (`AstridHeroBanner.jsx`): cambiado de `object-fit: cover` a `contain` para mostrar la composición completa sin recorte agresivo; fondo limpio `#F7F8FA`, centrado, alturas 360px desktop / 420px ≥1440 / 240px móvil / 200px <400px.
- Solape del sidebar: `AdminInvoices.jsx` y `AdminBankAccounts.jsx` no tenían la clase `app-bg`, por lo que el desplazamiento global `padding-left:240px` no aplicaba y el sidebar tapaba el contenido. Añadida la clase `app-bg` en la raíz de ambas páginas.
- Nota: el banner solo aparece si el tenant tiene `dashboard_banner_url` subido (Superadmin → Banner). La respuesta de login NO incluye `tenant_banner`; solo `/auth/me` (tras recargar) lo pobla. Por eso puede no verse justo después de iniciar sesión hasta recargar la página.


## 2026-06 — Gestión de cuentas bancarias desde el módulo Cuentas (admin)
- Backend: nuevo `PUT /api/admin/bank-accounts` (misma normalización que el endpoint superadmin `_normalize_bank_accounts`, pero scoped al tenant del usuario). Admin siempre permitido; empleado requiere permiso `manage_bank_accounts`.
- Frontend `AdminBankAccounts.jsx`: botón "Gestionar cuentas" en el header + botón "Agregar cuenta" en el estado vacío, con diálogo para agregar/editar/eliminar cuentas (replica el diálogo de SuperadminDashboard). API `updateBankAccounts` en `lib/api.js`.
- Nota IMPORTANTE: el PUT reemplaza la lista COMPLETA (igual que superadmin). El diálogo carga primero todas las cuentas vía `listBankAccounts`, por lo que al guardar se preservan las existentes. No llamar el PUT con una lista parcial.
- Verificado E2E: crear cuenta desde la UI (aparece como tarjeta) y eliminar preserva las cuentas restantes.


## 2026-06 — Toggle de tema claro/oscuro
- Nuevo `components/ThemeToggle.jsx`: botón muy pequeño (h-7 w-7, icono Sun/Moon) que alterna claro/oscuro, persiste en `localStorage["astrid_theme"]` y togglea la clase `dark` en `<html>` (Tailwind `darkMode: "class"`). Sincroniza instancias vía evento `astrid-theme-change`.
- Ubicación: footer del sidebar (desktop) y topbar móvil en `AstridSidebar.jsx`.
- `App.js`: aplica el tema guardado a nivel de módulo (antes del render) para evitar flash.
- Claro: fondo suave `#FFF7FA` (en `BrandBackgroundVideo.jsx` e `index.css`). Oscuro: paleta noche (#0f1420) con overrides en `index.css` — tokens shadcn bajo `.dark` (background/card/popover/border/input/etc.) + overrides de utilidades hardcoded (`.bg-white`, `.text-slate-*`, `.border-*`, `aside`, inputs, `.tenant-hero`). Los badges de color se conservan.
- Verificado con screenshots: dashboard, tabla de Facturas y diálogos legibles en oscuro; fondo suave en claro.


## 2026-06 — Vínculo permanente depósito↔factura (candado en recálculo) + auditoría
Problema: `recalculate_client_invoices` redistribuía depósitos entre facturas por fecha en cada ejecución (ej. movió $100 de FG6-003 a FG6-004).
- **Schema**: nuevo campo `assigned_invoice_id` en `wallet_transactions` (vínculo permanente).
- **Candado (server.py `recalculate_client_invoices`)**: prioridad #0 — si el depósito tiene `assigned_invoice_id` a una factura viva, se queda ahí; nunca se mueve ni queda suelto. Solo si esa factura fue anulada/eliminada cae al cálculo normal.
- **Memoria**: al final del recálculo persiste `assigned_invoice_id` para cada depósito que aterriza en una factura (primera vez, silencioso). Así el sistema deja de repartir por fecha.
- **Auditoría**: firma con `actor_id/actor_name/actor_role`. Movimientos reales (de una factura viva a otra distinta) generan `audit_logs` con acción `deposit_reassigned`. La asignación manual (`PUT /wallet/deposit/{id}/assign-invoice`) ahora fija también `assigned_invoice_id`, audita con el nombre del usuario y pasa el actor al recálculo.
- **Endpoints de mantenimiento (admin)**: `GET /api/admin/maintenance/client-deposits?q=<cid|nombre>` para revisar asignaciones; `POST /api/admin/maintenance/reassign-deposit {deposit_id(prefijo ok), invoice_number}` para mover+bloquear+auditar+recalcular con identificadores legibles.
- **Verificado en preview** (3 tests + smoke API): candado, memoria (factura nueva no roba el depósito), auditoría de movimiento con actor, y reassign positivo (R8062).
- **PENDIENTE EN PRODUCCIÓN** (los datos FG6/Gioconda/Nelly/77bc201f NO existen en preview): tras Deploy, ejecutar el fix manual de 77bc201f→FG6-003 y revisar Gioconda Ayala y Nelly (N7N) con los endpoints o la UI de "Asignar recarga".


## 2026-06 — Pantalla "Mantenimiento de Recargas" (admin)
- Nueva página `pages/AdminDepositMaintenance.jsx`, ruta `/admin/deposit-maintenance` (solo admin), ítem "Mant. Recargas" en el sidebar (icono Wrench).
- Busca cliente por nombre o customer_id → lista cada recarga aprobada con: monto, factura vinculada (candado) o "Sin vínculo fijo", si la factura está anulada, fecha, descripción e id. Desplegable con las facturas vivas del cliente + botón "Fijar" para reasignar (usa `POST /admin/maintenance/reassign-deposit`, que bloquea + audita + recalcula).
- API en `lib/api.js`: `reviewClientDeposits(q)`, `reassignDepositMaintenance(deposit_id, invoice_number)`.
- Verificado en preview (búsqueda R8062 muestra 3 recargas con dropdown). Requiere Deploy para funcionar en producción (los endpoints de mantenimiento aún dan 404 en prod hasta desplegar).

## 2026-06 — Fix producción aplicado (Gioconda FG6)
- Recarga `77bc201f` ($100, hecha 18‑sep = semana de FG6‑003) estaba en FG6‑004. Se reasignó a FG6‑003 con el endpoint desplegado `PUT /wallet/deposit/{id}/assign-invoice` (fija target_invoice_id, respetado por el recálculo). Resultado: FG6‑003 a_pagar 99.84→0 (favor 0.16), FG6‑004 sin cambio (a_pagar 0).
- Nelly (N7N): revisada. La única recarga sospechosa (032fd8b8 $275) fue el domingo 27‑sep 22:39 hora Ecuador = dentro de la semana de N7N‑020 → correctamente ubicada. Sin correcciones.


## 2026-06 — Fix descarga PDF Paquetería (Envíos) — CAUSA REAL
- Causa raíz real: `ReferenceError: getWeekKey is not defined` (y luego `weekList is not defined`) dentro de `handleExportCourierManifest`. Ambos estaban definidos SOLO dentro de IIFEs del render, no a nivel de componente. Solo fallaba con una semana específica seleccionada (con "Todas" el ternario hacía short-circuit y no evaluaba `getWeekKey`), por eso una prueba con "Todas" no lo reproducía.
- Fix en `AdminShipments.jsx`: `getWeekKey` y `getWeekLabel` movidos/duplicados a scope de componente (junto a `getCurrentWeekKey`). El handler ya no usa `weekList`; deriva la etiqueta con `getWeekLabel(filtered[0].created_at)`.
- (Adicional, no era la causa) `lib/courierManifestPDF.js`: entrega multiplataforma (móvil abre en pestaña) — se mantiene como mejora.
- El manifiesto incluye TODOS los envíos de la semana sin importar el status. Verificado en preview con semana específica (6-Abril, 2 envíos): "Manifiesto PDF generado" sin overlay de error.


## 2026-06 — PDF Paquetería: nombre + código del cliente
- El PDF usaba `customer_name/client_name` (vienen null); el envío trae el nombre en `user_name` y el código en `customer_id`. Fix en `lib/courierManifestPDF.js`: la columna CLIENTE ahora usa `s.user_name` como primer fallback. El código `#customer_id` ya se imprimía debajo. Verificado contra datos reales (user_name="Self Registered Client", customer_id="S7951").

## 2026-06 — Módulo Reporte PDF de Clientes (Estadísticas)
- Backend `GET /api/admin/reports/clients` con filtros: `status` (active/inactive), `min_inactivity_days`, `stagnant_only`+`stagnant_days`, `date_from`/`date_to` (por última compra). Devuelve por cliente: name, whatsapp, last_purchase, inactivity_days, saldo_pendiente (adeudado), merchandise_age_days (antigüedad = días desde la compra no facturada más antigua), stagnant, + totals (saldo total, con estancada).
- Frontend: `lib/clientReportPDF.js` (jsPDF + jspdf-autotable): tabla Cliente/WhatsApp/Última Compra/Días Inact./Saldo Pend./Antig. Mercadería, filas alternas, links WhatsApp (doc.link a wa.me), estancada y saldo en rojo, banda resumen con totales. `components/ClientReportGenerator.jsx` (diálogo de filtros) montado en `AdminStats.jsx`. API `getClientReport`.
- Verificado: backend 119 clientes / saldo $31,051.66 / 89 estancados; filtros inactividad(104) y estancada(89) OK; UI genera PDF sin errores (toast 104 clientes).

## 2026-06 — Fix layout PDF Envíos (TOTAL ENVÍOS)
- Se montaba sobre PERÍODO (posición fija margin+240 y periodLabel largo). Ahora TOTAL ENVÍOS es una píldora lila pastel (#EDE9FE) con texto gris (#6B7280) alineada a la derecha; PERÍODO a la izquierda con recorte de seguridad. `lib/courierManifestPDF.js` bloque META.

## 2026-06 — PDF Envíos: paleta lila pastel + negro, encabezado blanco con recuadro lila
- `lib/courierManifestPDF.js`: constantes LILAC(#EDE9FE)/LILAC_SOFT/LILAC_BORDER(#C4B5FD)/INK(#111827)/GRAY(#6B7280). Encabezado morado sólido → blanco con recuadro lila y texto negro/gris. Cabecera de tabla, tarjetas de categoría, banda TOTAL A PAGAR, divisores y filas alternas → lila pastel con texto negro. Verificado sin errores.

## 2026-10 — Candado de Lives finalizados por clave de administrador Astrid-Shop
- Requerimiento: (1) cerrar lives automáticamente los lunes al mediodía (hora Ecuador) — YA existía y funciona (`_auto_close_lives_scheduler` en server.py, confirmado en logs cerrando lives varias semanas). (2) Para REACTIVAR un live finalizado (agregar productos) y para ELIMINAR productos de lives finalizados, pedir la clave del administrador de Astrid-Shop.
- Backend (`server.py`): helper `verify_tenant_admin_password(tenant_id, password)` valida contra el usuario role=admin del tenant (sha256). `POST /lives/{id}/start` ahora acepta body `{password}` y exige clave SOLO si el live está completed/ended/finalized (iniciar lives inactivos no cambia). `DELETE /purchases/{id}` acepta body `{password}` y exige clave SOLO si la compra pertenece a un live finalizado (la verificación ocurre antes de cualquier reembolso/recálculo). Import `Body` agregado.
- Frontend (`AdminLive.jsx`): diálogo "Reactivar Live" con input de clave (testids `reactivate-pwd-dialog/input/confirm/cancel/error`); en el diálogo de eliminar compra se muestra bloque de clave `delete-pwd-block/input/error` solo para lives finalizados y el botón se deshabilita sin clave. `lib/api.js`: `startLive(id, data)` y `deletePurchase(id, data)` envían el body.
- Verificado por curl en tenant demo (admin@demo.com): reactivar sin/clave incorrecta → 401, con clave → 200; eliminar en live finalizado sin/clave incorrecta → 401, con clave → 200. Screenshot del diálogo de reactivación OK. Deployment pendiente para producción.

## 2026-10 — Recargas: numeración + check sutil "revisada en banco"
- Backend (`server.py`): `POST /wallet/deposit/{id}/bank-reviewed` body `{reviewed:bool}` → setea `bank_reviewed`, `bank_reviewed_at`, `bank_reviewed_by` en el wallet_transaction (type=deposit). `GET /wallet/all-deposits` ya hace spread del doc, así que el campo viaja al front sin cambios extra. API front: `setDepositBankReviewed(id, reviewed)`.
- Frontend (`AdminWallet.jsx`, tab Historial): cada recarga numerada por grupo de semana (`#1, #2…`, testid `deposit-number-{id}`). Check pequeño y sutil (círculo h-4 w-4, gris→verde al marcar) SOLO en recargas aprobadas para marcar que fue conciliada contra la cuenta del banco; tooltip muestra quién la revisó. Toggle optimista con rollback en error. Testid `bank-reviewed-toggle-{id}`.
- Verificado: curl toggle on/off persiste y se refleja en all-deposits; UI muestra numeración y check verde al conciliar. Deployment pendiente para producción.

## 2026-10 — Candado de lives finalizados: refuerzo (aplica a TODOS los usuarios)
- `verify_tenant_admin_password` ahora valida contra CUALQUIER cuenta admin del tenant (no solo la primera), evitando rechazos falsos cuando hay más de un administrador.
- El candado (reactivar + eliminar producto en live finalizado) aplica a TODOS los usuarios por igual (admin o empleado); el backend lo exige siempre que el live esté completed/ended/finalized.
- Frontend `AdminLive.jsx`: el flujo de eliminar ahora es robusto — muestra el campo de clave si detecta el live finalizado, y TAMBIÉN lo revela si el backend responde 401 (estado `deletePwdRequired`), permitiendo escribir la clave y reintentar sin cerrar el diálogo. Verificado por screenshot: aparece el input y marca "Clave de administrador incorrecta" con clave errónea.
- Nota de soporte: el síntoma "no le deja poner la clave / solo dice incorrecta" corresponde al frontend viejo cacheado durante el deploy en curso; se resuelve al terminar el deploy + recarga forzada (Ctrl/Cmd+Shift+R).

## 2026-10 — NUEVO MÓDULO "Live" (ingreso rápido de productos) — opt-in por tenant
Requisito: módulo nuevo "Live" (distinto de "Live Shopping"), ícono rojo en sidebar/dashboard, activable por Superadmin por tenant (default OFF). Mismo shell/encabezado. Ingreso dinámico: se crea el live (con tabla de taxes del tenant) → se define 1 producto (nombre con autocompletado desde historial, precio, comisión vacía=0) → se agregan varios clientes (búsqueda código/nombre, TAB) → "Registrar" crea 1 compra por cliente marcada entry_source='live', que fluye a facturación igual que Live Shopping. Si el módulo está OFF, nada cambia.

Decisiones del usuario: (1) activa Superadmin; (2) lives compartidos con Live Shopping + marca "LIVE"; (3) "valor final" mostrado = precio+comisión (el impuesto del live SÍ se aplica a la compra real); (4) 1 compra/cliente, descuenta saldo; (5) historial guarda solo el nombre.

Backend (server.py):
- Tenant.live_module_enabled (bool, default False). Toggle vía PUT /superadmin/tenants/{id}/settings {live_module_enabled}.
- auth/me devuelve live_module_enabled.
- Live.tax_rate/apply_tax; LiveCreate acepta tax_rate/apply_tax; create_live los guarda.
- POST /api/live-module/purchases {live_id,item_name,store,price,commission_amount,customer_ids[]}: valida módulo activo (403 si no), 1 compra/cliente con entry_source='live', impuesto del live aplicado, comisión plana (null=0), descuenta wallet, suma totales del live, guarda nombre en product_history, audit. Devuelve created[]/failed[].
- GET /api/live-module/product-history?q= → nombres para autocompletar.

Frontend:
- Nueva página pages/AdminLiveModule.jsx (ruta /admin/live-module). Header rosa/vino (#881337→#BE123C, NO rojo neón — ajustado por pedido del usuario). Secciones: live (crear/seleccionar + tax), producto (nombre datalist + precio + comisión + "Valor final"=precio+comisión), clientes (búsqueda rápida, chips con "Debe $X"/"Al día" vía getClientInfo, TAB/Enter). Botón Registrar bulk.
- AstridSidebar: item "Live" (ícono Video rosa #E11D48) inyectado tras "Live Shopping" solo si user.live_module_enabled.
- PurchaseItem: badge rosa "LIVE" cuando entry_source==='live' (visible en Live Shopping).
- SuperadminDashboard: toggle "Módulo Live" en diálogo de configuración del tenant.
- App.js: ruta protegida admin/employee.

Testing: iteration_15.json → 8/8 backend PASS, todos los flujos frontend PASS, sin issues. Nota: wallets no existían en el tenant demo (seed incompleto); se crearon para D1001/D1002/D1003. NOTA DEPLOY: requiere Deploy para producción; activar el módulo por tenant desde Superadmin → Configuración.
Pendiente menor (no bloqueante): el endpoint bulk no usa transacción DB (degrada por-cliente con failed[]); refactor de server.py (ya >10k líneas) sigue pendiente.

---

## Módulo de Inventario [12-Oct-2026]

### Descripción
Nuevo módulo completo para gestión de productos de inventario propios del negocio, con seguimiento de costos, stock por ubicación (Ecuador/USA) y estadísticas de ganancias netas.

### Campos de Producto
- `name` (requerido) - Nombre del producto
- `cost` (requerido) - Precio de costo/compra
- `sale_price` (requerido) - Precio de venta al cliente
- `tax_rate` - Impuesto (ej: 0.0825 para 8.25%)
- `stock_ecuador` - Cantidad disponible en Ecuador
- `stock_usa` - Cantidad disponible en USA
- `sku` - Código SKU/barcode opcional
- `description` - Descripción opcional

### Funcionalidades
1. **Gestión de Productos** (/admin/inventory)
   - Crear/Editar/Eliminar productos
   - KPIs: total productos, stock Ecuador, stock USA, valor total en stock, alertas de stock bajo (<5 unidades)
   - Tabla con: producto, costo, precio venta, impuesto, stock por ubicación, margen ($ y %)
   - Acciones: registrar venta, ajustar stock, editar, eliminar

2. **Ventas de Inventario**
   - Registrar venta seleccionando producto, cantidad, ubicación (Ecuador/USA)
   - Opcional: asignar a cliente por customer_id
   - Descuenta automáticamente del stock de la ubicación seleccionada
   - Calcula: subtotal, impuesto, total, ganancia
   - Validación de stock insuficiente

3. **Ajustes de Stock**
   - Ajuste manual positivo (agregar) o negativo (restar)
   - Seleccionar ubicación (Ecuador/USA)
   - Razón del ajuste opcional (se guarda en audit_logs)

4. **Estadísticas** (/admin/inventory-stats)
   - **KPIs principales**: Ventas totales, Costo total, Ganancia neta, Margen %
   - **KPIs secundarios**: Transacciones, Unidades vendidas, Impuestos, Stock Ecuador, Stock USA, Valor stock
   - **Filtros de período** (semanal como otros módulos): Esta semana, semanas anteriores, Este mes, Todo
   - **Gráfico de tendencia**: Línea de ventas y ganancia por día
   - **Distribución de ventas**: Pie chart por producto
   - **Productos Más Vendidos**: Tabla con ranking, cantidad, ventas, costo, ganancia, margen
   - **Alertas de Stock Bajo**: Lista de productos con menos de 5 unidades

### Backend (server.py)
- Modelos: `InventoryProduct`, `InventorySale`, `InventoryProductCreate`, `InventoryProductUpdate`, `InventorySaleCreate`
- Endpoints:
  - `GET /api/inventory/products` - Lista productos del tenant
  - `GET /api/inventory/products/{id}` - Detalle de producto
  - `POST /api/inventory/products` - Crear producto
  - `PUT /api/inventory/products/{id}` - Actualizar producto
  - `DELETE /api/inventory/products/{id}` - Soft delete (is_active=false)
  - `POST /api/inventory/sales` - Registrar venta (descuenta stock)
  - `GET /api/inventory/sales` - Lista ventas con filtros opcionales
  - `DELETE /api/inventory/sales/{id}` - Eliminar venta (restaura stock)
  - `GET /api/inventory/stats?period=` - Estadísticas (week/w1/w2/month/all)
  - `POST /api/inventory/products/{id}/adjust-stock` - Ajustar stock con audit log

### Frontend
- `AdminInventory.jsx` - Página principal de gestión de productos
- `AdminInventoryStats.jsx` - Página de estadísticas de inventario
- `AdminDashboard.jsx` - Botón "Inventario" agregado al menú de Acciones Rápidas
- `api.js` - Funciones de API para inventario
- `App.js` - Rutas protegidas /admin/inventory y /admin/inventory-stats

### Testing
- iteration_17.json: 14/14 backend tests PASS, 100% frontend flows PASS
- iteration_18.json: 100% frontend tests PASS - Verificación de bugs visuales corregidos
- Producto de prueba: "Camiseta Deportiva" SKU CAM-001, $15 costo, $29.99 venta, 8.25% tax, 48 Ecuador, 25 USA

### Bug Fixes (12-oct-2026)
- **Tarjetas Ecuador/USA reducidas**: Padding reducido de p-6 a p-3, banderas de h-20 a h-10, texto más compacto. Tamaño final ~216x132px (aproximadamente la mitad del original).
- **Botones de diálogos corregidos**: Añadidas clases explícitas de color a todos los botones de acción en DialogFooter:
  - Crear/Actualizar producto: `bg-blue-600 hover:bg-blue-700 text-white`
  - Aplicar (ajuste stock): `bg-blue-600 hover:bg-blue-700 text-white`
  - Registrar (venta): `bg-green-600 hover:bg-green-700 text-white`
  - Transferir: `bg-purple-600 hover:bg-purple-700 text-white`
  - Crear Compras para Facturar: `bg-green-600 hover:bg-green-700 text-white`
  - Cerrar (alertas): `bg-slate-700 hover:bg-slate-800 text-white`
- **Error de sintaxis corregido**: Removido `})}` duplicado en línea 1003 de AdminInventory.jsx

### Mejoras Diálogo Crear Producto (12-oct-2026)
- **Selector de impuesto visual**: Botones con íconos para Sin Tax (🚫), 7% (📊), 15% (📈), Otro (✏️)
- **Default de impuesto según ubicación**: Ecuador = 15%, USA = Sin Tax
- **Autocompletado de nombres**: Muestra sugerencias de productos existentes con alerta de duplicados
- **Stock por defecto = 1**: Ya no inicia en 0
- **Diseño animado y moderno**:
  - Header con gradiente según país (verde Ecuador, azul USA) y patrón de puntos
  - Campos con fondos diferenciados por tipo (gris=costo, verde=precio, púrpura=impuesto, azul=stock)
  - Iconos en cada sección (Tag, DollarSign, Percent, Boxes, Hash)
  - Botón de guardar con animación hover y color según país
  - Input de impuesto manual aparece con animación cuando se selecciona "Otro"

### Pendiente/Backlog
- Hacer el umbral de stock bajo (<5) configurable por tenant
- Permiso específico `manage_inventory` para empleados (actualmente hereda de admin)
- Refactorizar AdminInventory.jsx (>1000 líneas) en componentes más pequeños por diálogo

---

## Permiso "Ocultar Valores Financieros" (13-oct-2026)

### Descripción
Nuevo permiso `hide_financial_values` que permite crear empleados con acceso completo a la app pero SIN ver valores de dinero. Todos los montos aparecen como "••••".

### Implementación
- **Backend**: Añadido `hide_financial_values: bool = False` a `EmployeePermissions`
- **Frontend**:
  - Nuevo contexto `hideFinancials` en AuthContext (App.js)
  - Nuevo componente `MoneyDisplay` en `/components/MoneyDisplay.jsx`
  - Hook `useHideFinancials()` para formatear dinero respetando el permiso

### Páginas Modificadas
- `AdminDashboard.jsx`: Banner de Live activo, tarjetas de estadísticas
- `AdminBankAccounts.jsx`: Todos los valores de saldos, depósitos, retiros
- `AdminStats.jsx`: KPIs, totales, comisiones, rankings
- `AdminInvoices.jsx`: Totales de facturas, items, subtotales, impuestos
- `AdminLiveModule.jsx`: Precios, comisiones, saldos de clientes, totales de Live
- `AdminEmployees.jsx`: Nueva sección "Visibilidad financiera" en permisos

### Credenciales de Prueba
- Email: sindinero@test.com
- Password: 123456
- Tiene acceso a: clientes, compras, lives, recargas, envíos, facturas, reportes, estadísticas
- NO ve: ningún valor de dinero (aparece como "••••")

## 2026-10-21
- Acceso "Facturas sin Envío" con contador: dentro de la tarjeta Envíos del Dashboard (Acciones Rápidas) y junto a "Nuevo" en /admin/shipments. Ambos navegan a /admin/pending-shipments. Probado en preview (sin deploy).
- GET /api/shipments ya no falla con envíos sin user_id (datos de prueba antiguos en preview).
- Facturas (diálogo admin, diálogo pendientes y PDF): eliminada la línea "Comisiones"; la comisión se suma dentro de Subtotal. Total sin cambios. Total Etiqueta sigue mostrando solo precio.
- Facturas se actualizan en vivo cuando se edita un artículo (cualquier estado, incl. pagadas) y cuando se quitan taxes de un Live. Cada cambio queda en Auditoría como "Total de factura actualizado" (antes/después/diferencia/artículo). Helper resync_invoice_totals en server.py.
- "Total Etiqueta" oculto en todas las facturas (diálogo y PDF); fila resumen queda con Total de artículos + Paquetes/Libras.
- Comisión manual de Live Shopping sumada en: tarjeta Comisiones del Dashboard (reports/summary: total_commissions incl. manual, + product_commissions/manual_commissions) y Estadísticas (business-stats: total_commissions, gross/net_profit, sales_by_live). Atribuida por fecha de creación del Live. Arreglado 500 de business-stats cuando store_invoice_tax es null.
- Envíos multi-categoría: backend _price_shipment_packages recalcula costo por categoría (create/update); edición muestra filas por paquete; lista "G×1 · B×2"; widget pago paquetería, Reporte de Paquetes y manifiesto PDF por categoría (lib/shipmentPackages.js). Edición de una sola categoría limpia packages. Semana Jueves–Miércoles en /admin/shipments (se quitaron cálculos lunes), Reporte de Paquetes y Facturas sin Envío (lib/weekKey.js). Tests: iteration_21/22.
- Reporte de Cobranza: Estadísticas → pestaña "Cobranza" (permiso stats_deudas). GET /api/admin/reports/collections?start&end: clientes con factura pendiente o pagada con recargas posteriores; ordenado por último pago; abonado en período, falta pagar (real_debt), historial de pagos, WhatsApp con mensaje, PDF (lib/collectionsReportPDF.js). Filtro Semana (jue–mié)/Día/Todo.
- Editar Envío (una sola categoría): botón "Agregar Paquete de otra categoría" convierte a filas por paquete. Test iteration_23 OK.
- Cobro por retraso manual: check en la factura (components/invoice/LateFeeToggle.jsx) + PUT /api/invoices/{id}/late-fee {enabled, amount}. late_fee_manual=True evita que el automático lo vuelva a poner. recalculate_client_invoices ahora suma late_fee al total (antes lo perdía en el recálculo). Auditoría: invoice_late_fee_toggled.
- Cobro por retraso por paquete: compute_shipment_late_fee = Σ(late_fee categoría × paquetes) usando shipment.packages (modo libras: 1 por categoría). Aplica al automático y al check manual; desglose mostrado (G×2 · B×1).
- BUG GRAVE resuelto (preview): recarga duplicada en Cuentas por doble aprobación simultánea. approve-deposit ahora reclama atómicamente (pending->approved con filtro), wallet con $inc, ledger con upsert por source_transaction_id. Frontend AdminWallet bloquea doble clic (approvingRef). Herramienta: GET/POST /api/admin/bank-accounts/duplicate-recharges(/fix) + botón "Revisar duplicados" en Cuentas (solo admin): anula (soft-delete, deleted_reason=Duplicado) las copias extra, deja auditoría bank_duplicates_fixed. Test: backend/tests/manual_double_approve_test.py.
- Cobranza: filtro "Pagado sin envío" (factura con total_a_pagar 0 y sin envío, desde la primera factura con deuda) + columna Paquetes (total y por categoría de envíos de sus facturas, ej. 3 · B×1 · G×2) + en PDF.
