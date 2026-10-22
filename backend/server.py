from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form as FastAPIForm, Response, Body, Query
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import object_store
import uuid
from datetime import datetime, timezone, timedelta
import random
import string
import hashlib
import jwt
import shutil

# ─────────────────────────────────────────────────────────────
# WEEKLY CUTOFF for deposit → invoice assignment
# Week starts Monday 00:00 America/Guayaquil (UTC-5) and ends Sunday 23:59.
# A recharge only auto-applies to invoices created in its SAME calendar
# week. Recharges made after the last invoice of the week float and wait
# for a new-week invoice. Admin can override via wallet_transaction.target_invoice_id.
# ─────────────────────────────────────────────────────────────
BILLING_TZ_OFFSET = timedelta(hours=-5)  # America/Guayaquil, no DST


def _billing_week_bounds(dt_iso: str):
    """Return (week_start_iso, week_end_iso) in UTC for the Mon-Sun calendar
    week that contains the given UTC ISO timestamp, interpreted in
    America/Guayaquil (UTC-5)."""
    try:
        dt = datetime.fromisoformat(dt_iso.replace("Z", "+00:00"))
    except Exception:
        return ("", "")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(timezone(BILLING_TZ_OFFSET))
    # Monday = 0
    days_since_mon = local.weekday()
    week_start_local = (local - timedelta(days=days_since_mon)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    week_end_local = week_start_local + timedelta(days=7)
    return (
        week_start_local.astimezone(timezone.utc).isoformat(),
        week_end_local.astimezone(timezone.utc).isoformat(),
    )


ROOT_DIR = Path(__file__).parent.parent  # /app instead of /app/backend
BACKEND_DIR = Path(__file__).parent  # /app/backend
load_dotenv(BACKEND_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
# Fail fast when Mongo is unreachable: short server selection + connect
# timeouts so HTTP requests don't hang the worker indefinitely on transient
# Mongo issues. Socket timeout is generous (30s) because some client
# dashboards aggregate historical purchases/transactions and take a while
# on large tenants — a 10s cap was killing legitimate queries in production.
client = AsyncIOMotorClient(
    mongo_url,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=30000,
)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get("JWT_SECRET")
JWT_ALGORITHM = "HS256"

# Use backend/uploads for all uploaded files (logos, proofs, etc.)
UPLOAD_DIR = BACKEND_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="OUTLETS USA EC - SaaS Live Shopping API")

@app.on_event("startup")
async def startup_event():
    try:
        object_store.init_storage()
        logging.info("Object storage initialized successfully")
    except Exception as e:
        logging.warning(f"Object storage init failed (will retry on first upload): {e}")
    # Ensure all critical query patterns are backed by indexes. Safe to call on
    # every boot — Mongo no-ops when an equivalent index already exists.
    try:
        await _ensure_indexes()
    except Exception as e:
        logging.warning(f"Index ensure failed (non-fatal): {e}")
    # Spawn background scheduler that auto-closes any active live every Monday at 12:00 local (Ecuador, UTC-5).
    import asyncio as _asyncio
    _asyncio.create_task(_auto_close_lives_scheduler())


async def _ensure_indexes():
    """Create compound indexes for the hot query paths.

    All indexes here back patterns that already exist in `server.py` and
    handle the dominant multi-tenant filtering `{"tenant_id": ...}` combined
    with the per-entity lookup key. We use `background=True` so this never
    blocks application startup on Atlas. Repeated calls are no-ops.
    """
    spec = [
        # Users — login + per-tenant directory lookups
        ("users", [("tenant_id", 1), ("email", 1)]),
        ("users", [("tenant_id", 1), ("customer_id", 1)]),
        ("users", [("tenant_id", 1), ("whatsapp", 1)]),
        ("users", [("id", 1)]),
        # Tenants
        ("tenants", [("id", 1)]),
        ("tenants", [("slug", 1)]),
        # Employees
        ("employees", [("tenant_id", 1), ("email", 1)]),
        ("employees", [("id", 1)]),
        # Purchases — Live + per-customer aggregations
        ("purchases", [("user_id", 1), ("tenant_id", 1)]),
        ("purchases", [("live_id", 1), ("tenant_id", 1)]),
        ("purchases", [("tenant_id", 1), ("created_at", -1)]),
        ("purchases", [("invoice_id", 1)]),
        # Shipments
        ("shipments", [("user_id", 1), ("tenant_id", 1)]),
        ("shipments", [("tenant_id", 1), ("created_at", -1)]),
        # Wallets
        ("wallets", [("user_id", 1), ("tenant_id", 1)]),
        ("wallets", [("customer_id", 1), ("tenant_id", 1)]),
        # Wallet transactions — recharge feed + per-customer history
        ("wallet_transactions", [("user_id", 1), ("tenant_id", 1)]),
        ("wallet_transactions", [("tenant_id", 1), ("type", 1), ("status", 1)]),
        ("wallet_transactions", [("tenant_id", 1), ("created_at", -1)]),
        ("wallet_transactions", [("bank_account_id", 1)]),
        # Invoices
        ("invoices", [("user_id", 1), ("tenant_id", 1)]),
        ("invoices", [("tenant_id", 1), ("customer_id", 1)]),
        ("invoices", [("tenant_id", 1), ("created_at", -1)]),
        # Notifications
        ("notifications", [("user_id", 1), ("tenant_id", 1)]),
        ("notifications", [("tenant_id", 1), ("created_at", -1)]),
        # Audit logs
        ("audit_logs", [("tenant_id", 1), ("created_at", -1)]),
        ("audit_logs", [("user_id", 1), ("tenant_id", 1)]),
        # Lives
        ("lives", [("tenant_id", 1), ("status", 1)]),
        ("lives", [("tenant_id", 1), ("created_at", -1)]),
        # Bank transactions (ledger)
        ("bank_transactions", [("tenant_id", 1), ("bank_account_id", 1)]),
        ("bank_transactions", [("tenant_id", 1), ("created_at", -1)]),
    ]
    for coll, keys in spec:
        try:
            await db[coll].create_index(keys, background=True)
        except Exception as _idx_err:
            logging.warning(f"[indexes] {coll} {keys} skipped: {_idx_err}")
    logging.info(f"[indexes] ensured {len(spec)} compound indexes")


async def _auto_close_lives_scheduler():
    """Every Wednesday at 23:59 local Ecuador time (UTC-5), close any
    live whose status is "active". Runs once per minute, fires exactly once per
    Wednesday-midnight transition. Robust against restarts: a per-week guard on the
    database (`system_state.lives_auto_closed_week`) prevents double-runs.
    
    Week cycle: Thursday 00:00 → Wednesday 23:59
    Lives auto-close at end of week (Wednesday 23:59)
    """
    import asyncio as _asyncio
    from datetime import datetime as _dt, timezone as _tz
    while True:
        try:
            now_utc = _dt.now(_tz.utc)
            # Convert UTC time to local Ecuador (UTC-5) without external tz deps
            local_now = now_utc - timedelta(hours=5)
            # weekday: Wednesday=2, check at 23:00 hour (we run hourly check in the 23:xx window)
            if local_now.weekday() == 2 and local_now.hour == 23:
                # Compute a stable week-bucket key (yyyy-mm-dd of this Wednesday)
                week_key = local_now.strftime("%Y-%m-%d")
                state = await db.system_state.find_one({"_id": "lives_auto_closed"}, {"_id": 1, "week": 1})
                already_done = state and state.get("week") == week_key
                if not already_done:
                    res = await db.lives.update_many(
                        {"status": "active"},
                        {"$set": {"status": "completed", "ended_at": now_utc.isoformat(), "auto_closed": True}}
                    )
                    await db.system_state.update_one(
                        {"_id": "lives_auto_closed"},
                        {"$set": {"week": week_key, "closed_count": res.modified_count, "ran_at": now_utc.isoformat()}},
                        upsert=True
                    )
                    if res.modified_count:
                        logger.info(f"[auto_close_lives] Closed {res.modified_count} active live(s) at {now_utc.isoformat()} (week {week_key})")
                    # Audit log entry (per-tenant not needed; system-wide event)
                    try:
                        await db.audit_logs.insert_one({
                            "id": str(uuid.uuid4()),
                            "tenant_id": "system",
                            "user_id": "system",
                            "user_name": "Sistema",
                            "user_role": "system",
                            "action": "auto_close_lives",
                            "entity_type": "live",
                            "entity_id": None,
                            "entity_name": f"Cierre semanal automático ({week_key})",
                            "details": {"closed_count": res.modified_count, "week_key": week_key},
                            "ip_address": None,
                            "created_at": now_utc.isoformat()
                        })
                    except Exception:
                        pass
        except Exception as _err:
            logger.warning(f"[auto_close_lives] iteration failed: {_err}")
        # Sleep ~60s. We accept a 1-minute drift around 23:00 (acceptable).
        await _asyncio.sleep(60)
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DEFAULT_COMMISSION_FEE = 3.0
LOW_BALANCE_THRESHOLD = 9.0
DEFAULT_REFERRAL_BONUS = 5.0
ILLINOIS_TAX_RATE = 0.0825

# ==================== MODELS ====================

class Tenant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    business_name: str
    slug: str
    owner_name: str
    email: str
    logo_url: Optional[str] = None
    dashboard_banner_url: Optional[str] = None  # Hero banner shown at the top of the tenant's dashboard (desktop + mobile)
    status: str = "active"
    tax_options: List[dict] = Field(default_factory=lambda: [
        {"value": "8.25", "label": "8.25%"},
        {"value": "10", "label": "10%"},
        {"value": "15", "label": "15%"},
        {"value": "0", "label": "Sin Taxes"},
        {"value": "other", "label": "Otro"}
    ])
    tracking_url_template: Optional[str] = None  # URL template with {tracking} placeholder
    # Live module (fast product entry) — opt-in per tenant, controlled by superadmin.
    live_module_enabled: bool = False
    # Invoice settings
    invoice_show_tax_per_item: bool = True  # Show tax column in product table
    invoice_show_tax_summary: bool = True   # Show tax total at the bottom
    # Shipment settings  
    shipment_show_product_list: bool = True  # Show product list when creating shipment
    shipping_mode: str = "packages"  # "packages" | "pounds" — determines unit label in shipment creation
    shipping_categories: List[dict] = Field(default_factory=lambda: [
        {"key": "G", "label": "Categoría G (CON Núcleo Familiar)", "value_packages": 32, "value_pounds": 32, "late_fee": 0},
        {"key": "A", "label": "Categoría A (Personal)", "value_packages": 42, "value_pounds": 42, "late_fee": 0},
        {"key": "B", "label": "Categoría B (SIN Núcleo Familiar)", "value_packages": 52, "value_pounds": 52, "late_fee": 0}
    ])
    # Late Fee settings - applies per shipping category after grace period
    late_fee_enabled: bool = False
    late_fee_grace_hours: int = 24  # Hours after invoice creation before late fee applies
    late_fee_description: str = "Recargo por demora en pago"
    # Client ID settings
    allow_custom_client_id: bool = False  # Allow admin to enter custom client ID instead of auto-generated
    # Feature toggles per tenant (controlled by superadmin)
    show_shipments_diagnostic: bool = False  # Show the "Diagnóstico" button in /admin/shipments
    # Bank accounts owned by the tenant. Each one tracks recharges that landed
    # in it and supports manual deposits/withdrawals as a mini-bank ledger.
    bank_accounts: List[dict] = Field(default_factory=list)
    # Each item: {id, owner_name, owner_id (cedula), account_number, bank_name, currency, is_active, created_at}
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BankTransaction(BaseModel):
    """Ledger entries for a tenant bank account. Three kinds:
    - "recharge" — auto-created when a client deposit is approved and attributed.
    - "manual_deposit" — admin pushes money into the account.
    - "withdrawal" — admin pulls money out.
    """
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    bank_account_id: str
    kind: str  # "recharge" | "manual_deposit" | "withdrawal"
    amount: float
    description: Optional[str] = None
    # Cross-references (optional, set when origin is a wallet transaction).
    source_transaction_id: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    reference_number: Optional[str] = None
    # Auditing
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    customer_id: str
    referral_code: str = ""
    referred_by: Optional[str] = None
    referral_count: int = 0
    commission_fee: float = DEFAULT_COMMISSION_FEE
    name: str
    country: str
    whatsapp: str
    email: Optional[str] = None
    whatsapp_consent: bool = False
    password_hash: Optional[str] = None  # Can be None if client has no password yet
    # Shadow copy of the password in plain text so admin can view the current
    # client password from the Edit Client screen. Only set for passwords
    # captured after this feature was introduced (older clients will be None).
    password_plain: Optional[str] = None
    role: str = "client"
    is_active: bool = True
    # "Revisado" flag the admin can toggle directly from the clients list to
    # quickly mark which customers have already been reviewed in a session.
    # Defaults to False — older clients without the field render as unchecked.
    reviewed: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Wallet(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    user_id: str
    customer_id: str
    available: float = 0.0
    reserved: float = 0.0
    pending_adjustment: float = 0.0
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class WalletTransaction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    user_id: str
    customer_id: str
    type: str
    amount: float
    balance_after: float
    description: str
    status: str = "pending"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    approved_at: Optional[str] = None
    purchase_id: Optional[str] = None
    # Manual override for the recalc engine: when set, the deposit is assigned
    # to this specific invoice regardless of the weekly-cutoff / date-based
    # rules. Admin sets this from AdminClients → "Recargas Disponibles" pill.
    target_invoice_id: Optional[str] = None
    # PERMANENT LINK (lock): once a deposit is assigned to an invoice, this
    # stores that invoice id. The recalc engine MUST respect it — it can never
    # move the deposit to another invoice nor leave it floating while this is
    # set to a live invoice. This turns deposit→invoice assignment from a
    # date-based redistribution into a persistent, audited link.
    assigned_invoice_id: Optional[str] = None

class Live(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    title: str
    store: Optional[str] = None
    status: str = "inactive"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    total_sales: float = 0.0
    total_commissions: float = 0.0
    total_taxes_paid: float = 0.0  # Taxes paid by personal shopper per product (reduces net profit)
    purchase_count: int = 0
    # Store invoice fields (for profit calculation)
    store_invoice_amount: Optional[float] = None  # What was actually paid to the store
    store_invoice_tax: Optional[float] = None     # Tax from store invoice (paid by shopper, reduces profit)
    store_invoice_image: Optional[str] = None     # URL of the store invoice/receipt image
    # Total items physically purchased at the store (admin-entered, may differ
    # from `purchase_count` which counts client-assigned items).
    store_invoice_items_count: Optional[int] = None
    store_profit: Optional[float] = None          # Calculated profit: total_sales - store_invoice_amount
    # Tax chosen at creation (used by the Live fast-entry module; optional).
    tax_rate: Optional[float] = None
    apply_tax: Optional[bool] = None
    # Manual commission added by admin (additional earnings not from product commissions)
    manual_commission: Optional[float] = None
    manual_commission_note: Optional[str] = None

class Purchase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    user_id: str
    customer_id: str
    item_name: str
    store: str
    price: float
    tax: float = 0.0
    price_with_tax: float = 0.0
    commission: float = DEFAULT_COMMISSION_FEE
    total: float = 0.0
    status: str = "confirmed"
    live_id: str
    invoice_id: Optional[str] = None  # ID de factura si está facturado
    invoiced_at: Optional[str] = None  # Fecha de facturación
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Invoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    user_id: str
    customer_id: str
    invoice_number: str  # Número de factura consecutivo
    purchase_ids: List[str]
    subtotal: float
    total_tax: float
    total_commission: float
    total: float
    status: str = "pending"  # pending, approved
    notes: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    approved_at: Optional[str] = None
    is_annulled: bool = False
    annulled_at: Optional[str] = None
    annulled_by: Optional[str] = None
    annulled_by_name: Optional[str] = None
    # Late fee fields
    late_fee_applied: bool = False
    late_fee_amount: float = 0.0
    late_fee_description: Optional[str] = None
    late_fee_applied_at: Optional[str] = None
    late_fee_category: Optional[str] = None  # The shipping category that triggered the fee

class Shipment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    user_id: str
    customer_id: str
    purchase_ids: List[str]
    invoice_id: Optional[str] = None  # Link to the invoice this shipment belongs to
    shipping_type: str = ""  # DEPRECATED (kept for backward compatibility with existing data)
    shipping_category: Optional[str] = None  # "G" | "A" | "B" | "OTHER" (current model)
    shipping_unit_cost: float = 0  # Cost per unit (package or pound, depending on mode)
    shipping_cost: float  # Total cost = unit_cost * package_count
    shipping_mode: str = "packages"  # "packages" | "pounds" — snapshot at creation time
    weight_pounds: float = 0  # DEPRECATED (kept for backward compatibility with existing data)
    package_count: float = 0  # Units (packages or pounds depending on shipping_mode)
    packages: Optional[List[dict]] = None  # Array of packages [{shipping_category, unit_cost, package_count, cost}]
    address: str = ""
    country: str = ""  # Optional
    phone: str = ""    # Optional
    additional_info: Optional[str] = None
    tracking_number: Optional[str] = None  # Legacy single tracking (kept for backwards compatibility)
    tracking_numbers: List[str] = []  # Multiple tracking numbers for multiple packages
    status: str = "preparing"
    attachments: List[str] = []
    created_by: Optional[str] = None       # user_id of admin/employee who created the shipment
    created_by_name: Optional[str] = None  # snapshot of creator name at creation time
    # Manual physical-guide verification: admin marks this when they hold the
    # printed guide in their hands (independent of tracking_numbers presence).
    guide_verified: bool = False
    guide_verified_at: Optional[str] = None
    guide_verified_by: Optional[str] = None
    guide_verified_by_name: Optional[str] = None
    # Manual "sent to courier" toggle: admin marks this when the parcel was
    # physically dispatched to the shipping company. Drives the
    # "Pago a Empresa Paquetería" KPI (only sent shipments count).
    marked_sent: bool = False
    marked_sent_at: Optional[str] = None
    marked_sent_by: Optional[str] = None
    marked_sent_by_name: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: Optional[str] = None
    user_id: str
    customer_id: str
    type: str
    title: str
    message: str
    whatsapp_sent: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TemporaryAccessToken(BaseModel):
    """Temporary token for QR code access to client dashboard"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    token: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    user_id: str
    customer_id: str
    invoice_id: Optional[str] = None
    used: bool = False
    expires_at: str = Field(default_factory=lambda: (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat())
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class EmployeePermissions(BaseModel):
    """Granular permissions for employees"""
    manage_clients: bool = False       # Crear, editar, eliminar clientes
    manage_purchases: bool = False     # Crear, editar, eliminar compras
    manage_lives: bool = False         # Crear, iniciar, cerrar lives
    approve_recharges: bool = False    # Aprobar/Rechazar recargas
    assign_deposits: bool = False      # Asignar manualmente recargas disponibles a facturas
    manage_shipments: bool = False     # Gestionar envíos
    manage_invoices: bool = False      # Generar/Aprobar facturas
    view_reports: bool = False         # Ver reportes
    adjust_wallet: bool = False        # Ajustar saldos de wallet
    view_statistics: bool = False      # Toggle maestro de estadísticas (legacy)
    # Módulos del dashboard que antes solo veía el admin
    manage_employees: bool = False     # Acceso al módulo Empleados
    manage_referrals: bool = False     # Configurar bonos de referidos
    manage_bank_accounts: bool = False # Acceso al módulo Cuentas (banca)
    view_audit: bool = False           # Ver registro de auditoría
    # Permisos granulares por pestaña dentro de Estadísticas
    stats_resumen: bool = False
    stats_tiendas: bool = False
    stats_deudas: bool = False
    stats_inactivos: bool = False
    stats_graficas: bool = False
    stats_detalle: bool = False
    # Visualización de las tarjetas monetarias del encabezado en Estadísticas
    stats_view_money_kpis: bool = False
    # Ocultar valores financieros en toda la app
    hide_financial_values: bool = False  # Si está activo, oculta todos los valores de dinero en toda la aplicación

class Employee(BaseModel):
    """Employee model with granular permissions"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    name: str
    username: Optional[str] = None  # Username for login (if not set, can login with name)
    email: str
    whatsapp: Optional[str] = None
    password_plain: str  # Stored in plain text so admin can view/change it
    password_hash: str
    permissions: EmployeePermissions = Field(default_factory=EmployeePermissions)
    status: str = "active"  # active, inactive
    created_by: str  # Admin user_id who created this employee
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class AuditLog(BaseModel):
    """Audit log for tracking all employee/admin actions"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    user_id: str  # ID of user who performed action (admin or employee)
    user_name: str  # Name for display
    user_role: str  # "admin" or "employee"
    action: str  # Action type: create_client, delete_purchase, approve_recharge, etc.
    entity_type: str  # Type of affected entity: client, purchase, recharge, etc.
    entity_id: Optional[str] = None  # ID of affected entity
    entity_name: Optional[str] = None  # Name/description of affected entity
    details: Optional[dict] = None  # Additional details about the action
    ip_address: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# ==================== INVENTORY MODELS ====================

class InventoryProduct(BaseModel):
    """Inventory product for tracking stock and sales - belongs to ONE location"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    location: str  # "ecuador" or "usa" - each product belongs to ONE location
    name: str
    cost: float  # Cost price (what the business paid)
    sale_price: float  # Sale price to customers
    tax_rate: float = 0.0  # Tax rate (e.g., 0.0825 for 8.25%)
    stock: int = 0  # Stock available in this location
    sku: Optional[str] = None  # Optional SKU/barcode
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: Optional[str] = None


class InventorySale(BaseModel):
    """Record of an inventory product sale"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    product_id: str
    product_name: str  # Snapshot of product name at time of sale
    customer_id: Optional[str] = None  # Optional link to a client
    customer_name: Optional[str] = None
    quantity: int = 1
    unit_cost: float  # Cost at time of sale
    unit_price: float  # Sale price at time of sale
    tax_rate: float = 0.0
    tax_amount: float = 0.0
    total_amount: float  # quantity * unit_price + tax
    profit: float  # (unit_price - unit_cost) * quantity
    location: str = "ecuador"  # "ecuador" or "usa"
    invoice_id: Optional[str] = None  # Link to invoice if added to one
    notes: Optional[str] = None
    sold_by: Optional[str] = None  # User who made the sale
    sold_by_name: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class InventoryProductCreate(BaseModel):
    location: str  # "ecuador" or "usa"
    name: str
    cost: float
    sale_price: float
    tax_rate: float = 0.0
    stock: int = 0
    sku: Optional[str] = None
    description: Optional[str] = None


class InventoryProductUpdate(BaseModel):
    name: Optional[str] = None
    cost: Optional[float] = None
    sale_price: Optional[float] = None
    tax_rate: Optional[float] = None
    stock: Optional[int] = None
    sku: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class InventorySaleCreate(BaseModel):
    product_id: str
    customer_id: Optional[str] = None
    quantity: int = 1
    notes: Optional[str] = None


# ==================== REQUEST MODELS ====================

class UserLogin(BaseModel):
    identifier: str
    password: str

class UserRegister(BaseModel):
    tenant_slug: str
    name: str
    country: str
    whatsapp: str
    email: Optional[str] = None
    whatsapp_consent: bool = False
    password: str
    referral_code: Optional[str] = None

class LiveCreate(BaseModel):
    title: str
    store: Optional[str] = None
    tax_rate: Optional[float] = None
    apply_tax: Optional[bool] = None

class PurchaseCreate(BaseModel):
    customer_id: str
    item_name: str
    store: str
    price: float
    live_id: str
    tax_rate: float = 0.0825  # Direct tax rate (0.0825 = 8.25%)
    apply_tax: bool = True
    apply_commission: bool = True
    commission_amount: float = 0

class LiveModulePurchaseCreate(BaseModel):
    """Fast-entry: one product assigned to many clients at once (Live module)."""
    live_id: str
    item_name: str
    store: Optional[str] = None
    price: float
    commission_amount: Optional[float] = None  # empty => no commission
    tax_amount: Optional[float] = None  # Taxes paid by personal shopper (reduces profit)
    customer_ids: List[str]
    quantities: Optional[List[int]] = None  # Quantity per client (matches customer_ids order)

class ShipmentCreate(BaseModel):
    user_id: str
    purchase_ids: List[str]
    shipping_type: Optional[str] = ""  # DEPRECATED
    shipping_category: Optional[str] = None  # "G" | "A" | "B" | "OTHER"
    shipping_unit_cost: Optional[float] = None  # Cost per unit (required only if category is "OTHER")
    shipping_cost: Optional[float] = None  # Calculated on backend from unit_cost * package_count, client may send it too
    weight_pounds: float = 0  # DEPRECATED
    package_count: float = 1  # Units (packages or pounds depending on tenant.shipping_mode)
    packages: Optional[List[dict]] = None  # Array of packages [{shipping_category, unit_cost, package_count, cost}]
    address: Optional[str] = ""
    country: Optional[str] = ""
    phone: Optional[str] = ""
    additional_info: Optional[str] = None
    invoice_id: Optional[str] = None

class WalletDepositRequest(BaseModel):
    user_id: str
    amount: float
    description: Optional[str] = "Recarga de saldo"

class CreateTenantRequest(BaseModel):
    business_name: str
    slug: str
    owner_name: Optional[str] = ""
    email: Optional[str] = ""

class CreateAdminRequest(BaseModel):
    name: str
    email: str
    password: str
    whatsapp: str
    country: str

class AdminClientCreate(BaseModel):
    name: str
    country: str
    whatsapp: str
    email: Optional[str] = None
    password: Optional[str] = None  # Optional - client won't be able to login if empty
    commission_fee: float = 0.0  # Default commission is 0
    initial_balance: float = 0.0
    custom_customer_id: Optional[str] = None  # Optional custom customer ID

class EmployeeCreate(BaseModel):
    name: str
    username: Optional[str] = None  # Username for login (optional, defaults to name)
    email: str
    whatsapp: Optional[str] = None
    password: str
    permissions: dict = {}  # Will be converted to EmployeePermissions

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    whatsapp: Optional[str] = None
    password: Optional[str] = None
    permissions: Optional[dict] = None
    status: Optional[str] = None

# ==================== PACAS MODELS ====================

class Paca(BaseModel):
    """Model for Pacas (product bundles/bales)"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    name: str  # e.g., "Paca de niño", "Paca de maquillaje"
    description: Optional[str] = None
    sale_price: float  # Precio de venta
    commission: float  # Comisión/ganancia
    status: str = "active"  # active, inactive
    created_by: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class PacaCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sale_price: float
    commission: float

class PacaUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sale_price: Optional[float] = None
    commission: Optional[float] = None
    status: Optional[str] = None

class PacaSale(BaseModel):
    """Record of a paca sale to a client"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    paca_id: str
    paca_name: str
    customer_id: str
    user_id: str  # Client's user_id
    sale_price: float
    commission: float
    total: float  # sale_price (commission is the profit margin)
    status: str = "pending"  # pending, invoiced
    invoice_id: Optional[str] = None
    sold_by: str  # Admin/employee who made the sale
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class PacaSaleCreate(BaseModel):
    paca_id: str
    customer_id: str

# ==================== JWT & AUTH ====================

def create_token(user_id: str, role: str, tenant_id: str = None):
    payload = {
        "user_id": user_id,
        "role": role,
        "tenant_id": tenant_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token inválido")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

# ==================== HELPERS ====================

def generate_customer_id(name: str) -> str:
    letter = name[0].upper() if name else 'X'
    digits = ''.join(random.choices(string.digits, k=4))
    return f"{letter}{digits}"

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash

async def verify_tenant_admin_password(tenant_id: str, password: str) -> bool:
    """Verify a plaintext password against ANY admin account of the tenant.
    Used to gate sensitive actions that must always be authorized by the
    store admin (e.g. reactivating/editing a finalized live), regardless of
    who is operating (admin or an employee with a module permission).
    Checks all admin accounts so tenants with more than one admin still work."""
    if not password:
        return False
    admins = await db.users.find(
        {"tenant_id": tenant_id, "role": "admin"}, {"_id": 0, "password_hash": 1}
    ).to_list(50)
    ph = hash_password(password)
    return any(a.get("password_hash") == ph for a in admins)

async def create_notification(tenant_id: str, user_id: str, customer_id: str, notif_type: str, title: str, message: str):
    notification = Notification(
        tenant_id=tenant_id,
        user_id=user_id,
        customer_id=customer_id,
        type=notif_type,
        title=title,
        message=message
    )
    await db.notifications.insert_one(notification.model_dump())
    return notification

async def check_low_balance(tenant_id: str, user_id: str, customer_id: str, balance: float):
    if balance < LOW_BALANCE_THRESHOLD:
        await create_notification(tenant_id, user_id, customer_id, "low_balance", "Saldo Bajo",
            f"Tu saldo actual es ${balance:.2f} USD. Recarga para seguir comprando.")

async def get_referral_bonus(tenant_id: str):
    settings = await db.settings.find_one({"key": "referral_bonus", "tenant_id": tenant_id}, {"_id": 0})
    if settings:
        return settings.get("value", DEFAULT_REFERRAL_BONUS)
    return DEFAULT_REFERRAL_BONUS

async def process_referral(tenant_id: str, referrer_customer_id: str, new_user_id: str, new_customer_id: str):
    referrer = await db.users.find_one({"customer_id": referrer_customer_id.upper(), "tenant_id": tenant_id}, {"_id": 0})
    if not referrer:
        return False
    bonus = await get_referral_bonus(tenant_id)
    if bonus <= 0:
        return False
    referrer_wallet = await db.wallets.find_one({"user_id": referrer["id"], "tenant_id": tenant_id}, {"_id": 0})
    if referrer_wallet:
        new_balance = referrer_wallet["available"] + bonus
        await db.wallets.update_one({"user_id": referrer["id"], "tenant_id": tenant_id},
            {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
        tx = WalletTransaction(tenant_id=tenant_id, user_id=referrer["id"], customer_id=referrer_customer_id.upper(),
            type="referral_bonus", amount=bonus, balance_after=new_balance,
            description=f"Bono por referir a #{new_customer_id}", status="approved",
            approved_at=datetime.now(timezone.utc).isoformat())
        await db.wallet_transactions.insert_one(tx.model_dump())
        await create_notification(tenant_id, referrer["id"], referrer_customer_id.upper(), "referral_bonus",
            "Bono de Referido!", f"Recibiste ${bonus:.2f} USD por referir a un nuevo cliente.")
        await db.users.update_one({"id": referrer["id"]}, {"$inc": {"referral_count": 1}})
    new_wallet = await db.wallets.find_one({"user_id": new_user_id, "tenant_id": tenant_id}, {"_id": 0})
    if new_wallet:
        new_balance = new_wallet["available"] + bonus
        await db.wallets.update_one({"user_id": new_user_id, "tenant_id": tenant_id},
            {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
        tx = WalletTransaction(tenant_id=tenant_id, user_id=new_user_id, customer_id=new_customer_id,
            type="referral_bonus", amount=bonus, balance_after=new_balance,
            description=f"Bono de bienvenida por código de #{referrer_customer_id.upper()}", status="approved",
            approved_at=datetime.now(timezone.utc).isoformat())
        await db.wallet_transactions.insert_one(tx.model_dump())
        await create_notification(tenant_id, new_user_id, new_customer_id, "referral_bonus",
            "Bono de Bienvenida!", f"Recibiste ${bonus:.2f} USD por usar un código de referido.")
    return True

# ==================== AUDIT LOG HELPER ====================

async def log_audit_action(
    tenant_id: str,
    user_id: str,
    user_name: str,
    user_role: str,
    action: str,
    entity_type: str,
    entity_id: str = None,
    entity_name: str = None,
    details: dict = None
):
    """Log an action to the audit trail"""
    audit_log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        details=details
    )
    await db.audit_logs.insert_one(audit_log.model_dump())

async def get_actor_name(user_id: str) -> str:
    """Resolve a display name for an admin/employee actor — falls back to 'Sistema'."""
    actor = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1})
    if not actor:
        actor = await db.employees.find_one({"id": user_id}, {"_id": 0, "name": 1})
    return (actor or {}).get("name") or "Sistema"

async def resync_invoice_totals(tid: str, invoice_id: str, current_user: dict, reason: str, item: dict = None, purchase_id: str = None) -> bool:
    """Recompute invoice header totals from its current items (any non-annulled status) and audit the change."""
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid, "is_annulled": {"$ne": True}}, {"_id": 0})
    if not invoice:
        return False
    ids = invoice.get("purchase_ids") or []
    if purchase_id and purchase_id not in ids:
        return False
    items = await db.purchases.find({"id": {"$in": ids}, "tenant_id": tid}, {"_id": 0}).to_list(len(ids)) if ids else []
    if not items:
        return False
    after = {
        "subtotal": round(sum(float(p.get("price") or 0) for p in items), 2),
        "total_tax": round(sum(float(p.get("tax") or 0) for p in items), 2),
        "total_commission": round(sum(float(p.get("commission") or 0) for p in items), 2),
        "total": round(sum(float(p.get("total") or 0) for p in items), 2),
    }
    before = {k: round(float(invoice.get(k) or 0), 2) for k in after}
    if all(abs(before[k] - after[k]) < 0.005 for k in after):
        return False
    await db.invoices.update_one({"id": invoice_id, "tenant_id": tid}, {"$set": after})
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="invoice_totals_updated",
        entity_type="invoice", entity_id=invoice_id,
        entity_name=f"{invoice.get('invoice_number', '')} ({invoice.get('customer_id', '')})",
        details={"reason": reason, "invoice_status": invoice.get("status"), "customer_id": invoice.get("customer_id"),
                 "before": before, "after": after, "difference": round(after["total"] - before["total"], 2), "item": item},
    )
    return True

async def check_employee_permission(user_id: str, permission: str) -> bool:
    """Check if an employee has a specific permission"""
    employee = await db.employees.find_one({"id": user_id}, {"_id": 0})
    if not employee:
        return False
    return employee.get("permissions", {}).get(permission, False)


async def recalculate_client_invoices(tenant_id: str, customer_id: str,
                                      actor_id: str = None,
                                      actor_name: str = "Recálculo automático",
                                      actor_role: str = "sistema"):
    """Assign each deposit to the invoice that was the LATEST at the time the deposit was approved.

    PERMANENT LINK / LOCK: if a deposit has `assigned_invoice_id` pointing to a
    live invoice, it stays there no matter what — never moved, never floated.
    The first time a deposit is assigned, the link is persisted (giving the
    system "memory"). Any real move between invoices is written to audit_logs.
    """
    client = await db.users.find_one({"customer_id": customer_id, "tenant_id": tenant_id}, {"_id": 0, "id": 1})
    if not client:
        return

    # Backfill: if any invoice has shipment_id but the linked shipment lacks invoice_id, repair it.
    # (Historical data before the Shipment model had `invoice_id` defined lost this link silently.)
    invs_with_shipment = await db.invoices.find(
        {"customer_id": customer_id, "tenant_id": tenant_id,
         "shipment_id": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "id": 1, "shipment_id": 1}
    ).to_list(20000)
    for inv in invs_with_shipment:
        await db.shipments.update_one(
            {"id": inv["shipment_id"], "tenant_id": tenant_id,
             "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}, {"invoice_id": ""}]},
            {"$set": {"invoice_id": inv["id"]}}
        )

    # Self-heal orphan shipping_cost: invoices that still have shipping_cost > 0 but no real shipment.
    # This happens when a shipment was deleted under the old bug (before the auto-clear was in place).
    invs_with_shipping = await db.invoices.find(
        {"customer_id": customer_id, "tenant_id": tenant_id,
         "shipping_cost": {"$gt": 0},
         "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "shipment_id": 1}
    ).to_list(20000)
    for inv in invs_with_shipping:
        has_real_shipment = False
        if inv.get("shipment_id"):
            exists = await db.shipments.find_one(
                {"id": inv["shipment_id"], "tenant_id": tenant_id}, {"_id": 0, "id": 1}
            )
            if exists:
                has_real_shipment = True
        if not has_real_shipment:
            # Also check by invoice_id on shipments (legacy case)
            exists = await db.shipments.find_one(
                {"invoice_id": inv["id"], "tenant_id": tenant_id}, {"_id": 0, "id": 1}
            )
            if exists:
                has_real_shipment = True
        if not has_real_shipment:
            await db.invoices.update_one(
                {"id": inv["id"], "tenant_id": tenant_id},
                {"$set": {"shipping_cost": 0, "weight_pounds": 0, "shipment_id": None}}
            )

    all_deposits = await db.wallet_transactions.find(
        {"user_id": client["id"], "tenant_id": tenant_id, "type": "deposit", "status": "approved", "is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "amount": 1, "created_at": 1, "description": 1, "target_invoice_id": 1, "assigned_invoice_id": 1}
    ).sort("created_at", 1).to_list(20000)
    
    all_invoices = await db.invoices.find(
        {"customer_id": customer_id, "tenant_id": tenant_id, "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "invoice_number": 1, "total": 1, "saldo_pendiente": 1, "saldo_a_favor_anterior": 1, "shipping_cost": 1, "created_at": 1, "applied_deposits": 1}
    ).sort("created_at", 1).to_list(20000)

    # Snapshot existing assignments BEFORE we recompute, so historical
    # deposits (attached under previous logic versions) stay attached even
    # after the strict Mon-Sun weekly rule was introduced.
    existing_assignment = {}
    for inv in all_invoices:
        for ad in (inv.get("applied_deposits") or []):
            dep_id = ad.get("deposit_id")
            if dep_id:
                existing_assignment[dep_id] = inv["id"]

    # Backfill effective shipping_cost from the LINKED SHIPMENT for each invoice.
    # The invoice document's `shipping_cost` field can be stale or zero (e.g. if the
    # shipment was created/edited after invoice creation and never synced back).
    # The shipment is the source of truth for the cost the client actually pays.
    inv_ids_for_ship = [i["id"] for i in all_invoices]
    shipping_by_inv = {}
    if inv_ids_for_ship:
        ship_docs = await db.shipments.find(
            {"invoice_id": {"$in": inv_ids_for_ship}, "tenant_id": tenant_id},
            {"_id": 0, "invoice_id": 1, "shipping_cost": 1}
        ).to_list(len(inv_ids_for_ship) * 2)
        for sd in ship_docs:
            iid = sd.get("invoice_id")
            if iid:
                # If multiple shipments per invoice (rare), sum them
                shipping_by_inv[iid] = shipping_by_inv.get(iid, 0) + (sd.get("shipping_cost") or 0)
    # Use shipment value when present, otherwise fall back to invoice.shipping_cost
    for inv in all_invoices:
        inv["_effective_shipping"] = shipping_by_inv.get(inv["id"], inv.get("shipping_cost", 0) or 0)

    # Defensive cleanup: any annulled invoice that still has stale applied_deposits
    # (from before annul cleared them) gets wiped here so historial views show $0.
    await db.invoices.update_many(
        {"customer_id": customer_id, "tenant_id": tenant_id,
         "is_annulled": True,
         "$or": [
             {"applied_deposits": {"$exists": True, "$ne": []}},
             {"deposits_applied": {"$gt": 0}},
         ]},
        {"$set": {"applied_deposits": [], "deposits_applied": 0}}
    )
    
    if not all_invoices:
        return
    
    # Group deposits by which invoice was the latest at the time of the deposit
    deposits_by_invoice = {inv["id"]: [] for inv in all_invoices}
    valid_invoice_ids = {inv["id"] for inv in all_invoices}
    inv_number_by_id = {inv["id"]: inv.get("invoice_number", inv["id"]) for inv in all_invoices}
    # dep_id -> invoice_id it ends up on (None/absent if it floats).
    computed_by_dep = {}

    for dep in all_deposits:
        dep_date = dep.get("created_at", "")
        target_invoice = None

        # 0) PERMANENT LOCK: if this deposit is already linked to a live invoice
        #    via `assigned_invoice_id`, keep it there. The recalc engine may
        #    NOT move it to another invoice nor let it float. Only if the linked
        #    invoice no longer exists / was annulled do we fall through so the
        #    money isn't stranded on a dead invoice.
        locked_id = dep.get("assigned_invoice_id")
        if locked_id and locked_id in valid_invoice_ids:
            target_invoice = next((i for i in all_invoices if i["id"] == locked_id), None)

        # 1) Manual override: admin explicitly chose the invoice via the
        #    "assign recarga" action (also sets assigned_invoice_id going
        #    forward, but honor legacy rows that only have target_invoice_id).
        if target_invoice is None:
            manual_target = dep.get("target_invoice_id")
            if manual_target and manual_target in valid_invoice_ids:
                target_invoice = next((i for i in all_invoices if i["id"] == manual_target), None)

        # 2) Preserve existing historical assignment: if this deposit was
        #    already attached to a still-live invoice, keep it there. Prevents
        #    the strict weekly rule from unlinking old deposits assigned under
        #    previous logic versions.
        if target_invoice is None:
            prev_inv_id = existing_assignment.get(dep.get("id", ""))
            if prev_inv_id and prev_inv_id in valid_invoice_ids:
                target_invoice = next((i for i in all_invoices if i["id"] == prev_inv_id), None)

        if target_invoice is None:
            # 3) Weekly cutoff: a deposit only auto-applies to an invoice
            #    created in the SAME Mon-Sun week (America/Guayaquil).
            #    If no invoice exists in that week → try legacy fallback.
            wk_start, wk_end = _billing_week_bounds(dep_date)
            same_week = []
            if wk_start:
                same_week = [i for i in all_invoices
                             if wk_start <= i["created_at"] < wk_end]
            if same_week:
                # Latest same-week invoice created before OR at the deposit time
                for inv in same_week:
                    if inv["created_at"] <= dep_date:
                        target_invoice = inv
                    else:
                        break
                # If deposit is before any same-week invoice, pick the earliest
                # of the same week (edge case: deposit early Monday, invoice
                # later Monday).
                if target_invoice is None:
                    target_invoice = same_week[0]
            else:
                # 4) Legacy migration fallback: deposit predates the client's
                #    first non-annulled invoice (typical for accounts that
                #    started before weekly facturación existed). Attach to
                #    the EARLIEST invoice so it doesn't drift as float.
                #    If deposit is AFTER the first invoice but has no
                #    same-week match → keep floating (respects "cierre
                #    semanal": each week's recharges live on their own
                #    week's invoice or wait for one).
                if all_invoices and dep_date < all_invoices[0]["created_at"]:
                    target_invoice = all_invoices[0]
                else:
                    continue  # float

        deposits_by_invoice[target_invoice["id"]].append({
            "deposit_id": dep.get("id", ""),
            "amount_applied": dep["amount"],
            "created_at": dep.get("created_at", ""),
            "description": dep.get("description", "")
        })
        computed_by_dep[dep.get("id", "")] = target_invoice["id"]
    
    # Update each invoice with its corresponding deposits.
    # We propagate two carries between LIVE invoices (already filtered: is_annulled != True):
    #   - carry_saldo_a_favor: any positive credit left over after settling an invoice
    #   - carry_saldo_pendiente: the previous live invoice's total_a_pagar becomes the
    #     next invoice's saldo_pendiente (inherited debt). This guarantees that if an
    #     intermediate invoice is annulled, the next one inherits debt directly from
    #     the previous LIVE invoice (not from the now-defunct one frozen at creation).
    # The first invoice keeps its stored saldo_pendiente, since it may legitimately
    # represent legacy/manual onboarding debt that has no prior invoice to recompute from.
    carry_saldo_a_favor = 0
    carry_saldo_pendiente = None  # None on first iteration => use stored value
    for inv_doc in all_invoices:
        inv_deposits = deposits_by_invoice.get(inv_doc["id"], [])
        total_deposits = round(sum(ad["amount_applied"] for ad in inv_deposits), 2)

        if carry_saldo_pendiente is None:
            saldo_pendiente_dyn = round(float(inv_doc.get("saldo_pendiente", 0) or 0), 2)
        else:
            saldo_pendiente_dyn = round(float(carry_saldo_pendiente), 2)

        inv_total = (inv_doc.get("total", 0) or 0) + saldo_pendiente_dyn + inv_doc.get("_effective_shipping", inv_doc.get("shipping_cost", 0) or 0)
        saldo_ant = carry_saldo_a_favor
        total_credits = total_deposits + saldo_ant

        if total_credits >= inv_total:
            total_a_pagar = 0
            saldo_a_favor = round(total_credits - inv_total, 2)
        else:
            total_a_pagar = round(inv_total - total_credits, 2)
            saldo_a_favor = 0

        carry_saldo_a_favor = saldo_a_favor
        carry_saldo_pendiente = total_a_pagar  # propagate to next LIVE invoice

        # Persist the effective shipping back to the invoice document so list views
        # and PDF (which read invoice.shipping_cost) stay consistent with the recalc.
        effective_shipping = inv_doc.get("_effective_shipping", inv_doc.get("shipping_cost", 0) or 0)
        await db.invoices.update_one(
            {"id": inv_doc["id"], "tenant_id": tenant_id},
            {"$set": {
                "applied_deposits": inv_deposits,
                "deposits_applied": total_deposits,
                "saldo_a_favor_anterior": saldo_ant,
                "saldo_pendiente": saldo_pendiente_dyn,
                "total_a_pagar": total_a_pagar,
                "saldo_a_favor": saldo_a_favor,
                "shipping_cost": round(effective_shipping, 2),
            }}
        )

    # ── Persist the permanent link (memory) + audit real moves ──
    # For every deposit that landed on an invoice, store `assigned_invoice_id`.
    # This is what turns the engine from a date-based redistribution into a
    # persistent, audited link: once written, priority #0 above keeps it there.
    for dep in all_deposits:
        dep_id = dep.get("id", "")
        new_inv = computed_by_dep.get(dep_id)
        if not new_inv:
            continue  # deposit floated (no live invoice) — leave memory untouched
        old_inv = dep.get("assigned_invoice_id")
        if old_inv == new_inv:
            continue  # already locked here — nothing to do
        await db.wallet_transactions.update_one(
            {"id": dep_id, "tenant_id": tenant_id},
            {"$set": {"assigned_invoice_id": new_inv}}
        )
        # Audit only genuine MOVES (was linked to a real invoice, now different).
        # First-time links (old_inv is None) are persisted silently to avoid
        # flooding the audit trail on the initial migration run.
        if old_inv:
            await log_audit_action(
                tenant_id=tenant_id,
                user_id=actor_id or "system",
                user_name=actor_name,
                user_role=actor_role,
                action="deposit_reassigned",
                entity_type="wallet_transaction",
                entity_id=dep_id,
                entity_name=f"Recarga ${dep.get('amount', 0)}",
                details={
                    "customer_id": customer_id,
                    "amount": dep.get("amount"),
                    "from_invoice_id": old_inv,
                    "from_invoice_number": inv_number_by_id.get(old_inv, old_inv),
                    "to_invoice_id": new_inv,
                    "to_invoice_number": inv_number_by_id.get(new_inv, new_inv),
                    "reason": "Factura destino anulada/eliminada — recálculo reubicó la recarga",
                },
            )


# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register")
async def register_user(data: UserRegister):
    tenant = await db.tenants.find_one({"slug": data.tenant_slug.lower(), "status": "active"}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Código de negocio no encontrado")
    tenant_id = tenant["id"]
    
    # Check if email belongs to an admin, superadmin or employee (PREVENT COLLISION)
    if data.email:
        existing_admin = await db.users.find_one({
            "email": data.email, 
            "role": {"$in": ["admin", "superadmin"]}
        }, {"_id": 0})
        if existing_admin:
            raise HTTPException(status_code=400, detail="Este email ya está registrado. Por favor use otro email.")
        existing_employee = await db.employees.find_one({"email": data.email}, {"_id": 0})
        if existing_employee:
            raise HTTPException(status_code=400, detail="Este email ya está registrado. Por favor use otro email.")
    
    existing = await db.users.find_one({
        "tenant_id": tenant_id,
        "$or": [{"whatsapp": data.whatsapp}, {"email": data.email} if data.email else {"_id": None}]
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Usuario ya registrado con este WhatsApp o email")
    referred_by = None
    if data.referral_code:
        referrer = await db.users.find_one({"customer_id": data.referral_code.upper(), "tenant_id": tenant_id}, {"_id": 0})
        if referrer:
            referred_by = data.referral_code.upper()
    customer_id = generate_customer_id(data.name)
    while await db.users.find_one({"customer_id": customer_id, "tenant_id": tenant_id}, {"_id": 0}):
        customer_id = generate_customer_id(data.name)
    user = User(tenant_id=tenant_id, customer_id=customer_id, referral_code=customer_id, referred_by=referred_by,
        name=data.name, country=data.country, whatsapp=data.whatsapp, email=data.email,
        whatsapp_consent=data.whatsapp_consent, password_hash=hash_password(data.password),
        password_plain=data.password, role="client")
    await db.users.insert_one(user.model_dump())
    wallet = Wallet(tenant_id=tenant_id, user_id=user.id, customer_id=customer_id)
    await db.wallets.insert_one(wallet.model_dump())
    await create_notification(tenant_id, user.id, customer_id, "welcome", "Bienvenido!",
        f"Tu ID de cliente es #{customer_id}. Usa este ID para tus compras en vivo.")
    if referred_by:
        await process_referral(tenant_id, referred_by, user.id, customer_id)
    token = create_token(user.id, "client", tenant_id)
    return {
        "message": "Usuario registrado exitosamente",
        "token": token,
        "user_id": user.id,
        "customer_id": customer_id,
        "name": user.name,
        "role": "client",
        "tenant_id": tenant_id,
        "tenant_name": tenant["business_name"],
        "tenant_logo": tenant.get("logo_url"),
        "tenant_slug": tenant.get("slug"),
    }

@api_router.get("/auth/me")
async def auth_me(current_user: dict = Depends(get_current_user)):
    """Return the freshest version of the authenticated user's profile.
    Used by the frontend to refresh cached permissions when an admin updates them
    server-side after the employee has already logged in."""
    role = current_user.get("role")
    profile = None
    if role == "employee":
        profile = await db.employees.find_one(
            {"id": current_user["user_id"]},
            {"_id": 0, "password_hash": 0}
        )
    if not profile:
        profile = await db.users.find_one(
            {"id": current_user["user_id"]},
            {"_id": 0, "password_hash": 0}
        )
    if not profile:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    tenant_name = None
    tenant_logo = None
    tenant_slug = None
    if profile.get("tenant_id"):
        tenant = await db.tenants.find_one({"id": profile["tenant_id"]}, {"_id": 0, "business_name": 1, "logo_url": 1, "slug": 1, "dashboard_banner_url": 1, "live_module_enabled": 1})
        if tenant:
            tenant_name = tenant.get("business_name")
            tenant_logo = tenant.get("logo_url")
            tenant_slug = tenant.get("slug")
    return {
        "user_id": profile["id"],
        "name": profile.get("name"),
        "role": role or profile.get("role"),
        "tenant_id": profile.get("tenant_id"),
        "tenant_name": tenant_name,
        "tenant_logo": tenant_logo,
        "tenant_slug": tenant_slug,
        "tenant_banner": (tenant or {}).get("dashboard_banner_url") if profile.get("tenant_id") else None,
        "live_module_enabled": bool((tenant or {}).get("live_module_enabled")) if profile.get("tenant_id") else False,
        "permissions": profile.get("permissions") or {},
        "customer_id": profile.get("customer_id"),
        "email": profile.get("email"),
    }


@api_router.post("/auth/login")
async def login_user(login_data: UserLogin):
    identifier = login_data.identifier.strip()
    identifier_lower = identifier.lower()
    
    # FIRST: Always check if identifier is a tenant slug - HIGHEST PRIORITY
    admin_from_slug = None
    tenant_by_slug = await db.tenants.find_one({"slug": identifier_lower}, {"_id": 0})
    if tenant_by_slug:
        admin_from_slug = await db.users.find_one({
            "tenant_id": tenant_by_slug["id"],
            "role": "admin"
        }, {"_id": 0})
        
        # If found admin from tenant slug and password matches, login immediately
        if admin_from_slug and verify_password(login_data.password, admin_from_slug["password_hash"]):
            tenant_id = admin_from_slug.get("tenant_id")
            tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
            tenant_name = tenant["business_name"] if tenant else None
            tenant_logo = tenant.get("logo_url") if tenant else None
            tenant_slug = tenant.get("slug") if tenant else None
            
            if tenant and tenant.get("status") != "active":
                raise HTTPException(status_code=403, detail="Tu negocio está suspendido. Contacta al administrador.")
            
            # Log admin login for audit
            await log_audit_action(
                tenant_id=tenant_id,
                user_id=admin_from_slug["id"],
                user_name=admin_from_slug["name"],
                user_role="admin",
                action="login",
                entity_type="session",
                entity_name="Inicio de sesión"
            )
            
            token = create_token(admin_from_slug["id"], admin_from_slug["role"], tenant_id)
            return {
                "message": "Login exitoso",
                "token": token,
                "user_id": admin_from_slug["id"],
                "customer_id": admin_from_slug.get("customer_id"),
                "name": admin_from_slug["name"],
                "role": admin_from_slug["role"],
                "tenant_id": tenant_id,
                "tenant_name": tenant_name,
                "tenant_logo": tenant_logo,
                "tenant_slug": tenant_slug,
                "email": admin_from_slug.get("email")
            }
    
    # Search in both collections simultaneously
    # 1. Search in users collection (admins, clients, superadmins)
    users_found = await db.users.find({
        "$or": [
            {"email": identifier},
            {"whatsapp": identifier},
            {"customer_id": identifier.upper()}
        ]
    }, {"_id": 0}).to_list(10)
    
    # 2. Search in employees collection (by email, whatsapp, username, or name)
    employee = await db.employees.find_one({
        "$or": [
            {"email": identifier},
            {"email": identifier_lower},
            {"whatsapp": identifier},
            {"username": identifier},
            {"username": identifier_lower},
            {"name": identifier},
            {"name": {"$regex": f"^{identifier}$", "$options": "i"}}  # Case-insensitive name match
        ]
    }, {"_id": 0})
    
    # Sort users by role priority: superadmin > admin > client
    user = None
    role_priority = {"superadmin": 0, "admin": 1, "client": 2}
    if users_found:
        users_found.sort(key=lambda u: role_priority.get(u.get("role", "client"), 3))
        user = users_found[0]
    
    # PRIORITY: superadmin/admin FIRST, then employee, then client
    # Check if we have an admin-level user - they take priority over employee
    admin_user = None
    if user and user.get("role") in ["superadmin", "admin"]:
        admin_user = user
    
    # If admin exists and password matches, use admin login (skip employee)
    if admin_user and verify_password(login_data.password, admin_user["password_hash"]):
        tenant_id = admin_user.get("tenant_id")
        tenant_name = None
        tenant_logo = None
        tenant_slug = None
        if tenant_id:
            tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
            if tenant:
                if tenant.get("status") != "active":
                    raise HTTPException(status_code=403, detail="Tu negocio está suspendido. Contacta al administrador.")
                tenant_name = tenant["business_name"]
                tenant_logo = tenant.get("logo_url")
                tenant_slug = tenant.get("slug")
        
        # Log admin login for audit
        if admin_user["role"] == "admin":
            await log_audit_action(
                tenant_id=tenant_id,
                user_id=admin_user["id"],
                user_name=admin_user["name"],
                user_role="admin",
                action="login",
                entity_type="session",
                entity_name="Inicio de sesión"
            )
        
        token = create_token(admin_user["id"], admin_user["role"], tenant_id)
        return {
            "message": "Login exitoso",
            "token": token,
            "user_id": admin_user["id"],
            "customer_id": admin_user.get("customer_id"),
            "name": admin_user["name"],
            "role": admin_user["role"],
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "tenant_logo": tenant_logo,
            "tenant_slug": tenant_slug,
            "email": admin_user.get("email")
        }
    
    # Try employee login second (after admin check)
    if employee:
        if verify_password(login_data.password, employee["password_hash"]):
            if employee.get("status") != "active":
                raise HTTPException(status_code=403, detail="Tu cuenta está inactiva. Contacta al administrador.")
            
            tenant_id = employee["tenant_id"]
            tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
            if not tenant or tenant.get("status") != "active":
                raise HTTPException(status_code=403, detail="El negocio está suspendido.")
            
            # Log employee login
            await log_audit_action(
                tenant_id=tenant_id,
                user_id=employee["id"],
                user_name=employee["name"],
                user_role="employee",
                action="login",
                entity_type="session",
                entity_name="Inicio de sesión"
            )
            
            token = create_token(employee["id"], "employee", tenant_id)
            return {
                "message": "Login exitoso",
                "token": token,
                "user_id": employee["id"],
                "customer_id": None,
                "name": employee["name"],
                "role": "employee",
                "tenant_id": tenant_id,
                "tenant_name": tenant["business_name"],
                "tenant_logo": tenant.get("logo_url"),
                "tenant_slug": tenant.get("slug"),
                "permissions": employee.get("permissions", {})
            }
    
    # Try user login for CLIENT only (admin/superadmin already handled above)
    if user and user.get("role") == "client" and verify_password(login_data.password, user["password_hash"]):
        tenant_id = user.get("tenant_id")
        tenant_name = None
        tenant_logo = None
        tenant_slug = None
        if tenant_id:
            tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
            if tenant:
                if tenant.get("status") != "active":
                    raise HTTPException(status_code=403, detail="Tu negocio está suspendido. Contacta al administrador.")
                tenant_name = tenant["business_name"]
                tenant_logo = tenant.get("logo_url")
                tenant_slug = tenant.get("slug")
        
        token = create_token(user["id"], user["role"], tenant_id)
        return {
            "message": "Login exitoso",
            "token": token,
            "user_id": user["id"],
            "customer_id": user["customer_id"],
            "name": user["name"],
            "role": user["role"],
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "tenant_logo": tenant_logo,
            "tenant_slug": tenant_slug,
        }
    
    # No valid credentials found
    raise HTTPException(status_code=401, detail="Credenciales inválidas")

@api_router.get("/auth/user/{user_id}")
async def get_user(user_id: str, current_user: dict = Depends(get_current_user)):
    query = {"id": user_id}
    if current_user["role"] != "superadmin":
        query["tenant_id"] = current_user["tenant_id"]
    user = await db.users.find_one(query, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@api_router.post("/admin/recalculate-invoices/{customer_id}")
async def admin_recalculate_invoices(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Force recalculate all invoices for a client (deposits by date, full amounts)."""
    if current_user["role"] not in ["admin"]:
        raise HTTPException(status_code=403, detail="Solo admin")
    tid = current_user["tenant_id"]
    await recalculate_client_invoices(tid, customer_id.upper())
    return {"message": f"Facturas de {customer_id.upper()} recalculadas"}

@api_router.post("/admin/recalculate-all-invoices")
async def admin_recalculate_all(current_user: dict = Depends(get_current_user)):
    """Force recalculate invoices for ALL clients."""
    if current_user["role"] not in ["admin"]:
        raise HTTPException(status_code=403, detail="Solo admin")
    tid = current_user["tenant_id"]
    client_ids = await db.invoices.distinct("customer_id", {"tenant_id": tid, "is_annulled": {"$ne": True}})
    for cid in client_ids:
        await recalculate_client_invoices(tid, cid)
    return {"message": f"{len(client_ids)} clientes recalculados"}


# ==================== SUPERADMIN ENDPOINTS ====================

@api_router.post("/superadmin/seed")
async def seed_superadmin():
    existing = await db.users.find_one({"role": "superadmin"}, {"_id": 0})
    if existing:
        return {"message": "Superadmin ya existe", "email": existing.get("email")}
    sa = User(
        customer_id="SA0001",
        referral_code="SA0001",
        name="Super Administrador",
        country="Global",
        whatsapp="+0000000000",
        email="superadmin@outletsusaec.com",
        password_hash=hash_password("super123"),
        role="superadmin"
    )
    await db.users.insert_one(sa.model_dump())
    return {"message": "Superadmin creado", "email": "superadmin@outletsusaec.com", "password": "super123"}

@api_router.get("/superadmin/tenants")
async def list_tenants(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenants = await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(20000)
    result = []
    for t in tenants:
        admin_count = await db.users.count_documents({"tenant_id": t["id"], "role": "admin"})
        client_count = await db.users.count_documents({"tenant_id": t["id"], "role": "client"})
        if t.get("shipping_categories"):
            t["shipping_categories"] = _ensure_category_dual_prices(t["shipping_categories"])
        result.append({**t, "admin_count": admin_count, "client_count": client_count})
    return result

@api_router.post("/superadmin/tenants")
async def create_tenant(data: CreateTenantRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    slug = data.slug.lower().strip().replace(" ", "-")
    existing = await db.tenants.find_one({"slug": slug}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Este slug ya está en uso")
    
    tenant = Tenant(
        business_name=data.business_name, 
        slug=slug, 
        owner_name=data.owner_name or "", 
        email=data.email or ""
    )
    await db.tenants.insert_one(tenant.model_dump())
    
    # Create a default admin user for this tenant
    admin_name = data.owner_name or "Administrador"
    admin_email = f"admin@{slug}.com"
    customer_id = generate_customer_id(admin_name)
    while await db.users.find_one({"customer_id": customer_id}, {"_id": 0}):
        customer_id = generate_customer_id(admin_name)
    
    # Check if email already exists, if so, append a number
    base_email = admin_email
    counter = 1
    while await db.users.find_one({"email": admin_email}, {"_id": 0}):
        admin_email = f"admin{counter}@{slug}.com"
        counter += 1
    
    admin = User(
        tenant_id=tenant.id, 
        customer_id=customer_id, 
        referral_code=customer_id,
        name=admin_name, 
        country="", 
        whatsapp="",
        email=admin_email, 
        password_hash=hash_password("temp123456"),  # Temporary password
        role="admin"
    )
    await db.users.insert_one(admin.model_dump())
    
    return {
        "message": "Tenant creado exitosamente",
        "tenant_id": tenant.id,
        "tenant_slug": slug,
        "admin_id": admin.id,
        "admin_email": admin_email,
        "note": "Usa el botón 'Password' para establecer la contraseña del admin"
    }

@api_router.put("/superadmin/tenants/{tenant_id}")
async def update_tenant(tenant_id: str, status: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    if status not in ["active", "suspended"]:
        raise HTTPException(status_code=400, detail="Estado inválido")
    result = await db.tenants.update_one({"id": tenant_id}, {"$set": {"status": status}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    return {"message": f"Tenant actualizado a {status}"}

@api_router.put("/superadmin/tenants/{tenant_id}/tax-options")
async def update_tenant_tax_options_superadmin(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Superadmin endpoint to update tax options for a specific tenant"""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    tax_options = data.get("tax_options", [])
    if not tax_options:
        raise HTTPException(status_code=400, detail="Se requieren opciones de impuestos")
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"tax_options": tax_options}})
    return {"message": "Opciones de impuestos actualizadas para el tenant", "tax_options": tax_options}


def _normalize_shipping_categories(raw):
    """Validate and normalize a list of shipping categories.
    Each category stores independent prices for packages and pounds modes
    (what we charge the client), plus the courier-side costs we pay to the
    shipping company for each unit (packages and pounds).
    Accepts legacy `value` and maps it to both `value_packages` and `value_pounds` if those are missing.
    """
    out = []
    for item in raw or []:
        key = str(item.get("key", "")).strip().upper()
        label = str(item.get("label", "")).strip()
        # Legacy fallback for what we charge the client
        try:
            legacy_value = float(item.get("value", 0) or 0)
        except (TypeError, ValueError):
            legacy_value = 0
        try:
            value_packages = float(item.get("value_packages", legacy_value) or 0)
        except (TypeError, ValueError):
            value_packages = legacy_value
        try:
            value_pounds = float(item.get("value_pounds", legacy_value) or 0)
        except (TypeError, ValueError):
            value_pounds = legacy_value
        # New: what we pay the courier (defaults to 0 when not provided)
        try:
            courier_cost_packages = float(item.get("courier_cost_packages", 0) or 0)
        except (TypeError, ValueError):
            courier_cost_packages = 0
        try:
            courier_cost_pounds = float(item.get("courier_cost_pounds", 0) or 0)
        except (TypeError, ValueError):
            courier_cost_pounds = 0
        if not key or not label or value_packages < 0 or value_pounds < 0 or courier_cost_packages < 0 or courier_cost_pounds < 0:
            continue
        out.append({
            "key": key,
            "label": label,
            "value_packages": round(value_packages, 2),
            "value_pounds": round(value_pounds, 2),
            # Courier-side prices (paid to the shipping company)
            "courier_cost_packages": round(courier_cost_packages, 2),
            "courier_cost_pounds": round(courier_cost_pounds, 2),
            # Keep legacy `value` in sync with packages price for backward compatibility
            "value": round(value_packages, 2),
        })
    return out


def _price_shipment_packages(packages: list, categories: list, mode: str) -> list:
    """Price each package with its own category's tenant price (OTHER keeps its custom unit cost)."""
    price_field = "value_pounds" if mode == "pounds" else "value_packages"
    priced = []
    for p in packages or []:
        key = str(p.get("shipping_category") or "").upper()
        try:
            qty = float(p.get("package_count") or 0)
        except (TypeError, ValueError):
            qty = 0
        if mode != "pounds":
            qty = int(round(qty))
        if not key or qty <= 0:
            continue
        if key == "OTHER":
            unit = float(p.get("unit_cost") or 0)
        else:
            cat = next((c for c in categories if str(c.get("key", "")).upper() == key), None)
            if not cat:
                raise HTTPException(status_code=400, detail=f"Categoría de envío {key} no encontrada")
            unit = float(cat.get(price_field, cat.get("value", 0)) or 0)
        priced.append({"shipping_category": key, "unit_cost": round(unit, 2), "package_count": qty, "cost": round(unit * qty, 2)})
    return priced

def _ensure_category_dual_prices(categories):
    """Ensure every category has dual prices (packages/pounds) for both
    the client-facing price and the courier-side cost we pay.
    Used to migrate legacy docs on-the-fly when sending to the frontend.
    """
    if not isinstance(categories, list):
        return []
    out = []
    for c in categories:
        if not isinstance(c, dict):
            continue
        legacy = c.get("value", 0) or 0
        c.setdefault("value_packages", c.get("value_packages", legacy))
        c.setdefault("value_pounds", c.get("value_pounds", legacy))
        c.setdefault("courier_cost_packages", c.get("courier_cost_packages", 0))
        c.setdefault("courier_cost_pounds", c.get("courier_cost_pounds", 0))
        c["value"] = c.get("value_packages", legacy)
        out.append(c)
    return out


@api_router.get("/admin/settings/shipping-categories")
async def get_shipping_categories_admin(current_user: dict = Depends(get_current_user)):
    """Returns the current shipping categories with client-side prices and
    courier-side costs. Used by AdminShipments to render the live "Pago a Empresa
    Paquetería" widget without hitting the full reports/summary endpoint.
    """
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": current_user["tenant_id"]}, {"_id": 0, "shipping_categories": 1, "shipping_mode": 1})
    cats = _ensure_category_dual_prices((tenant or {}).get("shipping_categories", []))
    return {"shipping_categories": cats, "shipping_mode": (tenant or {}).get("shipping_mode", "packages")}


@api_router.put("/admin/settings/shipping-categories")
async def update_shipping_categories_admin(data: dict, current_user: dict = Depends(get_current_user)):
    """Tenant admin updates shipping categories used when creating shipments."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    normalized = _normalize_shipping_categories(data.get("shipping_categories", []))
    if not normalized:
        raise HTTPException(status_code=400, detail="Se requiere al menos una categoría válida")
    update_fields = {"shipping_categories": normalized}
    mode = data.get("shipping_mode")
    if mode in ("packages", "pounds"):
        update_fields["shipping_mode"] = mode
    await db.tenants.update_one({"id": tid}, {"$set": update_fields})
    return {"message": "Categorías de envío actualizadas", **update_fields}


@api_router.put("/superadmin/tenants/{tenant_id}/shipping-categories")
async def update_shipping_categories_superadmin(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Superadmin updates shipping categories for a specific tenant."""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    normalized = _normalize_shipping_categories(data.get("shipping_categories", []))
    if not normalized:
        raise HTTPException(status_code=400, detail="Se requiere al menos una categoría válida")
    update_fields = {"shipping_categories": normalized}
    mode = data.get("shipping_mode")
    if mode in ("packages", "pounds"):
        update_fields["shipping_mode"] = mode
    await db.tenants.update_one({"id": tenant_id}, {"$set": update_fields})
    return {"message": "Categorías de envío actualizadas para el tenant", **update_fields}


# ==================== BANK ACCOUNTS (Superadmin config + Admin operations) ====================

def _normalize_bank_accounts(raw):
    """Validate and normalize a list of bank accounts.
    Each account: owner_name, owner_id, account_number, bank_name, currency, is_active.
    `id` is auto-generated for new ones, preserved for existing ones.
    """
    out = []
    seen_ids = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        owner_name = str(item.get("owner_name", "")).strip()
        account_number = str(item.get("account_number", "")).strip()
        bank_name = str(item.get("bank_name", "")).strip()
        if not owner_name or not account_number or not bank_name:
            continue
        acc_id = str(item.get("id") or "").strip() or str(uuid.uuid4())
        if acc_id in seen_ids:
            acc_id = str(uuid.uuid4())
        seen_ids.add(acc_id)
        out.append({
            "id": acc_id,
            "owner_name": owner_name,
            "owner_id": str(item.get("owner_id", "")).strip(),
            "account_number": account_number,
            "bank_name": bank_name,
            "currency": str(item.get("currency", "USD")).strip().upper() or "USD",
            "is_active": item.get("is_active", True) is not False,
            "created_at": item.get("created_at") or datetime.now(timezone.utc).isoformat(),
        })
    return out


def _normalize_text_for_match(s: str) -> str:
    """Lowercase, strip accents, collapse whitespace — for fuzzy name matching."""
    if not s:
        return ""
    import unicodedata
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.lower().split())


def _find_matching_bank_account(accounts: list, ocr_text: str, account_number_hint: str = None, owner_name_hint: str = None):
    """Match a recharge to one of the tenant's bank accounts.

    Required rule (per product spec):
      A match needs BOTH:
        1) At least one token of the OCR owner-name (any given-name or surname,
           order-insensitive, accent-insensitive) is present in the configured
           account's `owner_name`, AND
        2) The last 4 digits of the OCR destination account match the
           configured `account_number` (either as a substring or the trailing 4).

    Falls back to:
      - Exact full account-number substring match if the AI-extracted account
        wasn't trimmed by OCR.
    Returns the account dict or None.
    """
    accounts = [a for a in (accounts or []) if a.get("is_active", True) is not False]
    if not accounts:
        return None

    text_pool_raw = " ".join([str(x) for x in (ocr_text, account_number_hint, owner_name_hint) if x])
    text_pool = _normalize_text_for_match(text_pool_raw)
    digits_in_text = "".join(c for c in text_pool_raw if c.isdigit())

    # Parse hints
    hint_account = "".join(c for c in str(account_number_hint or "") if c.isdigit())
    hint_owner_norm = _normalize_text_for_match(owner_name_hint or "")
    hint_owner_tokens = {t for t in hint_owner_norm.split() if len(t) >= 3}

    for acc in accounts:
        acc_num = str(acc.get("account_number", "")).strip()
        acc_num_digits = "".join(c for c in acc_num if c.isdigit())
        if not acc_num_digits:
            continue
        last4 = acc_num_digits[-4:]
        owner_norm = _normalize_text_for_match(acc.get("owner_name", ""))
        owner_tokens = {t for t in owner_norm.split() if len(t) >= 3}

        # ── Number match (any of these counts) ──
        number_match = False
        if hint_account:
            # Strong: hint includes the full account number (or its last 4).
            if acc_num_digits and acc_num_digits in hint_account:
                number_match = True
            elif last4 and hint_account.endswith(last4):
                number_match = True
            elif last4 and last4 in hint_account:
                number_match = True
        if not number_match and digits_in_text:
            # Weaker: last 4 of the configured account appear in the OCR digits.
            if acc_num_digits in digits_in_text or last4 in digits_in_text:
                number_match = True

        # ── Owner match (any token in common) ──
        owner_match = False
        if hint_owner_tokens and owner_tokens & hint_owner_tokens:
            owner_match = True
        elif owner_tokens:
            # Look for any token of the configured owner in the full OCR text.
            for tok in owner_tokens:
                if tok and tok in text_pool:
                    owner_match = True
                    break

        if number_match and owner_match:
            return acc

    return None


@api_router.get("/superadmin/tenants/{tenant_id}/bank-accounts")
async def list_bank_accounts_superadmin(tenant_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "bank_accounts": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    return {"bank_accounts": tenant.get("bank_accounts", [])}


@api_router.put("/superadmin/tenants/{tenant_id}/bank-accounts")
async def update_bank_accounts_superadmin(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    normalized = _normalize_bank_accounts(data.get("bank_accounts", []))
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"bank_accounts": normalized}})
    return {"message": "Cuentas bancarias actualizadas", "bank_accounts": normalized}


@api_router.get("/admin/bank-accounts")
async def list_bank_accounts_admin(current_user: dict = Depends(get_current_user)):
    """Admin/employee can list their own tenant accounts."""
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": current_user["tenant_id"]}, {"_id": 0, "bank_accounts": 1})
    return {"bank_accounts": (tenant or {}).get("bank_accounts", [])}


@api_router.put("/admin/bank-accounts")
async def update_bank_accounts_admin(data: dict, current_user: dict = Depends(get_current_user)):
    """Admin (or employee with the banking permission) manages the bank
    accounts of their OWN tenant — same normalization/logic as the superadmin
    endpoint, but scoped to the caller's tenant."""
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    if current_user["role"] == "employee":
        emp = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0, "permissions": 1})
        if not emp or not emp.get("permissions", {}).get("manage_bank_accounts"):
            raise HTTPException(status_code=403, detail="No tienes permiso para gestionar cuentas bancarias")
    tid = current_user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "id": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    normalized = _normalize_bank_accounts(data.get("bank_accounts", []))
    await db.tenants.update_one({"id": tid}, {"$set": {"bank_accounts": normalized}})
    return {"message": "Cuentas bancarias actualizadas", "bank_accounts": normalized}


async def _compute_account_balance(tenant_id: str, account_id: str) -> dict:
    """Sum recharge + manual deposits (credits) − withdrawals (debits).

    Soft-deleted rows (`is_deleted=True`) are excluded from every total so the
    balance always reflects only the money that is actually in the account.
    Deleted rows are still returned in the ledger listing (grayed out) for
    audit-trail purposes.
    """
    pipeline = [
        {"$match": {
            "tenant_id": tenant_id,
            "bank_account_id": account_id,
            "is_deleted": {"$ne": True},
        }},
        {"$group": {
            "_id": "$kind",
            "total": {"$sum": "$amount"},
            "count": {"$sum": 1}
        }}
    ]
    cur = db.bank_transactions.aggregate(pipeline)
    sums = {"recharge": 0.0, "manual_deposit": 0.0, "withdrawal": 0.0,
            "adjustment_deposit": 0.0, "adjustment_withdrawal": 0.0}
    counts = {"recharge": 0, "manual_deposit": 0, "withdrawal": 0,
              "adjustment_deposit": 0, "adjustment_withdrawal": 0}
    async for row in cur:
        k = row.get("_id")
        if k in sums:
            sums[k] = float(row.get("total", 0) or 0)
            counts[k] = int(row.get("count", 0) or 0)
    credits = sums["recharge"] + sums["manual_deposit"] + sums["adjustment_deposit"]
    debits = sums["withdrawal"] + sums["adjustment_withdrawal"]
    return {
        "balance": round(credits - debits, 2),
        "total_recharges": round(sums["recharge"], 2),
        "total_manual_deposits": round(sums["manual_deposit"], 2),
        "total_withdrawals": round(debits, 2),
        "recharge_count": counts["recharge"],
        "manual_deposit_count": counts["manual_deposit"],
        "withdrawal_count": counts["withdrawal"],
    }


@api_router.get("/admin/bank-accounts/summary")
async def get_bank_accounts_summary(current_user: dict = Depends(get_current_user)):
    """Per-account balances and aggregate totals for the Cuentas dashboard."""
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1, "business_name": 1, "logo_url": 1})
    accounts = (tenant or {}).get("bank_accounts", [])
    rows = []
    grand_balance = 0.0
    for acc in accounts:
        stats = await _compute_account_balance(tid, acc["id"])
        rows.append({**acc, **stats})
        grand_balance += stats["balance"]
    # Unassigned approved recharges (no bank_account_id set yet) — needs admin attention.
    unassigned = await db.wallet_transactions.count_documents({
        "tenant_id": tid, "type": "deposit", "status": "approved",
        "is_deleted": {"$ne": True},
        "$or": [{"bank_account_id": None}, {"bank_account_id": {"$exists": False}}]
    })
    return {
        "accounts": rows,
        "grand_balance": round(grand_balance, 2),
        "unassigned_recharges_count": unassigned,
        "tenant_name": (tenant or {}).get("business_name"),
        "tenant_logo": (tenant or {}).get("logo_url"),
    }


@api_router.get("/admin/bank-accounts/{account_id}/transactions")
async def list_account_transactions(account_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    q = {"tenant_id": tid, "bank_account_id": account_id}
    if start_date and end_date:
        q["created_at"] = {"$gte": start_date, "$lte": end_date}
    txs = await db.bank_transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(20000)
    stats = await _compute_account_balance(tid, account_id)
    return {"transactions": txs, **stats}


@api_router.post("/admin/bank-accounts/{account_id}/deposit")
async def manual_deposit_account(account_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    amount = float(data.get("amount", 0) or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")
    description = str(data.get("description", "")).strip() or "Depósito manual"
    tid = current_user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
    accs = [a for a in (tenant or {}).get("bank_accounts", []) if a.get("id") == account_id]
    if not accs:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    actor_name = await get_actor_name(current_user["user_id"])
    tx = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "bank_account_id": account_id,
        "kind": "manual_deposit",
        "amount": round(amount, 2),
        "description": description,
        "source_transaction_id": None,
        "customer_id": None,
        "customer_name": None,
        "reference_number": data.get("reference_number"),
        "created_by": current_user["user_id"],
        "created_by_name": actor_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bank_transactions.insert_one(tx)
    try:
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user["role"], action="bank_manual_deposit",
            entity_type="bank_transaction", entity_id=tx["id"],
            entity_name=f"{accs[0].get('bank_name')} #{accs[0].get('account_number')}",
            details={"amount": tx["amount"], "account_id": account_id, "description": description}
        )
    except Exception:
        pass
    tx.pop("_id", None)
    return {"message": "Depósito manual registrado", "transaction": tx}


@api_router.post("/admin/bank-accounts/{account_id}/withdrawal")
async def manual_withdrawal_account(account_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    amount = float(data.get("amount", 0) or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")
    description = str(data.get("description", "")).strip() or "Retiro manual"
    tid = current_user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
    accs = [a for a in (tenant or {}).get("bank_accounts", []) if a.get("id") == account_id]
    if not accs:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    # Optional: prevent negative balances unless override flag is set.
    stats = await _compute_account_balance(tid, account_id)
    if amount > stats["balance"] and not data.get("allow_overdraft"):
        raise HTTPException(status_code=400, detail=f"Saldo insuficiente. Disponible: ${stats['balance']:.2f}")
    actor_name = await get_actor_name(current_user["user_id"])
    tx = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "bank_account_id": account_id,
        "kind": "withdrawal",
        "amount": round(amount, 2),
        "description": description,
        "source_transaction_id": None,
        "customer_id": None,
        "customer_name": None,
        "reference_number": data.get("reference_number"),
        "created_by": current_user["user_id"],
        "created_by_name": actor_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bank_transactions.insert_one(tx)
    try:
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user["role"], action="bank_withdrawal",
            entity_type="bank_transaction", entity_id=tx["id"],
            entity_name=f"{accs[0].get('bank_name')} #{accs[0].get('account_number')}",
            details={"amount": tx["amount"], "account_id": account_id, "description": description}
        )
    except Exception:
        pass
    tx.pop("_id", None)
    return {"message": "Retiro registrado", "transaction": tx}


@api_router.post("/admin/bank-accounts/{account_id}/zero-out")
async def zero_out_bank_account(account_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Reset a bank account balance to $0 by inserting a single adjustment
    transaction of the opposite sign. Nothing in the historic ledger is
    deleted — the full trail stays intact for auditing.

    Requires re-entering the admin password (data.password) because this is
    a sensitive financial action.
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo admin puede resetear cuentas")
    if not data or not data.get("password"):
        raise HTTPException(status_code=400, detail="Contraseña de administrador requerida")
    tid = current_user["tenant_id"]
    admin = await db.users.find_one({"id": current_user["user_id"], "tenant_id": tid})
    if not admin or not verify_password(data["password"], admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")

    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
    accs = [a for a in (tenant or {}).get("bank_accounts", []) if a.get("id") == account_id]
    if not accs:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    stats = await _compute_account_balance(tid, account_id)
    current_balance = round(float(stats.get("balance", 0) or 0), 2)
    if abs(current_balance) < 0.01:
        return {"message": "La cuenta ya está en \$0.00", "adjusted": 0, "previous_balance": current_balance}

    reason = str(data.get("reason", "")).strip() or "Ajuste manual a cero"
    actor_name = await get_actor_name(current_user["user_id"])

    # If balance is positive, we book a withdrawal adjustment; if negative,
    # a deposit adjustment. Kind stays "adjustment" so it's easy to filter
    # in reports.
    if current_balance > 0:
        adj_kind = "adjustment_withdrawal"
        adj_amount = current_balance
    else:
        adj_kind = "adjustment_deposit"
        adj_amount = abs(current_balance)

    tx = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "bank_account_id": account_id,
        "kind": adj_kind,
        "amount": round(adj_amount, 2),
        "description": f"[AJUSTE A CERO] {reason} — saldo previo ${current_balance:.2f}",
        "source_transaction_id": None,
        "customer_id": None,
        "customer_name": None,
        "reference_number": None,
        "created_by": current_user["user_id"],
        "created_by_name": actor_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "is_zero_out_adjustment": True,
        "previous_balance": current_balance,
    }
    await db.bank_transactions.insert_one(tx)
    try:
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user["role"], action="bank_zero_out",
            entity_type="bank_transaction", entity_id=tx["id"],
            entity_name=f"{accs[0].get('bank_name')} #{accs[0].get('account_number')}",
            details={"previous_balance": current_balance, "adjustment_amount": tx["amount"],
                     "adjustment_kind": adj_kind, "reason": reason, "account_id": account_id}
        )
    except Exception:
        pass
    tx.pop("_id", None)
    return {
        "message": "Cuenta reseteada a \$0.00. Todo el historial se conserva.",
        "adjustment_transaction": tx,
        "previous_balance": current_balance,
    }



@api_router.get("/admin/bank-accounts/unassigned-recharges")
async def list_unassigned_recharges(current_user: dict = Depends(get_current_user)):
    """Lists approved recharges that don't have a `bank_account_id` set yet.
    Includes the AI-extracted destination_account/beneficiary so the admin can
    pick the right account from a dropdown without leaving the screen.
    """
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    txs = await db.wallet_transactions.find({
        "tenant_id": tid,
        "type": "deposit",
        "status": "approved",
        "is_deleted": {"$ne": True},
        "$or": [{"bank_account_id": None}, {"bank_account_id": {"$exists": False}}, {"bank_account_id": ""}]
    }, {
        "_id": 0, "id": 1, "amount": 1, "customer_id": 1, "user_name": 1,
        "reference_number": 1, "approved_at": 1, "created_at": 1, "description": 1,
        "ai_scan": 1, "proof_url": 1, "proof_path": 1
    }).sort("approved_at", -1).to_list(20000)

    # Include the active accounts so the frontend can render the dropdown.
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
    accounts = [a for a in (tenant or {}).get("bank_accounts", []) if a.get("is_active", True) is not False]

    # Annotate each tx with a suggested match (if any) using the same matcher.
    enriched = []
    for tx in txs:
        ai = tx.get("ai_scan") or {}
        suggestion = _find_matching_bank_account(
            accounts,
            str(ai.get("raw_text") or ai.get("text") or ""),
            account_number_hint=ai.get("detected_destination_account"),
            owner_name_hint=ai.get("detected_beneficiary_name"),
        )
        enriched.append({
            **tx,
            "ai_detected_destination_account": ai.get("detected_destination_account"),
            "ai_detected_beneficiary_name": ai.get("detected_beneficiary_name"),
            "ai_detected_reference_number": ai.get("detected_reference_number"),
            "ai_confidence": ai.get("confidence"),
            "suggested_bank_account_id": suggestion["id"] if suggestion else None,
        })

    return {
        "unassigned": enriched,
        "accounts": accounts,
        "total": len(enriched)
    }


@api_router.post("/admin/bank-accounts/backfill-recharges")
async def backfill_recharges(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Backfill the bank ledger for historical approved recharges.

    For each approved deposit without a `bank_account_id`, attribute it to the
    target account (provided in body as `bank_account_id`) and insert the
    matching `bank_transactions` row. Useful right after configuring bank
    accounts for the first time — fills the ledger with everything that came
    before the feature existed.

    Body: { "bank_account_id": "<id>" }  (required if tenant has >1 account)
    """
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    data = data or {}
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
    active = [a for a in (tenant or {}).get("bank_accounts", []) if a.get("is_active", True) is not False]
    if not active:
        raise HTTPException(status_code=400, detail="No hay cuentas bancarias activas configuradas")
    target_id = data.get("bank_account_id")
    if not target_id:
        if len(active) != 1:
            raise HTTPException(status_code=400, detail="Especifica bank_account_id; hay varias cuentas activas")
        target_id = active[0]["id"]
    if not any(a["id"] == target_id for a in active):
        raise HTTPException(status_code=404, detail="Cuenta bancaria no encontrada")

    # Find approved deposits without bank_account_id (or with empty)
    cursor = db.wallet_transactions.find({
        "tenant_id": tid,
        "type": "deposit",
        "status": "approved",
        "is_deleted": {"$ne": True},
        "$or": [{"bank_account_id": None}, {"bank_account_id": {"$exists": False}}, {"bank_account_id": ""}]
    }, {"_id": 0})

    actor_name = await get_actor_name(current_user["user_id"])
    assigned = 0
    async for tx in cursor:
        # Idempotency: if there's already a recharge ledger row tied to this tx, skip insert.
        existing = await db.bank_transactions.find_one({
            "tenant_id": tid, "source_transaction_id": tx["id"], "kind": "recharge"
        })
        await db.wallet_transactions.update_one(
            {"id": tx["id"], "tenant_id": tid},
            {"$set": {"bank_account_id": target_id, "bank_account_assigned_via": "backfill"}}
        )
        if not existing:
            # Backfill uses the wallet_transaction's approval/creation moment
            # as the ledger date — matches the "system entry date" rule for
            # normal recharges.
            _ledger_at = tx.get("approved_at") or tx.get("created_at") or datetime.now(timezone.utc).isoformat()
            await db.bank_transactions.insert_one({
                "id": str(uuid.uuid4()),
                "tenant_id": tid,
                "bank_account_id": target_id,
                "kind": "recharge",
                "amount": float(tx.get("amount", 0) or 0),
                "description": tx.get("description") or "Recarga de cliente (backfill)",
                "source_transaction_id": tx["id"],
                "customer_id": tx.get("customer_id"),
                "customer_name": tx.get("user_name"),
                "reference_number": tx.get("reference_number"),
                "created_by": current_user["user_id"],
                "created_by_name": actor_name,
                "created_at": _ledger_at,
            })
        assigned += 1
    try:
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user["role"], action="bank_backfill_recharges",
            entity_type="bank_transaction", entity_id=target_id,
            entity_name="Backfill de recargas históricas",
            details={"assigned_count": assigned, "bank_account_id": target_id}
        )
    except Exception:
        pass
    return {"message": f"Se asignaron {assigned} recargas a la cuenta", "assigned_count": assigned, "bank_account_id": target_id}


@api_router.put("/admin/wallet-transactions/{tx_id}/assign-bank-account")
async def assign_bank_account_to_recharge(tx_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Admin manually attaches/changes the bank account for an approved deposit.
    This is the override used when AI couldn't auto-match the recharge.
    """
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    new_account_id = (data.get("bank_account_id") or "").strip() or None
    wtx = await db.wallet_transactions.find_one({"id": tx_id, "tenant_id": tid}, {"_id": 0})
    if not wtx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if wtx.get("type") != "deposit":
        raise HTTPException(status_code=400, detail="Solo se pueden reasignar recargas (depósitos)")

    # Validate the new account exists (when not clearing)
    if new_account_id:
        tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
        ids = {a.get("id") for a in (tenant or {}).get("bank_accounts", [])}
        if new_account_id not in ids:
            raise HTTPException(status_code=404, detail="Cuenta bancaria no encontrada")

    old_account_id = wtx.get("bank_account_id")
    await db.wallet_transactions.update_one(
        {"id": tx_id, "tenant_id": tid},
        {"$set": {"bank_account_id": new_account_id}}
    )
    # Sync the bank ledger: remove old recharge entry, create new one (only if tx is approved).
    await db.bank_transactions.delete_many({"tenant_id": tid, "source_transaction_id": tx_id, "kind": "recharge"})
    if new_account_id and wtx.get("status") == "approved" and not wtx.get("is_deleted"):
        actor_name = await get_actor_name(current_user["user_id"])
        # Use the original approval/creation timestamp of the wallet_transaction
        # (matches system-entry date rule).
        _ledger_at = wtx.get("approved_at") or wtx.get("created_at") or datetime.now(timezone.utc).isoformat()
        await db.bank_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "bank_account_id": new_account_id,
            "kind": "recharge",
            "amount": float(wtx.get("amount", 0) or 0),
            "description": wtx.get("description") or "Recarga de cliente",
            "source_transaction_id": tx_id,
            "customer_id": wtx.get("customer_id"),
            "customer_name": wtx.get("user_name") or wtx.get("description"),
            "reference_number": wtx.get("reference_number"),
            "created_by": current_user["user_id"],
            "created_by_name": actor_name,
            "created_at": _ledger_at,
        })
    return {"message": "Cuenta reasignada", "old": old_account_id, "new": new_account_id}


@api_router.get("/superadmin/tenants/{tenant_id}/details")
async def get_tenant_details(tenant_id: str, current_user: dict = Depends(get_current_user)):
    """Get full tenant details including tax options"""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    default_tax_options = [
        {"value": "8.25", "label": "8.25%"},
        {"value": "10", "label": "10%"},
        {"value": "15", "label": "15%"},
        {"value": "0", "label": "Sin Taxes"},
        {"value": "other", "label": "Otro"}
    ]
    default_shipping_categories = [
        {"key": "G", "label": "Categoría G (CON Núcleo Familiar)", "value_packages": 32, "value_pounds": 32, "value": 32},
        {"key": "A", "label": "Categoría A (Personal)", "value_packages": 42, "value_pounds": 42, "value": 42},
        {"key": "B", "label": "Categoría B (SIN Núcleo Familiar)", "value_packages": 52, "value_pounds": 52, "value": 52}
    ]
    tenant["tax_options"] = tenant.get("tax_options", default_tax_options)
    tenant["shipping_categories"] = _ensure_category_dual_prices(tenant.get("shipping_categories", default_shipping_categories))
    return tenant

@api_router.put("/superadmin/tenants/{tenant_id}/tracking-url")
async def update_tenant_tracking_url(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update the tracking URL template for a tenant"""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    
    tracking_url = data.get("tracking_url_template", "")
    await db.tenants.update_one(
        {"id": tenant_id},
        {"$set": {"tracking_url_template": tracking_url}}
    )
    return {"message": "URL de tracking actualizado", "tracking_url_template": tracking_url}

@api_router.post("/superadmin/tenants/{tenant_id}/admin")
async def create_admin_for_tenant(tenant_id: str, data: CreateAdminRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email ya registrado")
    customer_id = generate_customer_id(data.name)
    while await db.users.find_one({"customer_id": customer_id}, {"_id": 0}):
        customer_id = generate_customer_id(data.name)
    admin = User(tenant_id=tenant_id, customer_id=customer_id, referral_code=customer_id,
        name=data.name, country=data.country, whatsapp=data.whatsapp, email=data.email,
        password_hash=hash_password(data.password), role="admin")
    await db.users.insert_one(admin.model_dump())
    return {"message": "Admin creado", "admin_id": admin.id, "customer_id": customer_id}

@api_router.put("/superadmin/tenants/{tenant_id}/reset-password")
async def reset_tenant_admin_password(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Reset the admin password for a tenant"""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    
    new_password = data.get("new_password")
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    
    # Find the admin of this tenant
    admin = await db.users.find_one({"tenant_id": tenant_id, "role": "admin"}, {"_id": 0})
    if not admin:
        raise HTTPException(status_code=404, detail="Admin no encontrado para este tenant")
    
    # Update password
    hashed = hash_password(new_password)
    await db.users.update_one(
        {"id": admin["id"]},
        {"$set": {"password_hash": hashed, "password_updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": "Contraseña actualizada exitosamente", "admin_email": admin["email"]}

@api_router.get("/superadmin/tenants/{tenant_id}/admin-info")
async def get_tenant_admin_info(tenant_id: str, current_user: dict = Depends(get_current_user)):
    """Get admin info for a tenant including last password update"""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    
    admin = await db.users.find_one({"tenant_id": tenant_id, "role": "admin"}, {"_id": 0, "password_hash": 0})
    if not admin:
        return {"has_admin": False}
    
    return {
        "has_admin": True,
        "admin_id": admin["id"],
        "admin_name": admin["name"],
        "admin_email": admin["email"],
        "admin_whatsapp": admin.get("whatsapp", ""),
        "password_updated_at": admin.get("password_updated_at"),
        "created_at": admin.get("created_at")
    }

@api_router.put("/superadmin/tenants/{tenant_id}/settings")
async def update_tenant_settings(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update tenant invoice and shipment settings"""
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    
    # Prepare update fields
    update_fields = {}
    
    # Invoice settings
    if "invoice_show_tax_per_item" in data:
        update_fields["invoice_show_tax_per_item"] = bool(data["invoice_show_tax_per_item"])
    if "invoice_show_tax_summary" in data:
        update_fields["invoice_show_tax_summary"] = bool(data["invoice_show_tax_summary"])
    
    # Shipment settings
    if "shipment_show_product_list" in data:
        update_fields["shipment_show_product_list"] = bool(data["shipment_show_product_list"])
    
    # Client ID settings
    if "allow_custom_client_id" in data:
        update_fields["allow_custom_client_id"] = bool(data["allow_custom_client_id"])

    # Feature toggles
    if "show_shipments_diagnostic" in data:
        update_fields["show_shipments_diagnostic"] = bool(data["show_shipments_diagnostic"])

    # Live fast-entry module (opt-in per tenant)
    if "live_module_enabled" in data:
        update_fields["live_module_enabled"] = bool(data["live_module_enabled"])

    # Late Fee settings
    if "late_fee_enabled" in data:
        update_fields["late_fee_enabled"] = bool(data["late_fee_enabled"])
    if "late_fee_grace_hours" in data:
        update_fields["late_fee_grace_hours"] = max(1, int(data["late_fee_grace_hours"]))
    if "late_fee_description" in data:
        update_fields["late_fee_description"] = str(data["late_fee_description"]).strip() or "Recargo por demora en pago"
    # Update shipping_categories with late_fee values
    if "shipping_categories" in data:
        update_fields["shipping_categories"] = data["shipping_categories"]

    if update_fields:
        await db.tenants.update_one({"id": tenant_id}, {"$set": update_fields})
    
    # Return updated tenant
    updated_tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return updated_tenant

@api_router.get("/superadmin/stats")
async def get_superadmin_stats(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant_count = await db.tenants.count_documents({})
    active_tenants = await db.tenants.count_documents({"status": "active"})
    total_admins = await db.users.count_documents({"role": "admin"})
    total_clients = await db.users.count_documents({"role": "client"})
    return {
        "tenant_count": tenant_count,
        "active_tenants": active_tenants,
        "total_admins": total_admins,
        "total_clients": total_clients
    }

# ==================== ADMIN TENANT ENDPOINTS ====================

@api_router.get("/admin/tenant")
async def get_my_tenant(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": current_user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    # Ensure shipping_categories always present and have dual prices for the frontend
    if not tenant.get("shipping_categories"):
        tenant["shipping_categories"] = [
            {"key": "G", "label": "Categoría G (CON Núcleo Familiar)", "value_packages": 32, "value_pounds": 32, "value": 32},
            {"key": "A", "label": "Categoría A (Personal)", "value_packages": 42, "value_pounds": 42, "value": 42},
            {"key": "B", "label": "Categoría B (SIN Núcleo Familiar)", "value_packages": 52, "value_pounds": 52, "value": 52}
        ]
    else:
        tenant["shipping_categories"] = _ensure_category_dual_prices(tenant["shipping_categories"])
    if not tenant.get("shipping_mode"):
        tenant["shipping_mode"] = "packages"
    return tenant

@api_router.post("/admin/tenant/logo")
async def upload_tenant_logo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant_id = current_user["tenant_id"]
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    filename = f"{tenant_id}_logo.{ext}"
    file_data = await file.read()
    obj_path = object_store.upload_file(file_data, filename, "logos")
    logo_url = f"/api/uploads/{obj_path}"
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"logo_url": logo_url}})
    return {"logo_url": logo_url}


@api_router.post("/superadmin/tenants/{tenant_id}/banner")
async def upload_tenant_banner(
    tenant_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload the tenant's dashboard hero banner (used at the top of the main
    dashboard on both desktop and mobile). Superadmin only."""
    if current_user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "webp"
    if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
        raise HTTPException(status_code=400, detail="Formato de imagen no soportado")
    filename = f"{tenant_id}_banner.{ext}"
    file_data = await file.read()
    obj_path = object_store.upload_file(file_data, filename, "banners")
    banner_url = f"/api/uploads/{obj_path}"
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"dashboard_banner_url": banner_url}})
    return {"dashboard_banner_url": banner_url}


@api_router.delete("/superadmin/tenants/{tenant_id}/banner")
async def delete_tenant_banner(tenant_id: str, current_user: dict = Depends(get_current_user)):
    """Clear the dashboard hero banner for a tenant. Superadmin only."""
    if current_user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="No autorizado")
    result = await db.tenants.update_one({"id": tenant_id}, {"$set": {"dashboard_banner_url": None}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    return {"success": True}


# ==================== ADMIN CLIENT ENDPOINTS ====================

@api_router.get("/admin/clients")
async def get_all_clients(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Build query based on status filter
    query = {"role": "client", "tenant_id": tid}
    if status == "active":
        query["$or"] = [{"is_active": True}, {"is_active": {"$exists": False}}]
    elif status == "inactive":
        query["is_active"] = False
    
    users = await db.users.find(query, {"_id": 0, "password_hash": 0, "password_plain": 0}).sort("created_at", -1).to_list(20000)
    
    if not users:
        return []
    
    # Batch fetch all related data in 3 queries instead of N*3
    user_ids = [u["id"] for u in users]
    
    # Fetch all wallets at once
    wallets_list = await db.wallets.find({"user_id": {"$in": user_ids}, "tenant_id": tid}, {"_id": 0}).to_list(len(user_ids))
    wallets_dict = {w["user_id"]: w for w in wallets_list}
    
    # Aggregate purchases per user
    purchases_agg = await db.purchases.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid}},
        {"$group": {"_id": "$user_id", "total": {"$sum": "$total"}, "count": {"$sum": 1}}}
    ]).to_list(len(user_ids))
    purchases_dict = {p["_id"]: {"total": p["total"], "count": p["count"]} for p in purchases_agg}
    
    # Aggregate shipments per user
    shipments_agg = await db.shipments.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid}},
        {"$group": {"_id": "$user_id", "total_shipping": {"$sum": "$shipping_cost"}}}
    ]).to_list(len(user_ids))
    shipments_dict = {s["_id"]: s["total_shipping"] for s in shipments_agg}
    
    # Aggregate PENDING purchases (no invoice_id) per user - for "compras pendientes de facturar"
    # Sum only price (Total Etiqueta) - commissions are shown separately in invoice
    pending_purchases_agg = await db.purchases.aggregate([
        {"$match": {
            "user_id": {"$in": user_ids}, 
            "tenant_id": tid,
            "$or": [
                {"invoice_id": None},
                {"invoice_id": {"$exists": False}}
            ]
        }},
        {"$group": {
            "_id": "$user_id", 
            "count": {"$sum": 1}, 
            "subtotal": {"$sum": {"$ifNull": ["$price", 0]}}
        }}
    ]).to_list(len(user_ids))
    pending_purchases_count_dict = {p["_id"]: p["count"] for p in pending_purchases_agg}
    pending_purchases_subtotal_dict = {p["_id"]: p["subtotal"] for p in pending_purchases_agg}
    
    # Aggregate saldo_pendiente from non-annulled invoices per customer
    customer_ids_list = [u.get("customer_id") for u in users if u.get("customer_id")]
    saldo_pendiente_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": customer_ids_list}, "is_annulled": {"$ne": True}, "saldo_pendiente": {"$gt": 0}}},
        {"$group": {"_id": "$customer_id", "total_saldo": {"$sum": "$saldo_pendiente"}}}
    ]).to_list(len(customer_ids_list) or 1)
    saldo_pendiente_dict = {s["_id"]: s["total_saldo"] for s in saldo_pendiente_agg}
    
    # Aggregate approved, non-deleted recharges per user
    recharges_agg = await db.wallet_transactions.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid, "type": {"$in": ["deposit", "initial_balance", "referral_bonus"]}, "status": "approved", "is_deleted": {"$ne": True}}},
        {"$group": {"_id": "$user_id", "total": {"$sum": "$amount"}}}
    ]).to_list(len(user_ids))
    recharges_dict = {r["_id"]: r["total"] for r in recharges_agg}

    # Aggregate amount actually APPLIED to invoices per customer (from
    # invoice.applied_deposits[]). Used to derive "Recargas Disponibles"
    # = approved recharges not attached to any invoice yet.
    applied_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": customer_ids_list},
                    "is_annulled": {"$ne": True}}},
        {"$unwind": {"path": "$applied_deposits", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$customer_id",
                    "total_applied": {"$sum": "$applied_deposits.amount_applied"}}}
    ]).to_list(len(customer_ids_list) or 1)
    applied_by_customer = {a["_id"]: float(a["total_applied"] or 0) for a in applied_agg}
    
    # Get total_a_pagar from the most recent invoice per customer
    last_invoice_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": customer_ids_list}, "is_annulled": {"$ne": True}}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$customer_id", "total_a_pagar": {"$first": "$total_a_pagar"}, "saldo_a_favor": {"$first": "$saldo_a_favor"}}}
    ]).to_list(len(customer_ids_list) or 1)
    last_invoice_dict = {li["_id"]: {"total_a_pagar": li.get("total_a_pagar", 0) or 0, "saldo_a_favor": li.get("saldo_a_favor", 0) or 0} for li in last_invoice_agg}
    
    result = []
    for user in users:
        uid = user["id"]
        wallet = wallets_dict.get(uid)
        purch = purchases_dict.get(uid, {"total": 0, "count": 0})
        total_shipping = shipments_dict.get(uid, 0)
        total_saldo_pendiente = saldo_pendiente_dict.get(user.get("customer_id"), 0)
        total_recharges = recharges_dict.get(uid, 0)
        total_purchases = purch["total"]
        last_inv = last_invoice_dict.get(user.get("customer_id"), {"total_a_pagar": 0, "saldo_a_favor": 0})
        last_total_a_pagar = last_inv["total_a_pagar"]
        last_saldo_a_favor = last_inv["saldo_a_favor"]
        # pending_balance: negative = owes money, positive = has credit
        if last_saldo_a_favor > 0:
            pending_balance = round(last_saldo_a_favor, 2)
        elif last_total_a_pagar > 0:
            pending_balance = round(-last_total_a_pagar, 2)
        else:
            pending_balance = 0
        pending_to_invoice = round(pending_purchases_subtotal_dict.get(uid, 0), 2)
        pending_purchases_count = pending_purchases_count_dict.get(uid, 0)
        customer_key = user.get("customer_id")
        applied_total = applied_by_customer.get(customer_key, 0)
        floating_deposits = round(max(0, float(total_recharges or 0) - float(applied_total or 0)), 2)
        result.append({
            **user, 
            "wallet_balance": round(total_recharges, 2),
            "total_purchases": round(total_purchases, 2),
            "total_shipping": round(total_shipping, 2),
            "total_saldo_pendiente": round(total_saldo_pendiente, 2),
            "pending_balance": pending_balance,
            "purchase_count": purch["count"],
            "is_active": user.get("is_active", True),
            "pending_to_invoice": pending_to_invoice,
            "pending_purchases_count": pending_purchases_count,
            "floating_deposits": floating_deposits,
        })
    return result


@api_router.get("/admin/reports/clients")
async def clients_report(
    status: Optional[str] = None,            # active | inactive | all(None)
    min_inactivity_days: Optional[int] = None,
    stagnant_only: bool = False,
    stagnant_days: int = 15,
    date_from: Optional[str] = None,         # filter by last-purchase date (YYYY-MM-DD)
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Data source for the PDF client report in Estadísticas. Returns per-client:
    name, whatsapp, last purchase, inactivity days, pending balance (owed) and
    merchandise age (days since the oldest not-yet-invoiced purchase)."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    query = {"role": "client", "tenant_id": tid}
    if status == "active":
        query["$or"] = [{"is_active": True}, {"is_active": {"$exists": False}}]
    elif status == "inactive":
        query["is_active"] = False

    users = await db.users.find(
        query, {"_id": 0, "id": 1, "name": 1, "whatsapp": 1, "customer_id": 1, "is_active": 1, "created_at": 1}
    ).to_list(20000)
    now = datetime.now(timezone.utc)
    if not users:
        return {"clients": [], "generated_at": now.isoformat(), "count": 0,
                "totals": {"saldo_pendiente": 0, "with_stagnant": 0}}

    user_ids = [u["id"] for u in users]
    customer_ids = [u.get("customer_id") for u in users if u.get("customer_id")]

    last_purchase_agg = await db.purchases.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid}},
        {"$group": {"_id": "$user_id", "last": {"$max": "$created_at"}}}
    ]).to_list(len(user_ids))
    last_purchase = {r["_id"]: r["last"] for r in last_purchase_agg}

    # Oldest purchase not yet invoiced = "stuck" merchandise in the warehouse.
    pending_agg = await db.purchases.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid,
                    "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}]}},
        {"$group": {"_id": "$user_id", "oldest": {"$min": "$created_at"}, "count": {"$sum": 1}}}
    ]).to_list(len(user_ids))
    pending_map = {r["_id"]: r for r in pending_agg}

    last_invoice_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": customer_ids}, "is_annulled": {"$ne": True}}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$customer_id", "total_a_pagar": {"$first": "$total_a_pagar"},
                    "saldo_a_favor": {"$first": "$saldo_a_favor"}}}
    ]).to_list(len(customer_ids) or 1)
    last_invoice = {li["_id"]: li for li in last_invoice_agg}

    def days_since(iso):
        if not iso:
            return None
        try:
            d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return max(0, (now - d).days)
        except Exception:
            return None

    out = []
    for u in users:
        uid = u["id"]
        cid = u.get("customer_id")
        lp = last_purchase.get(uid)
        inactivity = days_since(lp)
        pend = pending_map.get(uid)
        merch_age = days_since(pend["oldest"]) if pend else None
        li = last_invoice.get(cid, {})
        tap = li.get("total_a_pagar", 0) or 0
        favor = li.get("saldo_a_favor", 0) or 0
        saldo_pendiente = round(tap, 2) if (tap and favor <= 0) else 0.0
        stagnant = merch_age is not None and merch_age >= stagnant_days

        # Apply filters
        if min_inactivity_days is not None and (inactivity is None or inactivity < min_inactivity_days):
            continue
        if stagnant_only and not stagnant:
            continue
        if (date_from or date_to):
            if not lp:
                continue
            lp_date = str(lp)[:10]
            if date_from and lp_date < date_from:
                continue
            if date_to and lp_date > date_to:
                continue

        out.append({
            "name": u.get("name", ""),
            "whatsapp": u.get("whatsapp", ""),
            "customer_id": cid,
            "is_active": u.get("is_active", True),
            "last_purchase": lp,
            "inactivity_days": inactivity,
            "saldo_pendiente": saldo_pendiente,
            "merchandise_age_days": merch_age,
            "pending_items": (pend or {}).get("count", 0),
            "stagnant": stagnant,
        })

    out.sort(key=lambda r: r["saldo_pendiente"], reverse=True)
    return {
        "clients": out,
        "generated_at": now.isoformat(),
        "count": len(out),
        "totals": {
            "saldo_pendiente": round(sum(r["saldo_pendiente"] for r in out), 2),
            "with_stagnant": sum(1 for r in out if r["stagnant"]),
        },
    }


@api_router.post("/admin/clients/create")
async def admin_create_client(data: AdminClientCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get tenant settings to check if custom client ID is allowed
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0})
    allow_custom_id = tenant.get("allow_custom_client_id", False) if tenant else False
    
    # Check for existing client with same WhatsApp
    existing_whatsapp = await db.users.find_one({"whatsapp": data.whatsapp, "tenant_id": tid, "role": "client"}, {"_id": 0})
    if existing_whatsapp:
        raise HTTPException(status_code=400, detail=f"Ya existe un cliente con este WhatsApp: {existing_whatsapp['name']} ({existing_whatsapp['customer_id']})")
    
    # Check for existing client with same email
    if data.email:
        existing_email = await db.users.find_one({"email": data.email, "tenant_id": tid, "role": "client"}, {"_id": 0})
        if existing_email:
            raise HTTPException(status_code=400, detail=f"Ya existe un cliente con este email: {existing_email['name']} ({existing_email['customer_id']})")
        # Also check if email belongs to an admin or employee (prevent admin/client collision)
        existing_admin = await db.users.find_one({"email": data.email, "tenant_id": tid, "role": {"$in": ["admin", "superadmin"]}}, {"_id": 0})
        if existing_admin:
            raise HTTPException(status_code=400, detail=f"Este email ya está registrado como administrador. Use un email diferente para el cliente.")
        existing_employee = await db.employees.find_one({"email": data.email, "tenant_id": tid}, {"_id": 0})
        if existing_employee:
            raise HTTPException(status_code=400, detail=f"Este email ya está registrado como empleado. Use un email diferente para el cliente.")
    
    # Determine customer_id
    if data.custom_customer_id and allow_custom_id:
        # Validate custom ID format (alphanumeric, 3-20 chars)
        custom_id = data.custom_customer_id.strip().upper()
        if not custom_id or len(custom_id) < 2 or len(custom_id) > 20:
            raise HTTPException(status_code=400, detail="El código de cliente debe tener entre 2 y 20 caracteres")
        if not custom_id.replace("-", "").replace("_", "").isalnum():
            raise HTTPException(status_code=400, detail="El código de cliente solo puede contener letras, números, guiones y guiones bajos")
        # Check if custom ID already exists
        existing_id = await db.users.find_one({"customer_id": custom_id, "tenant_id": tid}, {"_id": 0})
        if existing_id:
            raise HTTPException(status_code=400, detail=f"Ya existe un cliente con este código: {existing_id['name']} ({custom_id})")
        customer_id = custom_id
    else:
        # Generate automatic customer_id
        customer_id = generate_customer_id(data.name)
        while await db.users.find_one({"customer_id": customer_id, "tenant_id": tid}, {"_id": 0}):
            customer_id = generate_customer_id(data.name)
    
    user = User(tenant_id=tid, customer_id=customer_id, referral_code=customer_id,
        commission_fee=data.commission_fee, name=data.name, country=data.country,
        whatsapp=data.whatsapp, email=data.email, whatsapp_consent=True,
        password_hash=hash_password(data.password) if data.password else None,
        password_plain=data.password if data.password else None,
        role="client", is_active=True)
    await db.users.insert_one(user.model_dump())
    wallet = Wallet(tenant_id=tid, user_id=user.id, customer_id=customer_id, available=data.initial_balance)
    await db.wallets.insert_one(wallet.model_dump())
    if data.initial_balance > 0:
        tx = WalletTransaction(tenant_id=tid, user_id=user.id, customer_id=customer_id,
            type="deposit", amount=data.initial_balance, balance_after=data.initial_balance,
            description="Saldo inicial (Admin)", status="approved",
            approved_at=datetime.now(timezone.utc).isoformat())
        await db.wallet_transactions.insert_one(tx.model_dump())
    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="create_client",
        entity_type="client", entity_id=user.id, entity_name=f"{data.name} ({customer_id})",
        details={"customer_id": customer_id, "whatsapp": data.whatsapp, "email": data.email,
                 "commission_fee": data.commission_fee, "initial_balance": data.initial_balance}
    )
    return {"message": "Cliente creado exitosamente", "user_id": user.id, "customer_id": customer_id,
        "commission_fee": data.commission_fee, "initial_balance": data.initial_balance}

@api_router.post("/admin/clients/check-duplicate")
async def check_client_duplicate(data: dict, current_user: dict = Depends(get_current_user)):
    """Check if a similar client already exists"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    duplicates = []
    
    # Check by WhatsApp
    if data.get("whatsapp"):
        existing = await db.users.find_one(
            {"whatsapp": data["whatsapp"], "tenant_id": tid, "role": "client"}, 
            {"_id": 0, "password_hash": 0}
        )
        if existing:
            duplicates.append({"field": "whatsapp", "client": existing})
    
    # Check by email
    if data.get("email"):
        existing = await db.users.find_one(
            {"email": data["email"], "tenant_id": tid, "role": "client"}, 
            {"_id": 0, "password_hash": 0}
        )
        if existing:
            duplicates.append({"field": "email", "client": existing})
    
    # Check by similar name (case insensitive)
    if data.get("name"):
        name_lower = data["name"].lower().strip()
        all_clients = await db.users.find(
            {"tenant_id": tid, "role": "client"}, 
            {"_id": 0, "password_hash": 0}
        ).to_list(20000)
        for client in all_clients:
            if client["name"].lower().strip() == name_lower:
                duplicates.append({"field": "name", "client": client})
                break
    
    return {"has_duplicates": len(duplicates) > 0, "duplicates": duplicates}

@api_router.put("/admin/clients/{user_id}/toggle-status")
async def toggle_client_status(user_id: str, current_user: dict = Depends(get_current_user)):
    """Enable/disable a client"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    client = await db.users.find_one({"id": user_id, "tenant_id": tid, "role": "client"}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    new_status = not client.get("is_active", True)
    await db.users.update_one(
        {"id": user_id, "tenant_id": tid},
        {"$set": {"is_active": new_status}}
    )
    
    status_text = "habilitado" if new_status else "inhabilitado"
    return {"message": f"Cliente {status_text} exitosamente", "is_active": new_status}


@api_router.put("/admin/clients/{user_id}/toggle-reviewed")
async def toggle_client_reviewed(user_id: str, current_user: dict = Depends(get_current_user)):
    """Flip the 'reviewed' marker for a client — used by the admin clients list
    to highlight customers that have already been audited in the current pass.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    client = await db.users.find_one({"id": user_id, "tenant_id": tid, "role": "client"}, {"_id": 0, "id": 1, "reviewed": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    new_val = not bool(client.get("reviewed"))
    await db.users.update_one(
        {"id": user_id, "tenant_id": tid},
        {"$set": {"reviewed": new_val, "reviewed_at": datetime.now(timezone.utc).isoformat() if new_val else None}}
    )
    return {"reviewed": new_val}

@api_router.delete("/admin/clients/{user_id}")
async def delete_client(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a client - ONLY admin can delete, not employees"""
    # Only admin can delete clients, NOT employees
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo el administrador puede eliminar clientes")
    tid = current_user["tenant_id"]
    
    client = await db.users.find_one({"id": user_id, "tenant_id": tid, "role": "client"}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    # Only allow deletion of inactive clients
    if client.get("is_active", True):
        raise HTTPException(status_code=400, detail="Solo puedes eliminar clientes inhabilitados. Primero inhabilita al cliente.")
    
    # Delete client and related data
    await db.users.delete_one({"id": user_id, "tenant_id": tid})
    await db.wallets.delete_one({"user_id": user_id, "tenant_id": tid})
    await db.wallet_transactions.delete_many({"user_id": user_id, "tenant_id": tid})
    # Note: Purchases and shipments are kept for historical records

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role="admin", action="delete_client",
        entity_type="client", entity_id=user_id,
        entity_name=f"{client.get('name','')} ({client.get('customer_id','')})",
        details={"customer_id": client.get("customer_id"), "whatsapp": client.get("whatsapp"),
                 "email": client.get("email")}
    )

    return {"message": "Cliente eliminado exitosamente", "deleted_id": user_id}

@api_router.get("/admin/clients/active")
async def get_active_clients(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    wallets = await db.wallets.find({"available": {"$gt": 0}, "tenant_id": tid}, {"_id": 0}).to_list(20000)
    result = []
    for wallet in wallets:
        user = await db.users.find_one({"id": wallet["user_id"], "tenant_id": tid}, {"_id": 0, "password_hash": 0})
        if user:
            result.append({**user, "wallet_balance": wallet["available"]})
    return sorted(result, key=lambda x: x["wallet_balance"], reverse=True)

@api_router.put("/admin/clients/{user_id}/commission")
async def update_client_commission(user_id: str, commission_fee: float, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if commission_fee < 0:
        raise HTTPException(status_code=400, detail="La comisión no puede ser negativa")
    result = await db.users.update_one({"id": user_id, "tenant_id": current_user["tenant_id"]},
        {"$set": {"commission_fee": commission_fee}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return {"message": f"Comisión actualizada a ${commission_fee:.2f}", "commission_fee": commission_fee}

class ClientUpdate(BaseModel):
    name: Optional[str] = None
    whatsapp: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    new_password: Optional[str] = None
    commission_fee: Optional[float] = None
    customer_id: Optional[str] = None

@api_router.put("/admin/clients/{user_id}")
async def update_client(user_id: str, data: ClientUpdate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    user = await db.users.find_one({"id": user_id, "tenant_id": tid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    updates = {}
    if data.name:
        updates["name"] = data.name
    if data.whatsapp:
        updates["whatsapp"] = data.whatsapp
    if data.country:
        updates["country"] = data.country
    if data.email is not None:
        updates["email"] = data.email
    if data.commission_fee is not None and data.commission_fee >= 0:
        updates["commission_fee"] = data.commission_fee
    if data.new_password:
        updates["password_hash"] = hash_password(data.new_password)
        updates["password_plain"] = data.new_password
    if data.customer_id:
        new_cid = data.customer_id.strip().upper()
        if new_cid != user.get("customer_id"):
            existing = await db.users.find_one({"customer_id": new_cid, "tenant_id": tid}, {"_id": 0})
            if existing:
                raise HTTPException(status_code=400, detail=f"El código {new_cid} ya está en uso por otro cliente")
            updates["customer_id"] = new_cid
            # Update customer_id in related collections
            await db.wallets.update_many({"user_id": user_id, "tenant_id": tid}, {"$set": {"customer_id": new_cid}})
            await db.purchases.update_many({"user_id": user_id, "tenant_id": tid}, {"$set": {"customer_id": new_cid}})
            await db.invoices.update_many({"user_id": user_id, "tenant_id": tid}, {"$set": {"customer_id": new_cid}})
            await db.wallet_transactions.update_many({"user_id": user_id, "tenant_id": tid}, {"$set": {"customer_id": new_cid}})
    
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.users.update_one({"id": user_id, "tenant_id": tid}, {"$set": updates})
    
    updated_user = await db.users.find_one({"id": user_id, "tenant_id": tid}, {"_id": 0, "password_hash": 0, "password_plain": 0})

    # Audit (only if something actually changed)
    if updates:
        actor_name = await get_actor_name(current_user["user_id"])
        # Snapshot of changed keys (excluding sensitive password values)
        changed_keys = [k for k in updates.keys() if k not in ("password_hash", "password_plain", "updated_at")]
        if "new_password" in (data.model_dump(exclude_none=True) or {}):
            changed_keys.append("password")
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user.get("role", "admin"), action="update_client",
            entity_type="client", entity_id=user_id,
            entity_name=f"{updated_user.get('name','')} ({updated_user.get('customer_id','')})",
            details={"changed": changed_keys}
        )
    return {"message": "Cliente actualizado exitosamente", "user": updated_user}

@api_router.get("/admin/clients/{user_id}/password")
async def get_client_password(user_id: str, current_user: dict = Depends(get_current_user)):
    """Return the plain-text password for a client so the admin can share it.

    Security notes:
    - Only admin/employee roles can call this endpoint.
    - Passwords are only available for clients whose password was set/changed AFTER
      the plain-shadow feature was introduced. Older clients will return None, and
      the admin must use "Cambiar contraseña" to set a new one.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    user = await db.users.find_one(
        {"id": user_id, "tenant_id": tid, "role": "client"},
        {"_id": 0, "password_plain": 1, "customer_id": 1, "name": 1}
    )
    if not user:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return {
        "customer_id": user.get("customer_id"),
        "name": user.get("name"),
        "password_plain": user.get("password_plain"),
        "available": bool(user.get("password_plain")),
    }

@api_router.get("/admin/clients/{customer_id}/info")
async def get_client_info(customer_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    user = await db.users.find_one({"customer_id": customer_id.upper(), "tenant_id": tid}, {"_id": 0, "password_hash": 0, "password_plain": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    wallet = await db.wallets.find_one({"user_id": user["id"], "tenant_id": tid}, {"_id": 0})

    # Compras del cliente que aún no se han incluido en ninguna factura. Sirve
    # para que la UI muestre en vivo cuánto va a deber el cliente la próxima
    # liquidación (viernes).
    pending_agg = await db.purchases.aggregate([
        {"$match": {
            "user_id": user["id"],
            "tenant_id": tid,
            "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}, {"invoice_id": ""}],
        }},
        {"$group": {"_id": None, "total": {"$sum": "$total"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    pending_total = round(float(pending_agg[0]["total"]) if pending_agg else 0.0, 2)
    pending_count = int(pending_agg[0]["count"]) if pending_agg else 0

    return {
        **user,
        "wallet_balance": wallet["available"] if wallet else 0,
        "commission_fee": user.get("commission_fee", DEFAULT_COMMISSION_FEE),
        "pending_to_invoice": pending_total,
        "pending_purchases_count": pending_count,
    }


@api_router.get("/wallet/duplicates")
async def get_duplicate_deposits(current_user: dict = Depends(get_current_user)):
    """Detect groups of possibly-duplicated recargas so the admin can review
    and clean them up. Runs three heuristics side-by-side; each hit lists the
    conflicting transaction ids so the UI can jump straight to them.

    Heuristics:
      1) `reference`  — same reference_number (case-insensitive) across
         non-deleted, non-rejected recargas.
      2) `client_amount_day` — same client + same amount + same calendar day.
         Catches the classic "uploaded twice by accident" scenario.
      3) `same_proof`  — same proof_url (identical image reused).

    Groups that the admin has already reviewed and marked as "Aceptado"
    (i.e. verified NOT to be a real duplicate) are moved to the `accepted`
    section instead of the main lists, so the noise stays down but nothing
    is lost.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    base_match = {
        "tenant_id": tid,
        "type": "deposit",
        "is_deleted": {"$ne": True},
        "status": {"$in": ["pending", "approved"]},
    }

    # Signature helper — must match _sig() used in accept endpoint.
    def _sig(kind: str, key):
        if kind == "by_reference":
            return f"ref:{str(key).lower()}"
        if kind == "by_same_proof":
            return f"proof:{key}"
        # by_client_amount_day
        return f"cad:{key.get('customer_id')}|{key.get('amount')}|{key.get('day')}"

    # Preload accepted signatures for this tenant.
    accepted_docs = await db.accepted_duplicates.find(
        {"tenant_id": tid}, {"_id": 0}
    ).to_list(20000)
    accepted_by_sig = {d["signature"]: d for d in accepted_docs}

    async def _fetch_txs(ids: list):
        if not ids:
            return []
        txs = await db.wallet_transactions.find(
            {"tenant_id": tid, "id": {"$in": ids}},
            {"_id": 0, "id": 1, "customer_id": 1, "user_id": 1, "amount": 1,
             "reference_number": 1, "status": 1, "created_at": 1,
             "proof_url": 1, "description": 1}
        ).to_list(len(ids))
        # Preserve caller-supplied order
        by_id = {t["id"]: t for t in txs}
        return [by_id[i] for i in ids if i in by_id]

    # 1) By reference number
    ref_groups = await db.wallet_transactions.aggregate([
        {"$match": {**base_match,
                    "reference_number": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": {"$toLower": "$reference_number"},
            "count": {"$sum": 1},
            "ids": {"$push": "$id"},
            "total_amount": {"$sum": "$amount"}
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 500}
    ]).to_list(500)

    # 2) Same client + same amount + same day
    same_group = await db.wallet_transactions.aggregate([
        {"$match": base_match},
        {"$group": {
            "_id": {
                "customer_id": "$customer_id",
                "amount": "$amount",
                "day": {"$substr": ["$created_at", 0, 10]}
            },
            "count": {"$sum": 1},
            "ids": {"$push": "$id"},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 500}
    ]).to_list(500)

    # 3) Same proof URL
    proof_group = await db.wallet_transactions.aggregate([
        {"$match": {**base_match, "proof_url": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": "$proof_url",
            "count": {"$sum": 1},
            "ids": {"$push": "$id"},
            "total_amount": {"$sum": "$amount"},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 500}
    ]).to_list(500)

    # Collect all involved customer_ids for a single batched user lookup
    all_ids = set()
    for g in ref_groups + same_group + proof_group:
        for tid_ in g.get("ids") or []:
            all_ids.add(tid_)
    # Batched customer name lookup
    all_customer_ids = set()
    if all_ids:
        tx_cursor = db.wallet_transactions.find(
            {"tenant_id": tid, "id": {"$in": list(all_ids)}},
            {"_id": 0, "id": 1, "customer_id": 1}
        )
        async for t in tx_cursor:
            if t.get("customer_id"):
                all_customer_ids.add(t["customer_id"])
    users = []
    if all_customer_ids:
        users = await db.users.find(
            {"tenant_id": tid, "customer_id": {"$in": list(all_customer_ids)}},
            {"_id": 0, "customer_id": 1, "name": 1}
        ).to_list(len(all_customer_ids))
    name_map = {u["customer_id"]: u.get("name") for u in users}

    async def _decorate(groups, kind):
        out = []
        accepted_out = []
        for g in groups:
            txs = await _fetch_txs(g.get("ids") or [])
            for t in txs:
                t["customer_name"] = name_map.get(t.get("customer_id"))
            group_key = g.get("_id")
            item = {
                "key": group_key,
                "signature": _sig(kind, group_key),
                "count": g["count"],
                "total_amount": round(float(g.get("total_amount") or
                                            sum((t.get("amount") or 0) for t in txs)), 2),
                "transactions": txs,
            }
            acc = accepted_by_sig.get(item["signature"])
            if acc:
                item["accepted_at"] = acc.get("accepted_at")
                item["accepted_by_name"] = acc.get("accepted_by_name")
                item["type"] = kind
                accepted_out.append(item)
            else:
                out.append(item)
        return out, accepted_out

    ref_active, ref_accepted = await _decorate(ref_groups, "by_reference")
    cad_active, cad_accepted = await _decorate(same_group, "by_client_amount_day")
    proof_active, proof_accepted = await _decorate(proof_group, "by_same_proof")

    return {
        "by_reference": ref_active,
        "by_client_amount_day": cad_active,
        "by_same_proof": proof_active,
        "accepted": ref_accepted + cad_accepted + proof_accepted,
    }


@api_router.post("/wallet/duplicates/accept")
async def accept_duplicate_group(data: dict, current_user: dict = Depends(get_current_user)):
    """Mark a duplicate group as reviewed & OK (not a real duplicate).
    Body: { type: "by_reference"|"by_client_amount_day"|"by_same_proof", key: <group key>, tx_ids: [...] }
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    kind = data.get("type")
    key = data.get("key")
    tx_ids = data.get("tx_ids") or []
    if kind not in ("by_reference", "by_client_amount_day", "by_same_proof") or key is None:
        raise HTTPException(status_code=400, detail="type/key inválidos")

    if kind == "by_reference":
        signature = f"ref:{str(key).lower()}"
    elif kind == "by_same_proof":
        signature = f"proof:{key}"
    else:
        if not isinstance(key, dict):
            raise HTTPException(status_code=400, detail="key debe ser objeto con customer_id/amount/day")
        signature = f"cad:{key.get('customer_id')}|{key.get('amount')}|{key.get('day')}"

    actor = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "name": 1}) \
        or await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0, "name": 1}) \
        or {}
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "type": kind,
        "signature": signature,
        "key": key,
        "tx_ids": tx_ids,
        "accepted_by": current_user["user_id"],
        "accepted_by_name": actor.get("name") or "Admin",
        "accepted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.accepted_duplicates.update_one(
        {"tenant_id": tid, "signature": signature},
        {"$set": doc},
        upsert=True
    )
    return {"message": "Grupo marcado como aceptado", "signature": signature}


@api_router.post("/wallet/duplicates/unaccept")
async def unaccept_duplicate_group(data: dict, current_user: dict = Depends(get_current_user)):
    """Undo the accept action so the group is flagged again next scan."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    signature = data.get("signature")
    if not signature:
        raise HTTPException(status_code=400, detail="signature es obligatorio")
    r = await db.accepted_duplicates.delete_one({"tenant_id": tid, "signature": signature})
    return {"message": "Reactivado" if r.deleted_count else "No estaba marcado", "removed": r.deleted_count}


# ==================== WALLET ENDPOINTS ====================

@api_router.get("/wallet/pending-deposits")
async def get_pending_deposits(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    transactions = await db.wallet_transactions.find(
        {"type": "deposit", "status": "pending", "tenant_id": tid, "is_deleted": {"$ne": True}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)
    if not transactions:
        return []
    # Batched user lookup — one query instead of N. Builds an id->user dict so
    # we don't blow up the request when there are hundreds of pending deposits.
    user_ids = list({t["user_id"] for t in transactions})
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "name": 1, "customer_id": 1}
    ).to_list(len(user_ids))
    user_map = {u["id"]: u for u in users}
    result = []
    for t in transactions:
        u = user_map.get(t["user_id"])
        result.append({**t, "user_name": (u["name"] if u else "Unknown")})
    return result

@api_router.get("/wallet/all-deposits")
async def get_all_deposits(include_deleted: bool = False, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    query = {"type": "deposit", "tenant_id": tid}
    if not include_deleted:
        query["is_deleted"] = {"$ne": True}
    transactions = await db.wallet_transactions.find(query, {"_id": 0}).sort("created_at", -1).to_list(20000)
    if not transactions:
        return []
    user_ids = list({t["user_id"] for t in transactions})
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "name": 1, "customer_id": 1}
    ).to_list(len(user_ids))
    user_map = {u["id"]: u for u in users}
    result = []
    for t in transactions:
        u = user_map.get(t["user_id"])
        result.append({
            **t,
            "user_name": (u["name"] if u else "Unknown"),
            # `customer_id` lookup goes through the user; expose it directly so the frontend
            # can filter/search on it without an extra round-trip. RECARGAS view used this
            # field but it was missing — caused customer-code searches to return zero matches.
            "customer_id": (u["customer_id"] if u else None),
        })
    return result

@api_router.post("/wallet/deposit/{transaction_id}/bank-reviewed")
async def set_deposit_bank_reviewed(transaction_id: str, data: dict = Body(default=None), current_user: dict = Depends(get_current_user)):
    """Toggle the 'reviewed against the bank account' flag on a deposit — a
    subtle reconciliation marker shown in the Recargas history view."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    reviewed = bool((data or {}).get("reviewed", True))
    tx = await db.wallet_transactions.find_one(
        {"id": transaction_id, "tenant_id": tid, "type": "deposit"}, {"_id": 0, "id": 1}
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Recarga no encontrada")
    actor_name = await get_actor_name(current_user["user_id"])
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.wallet_transactions.update_one(
        {"id": transaction_id, "tenant_id": tid},
        {"$set": {
            "bank_reviewed": reviewed,
            "bank_reviewed_at": now_iso if reviewed else None,
            "bank_reviewed_by": actor_name if reviewed else None,
        }}
    )
    return {"message": "Revisión actualizada", "bank_reviewed": reviewed,
            "bank_reviewed_at": now_iso if reviewed else None, "bank_reviewed_by": actor_name if reviewed else None}


@api_router.get("/wallet/deleted-deposits")
async def get_deleted_deposits(current_user: dict = Depends(get_current_user)):
    """Get all soft-deleted deposits"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    transactions = await db.wallet_transactions.find(
        {"type": "deposit", "tenant_id": tid, "is_deleted": True}, {"_id": 0}
    ).sort("deleted_at", -1).to_list(20000)
    result = []
    for t in transactions:
        user = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "name": 1, "customer_id": 1})
        result.append({**t, "user_name": user["name"] if user else "Unknown"})
    return result

@api_router.get("/wallet/by-customer/{customer_id}")
async def get_wallet_by_customer_id(customer_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    wallet = await db.wallets.find_one({"customer_id": customer_id.upper(), "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")
    return wallet

@api_router.get("/wallet/recharge-report")
async def get_recharge_report(current_user: dict = Depends(get_current_user)):
    """
    Get a report of all recharges comparing admin-created vs client-requested deposits.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get all deposit transactions
    deposits = await db.wallet_transactions.find(
        {"tenant_id": tid, "type": "deposit"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)
    
    # Get users for names
    user_ids = list(set(d["user_id"] for d in deposits))
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "customer_id": 1}).to_list(None)
    users_dict = {u["id"]: u for u in users}
    
    # Categorize and enrich with user info
    admin_created = []
    client_requested = []
    
    totals = {
        "admin_created": {"count": 0, "total": 0, "approved": 0, "pending": 0},
        "client_requested": {"count": 0, "total": 0, "approved": 0, "pending": 0, "rejected": 0}
    }
    
    for dep in deposits:
        user = users_dict.get(dep["user_id"], {})
        dep["user_name"] = user.get("name", "Desconocido")
        dep["user_customer_id"] = user.get("customer_id", "N/A")
        
        if dep.get("created_by_admin"):
            admin_created.append(dep)
            totals["admin_created"]["count"] += 1
            totals["admin_created"]["total"] += dep["amount"]
            if dep["status"] == "approved":
                totals["admin_created"]["approved"] += 1
        else:
            client_requested.append(dep)
            totals["client_requested"]["count"] += 1
            totals["client_requested"]["total"] += dep["amount"]
            if dep["status"] == "approved":
                totals["client_requested"]["approved"] += 1
            elif dep["status"] == "pending":
                totals["client_requested"]["pending"] += 1
            elif dep["status"] == "rejected":
                totals["client_requested"]["rejected"] += 1
    
    return {
        "admin_created": admin_created,
        "client_requested": client_requested,
        "totals": totals
    }

@api_router.get("/wallet/client-balance-report")
async def get_client_balance_report(
    date_from: str = None,
    date_to: str = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get a consolidated report of all clients with:
    - Total abonado (approved recharges) in the period
    - Valor consumido (purchases, even if not invoiced) in the period
    - Saldo = abonado - consumido
    
    Filters:
    - date_from: YYYY-MM-DD (inclusive)
    - date_to: YYYY-MM-DD (inclusive)
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Parse date filters - use ISO string comparison for MongoDB
    date_filter_str = {}
    if date_from:
        # Start of day in ISO format
        date_filter_str["$gte"] = f"{date_from}T00:00:00"
    if date_to:
        # End of day in ISO format
        date_filter_str["$lte"] = f"{date_to}T23:59:59"
    
    # Get all active clients
    clients = await db.users.find(
        {"tenant_id": tid, "role": "client", "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "customer_id": 1, "whatsapp": 1}
    ).to_list(None)
    
    if not clients:
        return {"clients": [], "totals": {"total_abonado": 0, "total_consumido": 0, "total_saldo": 0}}
    
    client_ids = [c["id"] for c in clients]
    clients_dict = {c["id"]: c for c in clients}
    
    # Build deposit match filter
    deposit_match = {
        "tenant_id": tid,
        "user_id": {"$in": client_ids},
        "type": {"$in": ["deposit", "initial_balance", "referral_bonus"]},
        "status": "approved",
        "is_deleted": {"$ne": True}
    }
    if date_filter_str:
        deposit_match["created_at"] = date_filter_str
    
    # Get approved deposits (recharges) per client
    deposits_agg = await db.wallet_transactions.aggregate([
        {"$match": deposit_match},
        {"$group": {"_id": "$user_id", "total": {"$sum": "$amount"}}}
    ]).to_list(None)
    deposits_dict = {d["_id"]: d["total"] for d in deposits_agg}
    
    # Build purchases match filter
    purchases_match = {
        "tenant_id": tid,
        "user_id": {"$in": client_ids},
        "status": {"$in": ["pending", "confirmed", "invoiced"]}  # Include pending too
    }
    if date_filter_str:
        purchases_match["created_at"] = date_filter_str
    
    # Get purchases (consumido) per client - all purchases in period
    purchases_agg = await db.purchases.aggregate([
        {"$match": purchases_match},
        {"$group": {"_id": "$user_id", "total": {"$sum": {"$add": [
            {"$ifNull": ["$price", 0]},
            {"$ifNull": ["$commission", 0]},
            {"$ifNull": ["$tax_amount", 0]}
        ]}}}}
    ]).to_list(None)
    purchases_dict = {p["_id"]: p["total"] for p in purchases_agg}
    
    # Build result
    result = []
    total_abonado = 0
    total_consumido = 0
    total_saldo = 0
    
    for client in clients:
        cid = client["id"]
        abonado = round(deposits_dict.get(cid, 0), 2)
        consumido = round(purchases_dict.get(cid, 0), 2)
        saldo = round(abonado - consumido, 2)
        
        total_abonado += abonado
        total_consumido += consumido
        total_saldo += saldo
        
        # Only include clients with activity in the period
        if abonado > 0 or consumido > 0:
            result.append({
                "id": cid,
                "name": client.get("name", "—"),
                "customer_id": client.get("customer_id", "N/A"),
                "whatsapp": client.get("whatsapp", ""),
                "total_abonado": abonado,
                "total_consumido": consumido,
                "saldo": saldo
            })
    
    # Sort by total_abonado descending
    result.sort(key=lambda x: x["total_abonado"], reverse=True)
    
    return {
        "clients": result,
        "totals": {
            "total_abonado": round(total_abonado, 2),
            "total_consumido": round(total_consumido, 2),
            "total_saldo": round(total_saldo, 2),
            "clients_count": len(result)
        }
    }

@api_router.get("/wallet/transactions/{user_id}")
async def get_wallet_transactions(user_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    transactions = await db.wallet_transactions.find({"user_id": user_id, "tenant_id": tid, "is_deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return transactions

@api_router.get("/wallet/{user_id}")
async def get_wallet(user_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    wallet = await db.wallets.find_one({"user_id": user_id, "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")
    
    # Include total saldo_pendiente from invoices
    customer_id = wallet.get("customer_id")
    saldo_pend = 0
    if customer_id:
        agg = await db.invoices.aggregate([
            {"$match": {"tenant_id": tid, "customer_id": customer_id, "is_annulled": {"$ne": True}, "saldo_pendiente": {"$gt": 0}}},
            {"$group": {"_id": None, "total": {"$sum": "$saldo_pendiente"}}}
        ]).to_list(1)
        saldo_pend = agg[0]["total"] if agg else 0
    
    # Get total_a_pagar and saldo_a_favor from the last invoice
    last_total_a_pagar = 0
    last_saldo_a_favor = 0
    if customer_id:
        last_inv = await db.invoices.find_one(
            {"tenant_id": tid, "customer_id": customer_id, "is_annulled": {"$ne": True}},
            {"_id": 0, "total_a_pagar": 1, "saldo_a_favor": 1},
            sort=[("created_at", -1)]
        )
        if last_inv:
            last_total_a_pagar = last_inv.get("total_a_pagar", 0) or 0
            last_saldo_a_favor = last_inv.get("saldo_a_favor", 0) or 0
    
    # Sum pending deposit amounts (AI-detected if admin hasn't set amount yet)
    pending_cursor = db.wallet_transactions.find(
        {"tenant_id": tid, "user_id": user_id, "type": "deposit", "status": "pending", "is_deleted": {"$ne": True}},
        {"_id": 0, "amount": 1, "ai_scan": 1, "reference_number": 1, "created_at": 1}
    )
    pending_deposits_info = []
    pending_deposit_total = 0.0
    async for tx in pending_cursor:
        admin_amount = tx.get("amount") or 0
        ai_amount = (tx.get("ai_scan") or {}).get("detected_amount") or 0
        # Prefer admin-entered amount; fall back to AI-detected
        effective = admin_amount if admin_amount > 0 else ai_amount
        if effective > 0:
            pending_deposit_total += effective
        pending_deposits_info.append({
            "amount": admin_amount,
            "detected_amount": ai_amount,
            "effective_amount": effective,
            "reference_number": tx.get("reference_number"),
            "created_at": tx.get("created_at")
        })

    # floating_deposits = approved recharges NOT attached to any non-annulled
    # invoice's applied_deposits[]. Uses stored assignments as source of
    # truth so historical recharges (assigned via previous logic versions)
    # keep showing as attached. Admin can force the current weekly rule
    # over old data via "Recalcular Todo".
    floating_deposits = 0.0
    if customer_id:
        approved_agg = await db.wallet_transactions.aggregate([
            {"$match": {"tenant_id": tid, "user_id": user_id,
                        "type": {"$in": ["deposit", "initial_balance", "referral_bonus"]},
                        "status": "approved", "is_deleted": {"$ne": True}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1)
        applied_agg = await db.invoices.aggregate([
            {"$match": {"tenant_id": tid, "customer_id": customer_id,
                        "is_annulled": {"$ne": True}}},
            {"$unwind": {"path": "$applied_deposits", "preserveNullAndEmptyArrays": False}},
            {"$group": {"_id": None, "total": {"$sum": "$applied_deposits.amount_applied"}}}
        ]).to_list(1)
        approved_total = float((approved_agg[0]["total"] if approved_agg else 0) or 0)
        applied_total = float((applied_agg[0]["total"] if applied_agg else 0) or 0)
        floating_deposits = round(max(0, approved_total - applied_total), 2)

    return {**wallet,
            "total_saldo_pendiente": round(saldo_pend, 2),
            "pending_debt": round(last_total_a_pagar, 2),
            "saldo_a_favor": round(last_saldo_a_favor, 2),
            "floating_deposits": floating_deposits,
            "pending_deposit_total": round(pending_deposit_total, 2),
            "pending_deposits": pending_deposits_info}

@api_router.post("/wallet/deposit-request")
async def request_deposit(deposit: WalletDepositRequest, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    # Block inactive users — no more recargas until admin re-enables them.
    target_user = await db.users.find_one(
        {"id": deposit.user_id, "tenant_id": tid},
        {"_id": 0, "is_active": 1, "name": 1}
    )
    if target_user and target_user.get("is_active", True) is False:
        raise HTTPException(status_code=403, detail=f"El cliente {target_user.get('name') or deposit.user_id} está inhabilitado. Actívalo antes de subir recargas.")
    wallet = await db.wallets.find_one({"user_id": deposit.user_id, "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")
    transaction = WalletTransaction(tenant_id=tid, user_id=deposit.user_id, customer_id=wallet["customer_id"],
        type="deposit", amount=deposit.amount, balance_after=wallet["available"],
        description=deposit.description, status="pending")
    await db.wallet_transactions.insert_one(transaction.model_dump())
    return {"message": "Solicitud de recarga enviada. Pendiente de aprobación.", "transaction_id": transaction.id}

@api_router.post("/wallet/deposit-request-with-proof")
async def request_deposit_with_proof(
    user_id: str = FastAPIForm(...),
    amount: Optional[float] = FastAPIForm(0),
    reference_number: Optional[str] = FastAPIForm(None),
    description: str = FastAPIForm("Solicitud de recarga"),
    file: UploadFile = File(None),
    current_user: dict = Depends(get_current_user)
):
    tid = current_user["tenant_id"]
    # Block inactive users — no more recargas until admin re-enables them.
    target_user = await db.users.find_one(
        {"id": user_id, "tenant_id": tid},
        {"_id": 0, "is_active": 1, "name": 1}
    )
    if target_user and target_user.get("is_active", True) is False:
        raise HTTPException(status_code=403, detail=f"El cliente {target_user.get('name') or user_id} está inhabilitado. Actívalo antes de subir recargas.")
    wallet = await db.wallets.find_one({"user_id": user_id, "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")

    # Clients must send reference_number + proof file. Admins keep legacy behavior (amount only).
    is_client_request = current_user["role"] == "client"
    ref = (reference_number or "").strip()
    if is_client_request:
        if not ref:
            raise HTTPException(status_code=400, detail="El número de comprobante es obligatorio")
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="Debes adjuntar la foto del comprobante")

    # Reject duplicate reference numbers (case-insensitive, within tenant, excluding rejected)
    if ref:
        duplicate = await db.wallet_transactions.find_one(
            {
                "tenant_id": tid,
                "reference_number_lower": ref.lower(),
                "status": {"$in": ["pending", "approved"]},
                "is_deleted": {"$ne": True}
            },
            {"_id": 0, "id": 1, "status": 1}
        )
        if duplicate:
            raise HTTPException(status_code=409, detail=f"Ya existe una recarga con el comprobante {ref}")

    proof_url = None
    if file and file.filename:
        try:
            file_data = await file.read()
        except Exception as e:
            logger.error(f"Failed to read uploaded proof file: {e}")
            raise HTTPException(status_code=400, detail="No se pudo leer la imagen del comprobante. Intenta de nuevo o usa otra foto.")
        # Reject obviously broken files (HEIC sometimes yields 0 bytes after iOS conversion)
        if not file_data or len(file_data) < 100:
            raise HTTPException(status_code=400, detail="El archivo del comprobante está vacío o dañado. Adjunta otra imagen.")
        # Reject files larger than 10MB to keep the proxy from rejecting them silently
        if len(file_data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="La imagen es demasiado grande (máximo 10MB). Comprime la foto e intenta de nuevo.")
        try:
            obj_path = object_store.upload_file(file_data, file.filename, "proofs")
            proof_url = f"/api/uploads/{obj_path}"
        except Exception as e:
            logger.error(f"Object store upload_file failed: {e}")
            raise HTTPException(status_code=500, detail="No se pudo guardar el comprobante en el almacenamiento. Reintenta en unos segundos.")

    transaction = WalletTransaction(
        tenant_id=tid, user_id=user_id, customer_id=wallet["customer_id"],
        type="deposit", amount=float(amount or 0), balance_after=wallet["available"],
        description=description, status="pending"
    )
    tx_dict = transaction.model_dump()
    tx_dict["proof_url"] = proof_url
    if ref:
        tx_dict["reference_number"] = ref
        tx_dict["reference_number_lower"] = ref.lower()
    await db.wallet_transactions.insert_one(tx_dict)

    # Auto-scan proof with Gemini Vision (best-effort; doesn't block success)
    detected_amount = None
    if proof_url:
        try:
            scan = await _scan_proof_image(proof_url, session_id=f"auto-{transaction.id}")
            if scan:
                detected_amount = scan.get("detected_amount")
                detected_deposit_date = scan.get("detected_deposit_date")
                update_fields = {
                    "ai_scan": {
                        "detected_reference_number": scan.get("detected_reference_number"),
                        "detected_amount": detected_amount,
                        "currency": scan.get("currency"),
                        "confidence": scan.get("confidence"),
                        "detected_destination_account": scan.get("detected_destination_account"),
                        "detected_beneficiary_name": scan.get("detected_beneficiary_name"),
                        "detected_deposit_date": detected_deposit_date,
                        "raw_text": scan.get("raw"),
                        "scanned_at": datetime.now(timezone.utc).isoformat()
                    }
                }
                # Persist the deposit date at the top level of the transaction too
                # so that queries + ledger UI can order by "when the money was
                # actually deposited" rather than "when the client uploaded the
                # screenshot". The upload timestamp remains in `created_at`.
                if detected_deposit_date:
                    update_fields["deposit_date"] = detected_deposit_date
                await db.wallet_transactions.update_one(
                    {"id": transaction.id, "tenant_id": tid},
                    {"$set": update_fields}
                )
        except Exception:
            pass

    return {
        "message": "Solicitud enviada. Será revisada por nuestro equipo.",
        "transaction_id": transaction.id,
        "detected_amount": detected_amount
    }


async def _scan_proof_image(proof_url: str, session_id: str = "ocr"):
    """Use Gemini Vision to extract reference number + amount from a proof image URL.
    Returns dict with detected_reference_number, detected_amount, currency, confidence, raw.
    Never raises — returns empty dict on failure so callers can treat it as best-effort.
    """
    if not proof_url or "/api/uploads/" not in proof_url:
        return {}
    obj_path = proof_url.split("/api/uploads/", 1)[1]
    try:
        image_bytes, content_type = object_store.get_object(obj_path)
    except Exception:
        return {}
    if content_type == "application/octet-stream":
        ext = obj_path.rsplit(".", 1)[-1].lower() if "." in obj_path else ""
        content_type = object_store.MIME_TYPES.get(ext, "image/jpeg")
    import tempfile, json as _json, re as _re
    suffix = "." + (obj_path.rsplit(".", 1)[-1] if "." in obj_path else "jpg")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
        emergent_key = os.environ.get("EMERGENT_LLM_KEY")
        if not emergent_key:
            return {}
        chat = LlmChat(
            api_key=emergent_key,
            session_id=session_id,
            system_message=(
                "You extract payment information from deposit receipt images. "
                "Return STRICT JSON with exactly these fields: "
                '{"reference_number": "<string or null>", "amount": <number or null>, "currency": "<string or null>", "confidence": "<low|medium|high>", "destination_account": "<string or null>", "beneficiary_name": "<string or null>", "deposit_date": "<YYYY-MM-DD or null>"}. '
                "Rules: reference_number is the voucher/transaction/receipt number (usually long digits). "
                "amount is the numeric amount deposited (no currency symbols). "
                "destination_account is the bank account number that received the deposit (where the money was transferred TO). "
                "beneficiary_name is the name of the person/company that received the money. "
                "deposit_date is the date the deposit/transfer was actually made in ISO format YYYY-MM-DD. "
                "Common date labels: 'Fecha', 'Fecha de transacción', 'Date', 'Transaction date', 'Fecha de depósito', 'Fecha y hora'. "
                "If the receipt shows the date as DD/MM/YYYY convert it to YYYY-MM-DD. If only a partial date is readable use null. "
                "If a value cannot be confidently read, use null. No extra text, only JSON."
            )
        ).with_model("gemini", "gemini-2.5-flash")
        image_file = FileContentWithMimeType(file_path=tmp_path, mime_type=content_type)
        prompt = (
            "Analiza este comprobante de depósito y extrae: número de comprobante, monto, "
            "número de cuenta destino, nombre del beneficiario y fecha del depósito. Responde únicamente con JSON."
        )
        raw = await chat.send_message(UserMessage(text=prompt, file_contents=[image_file]))
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        return {}
    try:
        os.unlink(tmp_path)
    except Exception:
        pass
    text = str(raw).strip()
    m = _re.search(r"\{.*\}", text, _re.DOTALL)
    parsed = {}
    if m:
        try:
            parsed = _json.loads(m.group(0))
        except Exception:
            parsed = {}
    detected_ref = parsed.get("reference_number")
    if isinstance(detected_ref, str):
        detected_ref = detected_ref.strip() or None
    detected_amount = parsed.get("amount")
    try:
        detected_amount = float(detected_amount) if detected_amount is not None else None
    except (TypeError, ValueError):
        detected_amount = None
    # Parse deposit_date. Gemini returns it in ISO YYYY-MM-DD but we defensively
    # accept DD/MM/YYYY too. If unparseable we keep it as None.
    detected_deposit_date = None
    raw_date = parsed.get("deposit_date")
    if isinstance(raw_date, str) and raw_date.strip():
        raw_date = raw_date.strip()
        import re as _re2
        try:
            if _re2.match(r"^\d{4}-\d{2}-\d{2}$", raw_date):
                detected_deposit_date = raw_date
            else:
                m2 = _re2.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", raw_date)
                if m2:
                    dd, mm, yyyy = m2.group(1), m2.group(2), m2.group(3)
                    detected_deposit_date = f"{yyyy}-{int(mm):02d}-{int(dd):02d}"
        except Exception:
            detected_deposit_date = None
    return {
        "detected_reference_number": detected_ref,
        "detected_amount": detected_amount,
        "currency": parsed.get("currency"),
        "confidence": parsed.get("confidence"),
        "detected_destination_account": (parsed.get("destination_account") or "").strip() or None if isinstance(parsed.get("destination_account"), str) else None,
        "detected_beneficiary_name": (parsed.get("beneficiary_name") or "").strip() or None if isinstance(parsed.get("beneficiary_name"), str) else None,
        "detected_deposit_date": detected_deposit_date,
        "raw": text[:1500]
    }


@api_router.post("/wallet/deposit/{transaction_id}/scan-proof")
async def scan_deposit_proof(transaction_id: str, current_user: dict = Depends(get_current_user)):
    """Use Gemini Vision to extract reference number and amount from the attached proof."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    tx = await db.wallet_transactions.find_one(
        {"id": transaction_id, "tenant_id": tid},
        {"_id": 0, "proof_url": 1, "reference_number": 1, "amount": 1}
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Recarga no encontrada")
    proof_url = tx.get("proof_url")
    if not proof_url:
        raise HTTPException(status_code=400, detail="Esta recarga no tiene comprobante adjunto")
    result = await _scan_proof_image(proof_url, session_id=f"ocr-{transaction_id}")
    if not result:
        raise HTTPException(status_code=502, detail="No se pudo leer el comprobante")

    # Persist scan result to the wallet transaction so the deposit_date read
    # from the screenshot is available for later approve_deposit + bank ledger.
    update_fields = {
        "ai_scan": {
            "detected_reference_number": result.get("detected_reference_number"),
            "detected_amount": result.get("detected_amount"),
            "currency": result.get("currency"),
            "confidence": result.get("confidence"),
            "detected_destination_account": result.get("detected_destination_account"),
            "detected_beneficiary_name": result.get("detected_beneficiary_name"),
            "detected_deposit_date": result.get("detected_deposit_date"),
            "raw_text": result.get("raw"),
            "scanned_at": datetime.now(timezone.utc).isoformat()
        }
    }
    if result.get("detected_deposit_date"):
        update_fields["deposit_date"] = result.get("detected_deposit_date")
    try:
        await db.wallet_transactions.update_one(
            {"id": transaction_id, "tenant_id": tid},
            {"$set": update_fields}
        )
    except Exception:
        pass

    client_ref = (tx.get("reference_number") or "").strip()
    detected_ref = result.get("detected_reference_number")
    matches_reference = None
    if client_ref and detected_ref:
        matches_reference = client_ref.lower().replace(" ", "") == str(detected_ref).lower().replace(" ", "")
    return {
        **result,
        "client_reference_number": client_ref or None,
        "matches_reference": matches_reference
    }


@api_router.put("/wallet/deposit/{transaction_id}/amount")
async def set_deposit_amount(transaction_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Admin sets/corrects the amount on a pending recharge request before approving it."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if current_user["role"] == "employee":
        employee = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not employee or not employee.get("permissions", {}).get("approve_recharges"):
            raise HTTPException(status_code=403, detail="No tienes permiso")
    tid = current_user["tenant_id"]
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Monto inválido")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    tx = await db.wallet_transactions.find_one({"id": transaction_id, "tenant_id": tid}, {"_id": 0, "status": 1})
    if not tx:
        raise HTTPException(status_code=404, detail="Recarga no encontrada")
    if tx["status"] != "pending":
        raise HTTPException(status_code=400, detail="Solo se puede editar una recarga pendiente")
    await db.wallet_transactions.update_one(
        {"id": transaction_id, "tenant_id": tid},
        {"$set": {"amount": amount}}
    )
    return {"message": "Monto actualizado", "amount": amount}

@api_router.get("/wallet/floating-deposits/{customer_id}")
async def list_floating_deposits(customer_id: str, current_user: dict = Depends(get_current_user)):
    """List all approved deposits for a customer that are NOT applied to any
    non-annulled invoice yet — the pool visible as 'Recargas Disponibles'."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    # All approved deposits for that customer
    deposits = await db.wallet_transactions.find(
        {"tenant_id": tid, "customer_id": customer_id, "type": "deposit",
         "status": "approved", "is_deleted": {"$ne": True}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)

    # All applied deposit_ids across non-annulled invoices
    applied_ids = set()
    async for inv in db.invoices.find(
        {"tenant_id": tid, "customer_id": customer_id, "is_annulled": {"$ne": True}},
        {"_id": 0, "applied_deposits": 1}
    ):
        for ad in (inv.get("applied_deposits") or []):
            did = ad.get("deposit_id")
            if did:
                applied_ids.add(did)

    unattached = [d for d in deposits if d.get("id") not in applied_ids]
    total = round(sum(float(d.get("amount", 0) or 0) for d in unattached), 2)
    return {"total": total, "deposits": unattached}


class AssignDepositRequest(BaseModel):
    invoice_id: Optional[str] = None  # None to un-attach (back to floating)


@api_router.put("/wallet/deposit/{transaction_id}/assign-invoice")
async def assign_deposit_to_invoice(
    transaction_id: str,
    payload: AssignDepositRequest,
    current_user: dict = Depends(get_current_user)
):
    """Manually attach an approved deposit to a specific invoice (overrides
    the date-based recalc logic). Passing null unlinks it back to floating."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    # Employee permission check (admins always allowed)
    if current_user["role"] == "employee":
        employee = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not employee or not employee.get("permissions", {}).get("assign_deposits"):
            raise HTTPException(status_code=403, detail="No tienes permiso para asignar recargas a facturas")

    tx = await db.wallet_transactions.find_one(
        {"id": transaction_id, "tenant_id": tid, "type": "deposit"},
        {"_id": 0}
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Recarga no encontrada")
    if tx.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Solo se pueden asignar recargas aprobadas")

    target = payload.invoice_id
    target_number = None
    if target:
        inv = await db.invoices.find_one(
            {"id": target, "tenant_id": tid,
             "customer_id": tx.get("customer_id"),
             "is_annulled": {"$ne": True}},
            {"_id": 0, "id": 1, "invoice_number": 1}
        )
        if not inv:
            raise HTTPException(status_code=404, detail="Factura destino no encontrada o anulada")
        target_number = inv.get("invoice_number")

    old_assigned = tx.get("assigned_invoice_id")
    old_number = None
    if old_assigned:
        old_inv = await db.invoices.find_one({"id": old_assigned, "tenant_id": tid}, {"_id": 0, "invoice_number": 1})
        old_number = (old_inv or {}).get("invoice_number", old_assigned)

    # Set BOTH the manual override and the permanent lock so the recalc engine
    # keeps this deposit on the chosen invoice from now on (or lets it float
    # again when unlinked with null).
    await db.wallet_transactions.update_one(
        {"id": transaction_id, "tenant_id": tid},
        {"$set": {"target_invoice_id": target, "assigned_invoice_id": target}}
    )

    # Audit the manual assignment/move/unlink with the acting user's name.
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor_name,
        user_role=current_user["role"],
        action="deposit_reassigned" if target else "deposit_unlinked",
        entity_type="wallet_transaction",
        entity_id=transaction_id,
        entity_name=f"Recarga ${tx.get('amount', 0)}",
        details={
            "customer_id": tx.get("customer_id"),
            "amount": tx.get("amount"),
            "from_invoice_id": old_assigned,
            "from_invoice_number": old_number,
            "to_invoice_id": target,
            "to_invoice_number": target_number,
            "manual": True,
        },
    )

    # Recompute the chain so the new assignment is reflected everywhere.
    await recalculate_client_invoices(
        tid, tx["customer_id"],
        actor_id=current_user["user_id"], actor_name=actor_name, actor_role=current_user["role"]
    )
    return {"message": "Recarga asignada correctamente", "target_invoice_id": target}



@api_router.get("/admin/maintenance/client-deposits")
async def review_client_deposits(q: str, current_user: dict = Depends(get_current_user)):
    """Review a client's approved deposits and where each is currently linked.
    `q` matches a customer_id (exact, case-insensitive) or a name substring.
    Admin/employee only, scoped to the caller's tenant."""
    if current_user["role"] not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    q = (q or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Falta el parámetro de búsqueda")
    users = await db.users.find(
        {"tenant_id": tid, "$or": [
            {"customer_id": q.upper()},
            {"name": {"$regex": q, "$options": "i"}},
        ]},
        {"_id": 0, "id": 1, "name": 1, "customer_id": 1}
    ).to_list(50)
    results = []
    for u in users:
        deposits = await db.wallet_transactions.find(
            {"user_id": u["id"], "tenant_id": tid, "type": "deposit", "status": "approved", "is_deleted": {"$ne": True}},
            {"_id": 0, "id": 1, "amount": 1, "created_at": 1, "assigned_invoice_id": 1, "target_invoice_id": 1, "description": 1}
        ).sort("created_at", 1).to_list(20000)
        # Which invoice each deposit CURRENTLY lives on (from applied_deposits),
        # regardless of whether the permanent lock is set yet.
        current_by_dep = {}
        cust = u.get("customer_id")
        async for inv in db.invoices.find(
            {"customer_id": cust, "tenant_id": tid, "is_annulled": {"$ne": True}},
            {"_id": 0, "id": 1, "invoice_number": 1, "applied_deposits": 1}
        ):
            for ad in (inv.get("applied_deposits") or []):
                if ad.get("deposit_id"):
                    current_by_dep[ad["deposit_id"]] = (inv["id"], inv.get("invoice_number"))
        inv_ids = {d.get("assigned_invoice_id") for d in deposits if d.get("assigned_invoice_id")}
        inv_map = {}
        if inv_ids:
            async for inv in db.invoices.find({"id": {"$in": list(inv_ids)}, "tenant_id": tid}, {"_id": 0, "id": 1, "invoice_number": 1, "is_annulled": 1}):
                inv_map[inv["id"]] = inv
        results.append({
            "customer_id": u.get("customer_id"),
            "name": u.get("name"),
            "deposits": [{
                "id": d.get("id"),
                "amount": d.get("amount"),
                "created_at": d.get("created_at"),
                "assigned_invoice_id": d.get("assigned_invoice_id"),
                "assigned_invoice_number": (inv_map.get(d.get("assigned_invoice_id")) or {}).get("invoice_number"),
                "assigned_invoice_annulled": (inv_map.get(d.get("assigned_invoice_id")) or {}).get("is_annulled", False),
                "current_invoice_id": (current_by_dep.get(d.get("id")) or (None, None))[0],
                "current_invoice_number": (current_by_dep.get(d.get("id")) or (None, None))[1],
                "is_locked": bool(d.get("assigned_invoice_id")),
                "target_invoice_id": d.get("target_invoice_id"),
                "description": d.get("description"),
            } for d in deposits],
        })
    return {"matches": results}


class MaintenanceReassignRequest(BaseModel):
    deposit_id: str            # full id or a unique prefix
    invoice_number: str        # e.g. "FG6-003"


@api_router.post("/admin/maintenance/reassign-deposit")
async def maintenance_reassign_deposit(payload: MaintenanceReassignRequest, current_user: dict = Depends(get_current_user)):
    """Permanently link a deposit to an invoice by human-readable identifiers
    (deposit id/prefix + invoice number). Sets the lock, audits the move and
    recomputes the client's chain. Admin only."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo un administrador puede ejecutar esta acción")
    tid = current_user["tenant_id"]
    dep_q = (payload.deposit_id or "").strip()
    inv_num = (payload.invoice_number or "").strip()
    if not dep_q or not inv_num:
        raise HTTPException(status_code=400, detail="Faltan deposit_id o invoice_number")

    # Resolve deposit (exact id, else unique prefix).
    tx = await db.wallet_transactions.find_one({"id": dep_q, "tenant_id": tid, "type": "deposit"}, {"_id": 0})
    if not tx:
        candidates = await db.wallet_transactions.find(
            {"id": {"$regex": f"^{dep_q}"}, "tenant_id": tid, "type": "deposit"}, {"_id": 0}
        ).to_list(5)
        if len(candidates) == 0:
            raise HTTPException(status_code=404, detail="Recarga no encontrada")
        if len(candidates) > 1:
            raise HTTPException(status_code=400, detail="El prefijo de la recarga no es único")
        tx = candidates[0]
    if tx.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Solo se pueden asignar recargas aprobadas")

    inv = await db.invoices.find_one(
        {"invoice_number": inv_num, "tenant_id": tid, "customer_id": tx.get("customer_id"), "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "invoice_number": 1}
    )
    if not inv:
        raise HTTPException(status_code=404, detail=f"Factura {inv_num} no encontrada para este cliente (o está anulada)")

    old_assigned = tx.get("assigned_invoice_id")
    old_number = None
    if old_assigned:
        oi = await db.invoices.find_one({"id": old_assigned, "tenant_id": tid}, {"_id": 0, "invoice_number": 1})
        old_number = (oi or {}).get("invoice_number", old_assigned)

    await db.wallet_transactions.update_one(
        {"id": tx["id"], "tenant_id": tid},
        {"$set": {"target_invoice_id": inv["id"], "assigned_invoice_id": inv["id"]}}
    )
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name, user_role="admin",
        action="deposit_reassigned", entity_type="wallet_transaction", entity_id=tx["id"],
        entity_name=f"Recarga ${tx.get('amount', 0)}",
        details={
            "customer_id": tx.get("customer_id"), "amount": tx.get("amount"),
            "from_invoice_id": old_assigned, "from_invoice_number": old_number,
            "to_invoice_id": inv["id"], "to_invoice_number": inv["invoice_number"],
            "manual": True, "via": "maintenance-endpoint",
        },
    )
    await recalculate_client_invoices(
        tid, tx["customer_id"],
        actor_id=current_user["user_id"], actor_name=actor_name, actor_role="admin"
    )
    return {
        "message": f"Recarga ${tx.get('amount', 0)} vinculada permanentemente a {inv['invoice_number']}",
        "deposit_id": tx["id"], "customer_id": tx.get("customer_id"),
        "from_invoice_number": old_number, "to_invoice_number": inv["invoice_number"],
    }



@api_router.post("/wallet/approve-deposit/{transaction_id}")
async def approve_deposit(transaction_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Check employee permissions
    if current_user["role"] == "employee":
        employee = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not employee or not employee.get("permissions", {}).get("approve_recharges"):
            raise HTTPException(status_code=403, detail="No tienes permiso para aprobar recargas")
    
    transaction = await db.wallet_transactions.find_one({"id": transaction_id, "tenant_id": tid}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if transaction["status"] != "pending":
        raise HTTPException(status_code=400, detail="Transacción ya procesada")
    if not transaction.get("amount") or transaction["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Debes asignar el monto antes de aprobar")
    wallet = await db.wallets.find_one({"user_id": transaction["user_id"], "tenant_id": tid}, {"_id": 0})
    new_balance = wallet["available"] + transaction["amount"]
    await db.wallets.update_one({"user_id": transaction["user_id"], "tenant_id": tid},
        {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await db.wallet_transactions.update_one({"id": transaction_id, "tenant_id": tid},
        {"$set": {"status": "approved", "balance_after": new_balance, "approved_at": datetime.now(timezone.utc).isoformat()}})
    await create_notification(tid, transaction["user_id"], transaction["customer_id"], "wallet_credited",
        "Saldo Acreditado", f"Se han acreditado ${transaction['amount']:.2f} USD. Saldo actual: ${new_balance:.2f} USD")
    
    # Get user name for audit
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    if not user:
        user = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
    user_name = user["name"] if user else "Usuario"
    
    # Audit log
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=user_name,
        user_role=current_user["role"],
        action="approve_recharge",
        entity_type="wallet_transaction",
        entity_id=transaction_id,
        entity_name=f"${transaction['amount']:.2f} - {transaction['customer_id']}",
        details={"amount": transaction["amount"], "customer_id": transaction["customer_id"], "new_balance": new_balance}
    )
    
    # Recalculate invoice deposits for this client
    await recalculate_client_invoices(tid, transaction["customer_id"])

    # ── Bank ledger: attribute this recharge to a tenant bank account ──
    # Matching rules (strict, per product spec):
    #   1) Honor manual `bank_account_id` if admin already set it.
    #   2) Else match by BOTH owner-name token AND last-4 of account number in the OCR.
    #   3) If no match → leave unassigned. The dashboard surfaces "Recargas sin
    #      asignar" with manual assignment UI.
    try:
        tenant_doc = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
        all_accounts = (tenant_doc or {}).get("bank_accounts", [])
        active_accounts = [a for a in all_accounts if a.get("is_active", True) is not False]
        target_id = transaction.get("bank_account_id")
        if not target_id and active_accounts:
            ai = transaction.get("ai_scan") or {}
            ocr_text = ""
            account_hint = transaction.get("bank_account_number_hint")
            owner_hint = transaction.get("beneficiary_name_hint")
            if isinstance(ai, dict):
                ocr_text = str(ai.get("raw_text") or ai.get("text") or "")
                account_hint = account_hint or ai.get("detected_destination_account")
                owner_hint = owner_hint or ai.get("detected_beneficiary_name")
            match = _find_matching_bank_account(
                active_accounts,
                ocr_text,
                account_number_hint=account_hint,
                owner_name_hint=owner_hint,
            )
            if match:
                target_id = match["id"]
                await db.wallet_transactions.update_one(
                    {"id": transaction_id, "tenant_id": tid},
                    {"$set": {"bank_account_id": target_id, "bank_account_auto_matched": True}}
                )
        if target_id:
            # Replace any previous recharge ledger row tied to this tx (idempotent re-approval).
            await db.bank_transactions.delete_many({
                "tenant_id": tid, "source_transaction_id": transaction_id, "kind": "recharge"
            })
            # Ledger row uses the SYSTEM approval timestamp (not the screenshot
            # date) — the admin explicitly requested this so the accounts
            # module reflects when the money was booked into the system.
            ledger_created_at = datetime.now(timezone.utc).isoformat()
            await db.bank_transactions.insert_one({
                "id": str(uuid.uuid4()),
                "tenant_id": tid,
                "bank_account_id": target_id,
                "kind": "recharge",
                "amount": float(transaction.get("amount", 0) or 0),
                "description": transaction.get("description") or "Recarga de cliente",
                "source_transaction_id": transaction_id,
                "customer_id": transaction.get("customer_id"),
                "customer_name": user_name,
                "reference_number": transaction.get("reference_number"),
                "created_by": current_user["user_id"],
                "created_by_name": user_name,
                "created_at": ledger_created_at,
                "approved_at": ledger_created_at,
            })
    except Exception as _bank_err:
        logger.warning(f"[bank_ledger] failed to attribute recharge {transaction_id}: {_bank_err}")

    return {"message": "Depósito aprobado", "new_balance": new_balance}

@api_router.post("/wallet/reject-deposit/{transaction_id}")
async def reject_deposit(transaction_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Check employee permissions
    if current_user["role"] == "employee":
        employee = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not employee or not employee.get("permissions", {}).get("approve_recharges"):
            raise HTTPException(status_code=403, detail="No tienes permiso para rechazar recargas")
    
    transaction = await db.wallet_transactions.find_one({"id": transaction_id, "tenant_id": tid}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if transaction["status"] != "pending":
        raise HTTPException(status_code=400, detail="Transacción ya procesada")
    await db.wallet_transactions.update_one({"id": transaction_id, "tenant_id": tid},
        {"$set": {"status": "rejected", "approved_at": datetime.now(timezone.utc).isoformat()}})
    await create_notification(tid, transaction["user_id"], transaction["customer_id"], "deposit_rejected",
        "Recarga Rechazada", f"Tu solicitud de recarga por ${transaction['amount']:.2f} USD ha sido rechazada. Contacta al administrador para más información.")
    
    # Get user name for audit
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    if not user:
        user = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
    user_name = user["name"] if user else "Usuario"
    
    # Audit log
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=user_name,
        user_role=current_user["role"],
        action="reject_recharge",
        entity_type="wallet_transaction",
        entity_id=transaction_id,
        entity_name=f"${transaction['amount']:.2f} - {transaction['customer_id']}",
        details={"amount": transaction["amount"], "customer_id": transaction["customer_id"]}
    )

    # Recalculate the client invoice chain so `applied_deposits` only contains approved+non-deleted deposits.
    # (A rejected deposit must never appear inside an invoice's deposits array.)
    try:
        await recalculate_client_invoices(tid, transaction["customer_id"])
    except Exception as _re_err:
        logger.error(f"Error recalculating after reject_deposit: {_re_err}")

    return {"message": "Depósito rechazado"}

@api_router.put("/wallet/{transaction_id}/deposit-date")
async def set_deposit_date(transaction_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Manually override the deposit_date on a recharge (admin/employee).

    Used when the OCR failed to read the date on the screenshot, or when the
    admin wants to correct it. Updates the bank_transactions ledger row too
    so the ledger UI reflects the correct chronological order right away.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    if current_user["role"] == "employee":
        emp = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not emp or not emp.get("permissions", {}).get("approve_recharges"):
            raise HTTPException(status_code=403, detail="No tienes permiso para editar recargas")

    date_str = (data or {}).get("deposit_date")
    if not date_str:
        # Clear the deposit_date (reverts ledger back to created_at ordering)
        await db.wallet_transactions.update_one(
            {"id": transaction_id, "tenant_id": tid},
            {"$unset": {"deposit_date": ""}}
        )
        await db.bank_transactions.update_many(
            {"tenant_id": tid, "source_transaction_id": transaction_id, "kind": "recharge"},
            {"$unset": {"deposit_date": ""}}
        )
        return {"message": "Fecha de depósito eliminada"}

    # Validate YYYY-MM-DD
    import re as _re
    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", str(date_str)):
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usa YYYY-MM-DD.")

    tx = await db.wallet_transactions.find_one({"id": transaction_id, "tenant_id": tid}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")

    await db.wallet_transactions.update_one(
        {"id": transaction_id, "tenant_id": tid},
        {"$set": {"deposit_date": date_str}}
    )
    # Update the ledger row's chronological anchor so the UI reflects the change.
    await db.bank_transactions.update_many(
        {"tenant_id": tid, "source_transaction_id": transaction_id, "kind": "recharge"},
        {"$set": {"deposit_date": date_str, "created_at": f"{date_str}T00:00:00+00:00"}}
    )
    return {"message": "Fecha de depósito actualizada", "deposit_date": date_str}


@api_router.post("/wallet/delete-deposit/{transaction_id}")
async def delete_deposit(transaction_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Soft-delete a deposit after admin password verification. Reverses wallet amount."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo el administrador puede eliminar recargas")
    tid = current_user["tenant_id"]
    
    admin_password = data.get("password", "")
    if not admin_password:
        raise HTTPException(status_code=400, detail="Contraseña requerida")
    
    # Verify admin password
    admin = await db.users.find_one({"id": current_user["user_id"], "tenant_id": tid})
    if not admin or not verify_password(admin_password, admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")
    
    # Find the transaction
    transaction = await db.wallet_transactions.find_one({"id": transaction_id, "tenant_id": tid}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if transaction.get("is_deleted"):
        raise HTTPException(status_code=400, detail="Esta recarga ya fue eliminada")
    
    # Reverse wallet balance if it was approved
    if transaction.get("status") == "approved":
        wallet = await db.wallets.find_one({"user_id": transaction["user_id"], "tenant_id": tid}, {"_id": 0})
        if wallet:
            new_balance = wallet["available"] - transaction["amount"]
            await db.wallets.update_one(
                {"user_id": transaction["user_id"], "tenant_id": tid},
                {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
    
    # Soft-delete
    await db.wallet_transactions.update_one(
        {"id": transaction_id, "tenant_id": tid},
        {"$set": {
            "is_deleted": True,
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": current_user["user_id"]
        }}
    )

    # Also soft-delete the linked `bank_transactions` ledger entry (if any)
    # so it stops adding to the bank account balance. We keep the row so the
    # ledger UI can render it grayed out with a strikethrough (audit trail).
    await db.bank_transactions.update_many(
        {"tenant_id": tid, "source_transaction_id": transaction_id, "kind": "recharge", "is_deleted": {"$ne": True}},
        {"$set": {
            "is_deleted": True,
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": current_user["user_id"],
        }}
    )
    
    # Remove this deposit from ALL invoices that have it assigned
    affected_invoices = await db.invoices.find(
        {"tenant_id": tid, "is_annulled": {"$ne": True}, "applied_deposits.deposit_id": transaction_id},
        {"_id": 0, "id": 1, "applied_deposits": 1}
    ).to_list(20000)
    
    for inv in affected_invoices:
        new_deposits = [d for d in inv.get("applied_deposits", []) if d.get("deposit_id") != transaction_id]
        new_total = round(sum(d["amount_applied"] for d in new_deposits), 2)
        await db.invoices.update_one(
            {"id": inv["id"], "tenant_id": tid},
            {"$set": {"applied_deposits": new_deposits, "deposits_applied": new_total}}
        )
    
    # Audit
    actor = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "name": 1})
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor["name"] if actor else "Admin",
        user_role="admin",
        action="delete_recharge",
        entity_type="wallet_transaction",
        entity_id=transaction_id,
        entity_name=f"${transaction['amount']:.2f} - {transaction.get('customer_id', '')}",
        details={"amount": transaction["amount"], "customer_id": transaction.get("customer_id", "")}
    )

    # Full recalculation of the client invoice chain so totals (`total_a_pagar`,
    # `saldo_pendiente`, `saldo_a_favor`) reflect the deposit removal across all invoices.
    try:
        if transaction.get("customer_id"):
            await recalculate_client_invoices(tid, transaction["customer_id"])
    except Exception as _re_err:
        logger.error(f"Error recalculating after delete_deposit: {_re_err}")

    return {"message": "Recarga eliminada exitosamente"}

class AdminBalanceAdjustment(BaseModel):
    user_id: str
    amount: float
    description: str

@api_router.post("/wallet/admin-adjustment")
async def admin_balance_adjustment(data: AdminBalanceAdjustment, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Check employee permissions
    if current_user["role"] == "employee":
        employee = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not employee or not employee.get("permissions", {}).get("adjust_wallet"):
            raise HTTPException(status_code=403, detail="No tienes permiso para ajustar saldos")
    
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")
    wallet = await db.wallets.find_one({"user_id": data.user_id, "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")
    user = await db.users.find_one({"id": data.user_id, "tenant_id": tid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    new_balance = wallet["available"] - data.amount
    await db.wallets.update_one({"user_id": data.user_id, "tenant_id": tid},
        {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
    tx = WalletTransaction(
        tenant_id=tid,
        user_id=data.user_id,
        customer_id=user["customer_id"],
        type="admin_adjustment",
        amount=-data.amount,
        balance_after=new_balance,
        description=data.description,
        status="approved",
        approved_at=datetime.now(timezone.utc).isoformat()
    )
    await db.wallet_transactions.insert_one(tx.model_dump())
    await create_notification(tid, data.user_id, user["customer_id"], "balance_adjustment",
        "Ajuste de Balance", f"Se ha realizado un ajuste de -${data.amount:.2f} USD en tu cuenta. Motivo: {data.description}")
    
    # Get actor name for audit
    actor = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    if not actor:
        actor = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
    actor_name = actor["name"] if actor else "Usuario"
    
    # Audit log
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor_name,
        user_role=current_user["role"],
        action="adjust_wallet",
        entity_type="wallet",
        entity_id=wallet["id"],
        entity_name=f"{user['name']} ({user['customer_id']})",
        details={"amount": -data.amount, "description": data.description, "new_balance": new_balance}
    )
    
    return {"message": "Ajuste realizado", "new_balance": new_balance, "amount_deducted": data.amount}

@api_router.post("/wallet/admin-recharge")
async def admin_create_recharge(
    user_id: str = FastAPIForm(...),
    amount: float = FastAPIForm(...),
    description: str = FastAPIForm(None),
    bank_account_id: str = FastAPIForm(None),
    proof: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Admin creates a recharge directly for a client with mandatory proof screenshot.
    This immediately credits the client's wallet and logs to audit.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Check employee permissions
    if current_user["role"] == "employee":
        employee = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not employee or not employee.get("permissions", {}).get("approve_recharges"):
            raise HTTPException(status_code=403, detail="No tienes permiso para crear recargas")
    
    if amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")
    
    # Validate user exists
    user = await db.users.find_one({"id": user_id, "tenant_id": tid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if user.get("is_active", True) is False:
        raise HTTPException(status_code=403, detail=f"El cliente {user.get('name') or user_id} está inhabilitado. Actívalo antes de subir recargas.")
    
    wallet = await db.wallets.find_one({"user_id": user_id, "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")
    
    # Save proof file (mandatory)
    if not proof or not proof.filename:
        raise HTTPException(status_code=400, detail="El comprobante es obligatorio")
    
    ext = proof.filename.split(".")[-1].lower()
    if ext not in ["jpg", "jpeg", "png", "gif", "webp", "pdf"]:
        raise HTTPException(status_code=400, detail="Formato de archivo no soportado. Use: jpg, jpeg, png, gif, webp, pdf")
    
    filename = f"proof_{uuid.uuid4().hex[:8]}.{ext}"
    file_data = await proof.read()
    obj_path = object_store.upload_file(file_data, filename, "proofs")
    proof_url = f"/api/uploads/{obj_path}"

    # ── Resolve which bank account this recharge belongs to ──
    # The bank account is now MANDATORY so every recharge always lands in the
    # ledger immediately (no "Sin asignar" leak). When only one active account
    # exists the frontend auto-fills it; with multiple, the admin must choose.
    tenant_doc = await db.tenants.find_one({"id": tid}, {"_id": 0, "bank_accounts": 1})
    all_accounts = (tenant_doc or {}).get("bank_accounts", [])
    active_accounts = [a for a in all_accounts if a.get("is_active", True) is not False]
    if not active_accounts:
        raise HTTPException(status_code=400, detail="No hay cuentas bancarias activas. Crea una primero en /admin/bank-accounts.")
    resolved_bank_account_id = None
    if bank_account_id:
        if not any(a.get("id") == bank_account_id for a in active_accounts):
            raise HTTPException(status_code=404, detail="Cuenta bancaria no encontrada o inactiva")
        resolved_bank_account_id = bank_account_id
    elif len(active_accounts) == 1:
        # Single-account tenants: auto-pick to keep the UX seamless.
        resolved_bank_account_id = active_accounts[0]["id"]
    else:
        raise HTTPException(status_code=400, detail="Debes seleccionar la cuenta bancaria de destino")

    # Update wallet balance immediately
    new_balance = wallet["available"] + amount
    await db.wallets.update_one(
        {"user_id": user_id, "tenant_id": tid},
        {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    # Create transaction with "approved" status directly
    tx = WalletTransaction(
        tenant_id=tid,
        user_id=user_id,
        customer_id=user["customer_id"],
        type="deposit",
        amount=amount,
        balance_after=new_balance,
        description=description or "Recarga creada por administrador",
        status="approved",
        approved_at=datetime.now(timezone.utc).isoformat()
    )
    tx_dict = tx.model_dump()
    tx_dict["proof_url"] = proof_url
    tx_dict["created_by_admin"] = True
    if resolved_bank_account_id:
        tx_dict["bank_account_id"] = resolved_bank_account_id

    # Run OCR on the proof BEFORE inserting so the deposit_date read from the
    # screenshot is persisted with the transaction and reused by the bank
    # ledger. If the scan fails we still create the recharge — the admin can
    # correct the date manually later.
    detected_deposit_date = None
    detected_reference_number = None
    try:
        scan = await _scan_proof_image(proof_url, session_id=f"admin-{tx.id}")
        if scan:
            detected_deposit_date = scan.get("detected_deposit_date")
            detected_reference_number = scan.get("detected_reference_number")
            tx_dict["ai_scan"] = {
                "detected_reference_number": detected_reference_number,
                "detected_amount": scan.get("detected_amount"),
                "currency": scan.get("currency"),
                "confidence": scan.get("confidence"),
                "detected_destination_account": scan.get("detected_destination_account"),
                "detected_beneficiary_name": scan.get("detected_beneficiary_name"),
                "detected_deposit_date": detected_deposit_date,
                "raw_text": scan.get("raw"),
                "scanned_at": datetime.now(timezone.utc).isoformat()
            }
            if detected_deposit_date:
                tx_dict["deposit_date"] = detected_deposit_date
            if detected_reference_number:
                tx_dict["reference_number"] = detected_reference_number
                tx_dict["reference_number_lower"] = detected_reference_number.lower()
    except Exception:
        pass

    # Reject duplicate reference numbers (same rule as client-facing endpoint)
    if detected_reference_number:
        dup = await db.wallet_transactions.find_one(
            {
                "tenant_id": tid,
                "reference_number_lower": detected_reference_number.lower(),
                "status": {"$in": ["pending", "approved"]},
                "is_deleted": {"$ne": True}
            },
            {"_id": 0, "id": 1, "customer_id": 1}
        )
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe una recarga con el comprobante {detected_reference_number} (cliente {dup.get('customer_id') or '—'})."
            )

    await db.wallet_transactions.insert_one(tx_dict)
    
    # Create notification for client
    await create_notification(
        tid, user_id, user["customer_id"], "wallet_credited",
        "Recarga Acreditada",
        f"Se ha acreditado ${amount:.2f} USD a tu cuenta. Nuevo saldo: ${new_balance:.2f} USD"
    )
    
    # Get actor name for audit
    actor = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    if not actor:
        actor = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
    actor_name = actor["name"] if actor else "Administrador"
    
    # Audit log
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor_name,
        user_role=current_user["role"],
        action="create_recharge",
        entity_type="wallet_transaction",
        entity_id=tx.id,
        entity_name=f"{user['name']} ({user['customer_id']})",
        details={
            "amount": amount,
            "description": description or "Recarga creada por administrador",
            "new_balance": new_balance,
            "proof_url": proof_url,
            "bank_account_id": resolved_bank_account_id,
        }
    )
    
    # Recalculate invoice deposits for this client
    await recalculate_client_invoices(tid, user["customer_id"])

    # ── Bank ledger: always log to the chosen bank account so the recharge
    # appears in /admin/bank-accounts. `resolved_bank_account_id` is now
    # guaranteed to be set thanks to the validations above.
    try:
        # Ledger row uses the SYSTEM entry timestamp (not the screenshot date)
        # per admin request — the accounts module reflects when the money
        # was booked into the system, not when the physical deposit happened.
        _ledger_created_at = datetime.now(timezone.utc).isoformat()
        await db.bank_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "bank_account_id": resolved_bank_account_id,
            "kind": "recharge",
            "amount": float(amount),
            "description": description or "Recarga creada por administrador",
            "source_transaction_id": tx.id,
            "customer_id": user["customer_id"],
            "customer_name": user["name"],
            "reference_number": None,
            "created_by": current_user["user_id"],
            "created_by_name": actor_name,
            "created_at": _ledger_created_at,
            "approved_at": _ledger_created_at,
        })
    except Exception as _bank_err:
        logger.warning(f"[bank_ledger] failed to attribute admin-recharge {tx.id}: {_bank_err}")

    return {
        "message": "Recarga creada exitosamente",
        "transaction_id": tx.id,
        "new_balance": new_balance,
        "amount_credited": amount,
        "bank_account_id": resolved_bank_account_id,
    }

# ==================== RECHARGE QR UPLOAD ENDPOINTS ====================

@api_router.post("/wallet/generate-upload-qr/{user_id}")
async def generate_recharge_upload_qr(user_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a temporary token for mobile upload of recharge proof via QR code"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    
    # Verify user exists
    user = await db.users.find_one({"id": user_id, "tenant_id": tid}, {"_id": 0, "id": 1, "customer_id": 1, "name": 1, "is_active": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.get("is_active", True) is False:
        raise HTTPException(status_code=403, detail=f"El cliente {user.get('name') or user_id} está inhabilitado. Actívalo antes de subir recargas.")
    
    # Create a temporary upload token (expires in 10 minutes)
    upload_token = str(uuid.uuid4())
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    
    # Store token in database
    await db.upload_tokens.insert_one({
        "token": upload_token,
        "user_id": user_id,
        "type": "recharge_proof",
        "tenant_id": tid,
        "expires_at": expires_at,
        "used": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "upload_token": upload_token,
        "expires_in_minutes": 10
    }

@api_router.post("/wallet/mobile-upload/{upload_token}")
async def mobile_upload_recharge_proof(upload_token: str, file: UploadFile = File(...)):
    """Upload recharge proof from mobile device using temporary token (no auth required)"""
    # Find and validate token
    token_doc = await db.upload_tokens.find_one({"token": upload_token, "type": "recharge_proof"}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=404, detail="Token inválido o expirado")
    
    if token_doc.get("used"):
        raise HTTPException(status_code=400, detail="Este token ya fue utilizado")
    
    # Check expiration
    expires_at = datetime.fromisoformat(token_doc["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=400, detail="Token expirado")

    # Block inactive users even if the token was generated earlier.
    target_user = await db.users.find_one(
        {"id": token_doc.get("user_id"), "tenant_id": token_doc.get("tenant_id")},
        {"_id": 0, "is_active": 1, "name": 1}
    )
    if target_user and target_user.get("is_active", True) is False:
        raise HTTPException(status_code=403, detail=f"El cliente {target_user.get('name') or token_doc.get('user_id')} está inhabilitado.")
    
    # Save file
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "jpg"
    filename = f"recharge_proof_{upload_token[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    content = await file.read()
    obj_path = object_store.upload_file(content, filename, "proofs")
    image_url = f"/api/uploads/{obj_path}"
    
    # Mark token as used and store image URL
    await db.upload_tokens.update_one(
        {"token": upload_token}, 
        {"$set": {"used": True, "image_url": image_url}}
    )
    
    return {"message": "Imagen subida exitosamente", "image_url": image_url}

@api_router.get("/wallet/check-upload/{upload_token}")
async def check_recharge_upload_status(upload_token: str):
    """Check if a recharge proof image was uploaded using the token (for polling from desktop)"""
    token_doc = await db.upload_tokens.find_one({"token": upload_token, "type": "recharge_proof"}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=404, detail="Token no encontrado")
    
    return {
        "used": token_doc.get("used", False),
        "image_url": token_doc.get("image_url")
    }

# ==================== LIVE SHOPPING ENDPOINTS ====================

@api_router.post("/lives")
async def create_live(live_data: LiveCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    live = Live(tenant_id=current_user["tenant_id"], title=live_data.title, store=live_data.store)
    if live_data.tax_rate is not None:
        live.tax_rate = live_data.tax_rate
    if live_data.apply_tax is not None:
        live.apply_tax = live_data.apply_tax
    await db.lives.insert_one(live.model_dump())
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=current_user["tenant_id"], user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="create_live",
        entity_type="live", entity_id=live.id, entity_name=f"{live.title} · {live.store}",
        details={"store": live.store, "title": live.title}
    )
    return {"message": "Live creado", "live_id": live.id}

@api_router.post("/lives/{live_id}/start")
async def start_live(live_id: str, data: dict = Body(default=None), current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0, "title": 1, "store": 1, "status": 1})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    # Reactivating a FINALIZED live to add products requires the Astrid-Shop
    # admin password — always, even for employees with the lives permission.
    if live.get("status") in ("completed", "ended", "finalized"):
        if not await verify_tenant_admin_password(tid, (data or {}).get("password")):
            raise HTTPException(status_code=401, detail="Clave de administrador incorrecta")
    result = await db.lives.update_one({"id": live_id, "tenant_id": tid},
        {"$set": {"status": "active", "started_at": datetime.now(timezone.utc).isoformat()}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=current_user["tenant_id"], user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="start_live",
        entity_type="live", entity_id=live_id,
        entity_name=f"{(live or {}).get('title','')} · {(live or {}).get('store','')}"
    )
    return {"message": "Live iniciado"}

@api_router.post("/lives/{live_id}/end")
async def end_live(live_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    result = await db.lives.update_one({"id": live_id, "tenant_id": tid},
        {"$set": {"status": "completed", "ended_at": datetime.now(timezone.utc).isoformat()}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="end_live",
        entity_type="live", entity_id=live_id,
        entity_name=f"{live.get('title','')} · {live.get('store','')}",
        details={"started_at": live.get("started_at")}
    )
    return {"message": "Live finalizado"}

@api_router.put("/lives/{live_id}/store-invoice")
async def update_store_invoice(live_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update store invoice amount, tax, and calculate profit"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    store_amount = float(data.get("store_invoice_amount", 0))
    if store_amount < 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor o igual a 0")

    # Store invoice tax (paid by shopper, reduces profit)
    store_tax_raw = data.get("store_invoice_tax")
    store_tax = 0.0
    if store_tax_raw is not None and store_tax_raw != "":
        try:
            store_tax = float(store_tax_raw)
            if store_tax < 0:
                raise HTTPException(status_code=400, detail="El tax debe ser mayor o igual a 0")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Tax inválido")

    # Optional: total physical items purchased at the store (admin-entered).
    # Useful when the admin bought e.g. 30 items at the store but only 25 went to
    # clients — this records the real basket size for store-profit reporting.
    items_count_raw = data.get("store_invoice_items_count")
    items_count = None
    if items_count_raw is not None and items_count_raw != "":
        try:
            items_count = int(items_count_raw)
            if items_count < 0:
                raise HTTPException(status_code=400, detail="La cantidad debe ser mayor o igual a 0")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Cantidad inválida")

    # Calculate profit: total_sales - store_invoice_amount - store_invoice_tax
    # Ganancia = Total del Live - Factura Tienda - Tax
    total_sales = live.get("total_sales", 0)
    profit = total_sales - store_amount - store_tax

    update_set = {
        "store_invoice_amount": store_amount,
        "store_invoice_tax": store_tax,
        "store_profit": profit,
    }
    if items_count is not None:
        update_set["store_invoice_items_count"] = items_count

    await db.lives.update_one(
        {"id": live_id, "tenant_id": tid},
        {"$set": update_set}
    )

    return {
        "message": "Monto actualizado",
        "store_invoice_amount": store_amount,
        "store_invoice_tax": store_tax,
        "store_invoice_items_count": items_count if items_count is not None else live.get("store_invoice_items_count"),
        "total_sales": total_sales,
        "store_profit": profit
    }

@api_router.post("/lives/{live_id}/store-invoice/upload")
async def upload_store_invoice_image(
    live_id: str, 
    file: UploadFile = File(...), 
    current_user: dict = Depends(get_current_user)
):
    """Upload store invoice/receipt image"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    # Save file
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "jpg"
    filename = f"store_invoice_{live_id}_{uuid.uuid4().hex[:8]}.{ext}"
    content = await file.read()
    obj_path = object_store.upload_file(content, filename, "invoices")
    image_url = f"/api/uploads/{obj_path}"
    
    # Update live with image URL and recalculate profit if amount exists
    update_data = {"store_invoice_image": image_url}
    if live.get("store_invoice_amount") is not None:
        profit = live.get("total_sales", 0) - live.get("store_invoice_amount", 0)
        update_data["store_profit"] = profit
    
    await db.lives.update_one({"id": live_id, "tenant_id": tid}, {"$set": update_data})
    
    return {"message": "Imagen subida", "image_url": image_url}

@api_router.put("/lives/{live_id}/manual-commission")
async def update_manual_commission(live_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update manual commission for a Live Shopping session"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    manual_commission = float(data.get("manual_commission", 0))
    note = data.get("note", "")
    
    await db.lives.update_one(
        {"id": live_id, "tenant_id": tid},
        {"$set": {
            "manual_commission": manual_commission,
            "manual_commission_note": note
        }}
    )
    
    return {
        "message": "Comisión manual actualizada",
        "manual_commission": manual_commission,
        "note": note
    }

@api_router.put("/lives/{live_id}/remove-all-taxes")
async def remove_all_taxes_from_live(live_id: str, current_user: dict = Depends(get_current_user)):
    """
    Remove taxes from ALL purchases in a Live and recalculate totals.
    Sets tax fields to 0 and recalculates purchase.total = price + commission (no tax).
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden realizar esta acción")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    # Get all purchases for this live
    purchases = await db.purchases.find(
        {"live_id": live_id, "tenant_id": tid}
    ).to_list(None)
    
    if not purchases:
        return {"message": "No hay compras en este Live", "updated_count": 0}
    
    updated_count = 0
    total_taxes_removed = 0
    new_total_sales = 0
    
    for purchase in purchases:
        purchase_id = purchase.get("id")
        
        # Get current values
        current_price = purchase.get("price", 0) or 0
        current_total = purchase.get("total", 0) or 0
        commission = purchase.get("commission", 0) or 0
        
        # Calculate the tax that was in the total
        # total = price + tax + commission, so tax = total - price - commission
        calculated_tax = current_total - current_price - commission
        if calculated_tax > 0:
            total_taxes_removed += calculated_tax
        
        # New total is just price + commission (no tax)
        new_total = round(current_price + commission, 2)
        new_total_sales += new_total
        
        # Update purchase: set tax fields to 0 and recalculate total
        await db.purchases.update_one(
            {"id": purchase_id, "tenant_id": tid},
            {"$set": {
                "total": new_total,
                "tax_amount": 0,
                "tax_rate": 0,
                "tax_percent": 0,
                "tax": 0,
                "tax_type": None,
                "tax_label": None,
                "tax_option": "0"
            }}
        )
        updated_count += 1
    
    # Sync any invoices that contain these items, then rebalance each client.
    invoice_ids = {p.get("invoice_id") for p in purchases if p.get("invoice_id")}
    customers = set()
    for iid in invoice_ids:
        if await resync_invoice_totals(tid, iid, current_user, f"Taxes removidos del Live {live.get('title', '')}"):
            inv = await db.invoices.find_one({"id": iid, "tenant_id": tid}, {"_id": 0, "customer_id": 1})
            if inv and inv.get("customer_id"):
                customers.add(inv["customer_id"])
    for cid in customers:
        await recalculate_client_invoices(tid, cid)

    # Update the Live totals
    await db.lives.update_one(
        {"id": live_id, "tenant_id": tid},
        {"$set": {
            "total_sales": round(new_total_sales, 2),
            "total_taxes_paid": 0,
            "tax_rate": None,
            "apply_tax": False
        }}
    )
    
    return {
        "message": f"Taxes removidos y totales recalculados para {updated_count} productos",
        "updated_count": updated_count,
        "total_taxes_removed": round(total_taxes_removed, 2),
        "new_total_sales": round(new_total_sales, 2),
        "live_id": live_id,
        "live_title": live.get("title", "")
    }

@api_router.put("/lives/{live_id}/reactivate")
async def reactivate_live(live_id: str, current_user: dict = Depends(get_current_user)):
    """Reactivate a closed/completed Live back to active status"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden reactivar Lives")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    if live.get("status") == "active":
        return {"message": "El Live ya está activo", "live_id": live_id}
    
    await db.lives.update_one(
        {"id": live_id, "tenant_id": tid},
        {"$set": {"status": "active"}, "$unset": {"ended_at": "", "auto_closed": ""}}
    )
    
    return {
        "message": "Live reactivado exitosamente",
        "live_id": live_id,
        "live_title": live.get("title", "")
    }

@api_router.put("/lives/reactivate-all-auto-closed")
async def reactivate_all_auto_closed_lives(current_user: dict = Depends(get_current_user)):
    """Reactivate all Lives that were auto-closed by the system"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden reactivar Lives")
    
    tid = current_user["tenant_id"]
    
    # Find and reactivate all auto-closed lives for this tenant
    result = await db.lives.update_many(
        {"tenant_id": tid, "auto_closed": True},
        {"$set": {"status": "active"}, "$unset": {"ended_at": "", "auto_closed": ""}}
    )
    
    return {
        "message": f"Se reactivaron {result.modified_count} Lives",
        "reactivated_count": result.modified_count
    }

@api_router.post("/lives/{live_id}/generate-upload-qr")
async def generate_upload_qr(live_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a temporary token for mobile upload via QR code"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    # Create a temporary upload token (expires in 10 minutes)
    upload_token = str(uuid.uuid4())
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    
    # Store token in database
    await db.upload_tokens.insert_one({
        "token": upload_token,
        "live_id": live_id,
        "tenant_id": tid,
        "expires_at": expires_at,
        "used": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "upload_token": upload_token,
        "expires_in_minutes": 10
    }

@api_router.post("/lives/mobile-upload/{upload_token}")
async def mobile_upload_store_invoice(upload_token: str, file: UploadFile = File(...)):
    """Upload store invoice from mobile device using temporary token (no auth required)"""
    # Find and validate token
    token_doc = await db.upload_tokens.find_one({"token": upload_token}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=404, detail="Token inválido o expirado")
    
    if token_doc.get("used"):
        raise HTTPException(status_code=400, detail="Este token ya fue utilizado")
    
    # Check expiration
    expires_at = datetime.fromisoformat(token_doc["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=400, detail="Token expirado")
    
    live_id = token_doc["live_id"]
    tid = token_doc["tenant_id"]
    
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    # Save file
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "jpg"
    filename = f"store_invoice_{live_id}_{uuid.uuid4().hex[:8]}.{ext}"
    content = await file.read()
    obj_path = object_store.upload_file(content, filename, "invoices")
    image_url = f"/api/uploads/{obj_path}"
    
    # Update live with image URL
    update_data = {"store_invoice_image": image_url}
    if live.get("store_invoice_amount") is not None:
        profit = live.get("total_sales", 0) - live.get("store_invoice_amount", 0)
        update_data["store_profit"] = profit
    
    await db.lives.update_one({"id": live_id, "tenant_id": tid}, {"$set": update_data})
    
    # Mark token as used
    await db.upload_tokens.update_one({"token": upload_token}, {"$set": {"used": True}})
    
    return {"message": "Imagen subida exitosamente", "image_url": image_url}

@api_router.get("/lives/check-upload/{upload_token}")
async def check_upload_status(upload_token: str):
    """Check if an image was uploaded using the token (for polling from desktop)"""
    token_doc = await db.upload_tokens.find_one({"token": upload_token}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=404, detail="Token no encontrado")
    
    live = await db.lives.find_one({"id": token_doc["live_id"]}, {"_id": 0})
    
    return {
        "used": token_doc.get("used", False),
        "image_url": live.get("store_invoice_image") if live else None
    }

@api_router.get("/lives")
async def get_lives(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    query = {"tenant_id": tid}
    if status:
        query["status"] = status
    lives = await db.lives.find(query, {"_id": 0}).sort("created_at", -1).to_list(20000)
    return lives

@api_router.get("/lives/active")
async def get_active_live(current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"status": "active", "tenant_id": tid}, {"_id": 0})
    return live

@api_router.get("/lives/{live_id}")
async def get_live(live_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    return live

@api_router.put("/lives/{live_id}")
async def update_live(live_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update live title and store - propagates changes to all purchases"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    
    update_fields = {}
    purchase_updates = {}
    
    # Track what fields changed
    if "title" in data and data["title"]:
        new_title = data["title"].strip()
        if new_title != live.get("title"):
            update_fields["title"] = new_title
            purchase_updates["live_title"] = new_title
    
    if "store" in data and data["store"]:
        new_store = data["store"].strip()
        if new_store != live.get("store"):
            update_fields["store"] = new_store
            purchase_updates["store"] = new_store
    
    if update_fields:
        # Update the live
        await db.lives.update_one({"id": live_id, "tenant_id": tid}, {"$set": update_fields})
        
        # Propagate changes to all purchases of this live
        if purchase_updates:
            result = await db.purchases.update_many(
                {"live_id": live_id, "tenant_id": tid},
                {"$set": purchase_updates}
            )
            print(f"Updated {result.modified_count} purchases with new live/store info")
    
    updated_live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    return updated_live

# ==================== PURCHASE ENDPOINTS ====================

CUSTOM_TAX_RATE = 0.15  # 15% custom tax

@api_router.post("/purchases")
async def create_purchase(purchase_data: PurchaseCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    user = await db.users.find_one({"customer_id": purchase_data.customer_id.upper(), "tenant_id": tid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    wallet = await db.wallets.find_one({"user_id": user["id"], "tenant_id": tid}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet no encontrada")
    
    # Calculate tax using the provided tax_rate
    tax_rate = purchase_data.tax_rate if purchase_data.apply_tax else 0
    tax = round(purchase_data.price * tax_rate, 2)
    
    commission_fee = purchase_data.commission_amount if purchase_data.apply_commission else 0
    price_with_tax = round(purchase_data.price + tax, 2)
    total = round(price_with_tax + commission_fee, 2)
    
    purchase_dict = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "user_id": user["id"],
        "customer_id": purchase_data.customer_id.upper(),
        "item_name": purchase_data.item_name,
        "store": purchase_data.store,
        "price": purchase_data.price,
        "tax": tax,
        "tax_rate": tax_rate,
        "apply_tax": purchase_data.apply_tax,
        "price_with_tax": price_with_tax,
        "commission": commission_fee,
        "apply_commission": purchase_data.apply_commission,
        "total": total,
        "status": "confirmed",
        "live_id": purchase_data.live_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.purchases.insert_one(purchase_dict)
    new_balance = wallet["available"] - total
    await db.wallets.update_one({"user_id": user["id"], "tenant_id": tid},
        {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
    transaction = WalletTransaction(tenant_id=tid, user_id=user["id"], customer_id=purchase_data.customer_id.upper(),
        type="purchase", amount=-total, balance_after=new_balance,
        description=f"Compra: {purchase_data.item_name} ({purchase_data.store}) - Total: ${total:.2f}", status="approved",
        approved_at=datetime.now(timezone.utc).isoformat(), purchase_id=purchase_dict["id"])
    await db.wallet_transactions.insert_one(transaction.model_dump())
    await db.lives.update_one({"id": purchase_data.live_id, "tenant_id": tid},
        {"$inc": {"total_sales": price_with_tax, "total_commissions": commission_fee, "purchase_count": 1}})
    await create_notification(tid, user["id"], purchase_data.customer_id.upper(), "purchase_created",
        "Nueva compra registrada",
        (
            f"Producto: {purchase_data.item_name}\n"
            f"Tienda: {purchase_data.store or '—'}\n"
            f"Precio: ${purchase_data.price:.2f}"
        ))
    await check_low_balance(tid, user["id"], purchase_data.customer_id.upper(), new_balance)

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="create_purchase",
        entity_type="purchase", entity_id=purchase_dict["id"],
        entity_name=f"{purchase_data.item_name} ({purchase_data.store or '—'})",
        details={
            "customer_id": purchase_data.customer_id.upper(),
            "client_name": user.get("name"),
            "live_id": purchase_data.live_id,
            "price": purchase_data.price,
            "tax": tax,
            "commission": commission_fee,
            "total": total
        }
    )
    return {
        "message": "Compra registrada", "purchase_id": purchase_dict["id"], "price": purchase_data.price,
        "tax": tax, "price_with_tax": price_with_tax, "commission": commission_fee, "total": total,
        "amount_deducted": total, "new_balance": new_balance, "customer_name": user["name"]
    }

# ==================== LIVE MODULE (fast product entry) ====================

@api_router.post("/live-module/purchases")
async def create_live_module_purchases(data: LiveModulePurchaseCreate, current_user: dict = Depends(get_current_user)):
    """Assign one product to many clients at once. Each selected client gets a
    normal purchase (same invoicing flow) tagged `entry_source='live'` so it can
    be told apart from products entered one-by-one in Live Shopping."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "live_module_enabled": 1})
    if not tenant or not tenant.get("live_module_enabled"):
        raise HTTPException(status_code=403, detail="El módulo Live no está activo para este tenant")
    live = await db.lives.find_one({"id": data.live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    if not data.customer_ids:
        raise HTTPException(status_code=400, detail="Debes agregar al menos un cliente")

    # Tax comes from the live (chosen at creation). Commission is a flat amount
    # per item; empty => nothing added.
    # tax_amount is the tax PAID BY THE PERSONAL SHOPPER (reduces their profit).
    apply_tax = bool(live.get("apply_tax"))
    tax_rate = float(live.get("tax_rate") or 0) if apply_tax else 0
    commission_fee = round(float(data.commission_amount), 2) if data.commission_amount else 0
    shopper_tax = round(float(data.tax_amount), 2) if data.tax_amount else 0  # Tax paid by shopper
    price = round(float(data.price), 2)
    tax = round(price * tax_rate, 2)
    price_with_tax = round(price + tax, 2)
    total = round(price_with_tax + commission_fee, 2)

    now_iso = datetime.now(timezone.utc).isoformat()
    created = []
    failed = []
    agg_sales = 0.0
    agg_comm = 0.0
    agg_shopper_tax = 0.0  # Accumulate taxes paid by shopper
    total_items_created = 0
    
    # Build quantities list - default to 1 for each client if not provided
    quantities = data.quantities or [1] * len(data.customer_ids)
    # Ensure quantities list matches customer_ids length
    while len(quantities) < len(data.customer_ids):
        quantities.append(1)
    
    for idx, raw_cid in enumerate(data.customer_ids):
        cid = (raw_cid or "").upper().strip()
        if not cid:
            continue
        quantity = max(1, quantities[idx])  # Get quantity for this specific client
        user = await db.users.find_one({"customer_id": cid, "tenant_id": tid}, {"_id": 0})
        if not user:
            failed.append({"customer_id": cid, "reason": "Cliente no encontrado"})
            continue
        wallet = await db.wallets.find_one({"user_id": user["id"], "tenant_id": tid}, {"_id": 0})
        if not wallet:
            failed.append({"customer_id": cid, "reason": "Wallet no encontrada"})
            continue
        
        # Create 'quantity' purchases for this client
        for _ in range(quantity):
            purchase_dict = {
                "id": str(uuid.uuid4()),
                "tenant_id": tid,
                "user_id": user["id"],
                "customer_id": cid,
                "item_name": data.item_name,
                "store": data.store or live.get("store") or "",
                "price": price,
                "tax": tax,
                "tax_rate": tax_rate,
                "apply_tax": apply_tax,
                "price_with_tax": price_with_tax,
                "commission": commission_fee,
                "apply_commission": commission_fee > 0,
                "shopper_tax": shopper_tax,  # Tax paid by personal shopper
                "total": total,
                "status": "confirmed",
                "live_id": data.live_id,
                "entry_source": "live",  # <-- mark: entered via the Live fast module
                "created_at": now_iso,
            }
            await db.purchases.insert_one(purchase_dict)
            agg_sales += price_with_tax
            agg_comm += commission_fee
            agg_shopper_tax += shopper_tax  # Accumulate shopper tax
            total_items_created += 1
        
        # Update wallet once with total for all items
        total_for_client = total * quantity
        new_balance = wallet["available"] - total_for_client
        await db.wallets.update_one({"user_id": user["id"], "tenant_id": tid},
            {"$set": {"available": new_balance, "updated_at": now_iso}})
        
        desc_qty = f" x{quantity}" if quantity > 1 else ""
        transaction = WalletTransaction(tenant_id=tid, user_id=user["id"], customer_id=cid,
            type="purchase", amount=-total_for_client, balance_after=new_balance,
            description=f"Compra (Live): {data.item_name}{desc_qty} - Total: ${total_for_client:.2f}", status="approved",
            approved_at=now_iso, purchase_id=purchase_dict["id"])
        await db.wallet_transactions.insert_one(transaction.model_dump())
        created.append({"customer_id": cid, "name": user.get("name"), "new_balance": round(new_balance, 2), "quantity": quantity})

    if created:
        await db.lives.update_one({"id": data.live_id, "tenant_id": tid},
            {"$inc": {"total_sales": round(agg_sales, 2), "total_commissions": round(agg_comm, 2), "total_taxes_paid": round(agg_shopper_tax, 2), "purchase_count": total_items_created}})
        # Save product name to history for autocomplete (name only).
        name_clean = data.item_name.strip()
        if name_clean:
            await db.product_history.update_one(
                {"tenant_id": tid, "name_lower": name_clean.lower()},
                {"$set": {"tenant_id": tid, "name": name_clean, "name_lower": name_clean.lower(), "last_used": now_iso},
                 "$inc": {"use_count": 1}},
                upsert=True)
        actor_name = await get_actor_name(current_user["user_id"])
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user.get("role", "admin"), action="create_live_purchases",
            entity_type="live", entity_id=data.live_id,
            entity_name=f"{data.item_name} x{len(created)}",
            details={"item_name": data.item_name, "price": price, "commission": commission_fee,
                     "shopper_tax": shopper_tax, "total": total, "clients": len(created), 
                     "customer_ids": [c["customer_id"] for c in created]}
        )

    return {
        "message": f"{len(created)} compra(s) registrada(s)",
        "created": created,
        "failed": failed,
        "unit_total": total,
        "price": price,
        "commission": commission_fee,
        "shopper_tax": shopper_tax,
    }


@api_router.get("/live-module/product-history")
async def get_product_history(q: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Autocomplete suggestions of previously entered product names (name only)."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    rows = await db.product_history.find({"tenant_id": tid}, {"_id": 0, "name": 1, "name_lower": 1}).sort("last_used", -1).limit(200).to_list(200)
    ql = (q or "").strip().lower()
    names = []
    for r in rows:
        if ql and ql not in (r.get("name_lower") or r["name"].lower()):
            continue
        names.append(r["name"])
        if len(names) >= 20:
            break
    return {"items": names}

@api_router.get("/purchases/user/{user_id}")
async def get_user_purchases(user_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    purchases = await db.purchases.find({"user_id": user_id, "tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(20000)
    # Return purchases with their original values (commission was set at purchase time)
    result = []
    for p in purchases:
        p_copy = dict(p)
        # Use the commission that was stored at purchase time, not the current client commission
        p_copy["total_price"] = p.get("total", 0)
        result.append(p_copy)
    return result

@api_router.get("/purchases/live/{live_id}")
async def get_live_purchases(live_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    # `to_list(500)` was capping the result for high-volume lives (e.g. an active
    # COSTCO live easily passes 500 purchases), making clients appear with fewer
    # items in the live view than they actually have when invoicing. We bump
    # the cap to 5000 — well above any realistic single-live volume — and keep
    # the chronological-desc order for the UI.
    purchases = await db.purchases.find({"live_id": live_id, "tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(20000)
    return purchases

@api_router.get("/purchases/pending-shipment/{user_id}")
async def get_pending_shipment_purchases(user_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    all_purchases = await db.purchases.find({"user_id": user_id, "status": "confirmed", "tenant_id": tid}, {"_id": 0}).to_list(20000)
    shipments = await db.shipments.find({"user_id": user_id, "tenant_id": tid}, {"_id": 0, "purchase_ids": 1}).to_list(20000)
    shipped_ids = set()
    for s in shipments:
        shipped_ids.update(s.get("purchase_ids", []))
    # Return purchases with their original values (commission was set at purchase time)
    result = []
    for p in all_purchases:
        if p["id"] not in shipped_ids:
            p_copy = dict(p)
            # Use the commission that was stored at purchase time
            p_copy["total_price"] = p.get("total", 0)
            result.append(p_copy)
    return result


class PurchaseUpdate(BaseModel):
    item_name: Optional[str] = None
    store: Optional[str] = None
    price: Optional[float] = None
    apply_tax: Optional[bool] = None
    tax_rate: Optional[float] = None
    apply_commission: Optional[bool] = None
    commission: Optional[float] = None
    customer_id: Optional[str] = None  # Allow changing the client

@api_router.put("/purchases/{purchase_id}")
async def update_purchase(purchase_id: str, data: PurchaseUpdate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    purchase = await db.purchases.find_one({"id": purchase_id, "tenant_id": tid}, {"_id": 0})
    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    
    updates = {}
    
    # Get current or new values
    new_price = data.price if data.price is not None else purchase["price"]
    new_apply_tax = data.apply_tax if data.apply_tax is not None else purchase.get("apply_tax", True)
    new_tax_rate = data.tax_rate if data.tax_rate is not None else purchase.get("tax_rate", ILLINOIS_TAX_RATE)
    new_apply_commission = data.apply_commission if data.apply_commission is not None else purchase.get("apply_commission", True)
    new_commission = data.commission if data.commission is not None else purchase.get("commission", 0)
    
    # Update basic fields
    if data.item_name is not None:
        updates["item_name"] = data.item_name
    if data.store is not None:
        updates["store"] = data.store
    
    # Handle customer change
    if data.customer_id is not None and data.customer_id != purchase["customer_id"]:
        # Verify the new customer exists
        new_customer = await db.users.find_one(
            {"customer_id": data.customer_id, "tenant_id": tid, "role": "client"},
            {"_id": 0, "id": 1, "customer_id": 1}
        )
        if not new_customer:
            raise HTTPException(status_code=400, detail=f"Cliente {data.customer_id} no encontrado")
        
        # Update purchase with new customer
        updates["customer_id"] = data.customer_id
        updates["user_id"] = new_customer["id"]
        
        # Move the amount from old wallet to new wallet
        old_wallet = await db.wallets.find_one({"user_id": purchase["user_id"], "tenant_id": tid})
        new_wallet = await db.wallets.find_one({"user_id": new_customer["id"], "tenant_id": tid})
        
        if old_wallet:
            # Refund to old wallet
            await db.wallets.update_one(
                {"user_id": purchase["user_id"], "tenant_id": tid},
                {"$inc": {"available": purchase["total"]}}
            )
        
        if new_wallet:
            # Charge new wallet
            await db.wallets.update_one(
                {"user_id": new_customer["id"], "tenant_id": tid},
                {"$inc": {"available": -purchase["total"]}}
            )
        else:
            # Create wallet for new customer if doesn't exist
            new_wallet_obj = Wallet(tenant_id=tid, user_id=new_customer["id"], available=-purchase["total"])
            await db.wallets.insert_one(new_wallet_obj.model_dump())
    
    # Recalculate totals if any financial field changed
    price_changed = data.price is not None
    tax_changed = data.apply_tax is not None or data.tax_rate is not None
    commission_changed = data.apply_commission is not None or data.commission is not None
    
    if price_changed or tax_changed or commission_changed:
        # Calculate new tax
        if new_apply_tax:
            new_tax = round(new_price * new_tax_rate, 2)
        else:
            new_tax = 0
        new_price_with_tax = round(new_price + new_tax, 2)
        
        # Calculate new commission
        if not new_apply_commission:
            new_commission = 0
        
        new_total = round(new_price_with_tax + new_commission, 2)
        old_total = purchase["total"]
        diff = new_total - old_total
        
        updates.update({
            "price": new_price,
            "tax": new_tax,
            "tax_rate": new_tax_rate if new_apply_tax else None,
            "apply_tax": new_apply_tax,
            "price_with_tax": new_price_with_tax,
            "commission": new_commission,
            "apply_commission": new_apply_commission,
            "total": new_total
        })
        
        # Adjust wallet balance
        wallet = await db.wallets.find_one({"user_id": purchase["user_id"], "tenant_id": tid}, {"_id": 0})
        if wallet:
            new_balance = wallet["available"] - diff
            await db.wallets.update_one({"user_id": purchase["user_id"], "tenant_id": tid},
                {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
        
        # Adjust live totals
        old_price_with_tax = purchase.get("price_with_tax", purchase["price"])
        old_commission = purchase.get("commission", 0)
        await db.lives.update_one({"id": purchase["live_id"], "tenant_id": tid},
            {"$inc": {
                "total_sales": round(new_price_with_tax - old_price_with_tax, 2),
                "total_commissions": round(new_commission - old_commission, 2)
            }})
    
    if updates:
        await db.purchases.update_one({"id": purchase_id, "tenant_id": tid}, {"$set": updates})

    # Keep the linked invoice header in sync with its items, whatever its status.
    if (price_changed or tax_changed or commission_changed) and purchase.get("invoice_id"):
        await resync_invoice_totals(tid, purchase["invoice_id"], current_user, "Artículo editado", {
            "purchase_id": purchase_id, "item_name": purchase.get("item_name"),
            "old": {"price": purchase.get("price"), "commission": purchase.get("commission", 0), "tax": purchase.get("tax", 0), "total": purchase.get("total")},
            "new": {k: updates.get(k) for k in ("price", "commission", "tax", "total")},
        }, purchase_id=purchase_id)

    updated = await db.purchases.find_one({"id": purchase_id, "tenant_id": tid}, {"_id": 0})

    # If any financial field changed and the purchase is linked to an invoice,
    # recalculate the client's invoice chain so PDFs/views show correct totals.
    if (price_changed or tax_changed or commission_changed) and purchase.get("invoice_id"):
        try:
            await recalculate_client_invoices(tid, purchase.get("customer_id"))
        except Exception as _re_err:
            logger.error(f"Error recalculating after update_purchase: {_re_err}")

    # Audit
    if updates:
        actor_name = await get_actor_name(current_user["user_id"])
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user.get("role", "admin"), action="update_purchase",
            entity_type="purchase", entity_id=purchase_id,
            entity_name=f"{updated.get('item_name','')} ({updated.get('store','—')})",
            details={
                "customer_id": updated.get("customer_id"),
                "changed": [k for k in updates.keys() if k not in ("paid_at",)],
                "new_total": updated.get("total"),
                "old_total": purchase.get("total")
            }
        )

    return updated

@api_router.get("/purchases/{purchase_id}/delete-preview")
async def get_delete_purchase_preview(purchase_id: str, current_user: dict = Depends(get_current_user)):
    """Returns a summary the admin sees BEFORE confirming a delete:

    - The wallet refund amount (always = purchase.total)
    - Whether the purchase is attached to an invoice and, if so, what the
      invoice will look like AFTER the delete (item count + new total).
    - Customer / item context so the confirm dialog can show a clear sentence.

    No state is mutated. Safe to call multiple times.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    purchase = await db.purchases.find_one(
        {"id": purchase_id, "tenant_id": tid},
        {"_id": 0}
    )
    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    customer = await db.users.find_one(
        {"id": purchase["user_id"], "tenant_id": tid},
        {"_id": 0, "name": 1, "customer_id": 1}
    ) or {}

    preview = {
        "purchase_id": purchase_id,
        "item_name": purchase.get("item_name"),
        "store": purchase.get("store"),
        "refund_amount": round(float(purchase.get("total") or 0), 2),
        "customer_id": purchase.get("customer_id"),
        "customer_name": customer.get("name"),
        "belongs_to_invoice": False,
    }

    invoice_id = purchase.get("invoice_id")
    if invoice_id:
        invoice = await db.invoices.find_one(
            {"id": invoice_id, "tenant_id": tid},
            {"_id": 0}
        )
        if invoice and purchase_id in (invoice.get("purchase_ids") or []):
            current_items = len(invoice.get("purchase_ids") or [])
            items_after = max(0, current_items - 1)

            # Recompute the would-be invoice total after the delete.
            remaining_ids = [pid for pid in invoice["purchase_ids"] if pid != purchase_id]
            remaining_purchases = await db.purchases.find(
                {"id": {"$in": remaining_ids}, "tenant_id": tid},
                {"_id": 0, "total": 1}
            ).to_list(len(remaining_ids)) if remaining_ids else []
            invoice_total_after = round(sum((p.get("total") or 0) for p in remaining_purchases), 2)

            preview.update({
                "belongs_to_invoice": True,
                "invoice_id": invoice_id,
                "invoice_number": invoice.get("invoice_number"),
                "invoice_status": invoice.get("status"),
                "current_items_count": current_items,
                "items_after_count": items_after,
                "current_invoice_total": round(float(invoice.get("total") or 0), 2),
                "invoice_total_after": invoice_total_after,
                "is_last_item": items_after == 0,
            })

    return preview


@api_router.delete("/purchases/{purchase_id}")
async def delete_purchase(purchase_id: str, data: dict = Body(default=None), current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    purchase = await db.purchases.find_one({"id": purchase_id, "tenant_id": tid}, {"_id": 0})
    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    # Deleting a product from a FINALIZED live requires the Astrid-Shop admin password.
    parent_live = await db.lives.find_one({"id": purchase.get("live_id"), "tenant_id": tid}, {"_id": 0, "status": 1})
    if (parent_live or {}).get("status") in ("completed", "ended", "finalized"):
        if not await verify_tenant_admin_password(tid, (data or {}).get("password")):
            raise HTTPException(status_code=401, detail="Clave de administrador incorrecta")
    # Refund total to wallet
    wallet = await db.wallets.find_one({"user_id": purchase["user_id"], "tenant_id": tid}, {"_id": 0})
    if wallet:
        new_balance = wallet["available"] + purchase["total"]
        await db.wallets.update_one({"user_id": purchase["user_id"], "tenant_id": tid},
            {"$set": {"available": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()}})
        tx = WalletTransaction(tenant_id=tid, user_id=purchase["user_id"], customer_id=purchase["customer_id"],
            type="refund", amount=purchase["total"], balance_after=new_balance,
            description=f"Reembolso: {purchase['item_name']} eliminado", status="approved",
            approved_at=datetime.now(timezone.utc).isoformat())
        await db.wallet_transactions.insert_one(tx.model_dump())
    # Adjust live totals
    await db.lives.update_one({"id": purchase["live_id"], "tenant_id": tid},
        {"$inc": {"total_sales": -purchase.get("price_with_tax", 0), "total_commissions": -purchase["commission"], "purchase_count": -1}})
    # Get user info for audit
    actor = await db.users.find_one({"id": current_user["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "email": 1, "role": 1})
    if not actor:
        actor = await db.employees.find_one({"id": current_user["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "email": 1})
    actor_name = (actor or {}).get("name") or (actor or {}).get("email") or "—"
    actor_role = (actor or {}).get("role") or current_user.get("role")

    # Get linked client name & live title for richer audit context.
    client_doc = await db.users.find_one({"id": purchase["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "customer_id": 1})
    live_doc = await db.lives.find_one({"id": purchase.get("live_id"), "tenant_id": tid}, {"_id": 0, "title": 1})

    # Snapshot the deleted purchase BEFORE the actual delete so the audit trail
    # always knows which client/store/live the item came from, even after the
    # purchase document is removed.
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor_name,
        user_role=actor_role,
        action="delete_purchase",
        entity_type="purchase",
        entity_id=purchase_id,
        entity_name=purchase.get("item_name"),
        details={
            "item_name": purchase.get("item_name"),
            "store": purchase.get("store"),
            "price": purchase.get("price"),
            "tax": purchase.get("tax", 0),
            "commission": purchase.get("commission", 0),
            "total": purchase.get("total"),
            "customer_id": purchase.get("customer_id"),
            "customer_name": (client_doc or {}).get("name"),
            "live_id": purchase.get("live_id"),
            "live_title": (live_doc or {}).get("title"),
            "invoice_id": purchase.get("invoice_id"),
            "purchase_created_at": purchase.get("created_at"),
        }
    )

    # If the purchase was attached to an invoice, also detach it from the
    # invoice and recalculate the invoice totals (mirroring the logic of
    # remove_item_from_invoice). This guarantees that deleting a purchase
    # never leaves orphan ids in `invoice.purchase_ids` and that subtotal,
    # total_tax, total_commission and total stay consistent across the chain.
    invoice_id = purchase.get("invoice_id")
    if invoice_id:
        invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
        if invoice and purchase_id in (invoice.get("purchase_ids") or []):
            new_purchase_ids = [pid for pid in invoice["purchase_ids"] if pid != purchase_id]
            remaining_purchases = await db.purchases.find(
                {"id": {"$in": new_purchase_ids}, "tenant_id": tid}, {"_id": 0}
            ).to_list(len(new_purchase_ids)) if new_purchase_ids else []

            new_subtotal = sum(p["price"] for p in remaining_purchases)
            new_total_tax = sum(p.get("tax", 0) for p in remaining_purchases)
            new_total_commission = sum(p.get("commission", 0) for p in remaining_purchases)
            new_total = sum(p["total"] for p in remaining_purchases)

            await db.invoices.update_one(
                {"id": invoice_id, "tenant_id": tid},
                {"$set": {
                    "purchase_ids": new_purchase_ids,
                    "subtotal": round(new_subtotal, 2),
                    "total_tax": round(new_total_tax, 2),
                    "total_commission": round(new_total_commission, 2),
                    "total": round(new_total, 2),
                }}
            )

    await db.purchases.delete_one({"id": purchase_id, "tenant_id": tid})

    # Recalculate the client's full invoice chain so saldo_pendiente,
    # saldo_a_favor, total_a_pagar and deposits_applied stay consistent.
    if invoice_id and purchase.get("customer_id"):
        try:
            await recalculate_client_invoices(tid, purchase["customer_id"])
        except Exception as _re_err:
            logger.error(f"Error recalculating after delete_purchase: {_re_err}")

    return {"message": "Compra eliminada y saldo reembolsado"}

# ==================== SHIPMENT ENDPOINTS ====================

@api_router.post("/shipments")
async def create_shipment(shipment_data: ShipmentCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    # Check employee permission
    if current_user["role"] == "employee":
        has_permission = await check_employee_permission(current_user["user_id"], "manage_shipments")
        if not has_permission:
            raise HTTPException(status_code=403, detail="No tienes permiso para gestionar envíos")
    tid = current_user["tenant_id"]
    user = await db.users.find_one({"id": shipment_data.user_id, "tenant_id": tid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Enforce: every shipment must be linked to exactly one invoice
    if not shipment_data.invoice_id:
        raise HTTPException(status_code=400, detail="Debes seleccionar una factura para este envío")
    invoice = await db.invoices.find_one(
        {"id": shipment_data.invoice_id, "tenant_id": tid, "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "customer_id": 1, "shipment_id": 1}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if invoice.get("customer_id") != user["customer_id"]:
        raise HTTPException(status_code=400, detail="La factura no pertenece al cliente seleccionado")
    if invoice.get("shipment_id"):
        raise HTTPException(status_code=400, detail="Esta factura ya tiene un envío asignado")

    # Resolve unit_cost from category + tenant settings
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "shipping_categories": 1, "shipping_mode": 1})
    categories = (tenant or {}).get("shipping_categories") or [
        {"key": "G", "label": "Categoría G (CON Núcleo Familiar)", "value_packages": 32, "value_pounds": 32},
        {"key": "A", "label": "Categoría A (Personal)", "value_packages": 42, "value_pounds": 42},
        {"key": "B", "label": "Categoría B (SIN Núcleo Familiar)", "value_packages": 52, "value_pounds": 52}
    ]
    shipping_mode = (tenant or {}).get("shipping_mode") or "packages"
    unit_cost = 0.0
    category_key = (shipment_data.shipping_category or "").upper() or None
    if category_key and category_key != "OTHER":
        matched = next((c for c in categories if str(c.get("key", "")).upper() == category_key), None)
        if not matched:
            raise HTTPException(status_code=400, detail="Categoría de envío no encontrada en el tenant")
        # Pick the mode-specific price; fallback to legacy `value` if mode-specific is missing
        price_field = "value_pounds" if shipping_mode == "pounds" else "value_packages"
        unit_cost = float(matched.get(price_field, matched.get("value", 0)) or 0)
    elif category_key == "OTHER":
        if shipment_data.shipping_unit_cost is None or shipment_data.shipping_unit_cost < 0:
            raise HTTPException(status_code=400, detail="Ingresa un costo personalizado válido")
        unit_cost = float(shipment_data.shipping_unit_cost)
    else:
        # Fallback: use provided shipping_cost as total (legacy support)
        if shipment_data.shipping_cost is None:
            raise HTTPException(status_code=400, detail="Selecciona una categoría de envío")
        unit_cost = float(shipment_data.shipping_cost) / max(float(shipment_data.package_count or 1), 1)

    # package_count represents units (packages OR pounds depending on tenant.shipping_mode)
    try:
        package_count = float(shipment_data.package_count or 1)
    except (TypeError, ValueError):
        package_count = 1
    if package_count <= 0:
        package_count = 1
    # Pounds can be fractional, packages should remain integer for clarity
    if shipping_mode == "packages":
        package_count = max(int(round(package_count)), 1)
    total_cost = round(unit_cost * package_count, 2)

    # Resolve creator's display name (admins are stored in `users`, employees in `employees`)
    creator = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "name": 1})
    if not creator:
        creator = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0, "name": 1})
    creator_name = (creator or {}).get("name") or "Sistema"

    # Handle multiple packages if provided
    packages_data = None
    if shipment_data.packages and len(shipment_data.packages) > 0:
        packages_data = _price_shipment_packages(shipment_data.packages, categories, shipping_mode)
        if packages_data:
            total_cost = round(sum(p["cost"] for p in packages_data), 2)
            package_count = sum(p["package_count"] for p in packages_data)
            unit_cost = packages_data[0]["unit_cost"]
        else:
            packages_data = None

    shipment = Shipment(
        tenant_id=tid,
        user_id=shipment_data.user_id,
        customer_id=user["customer_id"],
        purchase_ids=shipment_data.purchase_ids,
        shipping_category=category_key,
        shipping_unit_cost=round(unit_cost, 2),
        shipping_cost=round(total_cost, 2),
        shipping_mode=shipping_mode,
        package_count=package_count,
        packages=packages_data,
        address=shipment_data.address, country=shipment_data.country, phone=shipment_data.phone,
        additional_info=shipment_data.additional_info, invoice_id=shipment_data.invoice_id,
        created_by=current_user["user_id"],
        created_by_name=creator_name
    )
    await db.shipments.insert_one(shipment.model_dump())

    # Audit log: who created this shipment
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=creator_name,
        user_role=current_user.get("role", "admin"),
        action="create_shipment",
        entity_type="shipment",
        entity_id=shipment.id,
        entity_name=f"Envío {user.get('name', '')} (#{user['customer_id']})",
        details={
            "customer_id": user["customer_id"],
            "user_id": shipment_data.user_id,
            "invoice_id": shipment_data.invoice_id,
            "shipping_category": category_key,
            "shipping_mode": shipping_mode,
            "package_count": package_count,
            "shipping_cost": total_cost,
            "purchase_ids_count": len(shipment_data.purchase_ids or [])
        }
    )

    # Update linked invoice
    await db.invoices.update_one(
        {"id": shipment_data.invoice_id, "tenant_id": tid},
        {"$set": {"shipment_id": shipment.id, "shipping_cost": total_cost, "weight_pounds": 0}}
    )
    # Recalculate invoice chain so saldo_a_favor / total_a_pagar reflect shipping cost
    await recalculate_client_invoices(tid, user["customer_id"])

    unit_label = "libra(s)" if shipping_mode == "pounds" else "paquete(s)"
    await create_notification(tid, shipment_data.user_id, user["customer_id"], "shipment_created",
        "Envío Creado", f"Tu envío ha sido creado. {package_count} {unit_label}. Costo total: ${total_cost:.2f} USD")
    return {"message": "Envío creado", "shipment_id": shipment.id, "shipping_cost": total_cost, "package_count": package_count, "shipping_mode": shipping_mode}

@api_router.put("/shipments/{shipment_id}/tracking")
async def update_tracking(shipment_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update tracking numbers for a shipment (supports multiple packages)"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = current_user["tenant_id"]
    tracking_numbers = data.get("tracking_numbers", [])
    
    # Validate tracking numbers is a list
    if not isinstance(tracking_numbers, list):
        raise HTTPException(status_code=400, detail="tracking_numbers debe ser una lista")
    
    # Filter out empty strings
    tracking_numbers = [t.strip() for t in tracking_numbers if t and t.strip()]
    
    # Also set legacy tracking_number to first one for backwards compatibility
    tracking_number = tracking_numbers[0] if tracking_numbers else None
    
    result = await db.shipments.update_one(
        {"id": shipment_id, "tenant_id": tid},
        {"$set": {
            "tracking_numbers": tracking_numbers,
            "tracking_number": tracking_number,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    
    return {"message": "Tracking actualizado", "tracking_numbers": tracking_numbers}

@api_router.put("/shipments/{shipment_id}/verify-guide")
async def toggle_shipment_guide_verified(shipment_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Toggle the manual `guide_verified` flag on a shipment.

    Used when the admin/employee has the printed guide physically in hand and
    wants to mark the package as verified. Independent of `tracking_numbers`.
    Body: {"verified": true|false} — if omitted, toggles the current value.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")

    # Decide the new value: explicit `verified` from body, or toggle current.
    new_val = bool(shipment.get("guide_verified", False))
    if data is not None and "verified" in data:
        new_val = bool(data.get("verified"))
    else:
        new_val = not new_val

    actor_name = await get_actor_name(current_user["user_id"])
    now = datetime.now(timezone.utc).isoformat()
    update_set = {
        "guide_verified": new_val,
        "guide_verified_at": now if new_val else None,
        "guide_verified_by": current_user["user_id"] if new_val else None,
        "guide_verified_by_name": actor_name if new_val else None,
        "updated_at": now,
    }
    await db.shipments.update_one(
        {"id": shipment_id, "tenant_id": tid},
        {"$set": update_set}
    )
    return {
        "message": "Guía marcada como verificada" if new_val else "Verificación de guía removida",
        "guide_verified": new_val,
        "guide_verified_at": update_set["guide_verified_at"],
        "guide_verified_by_name": update_set["guide_verified_by_name"],
    }


@api_router.put("/shipments/{shipment_id}/toggle-sent")
async def toggle_shipment_sent(shipment_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Toggle the manual `marked_sent` flag on a shipment.

    Used when the parcel was physically dispatched to the courier company.
    Drives the "Pago a Empresa Paquetería" dashboard KPI.
    Body: {"sent": true|false} — if omitted, toggles the current value.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")

    new_val = bool(shipment.get("marked_sent", False))
    if data is not None and "sent" in data:
        new_val = bool(data.get("sent"))
    else:
        new_val = not new_val

    actor_name = await get_actor_name(current_user["user_id"])
    now = datetime.now(timezone.utc).isoformat()
    update_set = {
        "marked_sent": new_val,
        "marked_sent_at": now if new_val else None,
        "marked_sent_by": current_user["user_id"] if new_val else None,
        "marked_sent_by_name": actor_name if new_val else None,
        "updated_at": now,
    }
    await db.shipments.update_one(
        {"id": shipment_id, "tenant_id": tid},
        {"$set": update_set}
    )
    try:
        await log_audit_action(
            tenant_id=tid,
            user_id=current_user["user_id"],
            user_name=actor_name,
            user_role=current_user["role"],
            action="toggle_shipment_sent",
            entity_type="shipment",
            entity_id=shipment_id,
            entity_name=shipment.get("tracking_number") or shipment_id,
            details={"marked_sent": new_val, "customer_id": shipment.get("customer_id")}
        )
    except Exception:
        pass
    return {
        "message": "Envío marcado como enviado" if new_val else "Marca de enviado removida",
        "marked_sent": new_val,
        "marked_sent_at": update_set["marked_sent_at"],
        "marked_sent_by_name": update_set["marked_sent_by_name"],
    }

@api_router.put("/shipments/{shipment_id}/status")
async def update_shipment_status(shipment_id: str, status: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if status not in ["preparing", "in_transit", "delivered"]:
        raise HTTPException(status_code=400, detail="Estado inválido")
    tid = current_user["tenant_id"]
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    await db.shipments.update_one({"id": shipment_id, "tenant_id": tid},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if status == "delivered":
        await create_notification(tid, shipment["user_id"], shipment["customer_id"], "shipment_delivered",
            "Envío Entregado!", "Tu pedido ha sido entregado. Gracias por tu compra!")
    return {"message": f"Estado actualizado a {status}"}

@api_router.post("/shipments/{shipment_id}/attachments")
async def upload_shipment_attachment(shipment_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    
    # Save file to object store
    file_ext = Path(file.filename).suffix
    filename = f"{shipment_id}_{uuid.uuid4().hex[:8]}{file_ext}"
    content = await file.read()
    obj_path = object_store.upload_file(content, filename, "shipments")
    file_url = f"/api/uploads/{obj_path}"
    
    # Add to shipment attachments
    current_attachments = shipment.get("attachments", [])
    current_attachments.append(file_url)
    
    await db.shipments.update_one({"id": shipment_id, "tenant_id": tid},
        {"$set": {"attachments": current_attachments, "updated_at": datetime.now(timezone.utc).isoformat()}})
    
    return {"message": "Archivo adjuntado", "file_url": file_url, "attachments": current_attachments}


@api_router.post("/shipments/{shipment_id}/attach-session")
async def attach_session_files_to_shipment(shipment_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Attach all files from an upload session to a shipment (server-side, no re-upload)."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    token = data.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Token requerido")
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0, "attachments": 1})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    session = await db.upload_sessions.find_one({"token": token, "tenant_id": tid}, {"_id": 0, "files": 1})
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    file_urls = [f["file_url"] for f in (session.get("files") or [])]
    if not file_urls:
        return {"message": "Sin archivos", "attachments": shipment.get("attachments", [])}
    current_attachments = shipment.get("attachments", []) + file_urls
    await db.shipments.update_one(
        {"id": shipment_id, "tenant_id": tid},
        {"$set": {"attachments": current_attachments, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    # Clean up: delete session
    await db.upload_sessions.delete_one({"token": token, "tenant_id": tid})
    return {"message": "Archivos adjuntados", "attachments": current_attachments, "attached_count": len(file_urls)}



# Short-lived public upload sessions so admins can scan a QR and upload files from their phone
# during shipment creation. Files are temporarily tied to a session and returned to the admin's
# desktop UI via polling.

@api_router.post("/upload-sessions")
async def create_upload_session(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    token = uuid.uuid4().hex + uuid.uuid4().hex  # 64 chars
    now = datetime.now(timezone.utc)
    session = {
        "token": token,
        "tenant_id": current_user["tenant_id"],
        "created_by": current_user["user_id"],
        "files": [],
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=30)).isoformat()
    }
    await db.upload_sessions.insert_one(session)
    return {"token": token, "expires_at": session["expires_at"]}


@api_router.get("/upload-sessions/{token}/public-info")
async def get_upload_session_public_info(token: str):
    """Public endpoint the mobile page calls to validate the session and show context."""
    session = await db.upload_sessions.find_one({"token": token}, {"_id": 0, "tenant_id": 1, "expires_at": 1, "files": 1})
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    now = datetime.now(timezone.utc)
    if datetime.fromisoformat(session["expires_at"]) < now:
        raise HTTPException(status_code=410, detail="Sesión expirada")
    tenant = await db.tenants.find_one({"id": session["tenant_id"]}, {"_id": 0, "business_name": 1, "logo_url": 1})
    return {
        "valid": True,
        "expires_at": session["expires_at"],
        "files_count": len(session.get("files", [])),
        "business_name": (tenant or {}).get("business_name", ""),
        "logo_url": (tenant or {}).get("logo_url")
    }


@api_router.post("/upload-sessions/{token}/files")
async def upload_session_file(token: str, file: UploadFile = File(...)):
    """Public endpoint: mobile device uploads a file to the session."""
    session = await db.upload_sessions.find_one({"token": token}, {"_id": 0, "tenant_id": 1, "expires_at": 1, "files": 1})
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    if datetime.fromisoformat(session["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Sesión expirada")
    file_ext = Path(file.filename).suffix or ".bin"
    filename = f"session_{token[:12]}_{uuid.uuid4().hex[:8]}{file_ext}"
    content = await file.read()
    obj_path = object_store.upload_file(content, filename, "shipments")
    file_url = f"/api/uploads/{obj_path}"
    file_entry = {
        "file_url": file_url,
        "original_name": file.filename or filename,
        "uploaded_at": datetime.now(timezone.utc).isoformat()
    }
    await db.upload_sessions.update_one({"token": token}, {"$push": {"files": file_entry}})
    return {"message": "Archivo subido", "file_url": file_url}


@api_router.get("/upload-sessions/{token}")
async def get_upload_session(token: str, current_user: dict = Depends(get_current_user)):
    """Admin polls this endpoint to see uploaded files."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    session = await db.upload_sessions.find_one(
        {"token": token, "tenant_id": current_user["tenant_id"]},
        {"_id": 0}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return {
        "token": session["token"],
        "files": session.get("files", []),
        "expires_at": session["expires_at"]
    }


@api_router.delete("/upload-sessions/{token}/files")
async def clear_upload_session_files(token: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    await db.upload_sessions.update_one(
        {"token": token, "tenant_id": current_user["tenant_id"]},
        {"$set": {"files": []}}
    )
    return {"message": "Sesión limpiada"}


@api_router.get("/shipments/user/{user_id}")
async def get_user_shipments(user_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    shipments = await db.shipments.find({"user_id": user_id, "tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(20000)
    return shipments

@api_router.get("/shipments")
async def get_all_shipments(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    # Check employee permission
    if current_user["role"] == "employee":
        has_permission = await check_employee_permission(current_user["user_id"], "manage_shipments")
        if not has_permission:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver envíos")
    tid = current_user["tenant_id"]
    query = {"tenant_id": tid}
    if status:
        query["status"] = status
    shipments = await db.shipments.find(query, {"_id": 0}).sort("created_at", -1).to_list(20000)
    
    if not shipments:
        return []
    
    # Batch fetch all users (clients) in one query instead of N queries
    user_ids = list({s.get("user_id") for s in shipments if s.get("user_id")})
    users_list = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(user_ids))
    users_dict = {u["id"]: u["name"] for u in users_list}

    # Batch fetch creator names (admins/employees) for shipments missing the snapshot
    missing_creator_ids = list({
        s.get("created_by") for s in shipments
        if s.get("created_by") and not s.get("created_by_name")
    })
    creators_dict = {}
    if missing_creator_ids:
        admins_list = await db.users.find({"id": {"$in": missing_creator_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(missing_creator_ids))
        for u in admins_list:
            creators_dict[u["id"]] = u["name"]
        # Fill in any still missing from employees collection
        still_missing = [cid for cid in missing_creator_ids if cid not in creators_dict]
        if still_missing:
            emps_list = await db.employees.find({"id": {"$in": still_missing}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(still_missing))
            for e in emps_list:
                creators_dict[e["id"]] = e["name"]

    # Legacy fallback: shipments created before this feature don't have `created_by` at all.
    # Attribute them to the tenant's primary admin (most likely creator) and flag them so the
    # frontend can render the badge with a different style.
    legacy_admin_name = None
    has_legacy = any(not s.get("created_by") for s in shipments)
    if has_legacy:
        primary_admin = await db.users.find_one(
            {"tenant_id": tid, "role": "admin"},
            {"_id": 0, "name": 1},
            sort=[("created_at", 1)]
        )
        if primary_admin:
            legacy_admin_name = primary_admin.get("name")

    # Batch fetch invoice statuses for shipments (status + is_annulled + invoice_number)
    invoice_ids = list({s.get("invoice_id") for s in shipments if s.get("invoice_id")})
    invoices_dict = {}
    if invoice_ids:
        invs = await db.invoices.find(
            {"id": {"$in": invoice_ids}, "tenant_id": tid},
            {"_id": 0, "id": 1, "status": 1, "is_annulled": 1, "invoice_number": 1}
        ).to_list(len(invoice_ids))
        for inv in invs:
            invoices_dict[inv["id"]] = {
                "status": "annulled" if inv.get("is_annulled") else (inv.get("status") or "pending"),
                "invoice_number": inv.get("invoice_number") or "",
            }

    result = []
    for s in shipments:
        creator_id = s.get("created_by")
        creator_name = s.get("created_by_name") or creators_dict.get(creator_id or "", "")
        is_legacy = False
        if not creator_id and not creator_name and legacy_admin_name:
            creator_name = legacy_admin_name
            is_legacy = True
        inv_meta = invoices_dict.get(s.get("invoice_id") or "", {})
        result.append({
            **s,
            "user_name": users_dict.get(s.get("user_id"), s.get("customer_name") or "Unknown"),
            "created_by_name": creator_name,
            "created_by_legacy": is_legacy,
            "invoice_status": inv_meta.get("status"),
            "invoice_number": inv_meta.get("invoice_number"),
        })
    return result

class ShipmentUpdate(BaseModel):
    shipping_type: Optional[str] = None
    shipping_cost: Optional[float] = None
    weight_pounds: Optional[float] = None
    address: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None
    additional_info: Optional[str] = None
    tracking_number: Optional[str] = None
    # Newer fields used by the rich Edit dialog (category-aware shipments).
    shipping_category: Optional[str] = None      # "G" | "A" | "B" | "OTHER"
    shipping_unit_cost: Optional[float] = None   # per-package or per-pound cost
    package_count: Optional[float] = None        # qty of packages OR pounds
    tracking_numbers: Optional[List[str]] = None # full array of tracking codes
    packages: Optional[List[dict]] = None        # multi-category packages; overrides category/qty/cost

@api_router.put("/shipments/{shipment_id}")
async def update_shipment(shipment_id: str, data: ShipmentUpdate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    updates = {}
    if data.shipping_type is not None:
        updates["shipping_type"] = data.shipping_type
    if data.shipping_cost is not None:
        updates["shipping_cost"] = data.shipping_cost
    if data.weight_pounds is not None:
        updates["weight_pounds"] = data.weight_pounds
    if data.address is not None:
        updates["address"] = data.address
    if data.country is not None:
        updates["country"] = data.country
    if data.phone is not None:
        updates["phone"] = data.phone
    if data.additional_info is not None:
        updates["additional_info"] = data.additional_info
    if data.tracking_number is not None:
        updates["tracking_number"] = data.tracking_number
    if data.tracking_numbers is not None:
        updates["tracking_numbers"] = data.tracking_numbers
        # Keep the legacy single-tracking field in sync with the first entry.
        updates["tracking_number"] = data.tracking_numbers[0] if data.tracking_numbers else None
    if data.shipping_category is not None:
        updates["shipping_category"] = data.shipping_category
    if data.shipping_unit_cost is not None:
        updates["shipping_unit_cost"] = data.shipping_unit_cost
    if data.package_count is not None:
        updates["package_count"] = data.package_count
    if not data.packages and shipment.get("packages") and (data.shipping_category is not None or data.package_count is not None):
        # Single-category edit replaces any previous package breakdown.
        updates["packages"] = None
    if data.packages:
        tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "shipping_categories": 1, "shipping_mode": 1}) or {}
        mode = shipment.get("shipping_mode") or tenant.get("shipping_mode") or "packages"
        priced = _price_shipment_packages(data.packages, _ensure_category_dual_prices(tenant.get("shipping_categories") or []), mode)
        if not priced:
            raise HTTPException(status_code=400, detail="Agrega al menos un paquete con categoría y cantidad")
        data.shipping_cost = round(sum(p["cost"] for p in priced), 2)
        updates.update({
            "packages": priced,
            "shipping_cost": data.shipping_cost,
            "package_count": sum(p["package_count"] for p in priced),
            "shipping_category": priced[0]["shipping_category"],
            "shipping_unit_cost": priced[0]["unit_cost"],
        })
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.shipments.update_one({"id": shipment_id, "tenant_id": tid}, {"$set": updates})
    # Resolve linked invoice (new records via shipment.invoice_id, legacy via invoices.shipment_id)
    linked_invoice_id = shipment.get("invoice_id")
    if not linked_invoice_id:
        linked_inv = await db.invoices.find_one(
            {"shipment_id": shipment_id, "tenant_id": tid},
            {"_id": 0, "id": 1}
        )
        if linked_inv:
            linked_invoice_id = linked_inv["id"]
            # Backfill shipment.invoice_id so the next read is correct
            await db.shipments.update_one(
                {"id": shipment_id, "tenant_id": tid},
                {"$set": {"invoice_id": linked_invoice_id}}
            )
    # If shipping_cost or weight changed and shipment is linked to an invoice, sync to invoice and recalc
    if linked_invoice_id and (data.shipping_cost is not None or data.weight_pounds is not None):
        inv_updates = {}
        if data.shipping_cost is not None:
            inv_updates["shipping_cost"] = data.shipping_cost
        if data.weight_pounds is not None:
            inv_updates["weight_pounds"] = data.weight_pounds
        if inv_updates:
            await db.invoices.update_one(
                {"id": linked_invoice_id, "tenant_id": tid},
                {"$set": inv_updates}
            )
        await recalculate_client_invoices(tid, shipment["customer_id"])
    updated = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})

    # Audit
    if updates:
        actor_name = await get_actor_name(current_user["user_id"])
        await log_audit_action(
            tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
            user_role=current_user.get("role", "admin"), action="update_shipment",
            entity_type="shipment", entity_id=shipment_id,
            entity_name=f"Envío {shipment.get('customer_id','')}",
            details={
                "customer_id": shipment.get("customer_id"),
                "changed": [k for k in updates.keys() if k != "updated_at"],
                "new_total": updated.get("shipping_cost") if updated else None,
                "old_total": shipment.get("shipping_cost")
            }
        )
    return updated

@api_router.delete("/shipments/{shipment_id}")
async def delete_shipment(shipment_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    shipment = await db.shipments.find_one({"id": shipment_id, "tenant_id": tid}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    await db.shipments.delete_one({"id": shipment_id, "tenant_id": tid})
    # Find the invoice linked to this shipment — check both directions:
    # 1) shipment.invoice_id (new records)
    # 2) invoices.shipment_id == shipment_id (legacy records where invoice_id was dropped by the old bug)
    linked_invoice_id = shipment.get("invoice_id")
    if not linked_invoice_id:
        linked_inv = await db.invoices.find_one(
            {"shipment_id": shipment_id, "tenant_id": tid},
            {"_id": 0, "id": 1}
        )
        if linked_inv:
            linked_invoice_id = linked_inv["id"]
    if linked_invoice_id:
        await db.invoices.update_one(
            {"id": linked_invoice_id, "tenant_id": tid},
            {"$set": {"shipping_cost": 0, "weight_pounds": 0, "shipment_id": None}}
        )
        await recalculate_client_invoices(tid, shipment["customer_id"])
    else:
        # Still recalc the client chain in case there are stale values
        await recalculate_client_invoices(tid, shipment["customer_id"])
    await create_notification(tid, shipment["user_id"], shipment["customer_id"], "shipment_deleted",
        "Envío Eliminado", "Un envío ha sido eliminado de tu cuenta.")

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="delete_shipment",
        entity_type="shipment", entity_id=shipment_id,
        entity_name=f"Envío {shipment.get('customer_id','')}",
        details={
            "customer_id": shipment.get("customer_id"),
            "shipping_cost": shipment.get("shipping_cost"),
            "package_count": shipment.get("package_count"),
            "shipping_category": shipment.get("shipping_category"),
            "invoice_id": linked_invoice_id
        }
    )
    return {"message": "Envío eliminado"}

# ==================== INVOICES ====================

@api_router.get("/invoices/client/{customer_id}/pending-purchases")
async def get_pending_purchases_for_invoice(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Get all purchases not yet invoiced for a client"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get purchases without invoice_id
    purchases = await db.purchases.find({
        "customer_id": customer_id.upper(),
        "tenant_id": tid,
        "$or": [
            {"invoice_id": None},
            {"invoice_id": {"$exists": False}}
        ]
    }, {"_id": 0}).sort("created_at", -1).to_list(20000)

    # Enrich each purchase with the live's name (or None if it has no live or
    # the live was deleted). The frontend uses this to show the origin badge in
    # the Nueva Factura modal so admins can tell apart purchases that came from
    # different lives or from manual registrations.
    live_ids = {p.get("live_id") for p in purchases if p.get("live_id")}
    live_lookup = {}
    if live_ids:
        live_docs = await db.lives.find(
            {"id": {"$in": list(live_ids)}, "tenant_id": tid},
            {"_id": 0, "id": 1, "title": 1, "status": 1}
        ).to_list(len(live_ids))
        live_lookup = {ld["id"]: ld for ld in live_docs}
    for p in purchases:
        lid = p.get("live_id")
        if not lid:
            # Legitimate "no live" — purchase was created without a live attached
            # (manual registration or pre-live-aware seed data).
            p["live_title"] = None
            p["live_status"] = None
            p["live_origin"] = "no_live"
        elif lid in live_lookup:
            live = live_lookup[lid]
            p["live_title"] = live.get("title")
            p["live_status"] = live.get("status")
            p["live_origin"] = "live"
        else:
            # The live id is set but the Live record is gone — most often because
            # the admin deleted that live after it had already produced purchases.
            p["live_title"] = None
            p["live_status"] = None
            p["live_origin"] = "deleted_live"

    return purchases

@api_router.get("/invoices/client-available-deposits/{customer_id}")
async def get_client_available_deposits(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Get deposits not yet assigned to any invoice for this client"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    client = await db.users.find_one({"customer_id": customer_id.upper(), "tenant_id": tid}, {"_id": 0, "id": 1})
    if not client:
        return []
    
    all_deposits = await db.wallet_transactions.find(
        {"user_id": client["id"], "tenant_id": tid, "type": "deposit", "status": "approved", "is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "amount": 1, "created_at": 1, "description": 1}
    ).sort("created_at", 1).to_list(20000)
    
    # Only return deposits approved AFTER the last invoice was created
    last_invoice = await db.invoices.find_one(
        {"customer_id": customer_id.upper(), "tenant_id": tid, "is_annulled": {"$ne": True}},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)]
    )
    
    if last_invoice:
        # Only deposits made after last invoice
        available = [d for d in all_deposits if d.get("created_at", "") > last_invoice["created_at"]]
    else:
        # No invoices yet - all deposits available
        available = all_deposits
    
    return available

@api_router.get("/invoices/client-pending-balance/{customer_id}")
async def get_client_pending_balance(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Get the 'Total a Pagar' from the most recent invoice as saldo pendiente for the next invoice"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    # Ensure invoice chain is up-to-date (shipping costs added later, deposits, etc.)
    await recalculate_client_invoices(tid, customer_id.upper())

    # Find the most recent non-annulled invoice for this client
    last_invoice = await db.invoices.find_one(
        {"customer_id": customer_id.upper(), "tenant_id": tid, "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "invoice_number": 1, "total_a_pagar": 1, "total": 1, 
         "deposits_applied": 1, "saldo_pendiente": 1, "shipping_cost": 1, "purchase_ids": 1,
         "subtotal": 1, "total_tax": 1, "total_commission": 1, "saldo_a_favor": 1},
        sort=[("created_at", -1)]
    )
    
    if not last_invoice:
        return {"total_pending": 0, "saldo_a_favor": 0, "details": [], "is_first_invoice": True}
    
    # Check for saldo_a_favor first
    saldo_a_favor = last_invoice.get("saldo_a_favor", 0) or 0
    
    # Use stored total_a_pagar if available, otherwise calculate it
    total_a_pagar = last_invoice.get("total_a_pagar")
    if total_a_pagar is None:
        # Legacy invoice without total_a_pagar: calculate it
        inv_subtotal = last_invoice.get("subtotal", 0) + last_invoice.get("total_commission", 0) + last_invoice.get("total_tax", 0)
        ship_cost = last_invoice.get("shipping_cost", 0)
        shipment = await db.shipments.find_one(
            {"invoice_id": last_invoice["id"], "tenant_id": tid}, {"_id": 0, "shipping_cost": 1}
        )
        if not shipment and last_invoice.get("purchase_ids"):
            shipment = await db.shipments.find_one(
                {
                    "tenant_id": tid,
                    "customer_id": customer_id.upper(),
                    "purchase_ids": {"$in": last_invoice["purchase_ids"]},
                    "$or": [
                        {"invoice_id": None},
                        {"invoice_id": {"$exists": False}},
                        {"invoice_id": ""}
                    ]
                },
                {"_id": 0, "shipping_cost": 1}
            )
        if shipment:
            ship_cost = shipment.get("shipping_cost", 0)
        saldo_pend = last_invoice.get("saldo_pendiente", 0)
        grand_total = inv_subtotal + ship_cost + saldo_pend
        deposits = last_invoice.get("deposits_applied", 0)
        if deposits >= grand_total:
            total_a_pagar = 0
            saldo_a_favor = round(deposits - grand_total, 2)
        else:
            total_a_pagar = round(grand_total - deposits, 2)
    
    total_a_pagar = round(total_a_pagar or 0, 2)
    saldo_a_favor = round(saldo_a_favor or 0, 2)
    
    details = []
    inv_num = last_invoice.get("invoice_number", "")
    if total_a_pagar > 0:
        details.append({"invoice_number": inv_num, "total_a_pagar": total_a_pagar, "type": "deuda"})
    elif saldo_a_favor > 0:
        details.append({"invoice_number": inv_num, "saldo_a_favor": saldo_a_favor, "type": "favor"})
    
    return {
        "total_pending": total_a_pagar,
        "saldo_a_favor": saldo_a_favor,
        "details": details,
        "is_first_invoice": False
    }

@api_router.post("/invoices")
async def create_invoice(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new invoice for a client with pending purchases"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    customer_id = data.get("customer_id", "").upper()
    purchase_ids = data.get("purchase_ids", [])
    notes = data.get("notes", "")
    saldo_pendiente = round(float(data.get("saldo_pendiente", 0)), 2)
    saldo_a_favor_anterior = round(float(data.get("saldo_a_favor", 0)), 2)
    
    if not customer_id or not purchase_ids:
        raise HTTPException(status_code=400, detail="customer_id y purchase_ids son requeridos")
    
    # Get client info
    client = await db.users.find_one({"customer_id": customer_id, "tenant_id": tid}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    # Get purchases
    purchases = await db.purchases.find({
        "id": {"$in": purchase_ids},
        "customer_id": customer_id,
        "tenant_id": tid
    }, {"_id": 0}).to_list(len(purchase_ids))
    
    if len(purchases) != len(purchase_ids):
        raise HTTPException(status_code=400, detail="Algunas compras no fueron encontradas")
    
    # Calculate totals
    subtotal = sum(p["price"] for p in purchases)
    total_tax = sum(p.get("tax", 0) for p in purchases)
    total_commission = sum(p.get("commission", 0) for p in purchases)
    total = sum(p["total"] for p in purchases)
    
    # Generate invoice number using customer_id + sequential number
    # Count existing invoices for this customer to get the next number
    customer_invoice_count = await db.invoices.count_documents({"customer_id": customer_id, "tenant_id": tid})
    customer_seq = customer_invoice_count + 1
    invoice_number = f"{customer_id}-{customer_seq:03d}"
    
    invoice = Invoice(
        tenant_id=tid,
        user_id=client["id"],
        customer_id=customer_id,
        invoice_number=invoice_number,
        purchase_ids=purchase_ids,
        subtotal=round(subtotal, 2),
        total_tax=round(total_tax, 2),
        total_commission=round(total_commission, 2),
        total=round(total, 2),
        notes=notes
    )
    
    invoice_dict = invoice.model_dump()
    
    # ===== Assign deposits that belong to THIS invoice (by date) =====
    all_deposits = await db.wallet_transactions.find(
        {"user_id": client["id"], "tenant_id": tid, "type": "deposit", "status": "approved", "is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "amount": 1, "created_at": 1, "description": 1}
    ).sort("created_at", 1).to_list(20000)
    
    # This is the new latest invoice - get creation timestamp
    invoice_created_at = invoice_dict["created_at"]
    
    # Get all other invoices to know their dates
    other_invoices = await db.invoices.find(
        {"customer_id": customer_id, "tenant_id": tid, "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(20000)
    all_inv_dates = [inv["created_at"] for inv in other_invoices] + [invoice_created_at]
    all_inv_dates.sort()
    
    # Deposits that belong to this invoice: approved AFTER the previous invoice (or all if first)
    prev_invoice_date = None
    for i, d in enumerate(all_inv_dates):
        if d == invoice_created_at and i > 0:
            prev_invoice_date = all_inv_dates[i - 1]
            break
    
    applied_deposits = []
    for dep in all_deposits:
        dep_date = dep.get("created_at", "")
        if prev_invoice_date and dep_date <= prev_invoice_date:
            continue  # This deposit belongs to an older invoice
        applied_deposits.append({
            "deposit_id": dep.get("id", ""),
            "amount_applied": dep["amount"],
            "created_at": dep.get("created_at", ""),
            "description": dep.get("description", "")
        })
    
    # Calculate invoice total
    invoice_total = total + saldo_pendiente
    
    total_deposits_applied = round(sum(ad["amount_applied"] for ad in applied_deposits), 2)
    invoice_dict["applied_deposits"] = applied_deposits
    invoice_dict["deposits_applied"] = total_deposits_applied
    invoice_dict["saldo_pendiente"] = saldo_pendiente
    invoice_dict["saldo_a_favor_anterior"] = saldo_a_favor_anterior
    
    # Calculate and store total_a_pagar and saldo_a_favor
    # Grand total = purchases + saldo pendiente (debt from before)
    # Credits = deposits + saldo a favor from previous invoice
    grand_total = total + saldo_pendiente
    total_credits = total_deposits_applied + saldo_a_favor_anterior
    if total_credits >= grand_total:
        total_a_pagar = 0
        saldo_a_favor = round(total_credits - grand_total, 2)
    else:
        total_a_pagar = round(grand_total - total_credits, 2)
        saldo_a_favor = 0
    invoice_dict["total_a_pagar"] = total_a_pagar
    invoice_dict["saldo_a_favor"] = saldo_a_favor
    
    await db.invoices.insert_one(invoice_dict)
    
    # Mark purchases as invoiced
    now = datetime.now(timezone.utc).isoformat()
    await db.purchases.update_many(
        {"id": {"$in": purchase_ids}, "tenant_id": tid},
        {"$set": {"invoice_id": invoice.id, "invoiced_at": now}}
    )

    # Recalculate the full invoice chain to ensure consistency across invoices
    # (handles edge cases like shipping costs added later on previous invoices)
    await recalculate_client_invoices(tid, customer_id)

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="create_invoice",
        entity_type="invoice", entity_id=invoice.id,
        entity_name=f"Factura {invoice_number} · {client.get('name','')}",
        details={
            "customer_id": customer_id,
            "invoice_number": invoice_number,
            "purchase_count": len(purchase_ids),
            "subtotal": round(subtotal, 2),
            "total": round(total, 2),
            "total_a_pagar": total_a_pagar,
            "saldo_a_favor": saldo_a_favor,
            "saldo_pendiente": saldo_pendiente,
            "saldo_a_favor_anterior": saldo_a_favor_anterior
        }
    )

    return {
        "message": "Factura creada",
        "invoice_id": invoice.id,
        "invoice_number": invoice_number,
        "total": invoice.total
    }

@api_router.get("/invoices/client/{customer_id}")
async def get_client_invoices(customer_id: str, include_annulled: bool = False, current_user: dict = Depends(get_current_user)):
    """Get all invoices for a client"""
    if current_user["role"] not in ["admin", "employee", "client"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Client can only see their own invoices
    if current_user["role"] == "client":
        user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "customer_id": 1})
        if not user or user.get("customer_id", "").upper() != customer_id.upper():
            raise HTTPException(status_code=403, detail="No autorizado")
    
    query = {
        "customer_id": customer_id.upper(),
        "tenant_id": tid
    }
    
    # By default, exclude annulled invoices
    if not include_annulled:
        query["is_annulled"] = {"$ne": True}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(20000)
    
    return invoices

@api_router.get("/invoices/client/{customer_id}/for-shipment")
async def get_client_invoices_for_shipment(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Get invoices for a client that don't have an associated shipment yet"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get all non-annulled invoices for this client
    invoices = await db.invoices.find({
        "customer_id": customer_id.upper(),
        "tenant_id": tid,
        "is_annulled": {"$ne": True}
    }, {"_id": 0}).sort("created_at", -1).to_list(20000)
    
    # Get all shipment invoice_ids to filter out invoices that already have shipments
    shipments = await db.shipments.find(
        {"tenant_id": tid, "invoice_id": {"$ne": None}},
        {"invoice_id": 1, "_id": 0}
    ).to_list(20000)
    shipped_invoice_ids = {s["invoice_id"] for s in shipments if s.get("invoice_id")}
    
    # Filter out invoices that already have shipments
    result = []
    for inv in invoices:
        if inv["id"] not in shipped_invoice_ids:
            # Get purchase details for this invoice
            purchases = await db.purchases.find(
                {"id": {"$in": inv.get("purchase_ids", [])}},
                {"_id": 0}
            ).to_list(20000)
            inv["purchases"] = purchases
            inv["purchase_count"] = len(purchases)
            result.append(inv)
    
    return result

@api_router.get("/invoices/search")
async def search_invoices(
    q: str = "",
    status_filter: str = "all",  # all, pending, approved, annulled, active
    current_user: dict = Depends(get_current_user)
):
    """Search invoices by any field (invoice number, client name, email, whatsapp, customer_id)"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Build base query
    base_query = {"tenant_id": tid}
    
    # Apply status filter
    if status_filter == "annulled":
        base_query["is_annulled"] = True
    elif status_filter == "pending":
        base_query["is_annulled"] = {"$ne": True}
        base_query["status"] = "pending"
    elif status_filter == "approved":
        base_query["is_annulled"] = {"$ne": True}
        base_query["status"] = "approved"
    elif status_filter == "active":
        # All non-annulled invoices
        base_query["is_annulled"] = {"$ne": True}
    # status_filter == "all" means no filter on status
    
    # Get all invoices first
    invoices = await db.invoices.find(base_query, {"_id": 0}).sort("created_at", -1).to_list(20000)
    
    # Get all customer_ids from invoices
    customer_ids = list(set(inv["customer_id"] for inv in invoices))
    
    # Get pending purchases count per customer (purchases without invoice_id)
    pending_purchases_by_customer = {}
    if customer_ids:
        # Get all users for these customer_ids to get their user ids
        clients = await db.users.find({"customer_id": {"$in": customer_ids}, "tenant_id": tid}, {"_id": 0}).to_list(len(customer_ids))
        client_map = {c["customer_id"]: c for c in clients}
        
        # Get pending purchases (no invoice_id) grouped by user
        user_ids = [c["id"] for c in clients]
        pending_purchases = await db.purchases.find({
            "user_id": {"$in": user_ids},
            "tenant_id": tid,
            "$or": [
                {"invoice_id": None},
                {"invoice_id": {"$exists": False}}
            ]
        }, {"user_id": 1, "_id": 0}).to_list(20000)
        
        # Count by user_id, then map to customer_id
        user_pending_count = {}
        for p in pending_purchases:
            uid = p["user_id"]
            user_pending_count[uid] = user_pending_count.get(uid, 0) + 1
        
        # Map user_id counts to customer_id
        for c in clients:
            pending_purchases_by_customer[c["customer_id"]] = user_pending_count.get(c["id"], 0)
    else:
        client_map = {}
    
    # Get all shipments for these invoices
    invoice_ids = [inv["id"] for inv in invoices]
    shipments_by_invoice = {}
    
    if invoice_ids:
        # First try to get shipments linked directly by invoice_id
        linked_shipments = await db.shipments.find(
            {"invoice_id": {"$in": invoice_ids}, "tenant_id": tid},
            {"_id": 0}
        ).to_list(20000)
        
        for s in linked_shipments:
            shipments_by_invoice[s["invoice_id"]] = s
        
        # For invoices without direct link, try to find by purchase_ids
        # IMPORTANT: only match shipments that are NOT linked to a different invoice
        # (otherwise the same shipping cost would show on two invoices)
        for inv in invoices:
            if inv["id"] not in shipments_by_invoice and inv.get("purchase_ids"):
                shipment = await db.shipments.find_one(
                    {
                        "tenant_id": tid,
                        "customer_id": inv.get("customer_id"),
                        "purchase_ids": {"$in": inv["purchase_ids"]},
                        "$or": [
                            {"invoice_id": None},
                            {"invoice_id": {"$exists": False}},
                            {"invoice_id": ""}
                        ]
                    },
                    {"_id": 0},
                    sort=[("created_at", -1)]
                )
                if shipment:
                    shipments_by_invoice[inv["id"]] = shipment
    
    # Get all client deposits
    client_deposits_map = {}
    if customer_ids:
        user_ids = [c["id"] for c in client_map.values()]
        deposits = await db.wallet_transactions.find(
            {
                "user_id": {"$in": user_ids},
                "tenant_id": tid,
                "type": "deposit",
                "status": "approved",
                "is_deleted": {"$ne": True}
            },
            {"_id": 0, "user_id": 1, "amount": 1, "created_at": 1}
        ).sort("created_at", -1).to_list(20000)
        
        for dep in deposits:
            user_id = dep["user_id"]
            if user_id not in client_deposits_map:
                client_deposits_map[user_id] = []
            if len(client_deposits_map[user_id]) < 10:  # Max 10 deposits per client
                client_deposits_map[user_id].append(dep)
    
    # Helper function to enrich invoice with shipment
    def enrich_invoice(inv):
        inv["client"] = client_map.get(inv["customer_id"], {})
        inv["client_pending_purchases"] = pending_purchases_by_customer.get(inv["customer_id"], 0)
        inv["shipment"] = shipments_by_invoice.get(inv["id"])
        if inv["shipment"]:
            inv["shipping_cost"] = inv["shipment"].get("shipping_cost", 0)
        # Add client deposits
        client = client_map.get(inv["customer_id"])
        if client:
            inv["client_deposits"] = client_deposits_map.get(client["id"], [])
        return inv
    
    # If no search query, return all filtered invoices
    if not q or q.strip() == "":
        for inv in invoices:
            enrich_invoice(inv)
        
        return invoices
    
    # Search query provided - search in invoices and clients
    q_lower = q.strip().lower()
    q_upper = q.strip().upper()
    
    # Get all clients for this tenant to search
    all_clients = await db.users.find({"tenant_id": tid, "role": "client"}, {"_id": 0}).to_list(20000)
    
    # Find matching client customer_ids
    matching_customer_ids = set()
    for client in all_clients:
        client_name = (client.get("name") or "").lower()
        client_email = (client.get("email") or "").lower()
        client_whatsapp = (client.get("whatsapp") or "").lower()
        client_customer_id = (client.get("customer_id") or "").upper()
        if (q_lower in client_name or
            q_lower in client_email or
            q_lower in client_whatsapp or
            q_upper in client_customer_id):
            matching_customer_ids.add(client["customer_id"])
    
    # Filter invoices
    filtered_invoices = []
    
    for inv in invoices:
        # Match by invoice number
        if q_lower in inv.get("invoice_number", "").lower():
            enrich_invoice(inv)
            filtered_invoices.append(inv)
        # Match by customer_id
        elif q_upper in inv.get("customer_id", "").upper():
            enrich_invoice(inv)
            filtered_invoices.append(inv)
        # Match by client info
        elif inv["customer_id"] in matching_customer_ids:
            enrich_invoice(inv)
            filtered_invoices.append(inv)
    
    return filtered_invoices

@api_router.get("/invoices/annulled")
async def list_annulled_invoices(current_user: dict = Depends(get_current_user)):
    """List soft-deleted (annulled) invoices so the admin can review and
    optionally restore them. Ordered newest annulled first.

    NOTE: must stay registered BEFORE `/invoices/{invoice_id}` otherwise the
    literal path is shadowed by the path-param route and returns 404.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if current_user["role"] == "employee":
        emp = await db.employees.find_one({"id": current_user["user_id"]}, {"_id": 0})
        if not emp or not emp.get("permissions", {}).get("manage_invoices"):
            raise HTTPException(status_code=403, detail="No tienes permiso")
    tid = current_user["tenant_id"]
    invoices = await db.invoices.find(
        {"tenant_id": tid, "is_annulled": True},
        {"_id": 0}
    ).sort("annulled_at", -1).to_list(20000)
    return invoices


async def calculate_and_apply_late_fee(invoice: dict, tenant: dict, shipment: dict = None) -> dict:
    """
    Calculate and apply late fee to an invoice based on shipping category.
    Returns updated invoice dict (does NOT persist to DB - caller should do that).
    
    Rules:
    - Only applies if tenant has late_fee_enabled=True
    - Only applies if invoice is not annulled
    - Only applies if late_fee_applied is not already True
    - Late fee applies on Thursday 23:59 (after week closes Wednesday 23:59)
    - Fee amount comes from the shipping_category's late_fee value
    """
    # Skip if already applied or annulled
    if invoice.get("late_fee_applied") or invoice.get("is_annulled"):
        return invoice
    
    # Skip if late fee not enabled for tenant
    if not tenant.get("late_fee_enabled"):
        return invoice
    
    # Check if late fee deadline has passed (Thursday 23:59 after invoice week)
    created_at = invoice.get("created_at")
    if not created_at:
        return invoice
    
    try:
        created_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        
        # Find the Thursday 23:59 of the week the invoice was created
        # Week runs Thursday 00:00 → Wednesday 23:59
        # Late fee applies Thursday 23:59 (next day after week closes)
        
        # Get invoice creation date in local context
        invoice_date = created_dt.date()
        
        # Find the start of the invoice's week (Thursday)
        # JS getDay mapping: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
        # Python weekday: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
        # Days back to Thursday: Thu→0, Fri→1, Sat→2, Sun→3, Mon→4, Tue→5, Wed→6
        py_weekday = invoice_date.weekday()  # 0=Mon ... 6=Sun
        # Convert to days since Thursday: Thu=3→0, Fri=4→1, Sat=5→2, Sun=6→3, Mon=0→4, Tue=1→5, Wed=2→6
        days_since_thursday = (py_weekday - 3) % 7
        
        # Week start (Thursday of invoice's week)
        week_start = invoice_date - timedelta(days=days_since_thursday)
        
        # Late fee deadline: next Thursday at 23:59 (7 days after week start)
        late_fee_deadline = datetime.combine(
            week_start + timedelta(days=7),  # Next Thursday
            datetime.max.time()  # 23:59:59.999999
        ).replace(tzinfo=timezone.utc)
        
        if now < late_fee_deadline:
            return invoice  # Deadline not yet passed
    except Exception:
        return invoice
    
    # Get shipping category from shipment
    shipping_category = None
    if shipment:
        shipping_category = shipment.get("shipping_category")
    
    if not shipping_category:
        return invoice  # No shipping category to base fee on
    
    # Find the late fee for this category
    shipping_categories = tenant.get("shipping_categories", [])
    late_fee_amount = 0
    for cat in shipping_categories:
        if cat.get("key") == shipping_category:
            late_fee_amount = float(cat.get("late_fee", 0))
            break
    
    if late_fee_amount <= 0:
        return invoice  # No late fee configured for this category
    
    # Apply the late fee
    now_iso = datetime.now(timezone.utc).isoformat()
    invoice["late_fee_applied"] = True
    invoice["late_fee_amount"] = round(late_fee_amount, 2)
    invoice["late_fee_description"] = tenant.get("late_fee_description", "Recargo por demora en pago")
    invoice["late_fee_applied_at"] = now_iso
    invoice["late_fee_category"] = shipping_category
    
    # Update total to pay if it exists
    if "total_a_pagar" in invoice:
        invoice["total_a_pagar"] = round(invoice.get("total_a_pagar", 0) + late_fee_amount, 2)
    
    return invoice


@api_router.get("/invoices/{invoice_id}")
async def get_invoice_detail(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get invoice with full details"""
    if current_user["role"] not in ["admin", "employee", "client"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    # Client can only see their own invoices
    if current_user["role"] == "client":
        user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "customer_id": 1})
        if not user or invoice.get("customer_id") != user.get("customer_id"):
            raise HTTPException(status_code=403, detail="No autorizado")
    
    # Get client info
    client = await db.users.find_one({"customer_id": invoice["customer_id"], "tenant_id": tid}, {"_id": 0})
    
    # Get client wallet for balance
    client_wallet = None
    if client:
        client_wallet = await db.wallets.find_one({"user_id": client["id"], "tenant_id": tid}, {"_id": 0})
    
    # Get purchases
    purchases = await db.purchases.find({
        "id": {"$in": invoice["purchase_ids"]},
        "tenant_id": tid
    }, {"_id": 0}).to_list(len(invoice["purchase_ids"]))
    
    # Get tenant info for Personal Shopper details
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0})
    
    # Get shipment linked to this specific invoice first
    shipment = await db.shipments.find_one(
        {"invoice_id": invoice["id"], "tenant_id": tid},
        {"_id": 0}
    )
    
    # If no shipment by invoice_id, try to find one that contains the same purchases
    # IMPORTANT: only match shipments that are NOT linked to a different invoice
    if not shipment and invoice.get("purchase_ids"):
        shipment = await db.shipments.find_one(
            {
                "tenant_id": tid,
                "customer_id": invoice.get("customer_id"),
                "purchase_ids": {"$in": invoice["purchase_ids"]},
                "$or": [
                    {"invoice_id": None},
                    {"invoice_id": {"$exists": False}},
                    {"invoice_id": ""}
                ]
            },
            {"_id": 0},
            sort=[("created_at", -1)]
        )
    
    # If still no shipment, check if client has exactly one invoice and one unlinked shipment
    if not shipment and invoice.get("customer_id"):
        inv_count = await db.invoices.count_documents(
            {"customer_id": invoice["customer_id"], "tenant_id": tid, "is_annulled": {"$ne": True}}
        )
        if inv_count == 1:
            unlinked = await db.shipments.find_one(
                {
                    "tenant_id": tid,
                    "customer_id": invoice.get("customer_id"),
                    "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}, {"invoice_id": ""}]
                },
                {"_id": 0},
                sort=[("created_at", -1)]
            )
            if unlinked:
                shipment = unlinked
    
    # Read stored deposit data (fixed at creation time, never recalculated)
    applied_deposits = invoice.get("applied_deposits", [])
    deposits_applied = invoice.get("deposits_applied", 0)
    
    # Calculate real client balance (same formula as /admin/clients)
    real_client_balance = 0
    if client:
        # Total recharges
        recharges_agg = await db.wallet_transactions.aggregate([
            {"$match": {"user_id": client["id"], "tenant_id": tid, "type": {"$in": ["deposit", "initial_balance", "referral_bonus"]}, "status": "approved", "is_deleted": {"$ne": True}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1)
        total_recharges = recharges_agg[0]["total"] if recharges_agg else 0
        # Total purchases
        purchases_agg = await db.purchases.aggregate([
            {"$match": {"user_id": client["id"], "tenant_id": tid}},
            {"$group": {"_id": None, "total": {"$sum": "$total"}}}
        ]).to_list(1)
        total_purchases = purchases_agg[0]["total"] if purchases_agg else 0
        # Total shipping
        shipping_agg = await db.shipments.aggregate([
            {"$match": {"user_id": client["id"], "tenant_id": tid}},
            {"$group": {"_id": None, "total": {"$sum": "$shipping_cost"}}}
        ]).to_list(1)
        total_shipping = shipping_agg[0]["total"] if shipping_agg else 0
        # Saldo pendiente from invoices
        saldo_pend_agg = await db.invoices.aggregate([
            {"$match": {"tenant_id": tid, "customer_id": invoice["customer_id"], "is_annulled": {"$ne": True}, "saldo_pendiente": {"$gt": 0}}},
            {"$group": {"_id": None, "total": {"$sum": "$saldo_pendiente"}}}
        ]).to_list(1)
        total_saldo_pend = saldo_pend_agg[0]["total"] if saldo_pend_agg else 0
        real_client_balance = round(total_recharges - total_purchases - total_shipping, 2)

    # Apply late fee if applicable (and persist if changed)
    if tenant and not invoice.get("late_fee_applied") and not invoice.get("is_annulled"):
        updated_invoice = await calculate_and_apply_late_fee(invoice, tenant, shipment)
        if updated_invoice.get("late_fee_applied") and not invoice.get("late_fee_applied"):
            # Persist the late fee to the database
            await db.invoices.update_one(
                {"id": invoice_id, "tenant_id": tid},
                {"$set": {
                    "late_fee_applied": updated_invoice["late_fee_applied"],
                    "late_fee_amount": updated_invoice["late_fee_amount"],
                    "late_fee_description": updated_invoice["late_fee_description"],
                    "late_fee_applied_at": updated_invoice["late_fee_applied_at"],
                    "late_fee_category": updated_invoice.get("late_fee_category"),
                    "total_a_pagar": updated_invoice.get("total_a_pagar", invoice.get("total_a_pagar", 0))
                }}
            )
            invoice = updated_invoice

    return {
        **invoice,
        "client": client,
        "client_balance": real_client_balance,
        "applied_deposits": applied_deposits,
        "deposits_applied": deposits_applied,
        "purchases": purchases,
        "tenant": tenant,
        "shipment": shipment
    }


@api_router.get("/invoices/{invoice_id}/audit")
async def audit_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Audit an invoice's applied_deposits in real time:
    - Per-invoice: verify each deposit_id is approved + not deleted, amounts match.
    - Customer-wide: also detect orphan deposits (approved but not in any invoice),
      duplicates (same deposit_id across multiple non-annulled invoices), and
      total wallet vs total assigned mismatch.
    Returns the per-invoice issues plus a customer summary so the UI can decide
    whether a recalc is needed even when this specific invoice looks clean.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    invoice = await db.invoices.find_one(
        {"id": invoice_id, "tenant_id": tid},
        {"_id": 0, "id": 1, "invoice_number": 1, "applied_deposits": 1, "deposits_applied": 1, "customer_id": 1, "is_annulled": 1, "total_a_pagar": 1, "saldo_a_favor": 1}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    issues = []
    valid_amount = 0.0
    for dep in invoice.get("applied_deposits", []) or []:
        dep_id = dep.get("deposit_id")
        amount = dep.get("amount_applied", 0) or 0
        if not dep_id:
            issues.append({"type": "missing_id", "amount": amount, "description": dep.get("description") or ""})
            continue
        tx = await db.wallet_transactions.find_one(
            {"id": dep_id, "tenant_id": tid},
            {"_id": 0, "id": 1, "status": 1, "is_deleted": 1, "amount": 1}
        )
        if not tx:
            issues.append({"type": "tx_not_found", "deposit_id": dep_id, "amount": amount})
            continue
        if tx.get("is_deleted"):
            issues.append({"type": "tx_deleted", "deposit_id": dep_id, "amount": amount, "tx_status": tx.get("status")})
            continue
        if tx.get("status") != "approved":
            issues.append({"type": "tx_not_approved", "deposit_id": dep_id, "amount": amount, "tx_status": tx.get("status")})
            continue
        if abs((tx.get("amount") or 0) - amount) > 0.01:
            issues.append({"type": "amount_mismatch", "deposit_id": dep_id, "stored": amount, "actual": tx.get("amount")})
            valid_amount += tx.get("amount") or 0
            continue
        valid_amount += amount

    return {
        "invoice_id": invoice_id,
        "invoice_number": invoice.get("invoice_number"),
        "is_annulled": bool(invoice.get("is_annulled")),
        "deposits_applied_stored": round(invoice.get("deposits_applied", 0) or 0, 2),
        "valid_deposits_amount": round(valid_amount, 2),
        "issues": issues,
        "needs_recalc": len(issues) > 0,
        "customer_audit": await _customer_deposit_audit(tid, invoice.get("customer_id")),
    }


async def _customer_deposit_audit(tenant_id: str, customer_id: str | None) -> dict:
    """Customer-wide deposit audit: cross-checks wallet deposits vs deposits assigned
    across all non-annulled invoices. Detects orphans (approved but not in any invoice)
    and duplicates (same deposit_id in multiple invoices)."""
    if not customer_id:
        return {}
    user = await db.users.find_one(
        {"customer_id": customer_id, "tenant_id": tenant_id},
        {"_id": 0, "id": 1}
    )
    if not user:
        return {}
    # All approved, non-deleted deposits in wallet
    wallet_deposits = await db.wallet_transactions.find(
        {"user_id": user["id"], "tenant_id": tenant_id, "type": "deposit",
         "status": "approved", "is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "amount": 1, "created_at": 1}
    ).to_list(20000)
    approved_count = len(wallet_deposits)
    approved_total = round(sum(d.get("amount", 0) or 0 for d in wallet_deposits), 2)
    approved_ids = {d["id"] for d in wallet_deposits}

    # All applied_deposits across non-annulled invoices for this customer
    invoices = await db.invoices.find(
        {"customer_id": customer_id, "tenant_id": tenant_id, "is_annulled": {"$ne": True}},
        {"_id": 0, "id": 1, "invoice_number": 1, "applied_deposits": 1}
    ).to_list(20000)
    seen_in_invoices: dict[str, list[str]] = {}
    assigned_total = 0.0
    assigned_count = 0
    for inv in invoices:
        for dep in inv.get("applied_deposits", []) or []:
            did = dep.get("deposit_id") or ""
            if not did:
                continue
            assigned_count += 1
            assigned_total += dep.get("amount_applied", 0) or 0
            seen_in_invoices.setdefault(did, []).append(inv.get("invoice_number") or inv["id"][:8])

    duplicates = [
        {"deposit_id": did, "invoices": invs}
        for did, invs in seen_in_invoices.items() if len(invs) > 1
    ]
    orphan_ids = approved_ids - set(seen_in_invoices.keys())
    orphans = [
        {"deposit_id": d["id"], "amount": d.get("amount", 0), "created_at": d.get("created_at")}
        for d in wallet_deposits if d["id"] in orphan_ids
    ]
    # Stale = assigned in invoice but not approved/deleted (or rejected)
    assigned_ids = set(seen_in_invoices.keys())
    stale_ids = [did for did in assigned_ids if did not in approved_ids]

    needs_recalc = bool(duplicates or stale_ids or
                        round(assigned_total, 2) != approved_total or
                        assigned_count != approved_count)

    return {
        "customer_id": customer_id,
        "approved_count": approved_count,
        "approved_total": approved_total,
        "assigned_count": assigned_count,
        "assigned_total": round(assigned_total, 2),
        "orphans": orphans,
        "duplicates": duplicates,
        "stale_assigned_ids": stale_ids,
        "needs_recalc": needs_recalc,
    }


@api_router.post("/invoices/{invoice_id}/recalc")
async def recalc_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Recompute this invoice from scratch using the current purchases attached
    to it, then run the client-wide deposit/saldo recalculation chain.

    Sequence:
      1. Reload invoice and its purchase_ids.
      2. Recalculate `subtotal`, `total_tax`, `total_commission`, `total` from
         the live purchase rows (handles items deleted/edited outside this UI).
      3. Drop ids of purchases that no longer exist (orphan ids cleanup).
      4. Persist the new invoice header.
      5. Trigger the client-wide chain so saldo_pendiente / saldo_a_favor /
         total_a_pagar / deposits_applied stay consistent across siblings.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    invoice = await db.invoices.find_one(
        {"id": invoice_id, "tenant_id": tid}, {"_id": 0}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    customer_id = invoice.get("customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="Factura sin customer_id, no se puede recalcular")

    purchase_ids = list(invoice.get("purchase_ids") or [])
    purchases = await db.purchases.find(
        {"id": {"$in": purchase_ids}, "tenant_id": tid}, {"_id": 0}
    ).to_list(len(purchase_ids)) if purchase_ids else []

    # Drop ids that no longer exist in `purchases` (e.g. hard-deleted rows).
    live_ids = {p["id"] for p in purchases}
    cleaned_ids = [pid for pid in purchase_ids if pid in live_ids]

    new_subtotal = round(sum(float(p.get("price") or 0) for p in purchases), 2)
    new_total_tax = round(sum(float(p.get("tax") or 0) for p in purchases), 2)
    new_total_commission = round(sum(float(p.get("commission") or 0) for p in purchases), 2)
    new_total = round(sum(float(p.get("total") or 0) for p in purchases), 2)

    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {
            "purchase_ids": cleaned_ids,
            "subtotal": new_subtotal,
            "total_tax": new_total_tax,
            "total_commission": new_total_commission,
            "total": new_total,
        }}
    )

    # Now run the client-wide chain so saldos/depósitos stay consistent.
    await recalculate_client_invoices(tid, customer_id)

    refreshed = await db.invoices.find_one(
        {"id": invoice_id, "tenant_id": tid},
        {"_id": 0, "id": 1, "invoice_number": 1, "deposits_applied": 1,
         "total_a_pagar": 1, "saldo_a_favor": 1, "subtotal": 1, "total": 1,
         "total_tax": 1, "total_commission": 1, "purchase_ids": 1}
    )
    return {
        "message": "Factura recalculada",
        "invoice_id": invoice_id,
        "invoice_number": invoice.get("invoice_number"),
        "subtotal": (refreshed or {}).get("subtotal", 0),
        "total": (refreshed or {}).get("total", 0),
        "total_tax": (refreshed or {}).get("total_tax", 0),
        "total_commission": (refreshed or {}).get("total_commission", 0),
        "items_count": len((refreshed or {}).get("purchase_ids") or []),
        "deposits_applied": (refreshed or {}).get("deposits_applied", 0),
        "total_a_pagar": (refreshed or {}).get("total_a_pagar", 0),
        "saldo_a_favor": (refreshed or {}).get("saldo_a_favor", 0),
        "removed_orphan_ids": len(purchase_ids) - len(cleaned_ids),
    }


@api_router.put("/invoices/{invoice_id}/remove-item")
async def remove_item_from_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Remove an item from an invoice (works for both pending and approved invoices)"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    purchase_id = data.get("purchase_id")
    
    if not purchase_id:
        raise HTTPException(status_code=400, detail="purchase_id es requerido")
    
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    
    if purchase_id not in invoice["purchase_ids"]:
        raise HTTPException(status_code=400, detail="El artículo no está en esta factura")
    
    if len(invoice["purchase_ids"]) <= 1:
        raise HTTPException(status_code=400, detail="No puedes quitar el último artículo. Elimina la factura en su lugar.")
    
    # Get the purchase to update totals
    purchase = await db.purchases.find_one({"id": purchase_id, "tenant_id": tid}, {"_id": 0})
    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    
    # Remove from invoice
    new_purchase_ids = [pid for pid in invoice["purchase_ids"] if pid != purchase_id]
    
    # Recalculate totals
    remaining_purchases = await db.purchases.find({
        "id": {"$in": new_purchase_ids},
        "tenant_id": tid
    }, {"_id": 0}).to_list(len(new_purchase_ids))
    
    new_subtotal = sum(p["price"] for p in remaining_purchases)
    new_total_tax = sum(p.get("tax", 0) for p in remaining_purchases)
    new_total_commission = sum(p.get("commission", 0) for p in remaining_purchases)
    new_total = sum(p["total"] for p in remaining_purchases)
    
    # Update invoice
    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {
            "purchase_ids": new_purchase_ids,
            "subtotal": round(new_subtotal, 2),
            "total_tax": round(new_total_tax, 2),
            "total_commission": round(new_total_commission, 2),
            "total": round(new_total, 2)
        }}
    )
    
    # Remove invoice reference from purchase and reset status if invoice was approved
    update_fields = {"invoice_id": None, "invoiced_at": None}
    if invoice["status"] == "approved":
        update_fields["status"] = "confirmed"
        update_fields["paid_at"] = None
    
    await db.purchases.update_one(
        {"id": purchase_id, "tenant_id": tid},
        {"$set": update_fields}
    )

    # Recalculate the full invoice chain for this client so that totals
    # (saldo_pendiente, saldo_a_favor, total_a_pagar, deposits_applied, etc.)
    # reflect the new invoice subtotal after the item removal. Without this,
    # downstream PDFs and client views would show stale financial values.
    try:
        await recalculate_client_invoices(tid, invoice.get("customer_id"))
    except Exception as _re_err:
        logger.error(f"Error recalculating after remove_item_from_invoice: {_re_err}")

    return {
        "message": "Artículo removido de la factura",
        "removed_purchase_id": purchase_id,
        "new_total": round(new_total, 2),
        "remaining_items": len(new_purchase_ids)
    }


@api_router.put("/invoices/{invoice_id}/add-items")
async def add_items_to_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Attach one or more purchases (of the same client) to an existing invoice.

    Only purchases not currently attached to any invoice AND belonging to the
    same customer as the target invoice are accepted. The invoice must not be
    annulled. Works for both pending and approved invoices — the purchases
    receive `invoice_id`/`status=paid` when the invoice is approved.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    purchase_ids = data.get("purchase_ids") or []
    if not isinstance(purchase_ids, list) or not purchase_ids:
        raise HTTPException(status_code=400, detail="purchase_ids (lista) es requerido")

    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if invoice.get("is_annulled"):
        raise HTTPException(status_code=400, detail="No se pueden agregar artículos a una factura anulada")

    customer_id = invoice.get("customer_id")
    # Pull the candidate purchases and validate them
    candidates = await db.purchases.find(
        {"id": {"$in": purchase_ids}, "tenant_id": tid},
        {"_id": 0}
    ).to_list(len(purchase_ids))

    if len(candidates) != len(purchase_ids):
        raise HTTPException(status_code=400, detail="Alguna compra no existe")

    for p in candidates:
        if p.get("customer_id", "").upper() != (customer_id or "").upper():
            raise HTTPException(status_code=400, detail=f"La compra {p.get('item_name', p['id'][:8])} no pertenece al cliente {customer_id}")
        if p.get("invoice_id") and p.get("invoice_id") != invoice_id:
            raise HTTPException(status_code=400, detail=f"La compra {p.get('item_name', p['id'][:8])} ya está en otra factura")
        if p.get("is_deleted"):
            raise HTTPException(status_code=400, detail=f"La compra {p.get('item_name', p['id'][:8])} está eliminada")

    # Build the new purchase list (dedupe)
    existing_ids = set(invoice.get("purchase_ids", []))
    new_ids = [pid for pid in purchase_ids if pid not in existing_ids]
    if not new_ids:
        return {"message": "Todas las compras ya estaban en la factura", "added": 0}
    merged_ids = list(existing_ids) + new_ids

    # Recompute invoice totals from the merged set
    merged_purchases = await db.purchases.find(
        {"id": {"$in": merged_ids}, "tenant_id": tid},
        {"_id": 0}
    ).to_list(len(merged_ids))
    new_subtotal = sum(p.get("price", 0) for p in merged_purchases)
    new_total_tax = sum(p.get("tax", 0) for p in merged_purchases)
    new_total_commission = sum(p.get("commission", 0) for p in merged_purchases)
    new_total = sum(p.get("total", 0) for p in merged_purchases)

    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {
            "purchase_ids": merged_ids,
            "subtotal": round(new_subtotal, 2),
            "total_tax": round(new_total_tax, 2),
            "total_commission": round(new_total_commission, 2),
            "total": round(new_total, 2),
        }}
    )

    # Attach invoice reference + set status on added purchases
    now = datetime.now(timezone.utc).isoformat()
    update_fields = {"invoice_id": invoice_id, "invoiced_at": now}
    if invoice.get("status") == "approved":
        update_fields["status"] = "paid"
        update_fields["paid_at"] = now
    await db.purchases.update_many(
        {"id": {"$in": new_ids}, "tenant_id": tid},
        {"$set": update_fields}
    )

    # Recalc the full client chain so totals propagate
    try:
        await recalculate_client_invoices(tid, customer_id)
    except Exception as _re_err:
        logger.error(f"Error recalculating after add_items_to_invoice: {_re_err}")

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="update_invoice",
        entity_type="invoice", entity_id=invoice_id,
        entity_name=f"Factura {invoice['invoice_number']}",
        details={
            "customer_id": customer_id,
            "operation": "add_items",
            "added_count": len(new_ids),
            "added_purchase_ids": new_ids,
            "new_total": round(new_total, 2),
        }
    )

    return {
        "message": f"{len(new_ids)} artículo(s) agregado(s) a la factura",
        "added": len(new_ids),
        "added_purchase_ids": new_ids,
        "new_total": round(new_total, 2),
        "total_items": len(merged_ids),
    }

@api_router.put("/invoices/{invoice_id}/reopen")
async def reopen_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Reopen an approved invoice for modifications"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    
    if invoice["status"] != "approved":
        raise HTTPException(status_code=400, detail="La factura no está aprobada")
    
    # Reopen invoice
    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {"status": "pending", "approved_at": None}}
    )
    
    # Reset all purchases to confirmed status (not paid)
    await db.purchases.update_many(
        {"id": {"$in": invoice["purchase_ids"]}, "tenant_id": tid},
        {"$set": {"status": "confirmed", "paid_at": None}}
    )

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="reopen_invoice",
        entity_type="invoice", entity_id=invoice_id,
        entity_name=f"Factura {invoice['invoice_number']}",
        details={
            "customer_id": invoice.get("customer_id"),
            "invoice_number": invoice["invoice_number"],
            "purchase_count": len(invoice.get("purchase_ids", []))
        }
    )

    return {"message": "Factura reabierta para modificaciones"}

@api_router.put("/invoices/{invoice_id}/saldo-pendiente")
async def update_invoice_saldo_pendiente(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update saldo_pendiente for an existing invoice"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    saldo = round(float(data.get("saldo_pendiente", 0)), 2)
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid, "is_annulled": {"$ne": True}}, {"_id": 0, "customer_id": 1})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid, "is_annulled": {"$ne": True}},
        {"$set": {"saldo_pendiente": saldo}}
    )
    # Recompute total_a_pagar / saldo_a_favor / deposits chain so PDF + UI agree.
    if invoice.get("customer_id"):
        try:
            await recalculate_client_invoices(tid, invoice["customer_id"])
        except Exception as _e:
            logger.error(f"Error recalculating after saldo_pendiente update: {_e}")
    return {"message": "Saldo pendiente actualizado", "saldo_pendiente": saldo}

@api_router.put("/invoices/{invoice_id}/approve")
async def approve_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Approve an invoice - moves purchases to paid history"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    
    if invoice["status"] == "approved":
        raise HTTPException(status_code=400, detail="La factura ya está aprobada")
    
    now = datetime.now(timezone.utc).isoformat()
    
    # Update invoice status
    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {"status": "approved", "approved_at": now}}
    )
    
    # Mark all purchases as paid/archived
    await db.purchases.update_many(
        {"id": {"$in": invoice["purchase_ids"]}, "tenant_id": tid},
        {"$set": {"status": "paid", "paid_at": now}}
    )
    
    # Create notification for client
    await create_notification(
        tid, invoice["user_id"], invoice["customer_id"],
        "invoice_approved",
        "Factura Aprobada",
        f"Tu factura {invoice['invoice_number']} por ${invoice['total']:.2f} ha sido aprobada."
    )

    # Audit
    actor_name = await get_actor_name(current_user["user_id"])
    await log_audit_action(
        tenant_id=tid, user_id=current_user["user_id"], user_name=actor_name,
        user_role=current_user.get("role", "admin"), action="approve_invoice",
        entity_type="invoice", entity_id=invoice_id,
        entity_name=f"Factura {invoice['invoice_number']}",
        details={
            "customer_id": invoice.get("customer_id"),
            "invoice_number": invoice["invoice_number"],
            "total": invoice.get("total"),
            "purchase_count": len(invoice.get("purchase_ids", []))
        }
    )

    return {"message": "Factura aprobada", "invoice_number": invoice["invoice_number"]}

@api_router.get("/invoices/client/{customer_id}/history")
async def get_client_purchase_history(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Get purchase history (paid purchases from approved invoices)"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    purchases = await db.purchases.find({
        "customer_id": customer_id.upper(),
        "tenant_id": tid,
        "status": "paid"
    }, {"_id": 0}).sort("paid_at", -1).to_list(20000)
    
    return purchases

@api_router.get("/invoices/{invoice_id}/annul-preview")
async def annul_invoice_preview(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Preview what will happen when an invoice is annulled.

    Returns the linked shipment (if any), the purchases that will be reverted,
    and the deposits that will be freed. Used by the UI to show a detailed
    warning dialog BEFORE the destructive action runs.
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores")
    tid = current_user["tenant_id"]
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if invoice.get("is_annulled"):
        raise HTTPException(status_code=400, detail="Factura ya anulada")

    shipment = await db.shipments.find_one({"invoice_id": invoice_id, "tenant_id": tid}, {"_id": 0})
    purchases = await db.purchases.find(
        {"id": {"$in": invoice.get("purchase_ids", [])}, "tenant_id": tid},
        {"_id": 0, "id": 1, "item_name": 1, "store": 1, "total": 1, "status": 1}
    ).to_list(20000)
    return {
        "invoice": {
            "id": invoice["id"],
            "invoice_number": invoice["invoice_number"],
            "customer_id": invoice.get("customer_id"),
            "total": invoice.get("total"),
            "total_a_pagar": invoice.get("total_a_pagar"),
            "status": invoice.get("status"),
            "deposits_applied": invoice.get("deposits_applied", 0),
            "applied_deposits_count": len(invoice.get("applied_deposits", [])),
        },
        "shipment": shipment,
        "purchases": purchases,
        "counts": {
            "purchases": len(purchases),
            "deposits_freed": len(invoice.get("applied_deposits", [])),
            "has_shipment": bool(shipment),
        }
    }

@api_router.put("/invoices/{invoice_id}/restore")
async def restore_invoice(invoice_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Restore an annulled invoice back to its pre-annulment state.

    Reverses the flags set by `annul_invoice`:
      * `is_annulled` → False
      * Re-marks the linked purchases as `invoiced` so they stop appearing as
        "pending" in the client's cart and don't get double-billed on the next
        invoice run.
      * Re-runs `recalculate_client_invoices` to re-flow deposits and inherited
        balances across the client's chain.
    Requires admin role + password.
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden restaurar facturas")
    tid = current_user["tenant_id"]
    user_id = current_user["user_id"]

    # Password is mandatory — same policy as annul_invoice so restoring can't
    # be triggered by a stolen JWT alone. The testing agent caught that an
    # empty body used to succeed silently.
    if not data or not data.get("password"):
        raise HTTPException(status_code=400, detail="Contraseña de administrador requerida")
    admin = await db.users.find_one({"id": user_id, "tenant_id": tid})
    if not admin or not verify_password(data["password"], admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")

    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if not invoice.get("is_annulled"):
        raise HTTPException(status_code=400, detail="La factura no está anulada")

    # Prevent conflicts: if any purchase from this invoice was already re-billed
    # into a NEW invoice after the annulment, block the restore and tell the
    # admin which invoice to anular first. Restoring on top would double-bill.
    conflicts = await db.purchases.find(
        {"id": {"$in": invoice.get("purchase_ids", [])}, "tenant_id": tid,
         "invoice_id": {"$exists": True, "$nin": [None, "", invoice_id]}},
        {"_id": 0, "id": 1, "invoice_id": 1}
    ).to_list(len(invoice.get("purchase_ids", [])) or 1)
    if conflicts:
        blocking_ids = list({c["invoice_id"] for c in conflicts})
        blockers = await db.invoices.find(
            {"id": {"$in": blocking_ids}, "tenant_id": tid, "is_annulled": {"$ne": True}},
            {"_id": 0, "invoice_number": 1, "id": 1}
        ).to_list(len(blocking_ids))
        if blockers:
            names = ", ".join([b.get("invoice_number") or b["id"] for b in blockers])
            raise HTTPException(
                status_code=409,
                detail=f"No se puede restaurar: los productos ya fueron re-facturados en {names}. Anula primero esa(s) factura(s)."
            )

    now = datetime.now(timezone.utc).isoformat()
    admin_user = await db.users.find_one({"id": user_id, "tenant_id": tid}, {"_id": 0})
    admin_name = admin_user.get("name", admin_user.get("email", "Admin")) if admin_user else "Admin"

    # Restore invoice flags
    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {
            "is_annulled": False,
            "restored_at": now,
            "restored_by": user_id,
            "restored_by_name": admin_name,
        }, "$unset": {"annulled_at": "", "annulled_by": "", "annulled_by_name": ""}}
    )

    # Re-attach purchases to this invoice.
    was_approved = invoice.get("status") == "approved"
    purchase_update = {"invoice_id": invoice_id, "invoiced_at": invoice.get("approved_at") or invoice.get("created_at") or now}
    if was_approved:
        purchase_update["status"] = "invoiced"
        purchase_update["paid_at"] = invoice.get("approved_at") or now
    await db.purchases.update_many(
        {"id": {"$in": invoice.get("purchase_ids", [])}, "tenant_id": tid},
        {"$set": purchase_update}
    )

    # Recompute chain so deposits/saldos rebalance.
    await recalculate_client_invoices(tid, invoice["customer_id"])

    await log_audit_action(
        tenant_id=tid, user_id=user_id, user_name=admin_name,
        user_role="admin", action="restore_invoice",
        entity_type="invoice", entity_id=invoice_id,
        entity_name=invoice.get("invoice_number") or invoice_id,
        details={"customer_id": invoice.get("customer_id"), "total": invoice.get("total")}
    )

    return {"message": "Factura restaurada", "invoice_id": invoice_id}


@api_router.put("/invoices/{invoice_id}/annul")
async def annul_invoice(invoice_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Annul an invoice (soft delete) - only admins can do this, requires password.

    Optionally deletes the linked shipment when `data.delete_shipment == True`.
    Otherwise the shipment is simply unlinked (set invoice_id to None) for historical record.
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden anular facturas")
    tid = current_user["tenant_id"]
    user_id = current_user["user_id"]
    delete_shipment_flag = bool((data or {}).get("delete_shipment", False))

    # Verify admin password if provided
    if data and data.get("password"):
        admin = await db.users.find_one({"id": user_id, "tenant_id": tid})
        if not admin or not verify_password(data["password"], admin["password_hash"]):
            raise HTTPException(status_code=401, detail="Contraseña incorrecta")
    
    # Get admin user info for audit
    admin_user = await db.users.find_one({"id": user_id, "tenant_id": tid}, {"_id": 0})
    admin_name = admin_user.get("name", admin_user.get("email", "Admin")) if admin_user else "Admin"
    
    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    
    if invoice.get("is_annulled"):
        raise HTTPException(status_code=400, detail="La factura ya está anulada")
    
    now = datetime.now(timezone.utc).isoformat()
    
    # Update invoice to annulled - also clear applied_deposits to free them
    await db.invoices.update_one(
        {"id": invoice_id, "tenant_id": tid},
        {"$set": {
            "is_annulled": True,
            "annulled_at": now,
            "annulled_by": user_id,
            "annulled_by_name": admin_name,
            "applied_deposits": [],
            "deposits_applied": 0
        }}
    )
    
    # If invoice was approved, revert purchase statuses back to pending
    if invoice.get("status") == "approved":
        await db.purchases.update_many(
            {"id": {"$in": invoice["purchase_ids"]}, "tenant_id": tid},
            {"$set": {"status": "pending", "paid_at": None, "invoice_id": None, "invoiced_at": None}}
        )
    else:
        # If pending, just remove invoice reference
        await db.purchases.update_many(
            {"id": {"$in": invoice["purchase_ids"]}, "tenant_id": tid},
            {"$set": {"invoice_id": None, "invoiced_at": None}}
        )
    
    # Handle linked shipment — either delete it or just unlink
    shipment_action = None
    linked_shipment = await db.shipments.find_one({"invoice_id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if linked_shipment:
        if delete_shipment_flag:
            await db.shipments.delete_one({"id": linked_shipment["id"], "tenant_id": tid})
            shipment_action = "deleted"
            # Audit shipment deletion as separate event
            await log_audit_action(
                tenant_id=tid, user_id=user_id, user_name=admin_name,
                user_role=current_user.get("role", "admin"), action="delete_shipment",
                entity_type="shipment", entity_id=linked_shipment["id"],
                entity_name=f"Envío {linked_shipment.get('customer_id', '')}",
                details={
                    "customer_id": linked_shipment.get("customer_id"),
                    "shipping_cost": linked_shipment.get("shipping_cost"),
                    "package_count": linked_shipment.get("package_count"),
                    "triggered_by": "invoice_annulment",
                    "invoice_id": invoice_id,
                }
            )
        else:
            await db.shipments.update_one(
                {"id": linked_shipment["id"], "tenant_id": tid},
                {"$set": {"invoice_id": None}}
            )
            shipment_action = "unlinked"
    
    # Audit
    await log_audit_action(
        tenant_id=tid, user_id=user_id, user_name=admin_name,
        user_role=current_user.get("role", "admin"), action="invoice_annulled",
        entity_type="invoice", entity_id=invoice_id,
        entity_name=f"Factura {invoice['invoice_number']}",
        details={
            "customer_id": invoice.get("customer_id"),
            "invoice_number": invoice["invoice_number"],
            "total": invoice.get("total"),
            "was_status": invoice.get("status"),
            "purchase_count": len(invoice.get("purchase_ids", [])),
            "shipment_action": shipment_action,
            "shipment_id": linked_shipment.get("id") if linked_shipment else None,
        }
    )

    return {
        "message": "Factura anulada exitosamente",
        "invoice_number": invoice["invoice_number"],
        "shipment_action": shipment_action,
    }

# ==================== NOTIFICATIONS ====================

import re as _notif_re

_LEGACY_PURCHASE_PATTERN = _notif_re.compile(
    r"Compraste\s+(?P<item>.+?)\s+-\s+Precio:\s*\$(?P<price>[\d,.]+)"
)


def _reformat_purchase_notification(notif: dict) -> dict:
    """Rewrite legacy 'Compra Registrada' messages to the simplified format
    (item + store + price only). Pulls store from the linked purchase if available.
    Pure cosmetic — never persisted, only mutates the in-memory dict."""
    msg = notif.get("message") or ""
    m = _LEGACY_PURCHASE_PATTERN.search(msg)
    if not m:
        return notif
    item = m.group("item").strip()
    try:
        price = float(m.group("price").replace(",", ""))
    except ValueError:
        return notif
    notif["title"] = "Nueva compra registrada"
    notif["message"] = (
        f"Producto: {item}\n"
        f"Tienda: —\n"
        f"Precio: ${price:.2f}"
    )
    return notif


@api_router.get("/notifications/{user_id}")
async def get_user_notifications(user_id: str, current_user: dict = Depends(get_current_user)):
    tid = current_user["tenant_id"]
    notifications = await db.notifications.find({"user_id": user_id, "tenant_id": tid}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    # Cosmetically simplify legacy purchase notifications so historical entries
    # match the new compact format (no taxes / commission / total / saldo).
    for n in notifications:
        if n.get("type") == "purchase_created":
            _reformat_purchase_notification(n)
    return notifications

# ==================== REPORTS ====================

@api_router.get("/admin/reports/live/{live_id}")
async def get_live_report(live_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    live = await db.lives.find_one({"id": live_id, "tenant_id": tid}, {"_id": 0})
    if not live:
        raise HTTPException(status_code=404, detail="Live no encontrado")
    purchases = await db.purchases.find({"live_id": live_id, "tenant_id": tid}, {"_id": 0}).to_list(20000)
    customer_totals = {}
    for p in purchases:
        cid = p["customer_id"]
        if cid not in customer_totals:
            customer_totals[cid] = {"count": 0, "total": 0}
        customer_totals[cid]["count"] += 1
        customer_totals[cid]["total"] += p["total"]
    return {"live": live, "purchases": purchases, "customer_summary": customer_totals,
        "total_sales": live.get("total_sales", 0), "total_commissions": live.get("total_commissions", 0),
        "purchase_count": live.get("purchase_count", 0)}

@api_router.get("/admin/reports/summary")
async def get_reports_summary(
    period: str = "week",
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    # Build date filter based on period OR explicit start/end (creation date only).
    # NOTE: We always filter by `created_at` so that editing a shipment/purchase/invoice
    # does NOT pull it into a different week's counters.
    import math
    date_filter = {}
    if start_date and end_date:
        # Explicit range overrides any `period` value (used by past-week selectors).
        date_filter = {"created_at": {"$gte": start_date, "$lte": end_date}}
    elif period == "week":
        # Week = current Monday 12:00 (tenant local, UTC-5 Ecuador) → next Monday 11:59:59.
        # In UTC that is Monday 17:00 → next Monday 16:59:59.
        now = datetime.now(timezone.utc)
        days_since_monday = now.weekday()
        candidate_start = (now - timedelta(days=days_since_monday)).replace(hour=17, minute=0, second=0, microsecond=0)
        # If we're before Monday 17:00 UTC (i.e. before local Monday 12:00 noon), the active week
        # is the previous one — push the start back 7 days.
        if now < candidate_start:
            candidate_start = candidate_start - timedelta(days=7)
        week_start = candidate_start
        week_end = week_start + timedelta(days=7) - timedelta(seconds=1)
        date_filter = {"created_at": {"$gte": week_start.isoformat(), "$lte": week_end.isoformat()}}
    # "all" = no filter
    
    purchase_match = {"tenant_id": tid, **date_filter}
    shipment_match = {"tenant_id": tid, **date_filter}
    
    invoice_match = {"tenant_id": tid, "is_annulled": {"$ne": True}, **date_filter}
    
    # Total sales = sum of (price + tax) of every purchase in the period.
    # This is what the user wants on the "Ventas" card: label price + taxes only,
    # excluding commission. Pulls directly from purchases (not invoices) so it
    # also captures purchases that haven't been billed yet but were registered.
    total_sales_agg = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {"_id": None, "total": {"$sum": {"$add": ["$price", {"$ifNull": ["$tax", 0]}]}}}}
    ]).to_list(1)
    total_sales = [{"total": total_sales_agg[0]["total"]}] if total_sales_agg else []
    # Commissions = sum of `commission` per purchase in the period.
    # IMPORTANT: We pull from `purchases` (not invoices) so commissions show up
    # immediately when a sale is registered — even before an invoice is created
    # for that purchase. This mirrors how `total_sales` is computed above and
    # keeps both KPIs consistent.
    total_commissions_agg = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$commission", 0]}}}}
    ]).to_list(1)
    product_commissions = total_commissions_agg[0]["total"] if total_commissions_agg else 0
    # Manual commissions entered per Live (Live Shopping), attributed by Live creation date.
    manual_agg = await db.lives.aggregate([
        {"$match": {"tenant_id": tid, **date_filter}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$manual_commission", 0]}}}}
    ]).to_list(1)
    manual_commissions = manual_agg[0]["total"] if manual_agg else 0
    total_commissions = [{"total": product_commissions + manual_commissions}]
    
    # Shopper taxes = sum of `shopper_tax` per purchase in the period.
    # These are taxes PAID BY THE PERSONAL SHOPPER that reduce their net profit.
    total_shopper_taxes_agg = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$shopper_tax", 0]}}}}
    ]).to_list(1)
    total_shopper_taxes = total_shopper_taxes_agg[0]["total"] if total_shopper_taxes_agg else 0
    client_count = await db.users.count_documents({"role": "client", "tenant_id": tid})
    live_count = await db.lives.count_documents({"tenant_id": tid, **date_filter})
    pending_shipments = await db.shipments.count_documents({"status": {"$ne": "delivered"}, "tenant_id": tid})
    # Packages and shipping totals come from `shipments` filtered by shipment.created_at.
    # Pulling shipping_cost from invoices would attribute the cost to the invoice's
    # creation week, which is wrong if the shipment (and its cost) was added later.
    all_shipments = await db.shipments.find(
        shipment_match,
        {"_id": 0, "weight_pounds": 1, "package_count": 1, "shipping_cost": 1,
         "shipping_category": 1, "shipping_mode": 1, "marked_sent": 1, "packages": 1}
    ).to_list(20000)
    total_shipping_val = sum((s.get("shipping_cost") or 0) for s in all_shipments)
    total_shipping = [{"total": total_shipping_val}] if all_shipments else []
    total_packages = sum(s.get("package_count", 0) or math.ceil((s.get("weight_pounds", 0) or 0) / 8) for s in all_shipments if (s.get("package_count", 0) or 0) > 0 or (s.get("weight_pounds", 0) or 0) > 0)
    # Number of shipment documents in the period — distinct from total_packages
    # because one shipment can group multiple physical packages.
    shipments_count = len(all_shipments)

    # Courier payment KPI: sum the courier-side cost (paid to the shipping company)
    # ONLY for shipments physically dispatched (`marked_sent=True`).
    # The cost is pulled from the tenant's per-category configuration depending
    # on whether the shipment is billed by packages or by pounds.
    tenant_doc = await db.tenants.find_one({"id": tid}, {"_id": 0, "shipping_categories": 1, "shipping_mode": 1}) or {}
    cats_list = _ensure_category_dual_prices(tenant_doc.get("shipping_categories", []))
    cat_map = {str(c.get("key", "")).upper(): c for c in cats_list}
    total_courier_payment = 0.0
    sent_count = 0
    for s in all_shipments:
        if not s.get("marked_sent"):
            continue
        sent_count += 1
        s_mode = s.get("shipping_mode") or tenant_doc.get("shipping_mode", "packages")
        rate_field = "courier_cost_pounds" if s_mode == "pounds" else "courier_cost_packages"
        if s.get("packages"):
            parts = [(str(p.get("shipping_category") or "").upper(), float(p.get("package_count") or 0)) for p in s["packages"]]
        else:
            qty = float((s.get("weight_pounds") if s_mode == "pounds" else s.get("package_count")) or 0)
            parts = [(str(s.get("shipping_category") or "").upper(), qty)]
        for cat_key, qty in parts:
            cat = cat_map.get(cat_key)
            if cat:
                total_courier_payment += qty * float(cat.get(rate_field, 0) or 0)
    # Snapshot of current courier prices so the dashboard can display them
    courier_prices_snapshot = [
        {
            "key": c.get("key"),
            "label": c.get("label"),
            "courier_cost_packages": c.get("courier_cost_packages", 0),
            "courier_cost_pounds": c.get("courier_cost_pounds", 0),
        }
        for c in cats_list
    ]
    
    # Unique buyers in this period
    buyers_agg = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {"_id": "$customer_id"}}
    ]).to_list(20000)
    buyers_count = len(buyers_agg)
    
    top_customers = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {"_id": "$customer_id", "user_id": {"$first": "$user_id"}, "total_spent": {"$sum": "$total"}, "purchase_count": {"$sum": 1}}},
        {"$sort": {"total_spent": -1}}, {"$limit": 10}
    ]).to_list(10)
    # Add client names to top customers
    for customer in top_customers:
        user = await db.users.find_one({"customer_id": customer["_id"], "tenant_id": tid}, {"_id": 0, "name": 1})
        customer["name"] = user["name"] if user else "Sin nombre"
    return {
        "total_sales": total_sales[0]["total"] if total_sales else 0,
        "total_commissions": round(total_commissions[0]["total"], 2),
        "product_commissions": round(product_commissions, 2),
        "manual_commissions": round(manual_commissions, 2),
        "total_shopper_taxes": round(total_shopper_taxes, 2),
        "client_count": client_count, "live_count": live_count,
        "pending_shipments": pending_shipments,
        "total_shipping": total_shipping[0]["total"] if total_shipping else 0,
        "total_packages": total_packages,
        "shipments_count": shipments_count,
        "total_courier_payment": round(total_courier_payment, 2),
        "sent_shipments_count": sent_count,
        "courier_prices": courier_prices_snapshot,
        "buyers_count": buyers_count,
        "top_customers": top_customers
    }

@api_router.get("/admin/reports/buyers")
async def get_buyers_report(period: str = "week", current_user: dict = Depends(get_current_user)):
    """Get detailed buyers report grouped by week (Sunday to Sunday end of day)"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    import math
    
    # Date filter
    date_filter = {}
    if period == "week":
        # Week = current Monday 12:00 local (UTC-5 Ecuador) → next Monday 11:59:59 local
        # In UTC: Monday 17:00 → next Monday 16:59:59
        now = datetime.now(timezone.utc)
        days_since_monday = now.weekday()
        candidate_start = (now - timedelta(days=days_since_monday)).replace(hour=17, minute=0, second=0, microsecond=0)
        if now < candidate_start:
            candidate_start = candidate_start - timedelta(days=7)
        week_start = candidate_start
        week_end = week_start + timedelta(days=7) - timedelta(seconds=1)
        date_filter = {"created_at": {"$gte": week_start.isoformat(), "$lte": week_end.isoformat()}}
    
    purchase_match = {"tenant_id": tid, **date_filter}
    
    # Get all purchases in period
    purchases = await db.purchases.find(purchase_match, {"_id": 0}).sort("created_at", -1).to_list(20000)
    
    # Get client names
    client_ids = list(set(p.get("customer_id") for p in purchases if p.get("customer_id")))
    clients = await db.users.find(
        {"customer_id": {"$in": client_ids}, "tenant_id": tid},
        {"_id": 0, "customer_id": 1, "name": 1}
    ).to_list(20000)
    client_names = {c["customer_id"]: c["name"] for c in clients}
    
    # Group by week (Tuesday to Monday)
    def get_week_key(date_str):
        d = datetime.fromisoformat(date_str.replace("Z", "+00:00")) if isinstance(date_str, str) else date_str
        days_since_tue = (d.weekday() - 1) % 7
        tuesday = d - timedelta(days=days_since_tue)
        return tuesday.strftime("%Y-%m-%d")
    
    def get_week_label(date_str):
        d = datetime.fromisoformat(date_str.replace("Z", "+00:00")) if isinstance(date_str, str) else date_str
        days_since_tue = (d.weekday() - 1) % 7
        tuesday = d - timedelta(days=days_since_tue)
        monday = tuesday + timedelta(days=6)
        return f"{tuesday.strftime('%d %b')} - {monday.strftime('%d %b')}"
    
    weeks = {}
    for p in purchases:
        wk = get_week_key(p["created_at"])
        if wk not in weeks:
            weeks[wk] = {"label": get_week_label(p["created_at"]), "clients": {}}
        
        cid = p.get("customer_id", "SIN_ID")
        store = p.get("store", "Sin tienda")
        
        if cid not in weeks[wk]["clients"]:
            weeks[wk]["clients"][cid] = {"name": client_names.get(cid, cid), "stores": {}, "total": 0, "count": 0}
        
        if store not in weeks[wk]["clients"][cid]["stores"]:
            weeks[wk]["clients"][cid]["stores"][store] = {"total": 0, "count": 0}
        
        amount = p.get("total", p.get("price", 0))
        weeks[wk]["clients"][cid]["stores"][store]["total"] += amount
        weeks[wk]["clients"][cid]["stores"][store]["count"] += 1
        weeks[wk]["clients"][cid]["total"] += amount
        weeks[wk]["clients"][cid]["count"] += 1
    
    # Format response
    result = []
    for wk in sorted(weeks.keys(), reverse=True):
        w = weeks[wk]
        clients_list = []
        for cid, cdata in sorted(w["clients"].items(), key=lambda x: x[1]["total"], reverse=True):
            stores_list = [{"store": s, "total": round(sd["total"], 2), "count": sd["count"]} 
                          for s, sd in sorted(cdata["stores"].items(), key=lambda x: x[1]["total"], reverse=True)]
            clients_list.append({
                "customer_id": cid,
                "name": cdata["name"],
                "total": round(cdata["total"], 2),
                "count": cdata["count"],
                "stores": stores_list
            })
        result.append({
            "week_key": wk,
            "week_label": w["label"],
            "clients": clients_list,
            "total_buyers": len(clients_list),
            "total_purchases": sum(c["count"] for c in clients_list),
            "total_amount": round(sum(c["total"] for c in clients_list), 2)
        })
    
    return result



@api_router.get("/admin/reports/business-stats")
async def get_business_stats(period: str = "all", current_user: dict = Depends(get_current_user)):
    """Get detailed business statistics with optional date filter"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Build date filter
    from datetime import timedelta
    date_filter = {}
    if period == "today":
        date_filter = {"created_at": {"$gte": datetime.now(timezone.utc).strftime("%Y-%m-%d")}}
    elif period == "7days":
        date_filter = {"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}}
    elif period == "30days":
        date_filter = {"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}
    elif period == "90days":
        date_filter = {"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()}}
    
    purchase_match = {"tenant_id": tid, **date_filter}
    shipment_match = {"tenant_id": tid, **date_filter}
    
    # Total revenue, taxes, commissions, and profit
    revenue_stats = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {
            "_id": None,
            "total_price": {"$sum": "$price"},
            "total_tax": {"$sum": "$tax"},
            "total_commission": {"$sum": "$commission"},
            "total_shopper_tax": {"$sum": {"$ifNull": ["$shopper_tax", 0]}},
            "total_revenue": {"$sum": "$total"},
            "purchase_count": {"$sum": 1}
        }}
    ]).to_list(1)
    
    # Shipping revenue
    shipping_stats = await db.shipments.aggregate([
        {"$match": shipment_match},
        {"$group": {
            "_id": None,
            "total_shipping": {"$sum": "$shipping_cost"},
            "total_weight": {"$sum": "$weight_pounds"},
            "shipment_count": {"$sum": 1}
        }}
    ]).to_list(1)
    
    # Sales by store
    sales_by_store = await db.purchases.aggregate([
        {"$match": purchase_match},
        {"$group": {
            "_id": "$store",
            "total_sales": {"$sum": "$price"},
            "total_commission": {"$sum": "$commission"},
            "count": {"$sum": 1}
        }},
        {"$sort": {"total_sales": -1}},
        {"$limit": 10}
    ]).to_list(10)
    
    # Sales by live
    live_match = {"tenant_id": tid}
    if date_filter:
        live_match.update(date_filter)
    sales_by_live = await db.lives.aggregate([
        {"$match": live_match},
        {"$project": {
            "title": 1,
            "store": 1,
            "total_sales": 1,
            "total_commissions": 1,
            "total_taxes_paid": 1,
            "store_invoice_tax": 1,
            "manual_commission": 1,
            "purchase_count": 1,
            "status": 1,
            "created_at": 1
        }},
        {"$sort": {"created_at": -1}},
        {"$limit": 15}
    ]).to_list(15)
    
    # Sales trend by date
    trend_days = 7 if period == "7days" else 30 if period == "30days" else 90 if period == "90days" else 30
    trend_since = (datetime.now(timezone.utc) - timedelta(days=trend_days)).isoformat()
    
    sales_by_date = await db.purchases.aggregate([
        {"$match": {"tenant_id": tid, "created_at": {"$gte": trend_since}}},
        {"$project": {
            "date": {"$substr": ["$created_at", 0, 10]},
            "price": 1,
            "commission": 1,
            "total": 1
        }},
        {"$group": {
            "_id": "$date",
            "sales": {"$sum": "$price"},
            "commissions": {"$sum": "$commission"},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # Wallet deposits (approved) - total recharges received
    deposit_match = {"tenant_id": tid, "type": "deposit", "status": "approved", "is_deleted": {"$ne": True}}
    if date_filter:
        deposit_match.update(date_filter)
    deposits_stats = await db.wallet_transactions.aggregate([
        {"$match": deposit_match},
        {"$group": {
            "_id": None,
            "total_deposits": {"$sum": "$amount"},
            "deposit_count": {"$sum": 1}
        }}
    ]).to_list(1)
    
    # Current wallet balances (money in the system)
    wallet_stats = await db.wallets.aggregate([
        {"$match": {"tenant_id": tid}},
        {"$group": {
            "_id": None,
            "total_balance": {"$sum": "$available"},
            "wallet_count": {"$sum": 1}
        }}
    ]).to_list(1)
    
    # Store invoice taxes (from Lives - paid by shopper)
    live_tax_match = {"tenant_id": tid}
    if date_filter:
        live_tax_match.update(date_filter)
    store_invoice_taxes_agg = await db.lives.aggregate([
        {"$match": live_tax_match},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$store_invoice_tax", 0]}}}}
    ]).to_list(1)
    store_invoice_taxes = store_invoice_taxes_agg[0]["total"] if store_invoice_taxes_agg else 0
    manual_comm_agg = await db.lives.aggregate([
        {"$match": live_tax_match},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$manual_commission", 0]}}}}
    ]).to_list(1)
    manual_commissions = manual_comm_agg[0]["total"] if manual_comm_agg else 0
    
    revenue = revenue_stats[0] if revenue_stats else {"total_price": 0, "total_tax": 0, "total_commission": 0, "total_shopper_tax": 0, "total_revenue": 0, "purchase_count": 0}
    shipping = shipping_stats[0] if shipping_stats else {"total_shipping": 0, "total_weight": 0, "shipment_count": 0}
    deposits = deposits_stats[0] if deposits_stats else {"total_deposits": 0, "deposit_count": 0}
    wallets = wallet_stats[0] if wallet_stats else {"total_balance": 0, "wallet_count": 0}
    
    # Calculate profit (commissions - store invoice taxes = net profit for the business)
    # Note: shopper_taxes (per product) is charged to the CLIENT, not the shopper
    # Only store_invoice_taxes are paid by the shopper and reduce their profit
    gross_profit = revenue["total_commission"] + manual_commissions
    # Net profit = commissions - store invoice taxes (taxes shopper paid at the store)
    net_profit = gross_profit - store_invoice_taxes
    
    return {
        "revenue": {
            "total_product_sales": round(revenue["total_price"], 2),
            "total_tax_collected": round(revenue["total_tax"], 2),
            "total_commissions": round(revenue["total_commission"] + manual_commissions, 2),
            "product_commissions": round(revenue["total_commission"], 2),
            "manual_commissions": round(manual_commissions, 2),
            "total_store_invoice_taxes": round(store_invoice_taxes, 2),
            "net_profit": round(net_profit, 2),
            "total_charged_to_clients": round(revenue["total_revenue"], 2),
            "total_shipping": round(shipping["total_shipping"], 2),
            "gross_profit": round(gross_profit, 2),
            "purchase_count": revenue["purchase_count"],
            "shipment_count": shipping["shipment_count"],
            "total_weight_shipped": round(shipping["total_weight"], 2)
        },
        "wallets": {
            "total_deposits_received": round(deposits["total_deposits"], 2),
            "total_client_balance": round(wallets["total_balance"], 2),
            "client_count": wallets["wallet_count"]
        },
        "sales_by_store": [
            {"name": s["_id"] or "Sin tienda", "ventas": round(s["total_sales"], 2), "comisiones": round(s["total_commission"], 2), "cantidad": s["count"]}
            for s in sales_by_store
        ],
        "sales_by_live": [
            {"name": l.get("title", "N/A"), "store": l.get("store", "N/A"), "ventas": round(l.get("total_sales") or 0, 2), "comisiones": round((l.get("total_commissions") or 0) + (l.get("manual_commission") or 0), 2), "comision_manual": round(l.get("manual_commission") or 0, 2), "taxes_pagados": round(l.get("total_taxes_paid") or 0, 2), "tax_factura": round(l.get("store_invoice_tax") or 0, 2), "compras": l.get("purchase_count") or 0, "status": l.get("status", "inactive")}
            for l in sales_by_live
        ],
        "sales_trend": [
            {"date": d["_id"], "ventas": round(d["sales"], 2), "comisiones": round(d["commissions"], 2), "cantidad": d["count"]}
            for d in sales_by_date
        ]
    }

@api_router.get("/admin/reports/clients-purchases")
async def get_all_clients_purchases_report(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    clients = await db.users.find({"role": "client", "tenant_id": tid}, {"_id": 0, "password_hash": 0}).to_list(20000)
    
    if not clients:
        return []
    
    # Batch fetch all related data
    user_ids = [c["id"] for c in clients]
    
    # Fetch all wallets at once
    wallets_list = await db.wallets.find({"user_id": {"$in": user_ids}, "tenant_id": tid}, {"_id": 0}).to_list(len(user_ids))
    wallets_dict = {w["user_id"]: w for w in wallets_list}
    
    # Fetch all purchases at once (with limited fields for aggregation, full data separately)
    all_purchases = await db.purchases.find({"user_id": {"$in": user_ids}, "tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(20000)
    purchases_by_user = {}
    for p in all_purchases:
        uid = p["user_id"]
        if uid not in purchases_by_user:
            purchases_by_user[uid] = []
        purchases_by_user[uid].append(p)
    
    # Fetch all shipments at once
    all_shipments = await db.shipments.find({"user_id": {"$in": user_ids}, "tenant_id": tid}, {"_id": 0}).to_list(20000)
    shipments_by_user = {}
    for s in all_shipments:
        uid = s["user_id"]
        if uid not in shipments_by_user:
            shipments_by_user[uid] = []
        shipments_by_user[uid].append(s)
    
    result = []
    for client in clients:
        uid = client["id"]
        wallet = wallets_dict.get(uid)
        wallet_balance = wallet["available"] if wallet else 0
        purchases = purchases_by_user.get(uid, [])
        shipments = shipments_by_user.get(uid, [])
        
        total_purchases = sum(p.get("total", 0) for p in purchases)
        total_commission = sum(p.get("commission", 0) for p in purchases)
        total_shipping = sum(s.get("shipping_cost", 0) for s in shipments)
        total_weight = sum(s.get("weight_pounds", 0) for s in shipments)
        pending_balance = wallet_balance - total_shipping
        
        result.append({
            "client": {
                "id": client["id"], "customer_id": client["customer_id"],
                "name": client["name"], "whatsapp": client["whatsapp"],
                "country": client["country"], "commission_fee": client.get("commission_fee", DEFAULT_COMMISSION_FEE)
            },
            "wallet_balance": round(wallet_balance, 2),
            "purchases": purchases[:500],  # Limit per client for response size
            "shipments": shipments,
            "purchase_count": len(purchases),
            "total_spent": round(total_purchases, 2),
            "total_commission": round(total_commission, 2),
            "total_shipping": round(total_shipping, 2),
            "total_weight_pounds": round(total_weight, 2),
            "pending_balance": round(pending_balance, 2)
        })
    return sorted(result, key=lambda x: x["pending_balance"])

@api_router.get("/admin/reports/all-purchases")
async def get_all_purchases_report(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    purchases = await db.purchases.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(20000)
    
    if not purchases:
        return []
    
    # Batch fetch all users and lives in 2 queries instead of N*2
    user_ids = list(set(p["user_id"] for p in purchases))
    live_ids = list(set(p.get("live_id") for p in purchases if p.get("live_id")))
    
    users_list = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "customer_id": 1}).to_list(len(user_ids))
    users_dict = {u["id"]: u for u in users_list}
    
    lives_list = await db.lives.find({"id": {"$in": live_ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(len(live_ids)) if live_ids else []
    lives_dict = {l["id"]: l["title"] for l in lives_list}
    
    for p in purchases:
        user = users_dict.get(p["user_id"])
        p["client_name"] = user["name"] if user else "Unknown"
        p["live_title"] = lives_dict.get(p.get("live_id"), "N/A")
    return purchases

# ==================== CLIENT DEBTS REPORT ====================

@api_router.get("/admin/reports/invoices-without-shipment")
async def get_invoices_without_shipment(current_user: dict = Depends(get_current_user)):
    """List invoices that don't have an assigned shipment yet, grouped by client.
    Used by the Envíos card on the dashboard to surface invoices that still need
    a shipment created (i.e., shipping cost not yet charged)."""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    # Find invoices in tenant that are not annulled and have neither a shipment_id
    # nor a recorded shipping_cost. shipping_cost > 0 means a shipment was already
    # assigned at some point (covers legacy data where shipment_id was dropped).
    invoices = await db.invoices.find(
        {
            "tenant_id": tid,
            "is_annulled": {"$ne": True},
            "$and": [
                {"$or": [{"shipment_id": None}, {"shipment_id": {"$exists": False}}]},
                {"$or": [{"shipping_cost": 0}, {"shipping_cost": None}, {"shipping_cost": {"$exists": False}}]},
            ],
        },
        {"_id": 0, "id": 1, "invoice_number": 1, "customer_id": 1, "total": 1, "total_a_pagar": 1, "created_at": 1, "status": 1}
    ).sort("created_at", -1).to_list(20000)

    if not invoices:
        return {"clients": [], "invoices_count": 0, "clients_count": 0}

    # Resolve customer names from users collection in one pass
    cust_ids = list({inv.get("customer_id") for inv in invoices if inv.get("customer_id")})
    users = await db.users.find(
        {"customer_id": {"$in": cust_ids}, "tenant_id": tid, "role": "client"},
        {"_id": 0, "customer_id": 1, "name": 1, "whatsapp": 1}
    ).to_list(len(cust_ids) or 1)
    name_map = {u["customer_id"]: u for u in users}

    grouped: dict[str, dict] = {}
    for inv in invoices:
        cid = inv.get("customer_id") or "—"
        if cid not in grouped:
            u = name_map.get(cid, {})
            grouped[cid] = {
                "customer_id": cid,
                "name": u.get("name", ""),
                "whatsapp": u.get("whatsapp", ""),
                "invoices": [],
                "total_pending": 0.0,
            }
        grouped[cid]["invoices"].append({
            "id": inv["id"],
            "invoice_number": inv.get("invoice_number"),
            "total": float(inv.get("total") or 0),
            "total_a_pagar": float(inv.get("total_a_pagar") or 0),
            "created_at": inv.get("created_at"),
            "status": inv.get("status"),
        })
        grouped[cid]["total_pending"] += float(inv.get("total_a_pagar") or 0)

    clients_list = sorted(grouped.values(), key=lambda c: len(c["invoices"]), reverse=True)
    return {
        "clients": clients_list,
        "invoices_count": len(invoices),
        "clients_count": len(clients_list),
    }


@api_router.get("/admin/reports/sales-detail")
async def get_sales_detail(start: str | None = None, end: str | None = None, current_user: dict = Depends(get_current_user)):
    """Sales-detail report for the dashboard "Ventas" card.

    - `buyers`: distinct customers that registered purchases in [start, end].
    - `invoiced_customers`: subset of `buyers` whose purchases are tied to a non-annulled invoice.
    - `pending_customers`: subset of `buyers` whose purchases are NOT yet in any invoice.

    Each list contains `{customer_id, name}`. Counts are returned alongside.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    purchase_match: dict = {"tenant_id": tid}
    if start and end:
        purchase_match["created_at"] = {"$gte": start, "$lte": end}

    # All purchases in the window. Each purchase carries customer_id and
    # an optional invoice_id (set when the purchase was billed).
    purchases = await db.purchases.find(
        purchase_match,
        {"_id": 0, "customer_id": 1, "invoice_id": 1, "id": 1}
    ).to_list(20000)

    # Build sets
    buyers_set: set[str] = set()
    invoiced_set: set[str] = set()
    pending_set: set[str] = set()

    # We also need to ensure invoice is non-annulled. Collect all distinct
    # invoice ids referenced by these purchases, look them up in one pass.
    inv_ids = {p.get("invoice_id") for p in purchases if p.get("invoice_id")}
    annulled_inv_ids: set[str] = set()
    if inv_ids:
        ann_invs = await db.invoices.find(
            {"id": {"$in": list(inv_ids)}, "tenant_id": tid, "is_annulled": True},
            {"_id": 0, "id": 1}
        ).to_list(len(inv_ids))
        annulled_inv_ids = {i["id"] for i in ann_invs}

    for p in purchases:
        cid = (p.get("customer_id") or "").upper()
        if not cid:
            continue
        buyers_set.add(cid)
        inv_id = p.get("invoice_id")
        if inv_id and inv_id not in annulled_inv_ids:
            invoiced_set.add(cid)
        else:
            pending_set.add(cid)

    # "Sin factura" = anyone with AT LEAST ONE unbilled purchase in the window,
    # even if they also have other purchases already billed.
    purely_pending = pending_set

    # Resolve customer names in one query.
    cust_ids = list(buyers_set)
    users = await db.users.find(
        {"customer_id": {"$in": cust_ids}, "tenant_id": tid, "role": "client"},
        {"_id": 0, "customer_id": 1, "name": 1}
    ).to_list(len(cust_ids) or 1)
    name_map = {u["customer_id"].upper(): u.get("name", "") for u in users}

    def to_list(s: set[str]) -> list[dict]:
        return sorted(
            [{"customer_id": cid, "name": name_map.get(cid, "")} for cid in s],
            key=lambda x: (x.get("name") or "").lower() or x["customer_id"],
        )

    return {
        "buyers": to_list(buyers_set),
        "invoiced_customers": to_list(invoiced_set),
        "pending_customers": to_list(purely_pending),
        "buyers_count": len(buyers_set),
        "invoiced_count": len(invoiced_set),
        "pending_count": len(purely_pending),
        "start": start,
        "end": end,
    }


@api_router.get("/admin/reports/clients-debts")
async def get_clients_debts_report(current_user: dict = Depends(get_current_user)):
    """Get detailed report of client debts including creation date and pending balance"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get all clients
    clients = await db.users.find(
        {"role": "client", "tenant_id": tid}, 
        {"_id": 0, "password_hash": 0}
    ).to_list(20000)
    
    if not clients:
        return {"clients": [], "summary": {"total_clients": 0, "clients_with_debt": 0, "total_debt": 0}}
    
    user_ids = [c["id"] for c in clients]
    
    # Batch fetch wallets
    wallets_list = await db.wallets.find(
        {"user_id": {"$in": user_ids}, "tenant_id": tid}, 
        {"_id": 0}
    ).to_list(len(user_ids))
    wallets_dict = {w["user_id"]: w for w in wallets_list}
    
    # Aggregate total purchases per client
    purchases_agg = await db.purchases.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid}},
        {"$group": {
            "_id": "$user_id", 
            "total_spent": {"$sum": "$total"}, 
            "purchase_count": {"$sum": 1}
        }}
    ]).to_list(len(user_ids))
    purchases_dict = {p["_id"]: p for p in purchases_agg}

    # `pending_to_invoice`: purchases that haven't been included in any invoice
    # yet. This is the "real" debt accruing between invoice runs (e.g. mid-week
    # before Friday billing). Surfaced in the UI so admins can see what each
    # client owes BEFORE the next invoice is generated.
    pending_inv_agg = await db.purchases.aggregate([
        {"$match": {
            "user_id": {"$in": user_ids},
            "tenant_id": tid,
            "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}, {"invoice_id": ""}],
        }},
        {"$group": {
            "_id": "$user_id",
            "pending_to_invoice": {"$sum": "$total"},
            "pending_count": {"$sum": 1},
        }}
    ]).to_list(len(user_ids))
    pending_inv_dict = {p["_id"]: p for p in pending_inv_agg}
    
    # Aggregate shipments per client
    shipments_agg = await db.shipments.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid}},
        {"$group": {
            "_id": "$user_id", 
            "total_shipping": {"$sum": "$shipping_cost"},
            "shipment_count": {"$sum": 1}
        }}
    ]).to_list(len(user_ids))
    shipments_dict = {s["_id"]: s for s in shipments_agg}
    
    # Batch fetch: approved deposits total per user (for the "Deuda Real"
    # column = pending invoices − available recargas floating).
    approved_deposits_agg = await db.wallet_transactions.aggregate([
        {"$match": {"tenant_id": tid, "type": "deposit",
                    "status": "approved", "is_deleted": {"$ne": True},
                    "user_id": {"$in": user_ids}}},
        {"$group": {"_id": "$user_id", "total": {"$sum": "$amount"}}}
    ]).to_list(len(user_ids))
    approved_dep_by_uid = {a["_id"]: float(a["total"] or 0) for a in approved_deposits_agg}

    result = []
    total_debt = 0
    clients_with_debt = 0
    total_real_debt = 0.0
    
    # Get saldo_pendiente per customer from invoices
    cust_ids = [c.get("customer_id") for c in clients if c.get("customer_id")]
    saldo_pend_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": cust_ids}, "is_annulled": {"$ne": True}, "saldo_pendiente": {"$gt": 0}}},
        {"$group": {"_id": "$customer_id", "total_saldo": {"$sum": "$saldo_pendiente"}}}
    ]).to_list(len(cust_ids) or 1)
    saldo_pend_dict = {s["_id"]: s["total_saldo"] for s in saldo_pend_agg}

    # Total applied deposits per customer (from invoice.applied_deposits[])
    applied_deposits_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": cust_ids},
                    "is_annulled": {"$ne": True}}},
        {"$unwind": {"path": "$applied_deposits", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$customer_id",
                    "total": {"$sum": "$applied_deposits.amount_applied"}}}
    ]).to_list(len(cust_ids) or 1)
    applied_by_customer = {a["_id"]: float(a["total"] or 0) for a in applied_deposits_agg}

    # Latest non-annulled invoice per customer (date + total_a_pagar + saldo_a_favor).
    # Per the chained-invoice architecture (`recalculate_client_invoices`), the
    # CURRENT financial state of a client lives entirely on their last invoice:
    #   - `saldo_a_favor` > 0  → client has credit (no debt)
    #   - `total_a_pagar` > 0  → client owes that exact amount on the open invoice
    #   - both 0               → al día
    # Older invoices' `saldo_pendiente` is just a historical snapshot of the
    # inherited debt at creation time, it must NOT be re-summed (would double-count).
    last_inv_agg = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "customer_id": {"$in": cust_ids}, "is_annulled": {"$ne": True}}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$customer_id",
            "last_date": {"$first": "$created_at"},
            "last_total_a_pagar": {"$first": "$total_a_pagar"},
            "last_saldo_a_favor": {"$first": "$saldo_a_favor"},
            "last_invoice_number": {"$first": "$invoice_number"},
        }}
    ]).to_list(len(cust_ids) or 1)
    last_inv_dict = {
        x["_id"]: {
            "date": x.get("last_date"),
            "amount": float(x.get("last_total_a_pagar") or 0),
            "saldo_a_favor": float(x.get("last_saldo_a_favor") or 0),
            "number": x.get("last_invoice_number"),
        }
        for x in last_inv_agg
    }
    
    for client in clients:
        uid = client["id"]
        wallet = wallets_dict.get(uid)
        wallet_balance = wallet["available"] if wallet else 0
        
        purch = purchases_dict.get(uid, {"total_spent": 0, "purchase_count": 0})
        ship = shipments_dict.get(uid, {"total_shipping": 0, "shipment_count": 0})
        saldo_ant = saldo_pend_dict.get(client.get("customer_id"), 0)
        last_inv = last_inv_dict.get(client.get("customer_id"))
        last_total_a_pagar = (last_inv or {}).get("amount", 0)
        last_saldo_a_favor = (last_inv or {}).get("saldo_a_favor", 0)

        # `pending_balance`: positive = credit, negative = debt. Mirrors the
        # same calculation used by `/admin/clients` so that the Stats "Deudas"
        # panel never reports fake debt for clients who actually have credit.
        if last_saldo_a_favor > 0:
            pending_balance = round(last_saldo_a_favor, 2)
            debt_amount = 0
        elif last_total_a_pagar > 0:
            pending_balance = round(-last_total_a_pagar, 2)
            debt_amount = round(last_total_a_pagar, 2)
        else:
            pending_balance = 0
            debt_amount = 0
        
        if debt_amount > 0:
            total_debt += debt_amount
            clients_with_debt += 1

        pi = pending_inv_dict.get(uid, {})
        pending_to_invoice = round(float(pi.get("pending_to_invoice", 0) or 0), 2)
        pending_count = int(pi.get("pending_count", 0) or 0)

        # Deuda Real = deuda pendiente de la ÚLTIMA factura menos las
        # recargas disponibles (flotantes). NO usamos Σ saldo_pendiente
        # porque ese valor es un snapshot histórico que se hereda a la
        # siguiente factura vía saldo_a_favor_anterior — sumarlo duplicaría
        # la misma deuda varias veces (bug N25).
        # Positivo → deuda real; Negativo → saldo a favor real.
        approved_dep = approved_dep_by_uid.get(uid, 0)
        applied_dep = applied_by_customer.get(client.get("customer_id"), 0)
        floating_deposits = round(max(0.0, approved_dep - applied_dep), 2)
        real_debt = round(float(last_total_a_pagar or 0)
                          - float(last_saldo_a_favor or 0)
                          - float(floating_deposits or 0), 2)
        if real_debt > 0.01:
            total_real_debt += real_debt

        result.append({
            "id": client["id"],
            "customer_id": client["customer_id"],
            "name": client["name"],
            "whatsapp": client.get("whatsapp", ""),
            "country": client.get("country", ""),
            "created_at": client.get("created_at", ""),
            "wallet_balance": round(wallet_balance, 2),
            "total_spent": round(purch["total_spent"], 2),
            "total_shipping": round(ship["total_shipping"], 2),
            "total_saldo_pendiente": round(saldo_ant, 2),
            "pending_balance": pending_balance,
            "debt_amount": debt_amount,
            # Compras de esta semana aún no facturadas (cobrable antes de viernes).
            "pending_to_invoice": pending_to_invoice,
            "pending_purchases_count": pending_count,
            "floating_deposits": floating_deposits,
            "real_debt": real_debt,
            "purchase_count": purch["purchase_count"],
            "shipment_count": ship["shipment_count"],
            # Per-customer latest invoice info — used by the debts table
            # to show "what is owed on the last invoice" rather than a cumulative figure.
            "last_invoice_date": (last_inv_dict.get(client.get("customer_id")) or {}).get("date"),
            "last_invoice_amount": (last_inv_dict.get(client.get("customer_id")) or {}).get("amount", 0),
            "last_invoice_number": (last_inv_dict.get(client.get("customer_id")) or {}).get("number"),
        })
    
    # Sort by debt amount (highest first), then by pending_balance (most negative first)
    result.sort(key=lambda x: (-x["debt_amount"], x["pending_balance"]))

    total_pending_to_invoice = round(sum(r["pending_to_invoice"] for r in result), 2)
    clients_with_pending = sum(1 for r in result if r["pending_to_invoice"] > 0.01)

    return {
        "clients": result,
        "summary": {
            "total_clients": len(clients),
            "clients_with_debt": clients_with_debt,
            "total_debt": round(total_debt, 2),
            "clients_positive_balance": len(clients) - clients_with_debt,
            "total_pending_to_invoice": total_pending_to_invoice,
            "clients_with_pending_to_invoice": clients_with_pending,
            "total_real_debt": round(total_real_debt, 2),
            "clients_with_real_debt": sum(1 for r in result if r.get("real_debt", 0) > 0.01),
        }
    }


@api_router.get("/admin/reports/collections")
async def get_collections_report(start: Optional[str] = None, end: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Clients who owe (or owed) on an invoice and have been paying, most recent payment first."""
    debts = await get_clients_debts_report(current_user)
    tid = current_user["tenant_id"]
    by_uid = {c["id"]: c for c in debts["clients"]}
    invoices = await db.invoices.find(
        {"tenant_id": tid, "is_annulled": {"$ne": True}},
        {"_id": 0, "customer_id": 1, "created_at": 1, "total_a_pagar": 1, "applied_deposits": 1}
    ).to_list(None)
    deposits = await db.wallet_transactions.find(
        {"tenant_id": tid, "type": "deposit", "status": "approved", "is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "user_id": 1, "amount": 1, "created_at": 1}
    ).to_list(None)
    dep_date = {d["id"]: d.get("created_at") or "" for d in deposits}
    # Earliest invoice per customer that is still owed or got paid after it was issued.
    first_owed = {}
    for inv in invoices:
        created = inv.get("created_at") or ""
        owed = (inv.get("total_a_pagar") or 0) > 0.01 or any(
            dep_date.get(ad.get("deposit_id"), "") > created for ad in (inv.get("applied_deposits") or []))
        cid = inv.get("customer_id")
        if owed and cid and (cid not in first_owed or created < first_owed[cid]):
            first_owed[cid] = created
    deps_by_uid = {}
    for d in deposits:
        deps_by_uid.setdefault(d["user_id"], []).append(d)

    rows = []
    for uid, client in by_uid.items():
        since = first_owed.get(client["customer_id"])
        if since is None:
            continue
        paid = sorted((d for d in deps_by_uid.get(uid, []) if (d.get("created_at") or "") >= since),
                      key=lambda d: d.get("created_at") or "", reverse=True)
        in_period = [d for d in paid if (not start or d["created_at"] >= start) and (not end or d["created_at"] <= end)]
        if not in_period:
            continue
        remaining = round(max(0.0, client.get("real_debt") or 0), 2)
        rows.append({
            "id": uid,
            "customer_id": client["customer_id"],
            "name": client["name"],
            "whatsapp": client.get("whatsapp", ""),
            "remaining": remaining,
            "is_paid": remaining <= 0.01,
            "paid_in_period": round(sum(d.get("amount") or 0 for d in in_period), 2),
            "payments_count": len(in_period),
            "last_payment_at": in_period[0]["created_at"],
            "last_payment_amount": round(in_period[0].get("amount") or 0, 2),
            "payments": [{"amount": round(d.get("amount") or 0, 2), "created_at": d["created_at"]} for d in in_period[:20]],
            "last_invoice_number": client.get("last_invoice_number"),
        })
    rows.sort(key=lambda r: r["last_payment_at"], reverse=True)
    return {
        "clients": rows,
        "totals": {
            "clients_count": len(rows),
            "total_paid": round(sum(r["paid_in_period"] for r in rows), 2),
            "total_remaining": round(sum(r["remaining"] for r in rows), 2),
            "paid_off_count": sum(1 for r in rows if r["is_paid"]),
        },
    }


@api_router.get("/admin/reports/purchases-without-tax")
async def get_purchases_without_tax(current_user: dict = Depends(get_current_user)):
    """Lists purchases where tax was NOT applied (apply_tax=false or tax=0).

    Used by the "Auditoría de Tax" panel so the admin can quickly find items
    that slipped through without tax and fix them in place.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    # A purchase is considered "sin tax" ONLY when the resulting tax charged
    # was zero. That covers both intentional (apply_tax=false) and accidental
    # (tax_rate=0) cases. Purchases with a real positive `tax` are treated as
    # correctly taxed even if their `tax_rate` field is missing (legacy data).
    query = {
        "tenant_id": tid,
        "$or": [
            {"apply_tax": False},
            {"tax": 0},
            {"tax": 0.0},
            {"tax": {"$exists": False}},
            {"tax": None},
        ],
    }
    purchases = await db.purchases.find(query, {"_id": 0}).sort("created_at", -1).to_list(20000)
    if not purchases:
        return {"purchases": [], "summary": {"total_purchases": 0, "total_amount": 0.0, "total_tax_lost": 0.0}}

    # Enrich with client name + live title using batched lookups (avoids N+1).
    user_ids = list({p.get("user_id") for p in purchases if p.get("user_id")})
    live_ids = list({p.get("live_id") for p in purchases if p.get("live_id")})
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "customer_id": 1}).to_list(len(user_ids) or 1)
    user_map = {u["id"]: u for u in users}
    lives = await db.lives.find({"id": {"$in": live_ids}}, {"_id": 0, "id": 1, "title": 1, "store": 1}).to_list(len(live_ids) or 1)
    live_map = {liv["id"]: liv for liv in lives}

    # Default tax rate: use tenant-configured value when present, fallback to
    # the historical Illinois 8.25% constant so the "tax lost" estimation is
    # sensible.
    tenant_doc = await db.tenants.find_one({"id": tid}, {"_id": 0, "default_tax_rate": 1})
    default_rate = float((tenant_doc or {}).get("default_tax_rate") or ILLINOIS_TAX_RATE)

    result = []
    total_amount = 0.0
    total_tax_lost = 0.0
    for p in purchases:
        u = user_map.get(p.get("user_id")) or {}
        liv = live_map.get(p.get("live_id")) or {}
        price = float(p.get("price") or 0)
        would_be_tax = round(price * default_rate, 2)
        total_amount += price
        total_tax_lost += would_be_tax
        result.append({
            "id": p.get("id"),
            "item_name": p.get("item_name"),
            "store": p.get("store"),
            "price": price,
            "tax": float(p.get("tax") or 0),
            "tax_rate": float(p.get("tax_rate") or 0),
            "apply_tax": bool(p.get("apply_tax", False)),
            "commission": float(p.get("commission") or 0),
            "apply_commission": bool(p.get("apply_commission", True)),
            "total": float(p.get("total") or 0),
            "would_be_tax": would_be_tax,  # Estimación de lo que se dejó de cobrar.
            "customer_id": p.get("customer_id") or u.get("customer_id"),
            "customer_name": u.get("name") or "—",
            "live_id": p.get("live_id"),
            "live_title": liv.get("title") or "Sin live",
            "invoice_id": p.get("invoice_id") or None,
            "created_at": p.get("created_at"),
        })

    return {
        "purchases": result,
        "summary": {
            "total_purchases": len(result),
            "total_amount": round(total_amount, 2),
            "total_tax_lost": round(total_tax_lost, 2),
            "default_tax_rate": default_rate,
        },
    }


@api_router.get("/admin/reports/inactive-clients")
async def get_inactive_clients_report(current_user: dict = Depends(get_current_user)):
    """Lists clients ranked by how long they have been inactive (no purchases).

    For each active client returns: last_purchase_date, days_since_last_purchase,
    total_purchase_count, total_spent. Clients with zero purchases are included
    with `days_since_last_purchase = null` (treated as "never purchased") so the
    admin can also follow up on cold leads. The frontend applies the
    "days threshold" filter (30/60/90/180/365).
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    clients = await db.users.find(
        {"role": "client", "tenant_id": tid, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "customer_id": 1, "name": 1, "whatsapp": 1, "country": 1, "created_at": 1}
    ).to_list(20000)

    if not clients:
        return {"clients": [], "summary": {"total_clients": 0, "inactive_30d": 0, "inactive_60d": 0, "inactive_90d": 0, "inactive_180d": 0, "never_purchased": 0}}

    user_ids = [c["id"] for c in clients]

    # Last purchase + counts per client (single aggregation = fast even with
    # thousands of purchases).
    purchases_agg = await db.purchases.aggregate([
        {"$match": {"user_id": {"$in": user_ids}, "tenant_id": tid}},
        {"$group": {
            "_id": "$user_id",
            "last_purchase_at": {"$max": "$created_at"},
            "purchase_count": {"$sum": 1},
            "total_spent": {"$sum": "$total"},
        }}
    ]).to_list(len(user_ids))
    purchases_dict = {p["_id"]: p for p in purchases_agg}

    # Pending-to-invoice per client (uninvoiced purchases). Showing this in the
    # Inactivos panel is critical: an inactive client who STILL has pending
    # purchases is the most urgent to follow up.
    pending_inv_agg = await db.purchases.aggregate([
        {"$match": {
            "user_id": {"$in": user_ids},
            "tenant_id": tid,
            "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}, {"invoice_id": ""}],
        }},
        {"$group": {"_id": "$user_id", "pending_to_invoice": {"$sum": "$total"}}}
    ]).to_list(len(user_ids))
    pending_inv_dict = {p["_id"]: p["pending_to_invoice"] for p in pending_inv_agg}

    now = datetime.now(timezone.utc)
    result = []
    bucket_30 = bucket_60 = bucket_90 = bucket_180 = never = 0

    for c in clients:
        p = purchases_dict.get(c["id"])
        last_at = p.get("last_purchase_at") if p else None
        days = None
        if last_at:
            try:
                last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                days = max(0, (now - last_dt).days)
            except Exception:
                days = None

        if days is None:
            never += 1
        else:
            if days >= 30: bucket_30 += 1
            if days >= 60: bucket_60 += 1
            if days >= 90: bucket_90 += 1
            if days >= 180: bucket_180 += 1

        result.append({
            "id": c["id"],
            "customer_id": c.get("customer_id"),
            "name": c.get("name"),
            "whatsapp": c.get("whatsapp", ""),
            "country": c.get("country", ""),
            "registered_at": c.get("created_at"),
            "last_purchase_at": last_at,
            "days_since_last_purchase": days,
            "purchase_count": int((p or {}).get("purchase_count", 0)),
            "total_spent": round(float((p or {}).get("total_spent", 0) or 0), 2),
            "pending_to_invoice": round(float(pending_inv_dict.get(c["id"], 0) or 0), 2),
        })

    # Sort: most-inactive first; clients without any purchase appear at the very
    # bottom by default (so they don't dominate the top of the table).
    result.sort(key=lambda x: (x["days_since_last_purchase"] is None, -(x["days_since_last_purchase"] or 0)))

    return {
        "clients": result,
        "summary": {
            "total_clients": len(clients),
            "inactive_30d": bucket_30,
            "inactive_60d": bucket_60,
            "inactive_90d": bucket_90,
            "inactive_180d": bucket_180,
            "never_purchased": never,
        }
    }

@api_router.get("/admin/reports/store-profits")
async def get_store_profits_report(current_user: dict = Depends(get_current_user)):
    """Get profit report by store from completed lives"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get all completed lives with store invoice data
    lives = await db.lives.find(
        {"tenant_id": tid, "status": "completed"},
        {"_id": 0}
    ).sort("ended_at", -1).to_list(20000)
    
    store_profits = []
    total_sales = 0
    total_store_cost = 0
    total_profit = 0
    total_commissions = 0
    total_manual_commissions = 0
    
    for live in lives:
        store_amount = live.get("store_invoice_amount")
        store_image = live.get("store_invoice_image")
        live_total = live.get("total_sales", 0)
        live_commissions = live.get("total_commissions", 0)
        manual_commission = live.get("manual_commission", 0) or 0
        manual_commission_note = live.get("manual_commission_note", "")
        
        # Calculate profit if store amount exists
        profit = None
        if store_amount is not None:
            profit = live_total - store_amount + manual_commission
            total_store_cost += store_amount
            total_profit += profit
        else:
            # If no store invoice, still count manual commission as profit
            total_profit += manual_commission
        
        total_sales += live_total
        total_commissions += live_commissions
        total_manual_commissions += manual_commission
        
        store_profits.append({
            "live_id": live["id"],
            "live_title": live.get("title", "Sin título"),
            "store": live.get("store", "Sin tienda"),
            "date": live.get("ended_at") or live.get("started_at") or live.get("created_at"),
            "total_sales": round(live_total, 2),
            "total_commissions": round(live_commissions, 2),
            "purchase_count": live.get("purchase_count", 0),
            "store_invoice_amount": round(store_amount, 2) if store_amount else None,
            "store_invoice_image": store_image,
            "profit": round(profit, 2) if profit is not None else None,
            "profit_margin": round((profit / live_total * 100), 1) if profit is not None and live_total > 0 else None,
            "manual_commission": round(manual_commission, 2),
            "manual_commission_note": manual_commission_note
        })
    
    return {
        "stores": store_profits,
        "summary": {
            "total_lives": len(lives),
            "lives_with_invoice": len([l for l in store_profits if l["store_invoice_amount"] is not None]),
            "total_sales": round(total_sales, 2),
            "total_store_cost": round(total_store_cost, 2),
            "total_profit": round(total_profit, 2),
            "total_commissions": round(total_commissions, 2),
            "total_manual_commissions": round(total_manual_commissions, 2),
            "avg_profit_margin": round((total_profit / total_store_cost * 100), 1) if total_store_cost > 0 else 0
        }
    }

# ==================== SETTINGS ====================

@api_router.get("/admin/settings/referral-bonus")
async def get_referral_bonus_setting(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    bonus = await get_referral_bonus(current_user["tenant_id"])
    return {"referral_bonus": bonus}

@api_router.put("/admin/settings/referral-bonus")
async def set_referral_bonus_setting(amount: float, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if amount < 0:
        raise HTTPException(status_code=400, detail="El bono no puede ser negativo")
    tid = current_user["tenant_id"]
    await db.settings.update_one({"key": "referral_bonus", "tenant_id": tid},
        {"$set": {"key": "referral_bonus", "tenant_id": tid, "value": amount}}, upsert=True)
    return {"message": f"Bono de referido actualizado a ${amount:.2f}", "referral_bonus": amount}

@api_router.get("/admin/settings")
async def get_tenant_settings(current_user: dict = Depends(get_current_user)):
    """Get all tenant settings including tax options and client ID settings"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0})
    default_tax_options = [
        {"value": "8.25", "label": "8.25%"},
        {"value": "10", "label": "10%"},
        {"value": "15", "label": "15%"},
        {"value": "0", "label": "Sin Taxes"},
        {"value": "other", "label": "Otro"}
    ]
    return {
        "tax_options": tenant.get("tax_options", default_tax_options) if tenant else default_tax_options,
        "referral_bonus": await get_referral_bonus(tid),
        "allow_custom_client_id": tenant.get("allow_custom_client_id", False) if tenant else False,
        "shipment_show_product_list": tenant.get("shipment_show_product_list", True) if tenant else True,
        "invoice_show_tax_per_item": tenant.get("invoice_show_tax_per_item", True) if tenant else True,
        "invoice_show_tax_summary": tenant.get("invoice_show_tax_summary", True) if tenant else True
    }

@api_router.put("/admin/settings/tax-options")
async def update_tenant_tax_options(data: dict, current_user: dict = Depends(get_current_user)):
    """Update tax options for the tenant"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    tax_options = data.get("tax_options", [])
    if not tax_options:
        raise HTTPException(status_code=400, detail="Se requieren opciones de impuestos")
    await db.tenants.update_one({"id": tid}, {"$set": {"tax_options": tax_options}})
    return {"message": "Opciones de impuestos actualizadas", "tax_options": tax_options}

@api_router.get("/admin/referrals")
async def get_referral_stats(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    top_referrers = await db.users.find({"referral_count": {"$gt": 0}, "tenant_id": tid},
        {"_id": 0, "customer_id": 1, "name": 1, "referral_count": 1}).sort("referral_count", -1).limit(20).to_list(20)
    referral_bonuses = await db.wallet_transactions.aggregate([
        {"$match": {"type": "referral_bonus", "tenant_id": tid}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    return {"top_referrers": top_referrers, "total_bonus_paid": referral_bonuses[0]["total"] if referral_bonuses else 0,
        "current_bonus": await get_referral_bonus(tid)}

# ==================== TEMPORARY ACCESS TOKENS ====================

@api_router.post("/auth/generate-access-token")
async def generate_temporary_access_token(data: dict, current_user: dict = Depends(get_current_user)):
    """Generate a temporary access token for QR code access to client dashboard"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    customer_id = data.get("customer_id")
    invoice_id = data.get("invoice_id")
    
    if not customer_id:
        raise HTTPException(status_code=400, detail="customer_id es requerido")
    
    tid = current_user["tenant_id"]
    
    # Find the user
    user = await db.users.find_one({"customer_id": customer_id, "tenant_id": tid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    # Create temporary token
    token_data = TemporaryAccessToken(
        tenant_id=tid,
        user_id=user["id"],
        customer_id=customer_id,
        invoice_id=invoice_id
    )
    
    await db.temp_access_tokens.insert_one(token_data.model_dump())
    
    return {"token": token_data.token, "expires_at": token_data.expires_at}

@api_router.get("/auth/verify-access-token/{token}")
async def verify_temporary_access_token(token: str):
    """Verify and use a temporary access token - returns JWT for client dashboard access"""
    
    # Find the token
    token_doc = await db.temp_access_tokens.find_one({"token": token}, {"_id": 0})
    
    if not token_doc:
        raise HTTPException(status_code=404, detail="Token inválido o expirado")
    
    # Check if already used - but allow grace period of 30 seconds for duplicate requests
    if token_doc.get("used"):
        used_at = token_doc.get("used_at")
        if used_at:
            used_time = datetime.fromisoformat(used_at.replace("Z", "+00:00"))
            grace_period = timedelta(seconds=30)
            if datetime.now(timezone.utc) - used_time > grace_period:
                raise HTTPException(status_code=400, detail="Este enlace ya fue utilizado")
            # Within grace period - allow the request but don't update anything
        else:
            raise HTTPException(status_code=400, detail="Este enlace ya fue utilizado")
    else:
        # Mark as used (first time)
        await db.temp_access_tokens.update_one(
            {"token": token},
            {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}}
        )
    
    # Check expiration
    expires_at = datetime.fromisoformat(token_doc["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=400, detail="Este enlace ha expirado")
    
    # Get user and tenant info
    user = await db.users.find_one({"id": token_doc["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    tenant = await db.tenants.find_one({"id": token_doc["tenant_id"]}, {"_id": 0})
    
    # Generate JWT token for the client
    jwt_token = create_token(user["id"], user["role"], token_doc["tenant_id"])
    
    return {
        "token": jwt_token,
        "user_id": user["id"],
        "customer_id": user["customer_id"],
        "name": user["name"],
        "role": user["role"],
        "tenant_id": token_doc["tenant_id"],
        "tenant_name": tenant["business_name"] if tenant else None,
        "tenant_logo": tenant.get("logo_url") if tenant else None,
        "invoice_id": token_doc.get("invoice_id"),
        "message": "Acceso temporal verificado"
    }

# ==================== EMPLOYEE MANAGEMENT ====================

@api_router.get("/admin/employees")
async def get_employees(current_user: dict = Depends(get_current_user)):
    """Get all employees for the tenant"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    employees = await db.employees.find({"tenant_id": tid}, {"_id": 0}).to_list(20000)
    return employees

@api_router.post("/admin/employees")
async def create_employee(data: EmployeeCreate, current_user: dict = Depends(get_current_user)):
    """Create a new employee"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Check if email already exists
    existing = await db.employees.find_one({"email": data.email, "tenant_id": tid}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un empleado con este email")
    
    # Also check in users collection
    existing_user = await db.users.find_one({"email": data.email, "tenant_id": tid}, {"_id": 0})
    if existing_user:
        raise HTTPException(status_code=400, detail="Ya existe un usuario con este email")
    
    # Generate username from name if not provided
    username = data.username.strip() if data.username else data.name.lower().replace(" ", "_")
    
    # Check if username already exists
    existing_username = await db.employees.find_one({"username": username, "tenant_id": tid}, {"_id": 0})
    if existing_username:
        raise HTTPException(status_code=400, detail="Ya existe un empleado con este nombre de usuario")
    
    # Create permissions object
    permissions = EmployeePermissions(**data.permissions)
    
    employee = Employee(
        tenant_id=tid,
        name=data.name,
        username=username,
        email=data.email,
        whatsapp=data.whatsapp,
        password_plain=data.password,  # Store plain text for admin viewing
        password_hash=hash_password(data.password),
        permissions=permissions,
        created_by=current_user["user_id"]
    )
    
    await db.employees.insert_one(employee.model_dump())
    
    # Get admin name for audit
    admin = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    admin_name = admin["name"] if admin else "Admin"
    
    # Log audit
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=admin_name,
        user_role="admin",
        action="create_employee",
        entity_type="employee",
        entity_id=employee.id,
        entity_name=data.name,
        details={"email": data.email, "username": username, "permissions": data.permissions}
    )
    
    return {"message": "Empleado creado exitosamente", "employee_id": employee.id, "username": username}

@api_router.get("/admin/employees/{employee_id}")
async def get_employee(employee_id: str, current_user: dict = Depends(get_current_user)):
    """Get employee details including password"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    employee = await db.employees.find_one({"id": employee_id, "tenant_id": tid}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    
    return employee

@api_router.put("/admin/employees/{employee_id}")
async def update_employee(employee_id: str, data: EmployeeUpdate, current_user: dict = Depends(get_current_user)):
    """Update employee information"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    employee = await db.employees.find_one({"id": employee_id, "tenant_id": tid}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    changes = {}
    
    if data.name is not None:
        update_data["name"] = data.name
        changes["name"] = data.name
    if data.email is not None:
        # Check if new email is already in use
        existing = await db.employees.find_one({
            "email": data.email, 
            "tenant_id": tid, 
            "id": {"$ne": employee_id}
        }, {"_id": 0})
        if existing:
            raise HTTPException(status_code=400, detail="Email ya está en uso")
        update_data["email"] = data.email
        changes["email"] = data.email
    if data.whatsapp is not None:
        update_data["whatsapp"] = data.whatsapp
        changes["whatsapp"] = data.whatsapp
    if data.password is not None:
        update_data["password_plain"] = data.password
        update_data["password_hash"] = hash_password(data.password)
        changes["password"] = "***changed***"
    if data.permissions is not None:
        update_data["permissions"] = data.permissions
        changes["permissions"] = data.permissions
    if data.status is not None:
        update_data["status"] = data.status
        changes["status"] = data.status
    
    await db.employees.update_one({"id": employee_id}, {"$set": update_data})
    
    # Get admin name for audit
    admin = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    admin_name = admin["name"] if admin else "Admin"
    
    # Log audit
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=admin_name,
        user_role="admin",
        action="update_employee",
        entity_type="employee",
        entity_id=employee_id,
        entity_name=employee["name"],
        details=changes
    )
    
    return {"message": "Empleado actualizado exitosamente"}

@api_router.delete("/admin/employees/{employee_id}")
async def delete_employee(employee_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an employee"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    employee = await db.employees.find_one({"id": employee_id, "tenant_id": tid}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    
    await db.employees.delete_one({"id": employee_id})
    
    # Get admin name for audit
    admin = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    admin_name = admin["name"] if admin else "Admin"
    
    # Log audit
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=admin_name,
        user_role="admin",
        action="delete_employee",
        entity_type="employee",
        entity_id=employee_id,
        entity_name=employee["name"]
    )
    
    return {"message": "Empleado eliminado exitosamente"}

# ==================== AUDIT LOG ====================

@api_router.get("/admin/audit-logs")
async def get_audit_logs(
    current_user: dict = Depends(get_current_user),
    user_id: str = None,
    action: str = None,
    entity_type: str = None,
    start_date: str = None,
    end_date: str = None,
    limit: int = 100,
    skip: int = 0
):
    """Get audit logs with filtering options"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    query = {"tenant_id": tid}
    # Login events are intentionally hidden from the audit feed — they create noise
    # and are not actionable. They remain stored in the DB for forensic forensics
    # purposes but are filtered out at the API level.
    query["action"] = {"$ne": "login"}
    
    if user_id:
        query["user_id"] = user_id
    if action:
        # Allow explicit filter to override the global login exclusion only when needed.
        query["action"] = action
    if entity_type:
        query["entity_type"] = entity_type
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    total = await db.audit_logs.count_documents(query)
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    return {
        "total": total,
        "logs": logs,
        "limit": limit,
        "skip": skip
    }

@api_router.get("/admin/audit-logs/users")
async def get_audit_users(current_user: dict = Depends(get_current_user)):
    """Get list of users who have audit logs"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]
    
    # Get unique users from audit logs
    pipeline = [
        {"$match": {"tenant_id": tid}},
        {"$group": {
            "_id": {"user_id": "$user_id", "user_name": "$user_name", "user_role": "$user_role"}
        }},
        {"$project": {
            "_id": 0,
            "user_id": "$_id.user_id",
            "user_name": "$_id.user_name",
            "user_role": "$_id.user_role"
        }}
    ]
    users = await db.audit_logs.aggregate(pipeline).to_list(20000)
    return users

@api_router.get("/admin/audit-logs/actions")
async def get_audit_actions(current_user: dict = Depends(get_current_user)):
    """Get list of action types"""
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    # Return predefined action types (excluding "login" which is hidden from the feed)
    return [
        {"value": "create_client", "label": "Crear cliente"},
        {"value": "update_client", "label": "Editar cliente"},
        {"value": "delete_client", "label": "Eliminar cliente"},
        {"value": "create_purchase", "label": "Crear compra"},
        {"value": "update_purchase", "label": "Editar compra"},
        {"value": "invoice_totals_updated", "label": "Total de factura actualizado"},
        {"value": "delete_purchase", "label": "Eliminar compra"},
        {"value": "approve_recharge", "label": "Aprobar recarga"},
        {"value": "reject_recharge", "label": "Rechazar recarga"},
        {"value": "delete_recharge", "label": "Eliminar recarga"},
        {"value": "adjust_wallet", "label": "Ajustar saldo"},
        {"value": "create_recharge", "label": "Crear recarga"},
        {"value": "create_shipment", "label": "Crear envío"},
        {"value": "update_shipment", "label": "Editar envío"},
        {"value": "delete_shipment", "label": "Eliminar envío"},
        {"value": "create_invoice", "label": "Crear factura"},
        {"value": "approve_invoice", "label": "Aprobar factura"},
        {"value": "reopen_invoice", "label": "Reabrir factura"},
        {"value": "invoice_annulled", "label": "Anular factura"},
        {"value": "create_live", "label": "Crear live"},
        {"value": "start_live", "label": "Iniciar live"},
        {"value": "end_live", "label": "Finalizar live"},
        {"value": "create_employee", "label": "Crear empleado"},
        {"value": "update_employee", "label": "Editar empleado"},
        {"value": "delete_employee", "label": "Eliminar empleado"}
    ]

# ==================== HEALTH ====================

@api_router.get("/admin/audit-logs/history")
async def get_audit_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    """Aggregated 'last N days' history for sensitive actions:
    - Productos eliminados (with full client/store/live snapshot when available)
    - Facturas anuladas
    - Recargas aprobadas

    For deletions logged BEFORE the audit-rich version of `delete_purchase` was
    deployed, we fall back to the auto-created refund wallet_transaction so the
    user can still see "what was deleted yesterday" (cliente + ítem + monto).
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    days = max(1, min(int(days or 7), 90))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # 1) Audit-tracked deletions (rich data: store + live)
    audit_deletes_raw = await db.audit_logs.find(
        {"tenant_id": tid, "action": "delete_purchase", "created_at": {"$gte": since}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)

    deleted_purchases = []
    seen_purchase_ids = set()
    for log in audit_deletes_raw:
        det = log.get("details") or {}
        seen_purchase_ids.add(log.get("entity_id"))
        deleted_purchases.append({
            "audit_log_id": log.get("id"),
            "restored": bool(log.get("restored")),
            "source": "audit",
            "deleted_at": log.get("created_at"),
            "deleted_by": log.get("user_name"),
            "item_name": det.get("item_name") or log.get("entity_name"),
            "store": det.get("store"),
            "live_title": det.get("live_title"),
            "customer_id": det.get("customer_id"),
            "customer_name": det.get("customer_name"),
            "total": det.get("total"),
        })

    # 2) Legacy fallback — refund wallet transactions auto-created by delete_purchase.
    # Description format: "Reembolso: {item_name} eliminado".
    refund_txs = await db.wallet_transactions.find(
        {"tenant_id": tid, "type": "refund",
         "description": {"$regex": "^Reembolso:.*eliminado", "$options": "i"},
         "created_at": {"$gte": since}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)

    # Build customer_id -> name lookup once.
    cust_ids = list({tx.get("customer_id") for tx in refund_txs if tx.get("customer_id")})
    cust_lookup = {}
    if cust_ids:
        cust_docs = await db.users.find(
            {"customer_id": {"$in": cust_ids}, "tenant_id": tid},
            {"_id": 0, "customer_id": 1, "name": 1}
        ).to_list(len(cust_ids))
        cust_lookup = {c["customer_id"]: c.get("name") for c in cust_docs}

    for tx in refund_txs:
        # Skip if we already have an audit log entry that covers this delete.
        # We can't directly correlate by id, but if a refund's created_at is within
        # 5 seconds of an audit log we trust the audit log instead.
        tx_time = tx.get("created_at", "")
        is_dupe = False
        for d in deleted_purchases:
            if d["source"] != "audit": continue
            if d.get("customer_id") != tx.get("customer_id"): continue
            if d.get("total") != tx.get("amount"): continue
            try:
                t1 = datetime.fromisoformat(tx_time.replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(d["deleted_at"].replace("Z", "+00:00"))
                if abs((t1 - t2).total_seconds()) <= 10:
                    is_dupe = True
                    break
            except Exception:
                pass
        if is_dupe:
            continue
        # Extract item name from description
        desc = tx.get("description") or ""
        item_name = desc.replace("Reembolso:", "").replace("eliminado", "").strip()
        deleted_purchases.append({
            "audit_log_id": None,
            "restored": False,
            "source": "refund",  # legacy fallback (no store/live info)
            "deleted_at": tx_time,
            "deleted_by": None,
            "item_name": item_name or "(sin nombre)",
            "store": None,
            "live_title": None,
            "customer_id": tx.get("customer_id"),
            "customer_name": cust_lookup.get(tx.get("customer_id")),
            "total": tx.get("amount"),
        })

    # Sort all deletions desc by date
    deleted_purchases.sort(key=lambda x: x.get("deleted_at") or "", reverse=True)

    # 3) Annulled invoices
    annulled_logs = await db.audit_logs.find(
        {"tenant_id": tid, "action": "invoice_annulled", "created_at": {"$gte": since}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)
    annulled_invoices = []
    for log in annulled_logs:
        # Pull invoice for customer info if we still have it
        inv = await db.invoices.find_one(
            {"id": log.get("entity_id"), "tenant_id": tid},
            {"_id": 0, "invoice_number": 1, "customer_id": 1, "total": 1, "total_a_pagar": 1}
        )
        cust_name = None
        if inv and inv.get("customer_id"):
            cust = await db.users.find_one(
                {"customer_id": inv["customer_id"], "tenant_id": tid},
                {"_id": 0, "name": 1}
            )
            cust_name = (cust or {}).get("name")
        annulled_invoices.append({
            "annulled_at": log.get("created_at"),
            "annulled_by": log.get("user_name"),
            "invoice_id": log.get("entity_id"),
            "invoice_number": (inv or {}).get("invoice_number"),
            "customer_id": (inv or {}).get("customer_id"),
            "customer_name": cust_name,
            "total": (inv or {}).get("total"),
        })

    # 4) Approved recharges (from wallet_transactions to be exhaustive — audit may
    # have started later, but wallet_transactions are always created on approve).
    approved_recharges_raw = await db.wallet_transactions.find(
        {"tenant_id": tid,
         "type": {"$in": ["deposit", "initial_balance", "referral_bonus"]},
         "status": "approved",
         "is_deleted": {"$ne": True},
         "approved_at": {"$gte": since}},
        {"_id": 0}
    ).sort("approved_at", -1).to_list(20000)

    rc_cust_ids = list({tx.get("customer_id") for tx in approved_recharges_raw if tx.get("customer_id")})
    rc_cust_lookup = {}
    if rc_cust_ids:
        cust_docs = await db.users.find(
            {"customer_id": {"$in": rc_cust_ids}, "tenant_id": tid},
            {"_id": 0, "customer_id": 1, "name": 1}
        ).to_list(len(rc_cust_ids))
        rc_cust_lookup = {c["customer_id"]: c.get("name") for c in cust_docs}

    approved_recharges = [{
        "approved_at": tx.get("approved_at") or tx.get("created_at"),
        "customer_id": tx.get("customer_id"),
        "customer_name": rc_cust_lookup.get(tx.get("customer_id")),
        "amount": tx.get("amount"),
        "description": tx.get("description"),
        "type": tx.get("type"),
    } for tx in approved_recharges_raw]

    return {
        "since": since,
        "days": days,
        "deleted_purchases": deleted_purchases,
        "annulled_invoices": annulled_invoices,
        "approved_recharges": approved_recharges,
    }


@api_router.post("/admin/audit-logs/restore-purchase/{audit_log_id}")
async def restore_deleted_purchase(audit_log_id: str, current_user: dict = Depends(get_current_user)):
    """Restore a previously-deleted purchase from its audit-log snapshot.

    Steps:
    1) Look up the audit log (must be action=delete_purchase, same tenant).
    2) Refuse if no rich snapshot, already restored, or purchase already exists.
    3) Recreate the purchase document from the snapshot.
    4) Reverse the auto-created refund wallet_transaction (soft-delete) so the
       client's wallet returns to its pre-delete state.
    5) Mark the original audit log as restored, and log a new `restore_purchase`
       action for traceability.
    6) Trigger client invoice recalculation if the restored purchase was linked
       to an invoice.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    log = await db.audit_logs.find_one(
        {"id": audit_log_id, "tenant_id": tid, "action": "delete_purchase"},
        {"_id": 0}
    )
    if not log:
        raise HTTPException(status_code=404, detail="Registro de eliminación no encontrado")
    if log.get("restored"):
        raise HTTPException(status_code=400, detail="Esta eliminación ya fue restaurada")

    details = log.get("details") or {}
    purchase_id = log.get("entity_id")
    if not purchase_id or not details.get("item_name") or details.get("total") is None:
        raise HTTPException(status_code=400, detail="No hay suficiente información para restaurar este producto")

    existing = await db.purchases.find_one({"id": purchase_id, "tenant_id": tid}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="El producto ya existe en el sistema")

    # Resolve user_id from customer_id when needed.
    customer_id = details.get("customer_id")
    user_doc = await db.users.find_one(
        {"customer_id": customer_id, "tenant_id": tid, "role": "client"},
        {"_id": 0, "id": 1}
    ) if customer_id else None
    if not user_doc:
        raise HTTPException(status_code=400, detail="El cliente original ya no existe — no se puede restaurar")

    # Recreate the purchase row with original id and snapshot fields.
    restored_purchase = {
        "id": purchase_id,
        "tenant_id": tid,
        "user_id": user_doc["id"],
        "customer_id": customer_id,
        "live_id": details.get("live_id"),
        "item_name": details.get("item_name"),
        "store": details.get("store"),
        "price": details.get("price") or 0,
        "tax": details.get("tax") or 0,
        "commission": details.get("commission") or 0,
        "total": details.get("total") or 0,
        "invoice_id": details.get("invoice_id"),
        "created_at": details.get("purchase_created_at") or datetime.now(timezone.utc).isoformat(),
        "restored_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.purchases.insert_one(restored_purchase)

    # Re-credit the live totals that delete_purchase decremented.
    if restored_purchase.get("live_id"):
        await db.lives.update_one(
            {"id": restored_purchase["live_id"], "tenant_id": tid},
            {"$inc": {
                "total_sales": float(details.get("price") or 0) + float(details.get("tax") or 0),
                "total_commissions": float(details.get("commission") or 0),
                "purchase_count": 1,
            }}
        )

    # Reverse the refund wallet_transaction (auto-created on delete_purchase).
    # We match by tenant + user + amount + type=refund + customer_id, latest one.
    refund_query = {
        "tenant_id": tid,
        "user_id": user_doc["id"],
        "type": "refund",
        "amount": details.get("total"),
        "is_deleted": {"$ne": True},
    }
    refund_tx = await db.wallet_transactions.find_one(refund_query, sort=[("created_at", -1)])
    if refund_tx:
        # Subtract the refunded amount back from the wallet and mark refund as deleted.
        await db.wallet_transactions.update_one(
            {"id": refund_tx["id"], "tenant_id": tid},
            {"$set": {"is_deleted": True, "deleted_reason": f"Restauración de producto (audit_log {audit_log_id})", "deleted_at": datetime.now(timezone.utc).isoformat()}}
        )
        # Adjust wallet `available` (the schema field used by delete_purchase).
        await db.wallets.update_one(
            {"user_id": user_doc["id"], "tenant_id": tid},
            {"$inc": {"available": -float(refund_tx["amount"])},
             "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )

    # Mark the original audit log as restored so the UI can hide the button next time.
    await db.audit_logs.update_one(
        {"id": audit_log_id, "tenant_id": tid},
        {"$set": {"restored": True, "restored_at": datetime.now(timezone.utc).isoformat(), "restored_by": current_user["user_id"]}}
    )

    # Log the restore action.
    actor = await db.users.find_one({"id": current_user["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "email": 1, "role": 1})
    if not actor:
        actor = await db.employees.find_one({"id": current_user["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "email": 1})
    actor_name = (actor or {}).get("name") or (actor or {}).get("email") or "—"
    actor_role = (actor or {}).get("role") or current_user.get("role")
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor_name,
        user_role=actor_role,
        action="restore_purchase",
        entity_type="purchase",
        entity_id=purchase_id,
        entity_name=details.get("item_name"),
        details={**details, "restored_from_audit_log": audit_log_id},
    )

    # Recalculate the client's invoice chain if this purchase was attached to an invoice.
    if restored_purchase.get("invoice_id"):
        try:
            await recalculate_client_invoices(tid, customer_id)
        except Exception:
            pass

    return {
        "message": "Producto restaurado",
        "purchase_id": purchase_id,
        "item_name": details.get("item_name"),
        "customer_id": customer_id,
    }


@api_router.post("/purchases/{purchase_id}/reassign-live")
async def reassign_purchase_live(purchase_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    """Move an orphan purchase (one whose `live_id` points at a deleted Live, or
    that has no `live_id` at all) into a currently-existing Live.

    Body: { "live_id": "<uuid of an existing live in the same tenant>" }

    The destination Live's `purchase_count`, `total_sales` and `total_commissions`
    are incremented so the Live cards stay accurate. We don't touch the wallet
    or invoice — those numbers stay the same.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    new_live_id = (body or {}).get("live_id")
    if not new_live_id:
        raise HTTPException(status_code=400, detail="live_id requerido")

    purchase = await db.purchases.find_one({"id": purchase_id, "tenant_id": tid}, {"_id": 0})
    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    new_live = await db.lives.find_one({"id": new_live_id, "tenant_id": tid}, {"_id": 0})
    if not new_live:
        raise HTTPException(status_code=404, detail="Live destino no encontrado")

    old_live_id = purchase.get("live_id")

    await db.purchases.update_one(
        {"id": purchase_id, "tenant_id": tid},
        {"$set": {"live_id": new_live_id, "reassigned_at": datetime.now(timezone.utc).isoformat(),
                  "reassigned_from": old_live_id}}
    )

    # Bump destination Live counters.
    await db.lives.update_one(
        {"id": new_live_id, "tenant_id": tid},
        {"$inc": {
            "purchase_count": 1,
            "total_sales": float(purchase.get("price") or 0) + float(purchase.get("tax") or 0),
            "total_commissions": float(purchase.get("commission") or 0),
        }}
    )

    # Audit trail so we know who moved what.
    actor = await db.users.find_one({"id": current_user["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "email": 1, "role": 1})
    if not actor:
        actor = await db.employees.find_one({"id": current_user["user_id"], "tenant_id": tid}, {"_id": 0, "name": 1, "email": 1})
    actor_name = (actor or {}).get("name") or (actor or {}).get("email") or "—"
    actor_role = (actor or {}).get("role") or current_user.get("role")
    await log_audit_action(
        tenant_id=tid,
        user_id=current_user["user_id"],
        user_name=actor_name,
        user_role=actor_role,
        action="reassign_purchase",
        entity_type="purchase",
        entity_id=purchase_id,
        entity_name=purchase.get("item_name"),
        details={
            "from_live_id": old_live_id,
            "to_live_id": new_live_id,
            "to_live_title": new_live.get("title"),
            "customer_id": purchase.get("customer_id"),
            "store": purchase.get("store"),
        }
    )

    return {
        "message": "Compra reasignada",
        "purchase_id": purchase_id,
        "from_live_id": old_live_id,
        "to_live_id": new_live_id,
        "to_live_title": new_live.get("title"),
    }


@api_router.get("/admin/diagnose-pending/{customer_id}")
async def diagnose_pending_purchases(customer_id: str, current_user: dict = Depends(get_current_user)):
    """Diagnostic endpoint: lists every pending purchase of a customer with full
    origin metadata (live_id, whether the live exists, store, date, total).
    Helps the admin understand why some products show "Sin live" or appear in
    counts that don't match the active Live.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    purchases = await db.purchases.find({
        "customer_id": customer_id.upper(),
        "tenant_id": tid,
        "$or": [{"invoice_id": None}, {"invoice_id": {"$exists": False}}],
    }, {"_id": 0}).sort("created_at", 1).to_list(20000)

    live_ids = {p.get("live_id") for p in purchases if p.get("live_id")}
    live_docs = await db.lives.find(
        {"id": {"$in": list(live_ids)}, "tenant_id": tid},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "store": 1, "created_at": 1}
    ).to_list(len(live_ids)) if live_ids else []
    live_lookup = {ld["id"]: ld for ld in live_docs}

    rows = []
    counts = {"with_live": 0, "deleted_live": 0, "no_live": 0}
    for p in purchases:
        lid = p.get("live_id")
        if not lid:
            origin, live_meta = "no_live", None
            counts["no_live"] += 1
        elif lid in live_lookup:
            origin, live_meta = "with_live", live_lookup[lid]
            counts["with_live"] += 1
        else:
            origin, live_meta = "deleted_live", None
            counts["deleted_live"] += 1
        rows.append({
            "purchase_id": p.get("id"),
            "item_name": p.get("item_name"),
            "store": p.get("store"),
            "total": p.get("total"),
            "created_at": p.get("created_at"),
            "live_id": lid,
            "live_title": (live_meta or {}).get("title"),
            "live_status": (live_meta or {}).get("status"),
            "live_store": (live_meta or {}).get("store"),
            "origin": origin,
        })
    return {"customer_id": customer_id.upper(), "total_pending": len(rows), "counts": counts, "rows": rows}


@api_router.get("/admin/diagnose-shipments")
async def diagnose_shipments(
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Deep diagnostic for shipments in a date range.

    Returns every shipment whose `created_at` (or `updated_at` as fallback comparison)
    falls in the range, plus correlated audit-log entries so the admin can verify:
    - Real creation date from MongoDB
    - Whether `created_by` is missing (legacy) or set (new code)
    - Whether there is an audit log entry of action="create_shipment"
    - Last modification time and what changed

    Helps answer: "did anyone really create these shipments this week?"
    """
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    if not start_date or not end_date:
        raise HTTPException(status_code=400, detail="start_date y end_date son requeridos (ISO 8601)")

    # Two queries: shipments created in range, and shipments whose updated_at is in range
    # but created_at is NOT — these are the "edited but not created" ones.
    created_in_range = await db.shipments.find(
        {"tenant_id": tid, "created_at": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20000)

    updated_in_range = await db.shipments.find(
        {
            "tenant_id": tid,
            "updated_at": {"$gte": start_date, "$lte": end_date},
            "created_at": {"$lt": start_date},  # created BEFORE the range
        },
        {"_id": 0}
    ).sort("updated_at", -1).to_list(20000)

    # Build a set of all shipment IDs to fetch related audit logs
    all_ids = [s["id"] for s in created_in_range] + [s["id"] for s in updated_in_range]
    audit_logs = []
    if all_ids:
        audit_logs = await db.audit_logs.find(
            {"tenant_id": tid, "entity_type": "shipment", "entity_id": {"$in": all_ids}},
            {"_id": 0}
        ).sort("created_at", -1).to_list(20000)

    # Pre-fetch all login audit logs that happened within ±15 min of any shipment's
    # creation timestamp. This tells us WHO was authenticated when the insert ran,
    # even if the shipment itself has no audit log (legacy code in production).
    login_proximity_logs = {}
    if created_in_range:
        # Compute a global window covering all shipment creation times
        timestamps = [s.get("created_at") for s in created_in_range if s.get("created_at")]
        if timestamps:
            min_ts = min(timestamps)
            max_ts = max(timestamps)
            try:
                min_dt = datetime.fromisoformat(min_ts) - timedelta(hours=2)
                max_dt = datetime.fromisoformat(max_ts) + timedelta(minutes=15)
                login_window = await db.audit_logs.find(
                    {
                        "tenant_id": tid,
                        "action": "login",
                        "created_at": {"$gte": min_dt.isoformat(), "$lte": max_dt.isoformat()},
                    },
                    {"_id": 0, "user_name": 1, "user_role": 1, "user_id": 1, "created_at": 1, "details": 1}
                ).sort("created_at", 1).to_list(20000)
                # For each shipment, find the nearest preceding login (within 2h)
                for s in created_in_range:
                    sid = s["id"]
                    s_dt = datetime.fromisoformat(s["created_at"])
                    candidate = None
                    for log in login_window:
                        log_dt = datetime.fromisoformat(log["created_at"])
                        if log_dt <= s_dt and (s_dt - log_dt).total_seconds() <= 7200:
                            # Last login within 2 hours BEFORE the shipment creation
                            candidate = log
                        elif log_dt > s_dt:
                            break
                    if candidate:
                        login_proximity_logs[sid] = {
                            "user_name": candidate.get("user_name"),
                            "user_role": candidate.get("user_role"),
                            "user_id": candidate.get("user_id"),
                            "login_at": candidate.get("created_at"),
                            "minutes_before": round((s_dt - datetime.fromisoformat(candidate["created_at"])).total_seconds() / 60, 1),
                        }
            except Exception as _ex:
                logger.warning(f"Could not compute login proximity: {_ex}")

    # Group audit logs by shipment id
    logs_by_ship = {}
    for log in audit_logs:
        sid = log.get("entity_id")
        if not sid:
            continue
        logs_by_ship.setdefault(sid, []).append({
            "action": log.get("action"),
            "user_name": log.get("user_name"),
            "user_role": log.get("user_role"),
            "created_at": log.get("created_at"),
            "details": log.get("details"),
        })

    # Resolve user names for each shipment's user_id and created_by
    user_ids = list({s.get("user_id") for s in (created_in_range + updated_in_range) if s.get("user_id")})
    creator_ids = list({s.get("created_by") for s in (created_in_range + updated_in_range) if s.get("created_by")})
    name_lookup = {}
    if user_ids:
        for u in await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(user_ids)):
            name_lookup[u["id"]] = u["name"]
    if creator_ids:
        for u in await db.users.find({"id": {"$in": creator_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(creator_ids)):
            name_lookup[u["id"]] = u["name"]
        missing = [c for c in creator_ids if c not in name_lookup]
        if missing:
            for e in await db.employees.find({"id": {"$in": missing}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(missing)):
                name_lookup[e["id"]] = e["name"]

    def build_row(s):
        sid = s["id"]
        related = logs_by_ship.get(sid, [])
        create_log = next((l for l in related if l["action"] == "create_shipment"), None)
        return {
            "id": sid,
            "customer_id": s.get("customer_id"),
            "client_name": name_lookup.get(s.get("user_id"), "Sin nombre"),
            "package_count": s.get("package_count"),
            "shipping_category": s.get("shipping_category"),
            "shipping_cost": s.get("shipping_cost"),
            "status": s.get("status"),
            "raw_created_at": s.get("created_at"),
            "raw_updated_at": s.get("updated_at"),
            "created_by": s.get("created_by"),
            "created_by_name_in_doc": s.get("created_by_name"),
            "created_by_resolved": name_lookup.get(s.get("created_by"), None),
            "has_audit_create": bool(create_log),
            "audit_create_user": (create_log or {}).get("user_name"),
            "audit_create_at": (create_log or {}).get("created_at"),
            "audit_log_count": len(related),
            "audit_logs": related[:10],  # cap for payload size
            "login_proximity": login_proximity_logs.get(sid),  # who was logged in at the time
        }

    rows_created = [build_row(s) for s in created_in_range]
    rows_updated_only = [build_row(s) for s in updated_in_range]

    # Summary diagnostics
    summary = {
        "range": {"start": start_date, "end": end_date},
        "created_in_range_count": len(rows_created),
        "updated_only_count": len(rows_updated_only),
        "created_with_created_by": sum(1 for r in rows_created if r["created_by"]),
        "created_without_created_by_legacy": sum(1 for r in rows_created if not r["created_by"]),
        "created_with_audit_log": sum(1 for r in rows_created if r["has_audit_create"]),
        "created_without_audit_log": sum(1 for r in rows_created if not r["has_audit_create"]),
        "total_packages_in_range": sum((r.get("package_count") or 0) for r in rows_created),
    }

    return {
        "summary": summary,
        "shipments_created_in_range": rows_created,
        "shipments_updated_only_in_range": rows_updated_only,
    }


@api_router.get("/")
async def root():
    return {"message": "OUTLETS USA EC SaaS API - Multi-Tenant Live Shopping Platform"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

# ==================== APP SETUP ====================

@api_router.get("/uploads/{file_path:path}")
async def serve_upload(file_path: str):
    """Serve uploaded files - try object store first, then local fallback"""
    # Try object store directly (path already includes app prefix)
    try:
        data, content_type = object_store.get_object(file_path)
        return Response(content=data, media_type=content_type)
    except Exception:
        pass
    
    # Local fallback for old files
    local_path = UPLOAD_DIR / file_path
    if local_path.exists():
        content_type = "image/jpeg"
        ext = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else ""
        if ext == "png": content_type = "image/png"
        elif ext == "gif": content_type = "image/gif"
        elif ext == "webp": content_type = "image/webp"
        elif ext == "pdf": content_type = "application/pdf"
        return Response(content=local_path.read_bytes(), media_type=content_type)
    
    raise HTTPException(status_code=404, detail="File not found")


@api_router.get("/admin/diagnose-invoice/{invoice_id}")
async def diagnose_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Build a complete timeline for a specific invoice.

    Returns the current state of the invoice, all linked purchases (including
    soft-deleted ones), the linked shipment, ALL invoices of the same client
    (so the saldo_a_favor cascade can be traced), all related audit_logs
    (purchase create/update/delete, invoice create/approve/reopen/annul,
    shipment create/update/delete, deposit create/approve, etc.), and
    matching wallet transactions.
    """
    if current_user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    tid = current_user["tenant_id"]

    invoice = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    customer_id = invoice["customer_id"]

    # Linked purchases (active + soft-deleted)
    linked_purchases = await db.purchases.find(
        {"id": {"$in": invoice.get("purchase_ids", [])}, "tenant_id": tid},
        {"_id": 0}
    ).to_list(20000)

    # Soft-deleted purchases that previously belonged to this invoice but were removed.
    # We find these via audit logs that referenced this invoice or by purchases whose
    # `deleted_invoice_id` matches.
    extra_deleted = await db.purchases.find(
        {"tenant_id": tid, "is_deleted": True, "customer_id": customer_id},
        {"_id": 0}
    ).to_list(20000)

    # Linked shipment
    shipment = await db.shipments.find_one({"invoice_id": invoice_id, "tenant_id": tid}, {"_id": 0})

    # All client invoices in chronological order (saldo cascade)
    client_invoices = await db.invoices.find(
        {"customer_id": customer_id, "tenant_id": tid},
        {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "is_annulled": 1,
         "total": 1, "subtotal": 1, "total_commission": 1, "total_tax": 1,
         "shipping_cost": 1, "saldo_pendiente": 1, "saldo_a_favor_anterior": 1,
         "saldo_a_favor": 1, "deposits_applied": 1, "total_a_pagar": 1,
         "applied_deposits": 1, "purchase_ids": 1, "created_at": 1, "approved_at": 1}
    ).sort("created_at", 1).to_list(20000)

    # Audit logs for: this invoice, purchases of this invoice, the shipment.
    related_ids = [invoice_id] + [p["id"] for p in linked_purchases] + [p["id"] for p in extra_deleted]
    if shipment:
        related_ids.append(shipment["id"])
    audit_logs = []
    if related_ids:
        audit_logs = await db.audit_logs.find(
            {"tenant_id": tid, "entity_id": {"$in": related_ids}},
            {"_id": 0}
        ).sort("created_at", -1).to_list(20000)

    # Audit logs for any OTHER invoice in the chain (so we see when a previous
    # invoice was annulled / reopened / approved → triggers a saldo recalc here).
    other_inv_ids = [i["id"] for i in client_invoices if i["id"] != invoice_id]
    chain_audit = []
    if other_inv_ids:
        chain_audit = await db.audit_logs.find(
            {"tenant_id": tid, "entity_type": "invoice", "entity_id": {"$in": other_inv_ids},
             "action": {"$in": ["create_invoice", "approve_invoice", "reopen_invoice",
                                "invoice_annulled", "annul_invoice", "update_invoice"]}},
            {"_id": 0}
        ).sort("created_at", -1).to_list(20000)

    # Wallet transactions (deposits) for this customer — recharges directly affect
    # saldo cascade across invoices.
    wallet_txs = await db.wallet_transactions.find(
        {"tenant_id": tid, "customer_id": customer_id, "type": {"$in": ["deposit", "deposit_request"]}},
        {"_id": 0, "id": 1, "amount": 1, "status": 1, "is_deleted": 1, "description": 1,
         "created_at": 1, "approved_at": 1, "approved_by_name": 1, "deleted_at": 1, "deleted_by_name": 1}
    ).sort("created_at", -1).to_list(20000)

    # Build a unified timeline merging audits + wallet ops + invoice/purchase events
    timeline = []
    for log in audit_logs + chain_audit:
        timeline.append({
            "ts": log.get("created_at"),
            "type": log.get("action"),
            "entity_type": log.get("entity_type"),
            "entity_id": log.get("entity_id"),
            "entity_name": log.get("entity_name"),
            "user_name": log.get("user_name"),
            "user_role": log.get("user_role"),
            "details": log.get("details"),
        })
    for tx in wallet_txs:
        timeline.append({
            "ts": tx.get("approved_at") or tx.get("created_at"),
            "type": f"wallet_{tx.get('type')}_{tx.get('status') or 'pending'}",
            "entity_type": "wallet",
            "entity_id": tx.get("id"),
            "entity_name": f"${tx.get('amount', 0):.2f} - {tx.get('description', '')}",
            "user_name": tx.get("approved_by_name") or "Cliente",
            "details": {"amount": tx.get("amount"), "is_deleted": tx.get("is_deleted")},
        })
    timeline.sort(key=lambda x: x.get("ts") or "", reverse=True)

    return {
        "invoice": invoice,
        "linked_purchases": linked_purchases,
        "shipment": shipment,
        "extra_deleted_purchases": extra_deleted,
        "client_invoices_chain": client_invoices,
        "wallet_transactions": wallet_txs,
        "timeline": timeline[:200],  # cap for payload size
        "summary": {
            "linked_purchases_count": len(linked_purchases),
            "soft_deleted_purchases_count": sum(1 for p in linked_purchases if p.get("is_deleted")),
            "audit_logs_count": len(audit_logs),
            "chain_audit_count": len(chain_audit),
            "wallet_tx_count": len(wallet_txs),
        }
    }

# ==================== INVENTORY ENDPOINTS ====================

@api_router.get("/inventory/products")
async def get_inventory_products(
    location: str = Query(..., description="Location: 'ecuador' or 'usa'"),
    user=Depends(get_current_user)
):
    """Get all inventory products for the tenant filtered by location"""
    if location not in ("ecuador", "usa"):
        raise HTTPException(status_code=400, detail="Location must be 'ecuador' or 'usa'")
    
    products = await db.inventory_products.find(
        {"tenant_id": user["tenant_id"], "location": location},
        {"_id": 0}
    ).sort("name", 1).to_list(1000)
    return products
    return products


@api_router.get("/inventory/products/{product_id}")
async def get_inventory_product(product_id: str, user=Depends(get_current_user)):
    """Get a single inventory product"""
    product = await db.inventory_products.find_one(
        {"id": product_id, "tenant_id": user["tenant_id"]},
        {"_id": 0}
    )
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return product


@api_router.post("/inventory/products")
async def create_inventory_product(data: InventoryProductCreate, user=Depends(get_current_user)):
    """Create a new inventory product for a specific location"""
    if data.location not in ("ecuador", "usa"):
        raise HTTPException(status_code=400, detail="Location must be 'ecuador' or 'usa'")
    
    product = InventoryProduct(
        tenant_id=user["tenant_id"],
        location=data.location,
        name=data.name,
        cost=data.cost,
        sale_price=data.sale_price,
        tax_rate=data.tax_rate,
        stock=data.stock,
        sku=data.sku,
        description=data.description
    )
    await db.inventory_products.insert_one(product.model_dump())
    return {"message": "Producto creado", "product": product.model_dump()}


@api_router.put("/inventory/products/{product_id}")
async def update_inventory_product(product_id: str, data: InventoryProductUpdate, user=Depends(get_current_user)):
    """Update an inventory product"""
    product = await db.inventory_products.find_one(
        {"id": product_id, "tenant_id": user["tenant_id"]}
    )
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.inventory_products.update_one(
            {"id": product_id},
            {"$set": update_data}
        )
    
    updated = await db.inventory_products.find_one({"id": product_id}, {"_id": 0})
    return {"message": "Producto actualizado", "product": updated}


@api_router.delete("/inventory/products/{product_id}")
async def delete_inventory_product(product_id: str, user=Depends(get_current_user)):
    """Delete an inventory product (soft delete by setting inactive)"""
    result = await db.inventory_products.update_one(
        {"id": product_id, "tenant_id": user["tenant_id"]},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"message": "Producto eliminado"}


@api_router.post("/inventory/sales")
async def create_inventory_sale(data: InventorySaleCreate, user=Depends(get_current_user)):
    """Record a sale of an inventory product"""
    # Get the product
    product = await db.inventory_products.find_one(
        {"id": data.product_id, "tenant_id": user["tenant_id"]}
    )
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    # Product location determines sale location
    location = product.get("location", "ecuador")
    
    # Check stock availability
    current_stock = product.get("stock", 0)
    if current_stock < data.quantity:
        raise HTTPException(
            status_code=400, 
            detail=f"Stock insuficiente. Disponible: {current_stock}"
        )
    
    # Get customer info if provided
    customer_name = None
    if data.customer_id:
        customer = await db.users.find_one({"customer_id": data.customer_id, "tenant_id": user["tenant_id"]})
        if customer:
            customer_name = customer.get("name")
    
    # Calculate amounts
    unit_cost = product["cost"]
    unit_price = product["sale_price"]
    tax_rate = product.get("tax_rate", 0)
    subtotal = data.quantity * unit_price
    tax_amount = subtotal * tax_rate
    total_amount = subtotal + tax_amount
    profit = (unit_price - unit_cost) * data.quantity
    
    # Create sale record
    sale = InventorySale(
        tenant_id=user["tenant_id"],
        product_id=data.product_id,
        product_name=product["name"],
        customer_id=data.customer_id,
        customer_name=customer_name,
        quantity=data.quantity,
        unit_cost=unit_cost,
        unit_price=unit_price,
        tax_rate=tax_rate,
        tax_amount=tax_amount,
        total_amount=total_amount,
        profit=profit,
        location=location,
        notes=data.notes,
        sold_by=user.get("user_id"),
        sold_by_name=user.get("name")
    )
    
    await db.inventory_sales.insert_one(sale.model_dump())
    
    # Reduce stock
    await db.inventory_products.update_one(
        {"id": data.product_id},
        {
            "$inc": {"stock": -data.quantity},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    # Log to audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": user["tenant_id"],
        "user_id": user.get("user_id"),
        "user_name": user.get("name", "Admin"),
        "user_role": user.get("role", "admin"),
        "action": "inventory_sale",
        "entity_type": "inventory_product",
        "entity_id": data.product_id,
        "entity_name": product["name"],
        "details": {
            "sale_id": sale.id,
            "quantity": data.quantity,
            "unit_price": unit_price,
            "total_amount": total_amount,
            "profit": profit,
            "location": location,
            "customer_id": data.customer_id,
            "customer_name": customer_name
        },
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"message": "Venta registrada", "sale": sale.model_dump()}


@api_router.get("/inventory/sales")
async def get_inventory_sales(
    location: str = Query(..., description="Location: 'ecuador' or 'usa'"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_id: Optional[str] = None,
    user=Depends(get_current_user)
):
    """Get inventory sales with optional filters"""
    if location not in ("ecuador", "usa"):
        raise HTTPException(status_code=400, detail="Location must be 'ecuador' or 'usa'")
    
    query = {"tenant_id": user["tenant_id"], "location": location}
    
    if product_id:
        query["product_id"] = product_id
    
    if start_date or end_date:
        query["created_at"] = {}
        if start_date:
            query["created_at"]["$gte"] = start_date
        if end_date:
            query["created_at"]["$lte"] = end_date
    
    sales = await db.inventory_sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return sales


@api_router.delete("/inventory/sales/{sale_id}")
async def delete_inventory_sale(sale_id: str, user=Depends(get_current_user)):
    """Delete an inventory sale and restore stock"""
    sale = await db.inventory_sales.find_one(
        {"id": sale_id, "tenant_id": user["tenant_id"]}
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    
    # Restore stock
    await db.inventory_products.update_one(
        {"id": sale["product_id"]},
        {
            "$inc": {"stock": sale["quantity"]},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    # Delete sale
    await db.inventory_sales.delete_one({"id": sale_id})
    
    return {"message": "Venta eliminada y stock restaurado"}


@api_router.get("/inventory/stats")
async def get_inventory_stats(
    location: str = Query(..., description="Location: 'ecuador' or 'usa'"),
    period: str = "week",
    user=Depends(get_current_user)
):
    """Get inventory statistics - weekly by default like other modules"""
    if location not in ("ecuador", "usa"):
        raise HTTPException(status_code=400, detail="Location must be 'ecuador' or 'usa'")
    
    tenant_id = user["tenant_id"]
    
    # Calculate date range based on period
    now = datetime.now(timezone.utc)
    
    if period == "week":
        # Current week (Monday to Sunday)
        days_since_monday = now.weekday()
        week_start = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
        start_date = week_start.isoformat()
        end_date = now.isoformat()
    elif period == "month":
        start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        end_date = now.isoformat()
    elif period == "all":
        start_date = None
        end_date = None
    else:
        # Try to parse as week offset (w1, w2, etc.)
        if period.startswith("w"):
            try:
                weeks_back = int(period[1:])
                days_since_monday = now.weekday()
                current_week_start = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
                week_start = current_week_start - timedelta(weeks=weeks_back)
                week_end = week_start + timedelta(days=7)
                start_date = week_start.isoformat()
                end_date = week_end.isoformat()
            except ValueError:
                start_date = None
                end_date = None
        else:
            start_date = None
            end_date = None
    
    # Build query - filter by location
    query = {"tenant_id": tenant_id, "location": location}
    if start_date:
        query["created_at"] = {"$gte": start_date}
        if end_date:
            query["created_at"]["$lte"] = end_date
    
    # Get all sales in period
    sales = await db.inventory_sales.find(query, {"_id": 0}).to_list(10000)
    
    # Calculate totals
    total_sales = sum(s.get("total_amount", 0) for s in sales)
    total_cost = sum(s.get("unit_cost", 0) * s.get("quantity", 1) for s in sales)
    total_profit = sum(s.get("profit", 0) for s in sales)
    total_tax = sum(s.get("tax_amount", 0) for s in sales)
    total_quantity = sum(s.get("quantity", 1) for s in sales)
    
    # Products sold breakdown
    products_sold = {}
    for s in sales:
        pid = s.get("product_id")
        pname = s.get("product_name", "Unknown")
        if pid not in products_sold:
            products_sold[pid] = {
                "product_id": pid,
                "product_name": pname,
                "quantity": 0,
                "total_sales": 0,
                "total_cost": 0,
                "profit": 0
            }
        products_sold[pid]["quantity"] += s.get("quantity", 1)
        products_sold[pid]["total_sales"] += s.get("total_amount", 0)
        products_sold[pid]["total_cost"] += s.get("unit_cost", 0) * s.get("quantity", 1)
        products_sold[pid]["profit"] += s.get("profit", 0)
    
    # Sort by quantity sold
    top_products = sorted(products_sold.values(), key=lambda x: x["quantity"], reverse=True)[:20]
    
    # Calculate margin per product
    for p in top_products:
        if p["total_sales"] > 0:
            p["margin_percent"] = round((p["profit"] / p["total_sales"]) * 100, 1)
        else:
            p["margin_percent"] = 0
    
    # Daily breakdown for charts
    daily_sales = {}
    for s in sales:
        date_str = s.get("created_at", "")[:10]  # YYYY-MM-DD
        if date_str not in daily_sales:
            daily_sales[date_str] = {"date": date_str, "sales": 0, "profit": 0, "quantity": 0}
        daily_sales[date_str]["sales"] += s.get("total_amount", 0)
        daily_sales[date_str]["profit"] += s.get("profit", 0)
        daily_sales[date_str]["quantity"] += s.get("quantity", 1)
    
    daily_trend = sorted(daily_sales.values(), key=lambda x: x["date"])
    
    # Get current stock levels - filter by location
    products = await db.inventory_products.find(
        {"tenant_id": tenant_id, "location": location, "is_active": True},
        {"_id": 0}
    ).to_list(1000)
    
    total_stock = sum(p.get("stock", 0) for p in products)
    total_stock_value = sum(
        p.get("cost", 0) * p.get("stock", 0)
        for p in products
    )
    
    # Low stock alerts (less than 5 units)
    low_stock = [
        {
            "id": p["id"],
            "name": p["name"],
            "stock": p.get("stock", 0)
        }
        for p in products
        if p.get("stock", 0) < 5
    ]
    
    return {
        "period": period,
        "location": location,
        "start_date": start_date,
        "end_date": end_date,
        "summary": {
            "total_sales": round(total_sales, 2),
            "total_cost": round(total_cost, 2),
            "total_profit": round(total_profit, 2),
            "total_tax": round(total_tax, 2),
            "total_quantity": total_quantity,
            "sale_count": len(sales),
            "margin_percent": round((total_profit / total_sales * 100) if total_sales > 0 else 0, 1)
        },
        "stock": {
            "total": total_stock,
            "total_value": round(total_stock_value, 2),
            "product_count": len(products)
        },
        "top_products": top_products,
        "low_stock_alerts": low_stock,
        "daily_trend": daily_trend
    }


@api_router.post("/inventory/products/{product_id}/adjust-stock")
async def adjust_inventory_stock(
    product_id: str,
    adjustment: int = Body(..., embed=True),
    reason: str = Body(None, embed=True),
    user=Depends(get_current_user)
):
    """Manually adjust stock (positive to add, negative to remove)"""
    product = await db.inventory_products.find_one(
        {"id": product_id, "tenant_id": user["tenant_id"]}
    )
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    current_stock = product.get("stock", 0)
    new_stock = current_stock + adjustment
    
    if new_stock < 0:
        raise HTTPException(status_code=400, detail="El ajuste resultaría en stock negativo")
    
    await db.inventory_products.update_one(
        {"id": product_id},
        {
            "$set": {
                "stock": new_stock,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    # Log the adjustment
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": user["tenant_id"],
        "user_id": user.get("user_id"),
        "user_name": user.get("name", "Admin"),
        "user_role": user.get("role", "admin"),
        "action": "inventory_stock_adjustment",
        "entity_type": "inventory_product",
        "entity_id": product_id,
        "entity_name": product["name"],
        "details": {
            "location": product.get("location"),
            "previous_stock": current_stock,
            "adjustment": adjustment,
            "new_stock": new_stock,
            "reason": reason
        },
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "message": "Stock ajustado",
        "previous_stock": current_stock,
        "adjustment": adjustment,
        "new_stock": new_stock
    }


@api_router.post("/inventory/products/{product_id}/transfer")
async def transfer_inventory_stock(
    product_id: str,
    quantity: int = Body(..., embed=True),
    target_product_id: Optional[str] = Body(None, embed=True),
    create_new: bool = Body(False, embed=True),
    target_location: Optional[str] = Body(None, embed=True),
    user=Depends(get_current_user)
):
    """Transfer stock from one location to another.
    Either specify target_product_id to transfer to existing product,
    or set create_new=True to create a new product in the other location.
    target_location can be: bodega, local, ali, usa, ecuador
    """
    # Get source product
    source = await db.inventory_products.find_one(
        {"id": product_id, "tenant_id": user["tenant_id"]}
    )
    if not source:
        raise HTTPException(status_code=404, detail="Producto origen no encontrado")
    
    current_stock = source.get("stock", 0)
    if current_stock < quantity:
        raise HTTPException(status_code=400, detail=f"Stock insuficiente. Disponible: {current_stock}")
    
    source_location = source.get("location", "bodega")
    
    # Determine target location if not provided
    if not target_location:
        # Legacy behavior: swap between ecuador/usa
        if source_location == "usa":
            target_location = "bodega"  # Default to bodega for USA transfers
        elif source_location in ["bodega", "local", "ali"]:
            target_location = "usa"
        else:
            target_location = "bodega"
    
    # Validate target is different from source
    if target_location == source_location:
        raise HTTPException(status_code=400, detail="La ubicación destino debe ser diferente a la origen")
    
    if create_new:
        # Create new product in target location
        new_product = InventoryProduct(
            tenant_id=user["tenant_id"],
            location=target_location,
            name=source["name"],
            cost=source["cost"],
            sale_price=source["sale_price"],
            tax_rate=source.get("tax_rate", 0),
            stock=quantity,
            sku=source.get("sku"),
            description=source.get("description")
        )
        await db.inventory_products.insert_one(new_product.model_dump())
        target_product_id = new_product.id
        target_name = new_product.name
    else:
        if not target_product_id:
            raise HTTPException(status_code=400, detail="Debe especificar producto destino o create_new=True")
        
        # Get target product
        target = await db.inventory_products.find_one(
            {"id": target_product_id, "tenant_id": user["tenant_id"], "location": target_location}
        )
        if not target:
            raise HTTPException(status_code=404, detail="Producto destino no encontrado en la ubicación correcta")
        
        # Add stock to target
        await db.inventory_products.update_one(
            {"id": target_product_id},
            {
                "$inc": {"stock": quantity},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            }
        )
        target_name = target["name"]
    
    # Reduce stock from source
    await db.inventory_products.update_one(
        {"id": product_id},
        {
            "$inc": {"stock": -quantity},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    # Location display names
    location_names = {
        "bodega": "Bodega",
        "local": "Local", 
        "ali": "Ali",
        "usa": "USA",
        "ecuador": "Ecuador"
    }
    
    # Log the transfer
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": user["tenant_id"],
        "user_id": user.get("user_id"),
        "user_name": user.get("name", "Admin"),
        "user_role": user.get("role", "admin"),
        "action": "inventory_transfer",
        "entity_type": "inventory_product",
        "entity_id": product_id,
        "entity_name": source["name"],
        "details": {
            "source_location": source_location,
            "target_location": target_location,
            "quantity": quantity,
            "source_product_id": product_id,
            "target_product_id": target_product_id,
            "created_new": create_new
        },
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "message": f"Transferencia completada: {quantity} unidades de {location_names.get(source_location, source_location)} a {location_names.get(target_location, target_location)}",
        "source_product": source["name"],
        "target_product": target_name,
        "quantity": quantity,
        "target_product_id": target_product_id
    }


@api_router.get("/inventory/products-for-transfer")
async def get_products_for_transfer(
    target_location: str = Query(...),
    user=Depends(get_current_user)
):
    """Get products in target location for transfer selection"""
    products = await db.inventory_products.find(
        {"tenant_id": user["tenant_id"], "location": target_location, "is_active": True},
        {"_id": 0, "id": 1, "name": 1, "sku": 1, "stock": 1}
    ).sort("name", 1).to_list(500)
    return products


@api_router.post("/inventory/create-purchases")
async def create_purchases_from_inventory(
    items: List[dict] = Body(...),
    customer_id: str = Body(...),
    user=Depends(get_current_user)
):
    """Create purchases from inventory items for invoicing.
    Each item: {product_id, quantity}
    These purchases will be marked with entry_source='inventory' and can be invoiced normally.
    """
    tenant_id = user["tenant_id"]
    
    # Get customer
    customer = await db.users.find_one({"customer_id": customer_id, "tenant_id": tenant_id})
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    created_purchases = []
    errors = []
    
    for item in items:
        product_id = item.get("product_id")
        quantity = item.get("quantity", 1)
        
        # Get product
        product = await db.inventory_products.find_one(
            {"id": product_id, "tenant_id": tenant_id}
        )
        if not product:
            errors.append({"product_id": product_id, "error": "Producto no encontrado"})
            continue
        
        current_stock = product.get("stock", 0)
        if current_stock < quantity:
            errors.append({
                "product_id": product_id, 
                "product_name": product["name"],
                "error": f"Stock insuficiente. Disponible: {current_stock}"
            })
            continue
        
        # Calculate amounts
        price = product["sale_price"]
        tax_rate = product.get("tax_rate", 0)
        tax = price * tax_rate
        price_with_tax = price + tax
        commission = customer.get("commission_fee", 0)
        
        # Create purchase for each unit (or batch)
        for i in range(quantity):
            purchase = Purchase(
                tenant_id=tenant_id,
                user_id=customer["id"],
                customer_id=customer_id,
                item_name=f"[INVENTARIO] {product['name']}",
                store=f"Inventario {product.get('location', 'ecuador').upper()}",
                price=price,
                tax=tax,
                price_with_tax=price_with_tax,
                commission=commission,
                total=price_with_tax + commission,
                status="confirmed",
                live_id=f"inventory_{product_id}"  # Special marker
            )
            await db.purchases.insert_one(purchase.model_dump())
            created_purchases.append(purchase.model_dump())
        
        # Reduce inventory stock
        await db.inventory_products.update_one(
            {"id": product_id},
            {
                "$inc": {"stock": -quantity},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            }
        )
        
        # Record inventory sale
        sale = InventorySale(
            tenant_id=tenant_id,
            product_id=product_id,
            product_name=product["name"],
            customer_id=customer_id,
            customer_name=customer.get("name"),
            quantity=quantity,
            unit_cost=product["cost"],
            unit_price=price,
            tax_rate=tax_rate,
            tax_amount=tax * quantity,
            total_amount=price_with_tax * quantity,
            profit=(price - product["cost"]) * quantity,
            location=product.get("location", "ecuador"),
            notes="Creado para facturación",
            sold_by=user.get("user_id"),
            sold_by_name=user.get("name")
        )
        await db.inventory_sales.insert_one(sale.model_dump())
        
        # Log to audit
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "user_id": user.get("user_id"),
            "user_name": user.get("name", "Admin"),
            "user_role": user.get("role", "admin"),
            "action": "inventory_invoice_purchase",
            "entity_type": "inventory_product",
            "entity_id": product_id,
            "entity_name": product["name"],
            "details": {
                "quantity": quantity,
                "customer_id": customer_id,
                "customer_name": customer.get("name"),
                "total_amount": price_with_tax * quantity,
                "location": product.get("location", "ecuador"),
                "purchases_created": quantity
            },
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    # Check for low stock alerts
    low_stock_alerts = []
    for item in items:
        product = await db.inventory_products.find_one(
            {"id": item.get("product_id"), "tenant_id": tenant_id},
            {"_id": 0, "id": 1, "name": 1, "stock": 1, "location": 1}
        )
        if product and product.get("stock", 0) < 5:
            low_stock_alerts.append({
                "product_id": product["id"],
                "name": product["name"],
                "stock": product["stock"],
                "location": product.get("location")
            })
    
    return {
        "message": f"Se crearon {len(created_purchases)} compras para facturación",
        "created_count": len(created_purchases),
        "errors": errors,
        "low_stock_alerts": low_stock_alerts
    }


@api_router.get("/inventory/low-stock-alerts")
async def get_low_stock_alerts(
    threshold: int = 5,
    location: Optional[str] = None,
    user=Depends(get_current_user)
):
    """Get products with stock below threshold"""
    query = {
        "tenant_id": user["tenant_id"],
        "is_active": True,
        "stock": {"$lt": threshold}
    }
    if location:
        query["location"] = location
    
    products = await db.inventory_products.find(
        query,
        {"_id": 0, "id": 1, "name": 1, "stock": 1, "location": 1, "sku": 1}
    ).sort("stock", 1).to_list(100)
    
    return {
        "threshold": threshold,
        "count": len(products),
        "products": products
    }


@api_router.get("/inventory/movement-history")
async def get_inventory_movement_history(
    location: Optional[str] = None,
    action_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user)
):
    """Get inventory movement history from audit logs.
    action_type can be: inventory_sale, inventory_transfer, inventory_stock_adjustment, inventory_invoice_purchase
    """
    query = {
        "tenant_id": user["tenant_id"],
        "action": {"$in": [
            "inventory_sale",
            "inventory_transfer", 
            "inventory_stock_adjustment",
            "inventory_invoice_purchase"
        ]}
    }
    
    if action_type:
        query["action"] = action_type
    
    if location:
        query["$or"] = [
            {"details.location": location},
            {"details.source_location": location},
            {"details.target_location": location}
        ]
    
    if start_date or end_date:
        query["created_at"] = {}
        if start_date:
            query["created_at"]["$gte"] = start_date
        if end_date:
            query["created_at"]["$lte"] = end_date
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    
    return {
        "count": len(logs),
        "movements": logs
    }


# ==================== PACAS ENDPOINTS ====================

@api_router.get("/pacas")
async def get_pacas(user=Depends(get_current_user)):
    """Get all pacas for the tenant"""
    pacas = await db.pacas.find(
        {"tenant_id": user["tenant_id"]},
        {"_id": 0}
    ).sort("name", 1).to_list(500)
    return pacas

@api_router.get("/pacas/sales/list")
async def get_paca_sales(
    period: str = Query("week", description="Period: 'week', 'month', 'all'"),
    user=Depends(get_current_user)
):
    """Get paca sales with optional period filter"""
    tid = user["tenant_id"]
    
    query = {"tenant_id": tid}
    if period == "week":
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        query["created_at"] = {"$gte": week_ago}
    elif period == "month":
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        query["created_at"] = {"$gte": month_ago}
    
    sales = await db.paca_sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    # Enrich with client names
    for sale in sales:
        client = await db.users.find_one(
            {"customer_id": sale["customer_id"], "tenant_id": tid},
            {"_id": 0, "name": 1}
        )
        sale["client_name"] = client.get("name") if client else "—"
    
    return sales

@api_router.get("/pacas/stats")
async def get_paca_stats(
    period: str = Query("week", description="Period: 'week', 'month', 'all'"),
    user=Depends(get_current_user)
):
    """Get statistics for paca sales"""
    tid = user["tenant_id"]
    
    query = {"tenant_id": tid}
    if period == "week":
        start_date = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        query["created_at"] = {"$gte": start_date}
    elif period == "month":
        start_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        query["created_at"] = {"$gte": start_date}
    
    sales = await db.paca_sales.find(query, {"_id": 0}).to_list(5000)
    
    total_sales = sum(s.get("sale_price", 0) for s in sales)
    total_commission = sum(s.get("commission", 0) for s in sales)
    total_count = len(sales)
    
    # Sales by paca type
    paca_breakdown = {}
    for s in sales:
        pn = s.get("paca_name", "Otro")
        if pn not in paca_breakdown:
            paca_breakdown[pn] = {"count": 0, "sales": 0, "commission": 0}
        paca_breakdown[pn]["count"] += 1
        paca_breakdown[pn]["sales"] += s.get("sale_price", 0)
        paca_breakdown[pn]["commission"] += s.get("commission", 0)
    
    # Convert to list and sort by count
    paca_list = [
        {"name": k, **v}
        for k, v in paca_breakdown.items()
    ]
    paca_list.sort(key=lambda x: x["count"], reverse=True)
    
    # Daily breakdown for trend chart
    daily_stats = {}
    for s in sales:
        day = s.get("created_at", "")[:10]
        if day not in daily_stats:
            daily_stats[day] = {"date": day, "count": 0, "sales": 0, "commission": 0}
        daily_stats[day]["count"] += 1
        daily_stats[day]["sales"] += s.get("sale_price", 0)
        daily_stats[day]["commission"] += s.get("commission", 0)
    
    daily_list = list(daily_stats.values())
    daily_list.sort(key=lambda x: x["date"])
    
    return {
        "total_sales": round(total_sales, 2),
        "total_commission": round(total_commission, 2),
        "total_count": total_count,
        "avg_sale": round(total_sales / total_count, 2) if total_count > 0 else 0,
        "avg_commission": round(total_commission / total_count, 2) if total_count > 0 else 0,
        "by_paca": paca_list,
        "daily_trend": daily_list
    }

@api_router.post("/pacas")
async def create_paca(data: PacaCreate, user=Depends(get_current_user)):
    """Create a new paca"""
    if user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    paca = Paca(
        tenant_id=user["tenant_id"],
        name=data.name,
        description=data.description,
        sale_price=data.sale_price,
        commission=data.commission,
        created_by=user["user_id"]
    )
    await db.pacas.insert_one(paca.model_dump())
    
    # Audit log
    await log_audit_action(
        tenant_id=user["tenant_id"],
        user_id=user["user_id"],
        user_name=user.get("name", "Admin"),
        user_role=user["role"],
        action="create_paca",
        entity_type="paca",
        entity_id=paca.id,
        entity_name=data.name,
        details={"sale_price": data.sale_price, "commission": data.commission}
    )
    
    return {"message": "Paca creada exitosamente", "id": paca.id}

@api_router.post("/pacas/sales")
async def create_paca_sale(data: PacaSaleCreate, user=Depends(get_current_user)):
    """Sell a paca to a client - creates a purchase for invoicing"""
    if user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    tid = user["tenant_id"]
    
    # Get paca
    paca = await db.pacas.find_one({"id": data.paca_id, "tenant_id": tid}, {"_id": 0})
    if not paca:
        raise HTTPException(status_code=404, detail="Paca no encontrada")
    
    # Get client
    customer_id = data.customer_id.upper().strip()
    client = await db.users.find_one({"customer_id": customer_id, "tenant_id": tid}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    # Create the sale record
    sale = PacaSale(
        tenant_id=tid,
        paca_id=paca["id"],
        paca_name=paca["name"],
        customer_id=customer_id,
        user_id=client["id"],
        sale_price=paca["sale_price"],
        commission=paca["commission"],
        total=paca["sale_price"],
        sold_by=user["user_id"]
    )
    await db.paca_sales.insert_one(sale.model_dump())
    
    # Create a purchase record for invoicing (similar to inventory)
    purchase_dict = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "user_id": client["id"],
        "customer_id": customer_id,
        "item_name": f"[PACA] {paca['name']}",
        "store": "Pacas",
        "price": paca["sale_price"],
        "tax": 0,
        "tax_rate": 0,
        "apply_tax": False,
        "price_with_tax": paca["sale_price"],
        "commission": paca["commission"],
        "apply_commission": True,
        "total": paca["sale_price"],
        "status": "confirmed",
        "entry_source": "paca",
        "paca_sale_id": sale.id,
        "created_at": now_iso,
    }
    await db.purchases.insert_one(purchase_dict)
    
    # Update wallet
    wallet = await db.wallets.find_one({"user_id": client["id"], "tenant_id": tid}, {"_id": 0})
    if wallet:
        new_balance = wallet["available"] - paca["sale_price"]
        await db.wallets.update_one(
            {"user_id": client["id"], "tenant_id": tid},
            {"$set": {"available": new_balance, "updated_at": now_iso}}
        )
        
        # Create wallet transaction
        transaction = WalletTransaction(
            tenant_id=tid,
            user_id=client["id"],
            customer_id=customer_id,
            type="purchase",
            amount=-paca["sale_price"],
            balance_after=new_balance,
            description=f"Compra Paca: {paca['name']}",
            status="approved",
            approved_at=now_iso,
            purchase_id=purchase_dict["id"]
        )
        await db.wallet_transactions.insert_one(transaction.model_dump())
    
    # Audit log
    await log_audit_action(
        tenant_id=tid,
        user_id=user["user_id"],
        user_name=user.get("name", "Admin"),
        user_role=user["role"],
        action="paca_sale",
        entity_type="paca_sale",
        entity_id=sale.id,
        entity_name=paca["name"],
        details={
            "customer_id": customer_id,
            "sale_price": paca["sale_price"],
            "commission": paca["commission"],
            "purchase_id": purchase_dict["id"]
        }
    )
    
    return {
        "message": "Paca vendida exitosamente",
        "sale_id": sale.id,
        "purchase_id": purchase_dict["id"],
        "client_name": client.get("name"),
        "new_balance": wallet["available"] - paca["sale_price"] if wallet else None
    }

@api_router.get("/pacas/{paca_id}")
async def get_paca(paca_id: str, user=Depends(get_current_user)):
    """Get a single paca"""
    paca = await db.pacas.find_one(
        {"id": paca_id, "tenant_id": user["tenant_id"]},
        {"_id": 0}
    )
    if not paca:
        raise HTTPException(status_code=404, detail="Paca no encontrada")
    return paca

@api_router.put("/pacas/{paca_id}")
async def update_paca(paca_id: str, data: PacaUpdate, user=Depends(get_current_user)):
    """Update a paca"""
    if user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    paca = await db.pacas.find_one({"id": paca_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not paca:
        raise HTTPException(status_code=404, detail="Paca no encontrada")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.pacas.update_one({"id": paca_id}, {"$set": update_data})
    return {"message": "Paca actualizada"}

@api_router.delete("/pacas/{paca_id}")
async def delete_paca(paca_id: str, user=Depends(get_current_user)):
    """Delete a paca"""
    if user["role"] not in ["admin", "employee"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    result = await db.pacas.delete_one({"id": paca_id, "tenant_id": user["tenant_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Paca no encontrada")
    return {"message": "Paca eliminada"}


# ==================== ADMIN DATABASE CLEANUP ====================
@api_router.post("/admin/cleanup-database")
async def cleanup_database(user=Depends(get_current_user)):
    """Clean all data except employees, tenants and admin users - ADMIN ONLY"""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden limpiar la base de datos")
    
    tenant_id = user["tenant_id"]
    
    # Collections to clean completely
    collections_to_clean = [
        "invoices",        # Facturas
        "purchases",       # Compras
        "products",        # Productos (legacy)
        "inventory_products",  # Productos de inventario
        "inventory_movements",  # Movimientos de inventario
        "pacas",           # Pacas
        "paca_sales",      # Ventas de pacas
        "wallets",         # Wallets
        "wallet_transactions",  # Transacciones de wallet
        "shipments",       # Envíos
        "lives",           # Lives
        "live_purchases",  # Compras de live
        "referrals",       # Referidos
        "audit_logs",      # Logs de auditoría
        "bank_deposits",   # Depósitos bancarios
    ]
    
    results = {}
    total_deleted = 0
    
    for collection_name in collections_to_clean:
        try:
            collection = db[collection_name]
            result = await collection.delete_many({"tenant_id": tenant_id})
            results[collection_name] = result.deleted_count
            total_deleted += result.deleted_count
        except Exception as e:
            results[collection_name] = f"Error: {str(e)}"
    
    # Clean users BUT preserve admin users (role=admin)
    try:
        users_result = await db.users.delete_many({
            "tenant_id": tenant_id,
            "role": {"$ne": "admin"}  # NO borrar admins
        })
        results["users (clientes)"] = users_result.deleted_count
        total_deleted += users_result.deleted_count
    except Exception as e:
        results["users"] = f"Error: {str(e)}"
    
    # Log the cleanup action
    await log_audit_action(
        tenant_id=tenant_id,
        user_id=user["user_id"],
        user_name=user.get("name", "Admin"),
        user_role=user["role"],
        action="database_cleanup",
        entity_type="system",
        entity_id="cleanup",
        entity_name="Database Cleanup",
        details={"collections_cleaned": list(collections_to_clean), "total_deleted": total_deleted}
    )
    
    return {
        "message": "Base de datos limpiada exitosamente",
        "total_deleted": total_deleted,
        "details": results
    }


app.include_router(api_router)

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
