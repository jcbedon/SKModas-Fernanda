"""Seed realistic demo data for test@preview.com (PREVIEW ONLY) through the real API.
Run: python3 tests/seed_preview_data.py   (log: /app/test_reports/seed_preview.log)
"""
import os, random, asyncio, requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient

API = "https://pdf-horizontal-fix.preview.emergentagent.com/api"
random.seed(42)
FIRST = ["María", "Karen", "Daniela", "Andrea", "Gabriela", "Paola", "Carla", "Valeria", "Fernanda", "Lucía", "Sofía", "Camila",
         "Jessica", "Diana", "Verónica", "Mónica", "Patricia", "Elena", "Rosa", "Natalia", "Ximena", "Johanna", "Tatiana", "Lorena"]
LAST = ["Chávez", "Jiménez", "Torres", "Vera", "Mendoza", "Zambrano", "Cedeño", "Morales", "Castro", "Ortiz", "Reyes", "Paredes",
        "Salazar", "Cevallos", "Andrade", "Bravo", "Ruiz", "Ponce", "Villacís", "Mora"]
ITEMS = ["Blusa satinada", "Jean skinny", "Vestido floral", "Perfume Victoria's Secret", "Bolso Michael Kors", "Zapatos Nike",
         "Leggings deportivos", "Set de maquillaje", "Crema CeraVe", "Gorra Under Armour", "Camiseta básica", "Pijama de seda",
         "Licra nailon negra", "Truly Coral body scrub", "Tenis Adidas", "Reloj Fossil", "Lentes Ray-Ban", "Mochila Jansport",
         "Sudadera Hollister", "Short de jean", "Body Fajas", "Sandalias", "Billetera Guess", "Juguete Lego"]
LIVES = [("VENTAS FLASH WALMART", "Walmart"), ("LIQUIDACIÓN ROSS", "Ross"), ("MARSHALLS DE NOCHE", "Marshalls"), ("TJ MAXX ESPECIAL", "TJ Maxx")]
BANKS = [
    {"bank_name": "Banco Pichincha", "owner_name": "DANIELA JIMENEZ", "owner_id": "0912345678", "account_number": "2204567891", "account_type": "Ahorros", "currency": "USD"},
    {"bank_name": "Banco Guayaquil", "owner_name": "DIDIER SHOP SA", "owner_id": "0991234567001", "account_number": "0034561278", "account_type": "Corriente", "currency": "USD"},
    {"bank_name": "Produbanco", "owner_name": "KAREN CHAVEZ", "owner_id": "1712345678", "account_number": "12058899443", "account_type": "Ahorros", "currency": "USD"},
]
N_CLIENTS = 40


def log(*a):
    print(*a, flush=True)


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tok = requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']
    S = requests.Session(); S.headers['Authorization'] = f'Bearer {tok}'

    def call(method, path, **kw):
        r = S.request(method, f"{API}{path}", timeout=60, **kw)
        if r.status_code >= 400:
            log("  !!", method, path, r.status_code, r.text[:200])
            return None
        return r.json()

    # 1) Bank accounts (keep existing ones)
    existing = (call("GET", "/admin/bank-accounts") or {}).get("bank_accounts", [])
    have = {a.get("account_number") for a in existing}
    accounts = existing + [b for b in BANKS if b["account_number"] not in have]
    accounts = (call("PUT", "/admin/bank-accounts", json={"bank_accounts": accounts}) or {}).get("bank_accounts", existing)
    acct_ids = [a["id"] for a in accounts if a.get("is_active", True)]
    log("bank accounts:", len(acct_ids))

    # 2) Clients
    clients = []
    used = set()
    for i in range(N_CLIENTS):
        while True:
            name = f"{random.choice(FIRST)} {random.choice(LAST)}"
            if name not in used:
                used.add(name); break
        phone = f"+5939{random.randint(10000000, 99999999)}"
        r = call("POST", "/admin/clients/create", json={"name": name, "country": "Ecuador", "whatsapp": phone, "commission_fee": 0})
        if r:
            clients.append({"user_id": r["user_id"], "customer_id": r["customer_id"], "name": name})
    log("clients:", len(clients))

    # 3) Lives + purchases
    lives = []
    for j, (title, store) in enumerate(LIVES):
        day = (datetime.now() - timedelta(days=8 - j * 2)).strftime("%d/%m/%Y")
        lv = call("POST", "/lives", json={"title": f"{title} {day}", "store": store, "apply_tax": False})
        if not lv:
            continue
        live_id = lv["live_id"]
        call("POST", f"/lives/{live_id}/start", json={})
        lives.append({"id": live_id, "store": store})
    log("lives:", len(lives))

    purchases = {c["customer_id"]: [] for c in clients}
    for c in clients[:36]:  # last 4 clients only recharge (saldo a favor)
        for _ in range(random.randint(3, 10)):
            lv = random.choice(lives)
            commission = random.choice([0, 0, 1, 1.5, 2, 3])
            p = call("POST", "/purchases", json={
                "customer_id": c["customer_id"], "item_name": random.choice(ITEMS), "store": lv["store"],
                "price": round(random.uniform(5, 45), 2), "live_id": lv["id"], "apply_tax": False, "tax_rate": 0,
                "apply_commission": commission > 0, "commission_amount": commission})
            if p:
                purchases[c["customer_id"]].append(p["purchase_id"])
    log("purchases:", sum(len(v) for v in purchases.values()))
    # manual commission on one Live Shopping live
    if lives:
        call("PUT", f"/lives/{lives[0]['id']}/manual-commission", json={"manual_commission": 35, "note": "Comisión acordada con tienda"})
    for lv in lives[:-1]:
        call("POST", f"/lives/{lv['id']}/end", json={})

    # 4) Invoices for the first 32 clients (4 keep purchases "por facturar")
    invoices = {}
    for c in clients[:32]:
        ids = [x for x in purchases[c["customer_id"]] if x]
        r = call("POST", "/invoices", json={"customer_id": c["customer_id"], "purchase_ids": ids})
        if r:
            invoices[c["customer_id"]] = r["invoice_id"]
    log("invoices:", len(invoices))

    # 5) Recargas: profiles -> paid in full / partial / none / saldo a favor / pending
    async def recharge(c, amount, days_ago, approve=True):
        r = call("POST", "/wallet/deposit-request", json={"user_id": c["user_id"], "amount": amount, "description": "Recarga transferencia"})
        if not r:
            return
        tx = r["transaction_id"]
        when = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0, 10))
        await db.wallet_transactions.update_one({"id": tx}, {"$set": {
            "created_at": when.isoformat(), "bank_account_id": random.choice(acct_ids) if acct_ids else None,
            "reference_number": f"W{random.randint(10000000, 99999999)}"}})
        if approve:
            call("POST", f"/wallet/approve-deposit/{tx}")

    invoiced = list(invoices.keys())
    paid_full, partial, none_ = invoiced[:12], invoiced[12:24], invoiced[24:]
    by_cid = {c["customer_id"]: c for c in clients}
    for cid in paid_full + partial:
        inv = call("GET", f"/invoices/{invoices[cid]}")
        total = float((inv or {}).get("total_a_pagar") or (inv or {}).get("total") or 0)
        target = total if cid in paid_full else round(total * random.uniform(0.3, 0.7), 2)
        parts = 1 if target < 30 else random.randint(2, 3)
        for k in range(parts):
            await recharge(by_cid[cid], round(target / parts, 2) + (0.01 if cid in paid_full and k == parts - 1 else 0), random.randint(0, 9))
    for c in clients[36:]:
        await recharge(c, round(random.uniform(20, 80), 2), random.randint(0, 6))
    for cid in none_[:3]:
        await recharge(by_cid[cid], round(random.uniform(10, 40), 2), 0, approve=False)  # pending to approve
    log("recargas done")

    # 6) Shipments with mixed categories (leave 4 paid clients without shipment)
    for cid in paid_full[:8] + partial[:5]:
        cats = random.sample(["G", "A", "B"], random.randint(1, 2))
        pkgs = [{"shipping_category": k, "package_count": random.randint(1, 3)} for k in cats]
        call("POST", "/shipments", json={
            "user_id": by_cid[cid]["user_id"], "purchase_ids": [x for x in purchases[cid] if x], "invoice_id": invoices[cid],
            "shipping_category": pkgs[0]["shipping_category"], "package_count": sum(p["package_count"] for p in pkgs),
            "packages": pkgs, "address": "Av. 9 de Octubre y Malecón, Guayaquil", "country": "Ecuador", "phone": "+593999000111"})
    log("shipments done")
    log("SEED COMPLETE")

asyncio.run(main())
