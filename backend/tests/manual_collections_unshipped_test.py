import os, asyncio, uuid, requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://pdf-horizontal-fix.preview.emergentagent.com/api"
M = "TEST-CU"

async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    c = await db.users.find_one({'tenant_id': tid, 'customer_id': 'M5358'})
    now = datetime.now(timezone.utc); iso = lambda d: d.isoformat()
    d1, d2 = str(uuid.uuid4()), str(uuid.uuid4())
    await db.wallet_transactions.insert_many([
        {'id': d1, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'type': 'deposit', 'amount': 40.0, 'description': M, 'status': 'approved', 'created_at': iso(now - timedelta(hours=3))},
        {'id': d2, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'type': 'deposit', 'amount': 10.0, 'description': M, 'status': 'approved', 'created_at': iso(now - timedelta(hours=1))}])
    await db.invoices.insert_many([
        {'id': M + '-1', 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'invoice_number': M + '-PAID', 'status': 'pending', 'purchase_ids': [], 'total': 40, 'total_a_pagar': 0, 'applied_deposits': [{'deposit_id': d1, 'amount_applied': 40}], 'created_at': iso(now - timedelta(days=2))},
        {'id': M + '-2', 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'invoice_number': M + '-SHIP', 'status': 'pending', 'purchase_ids': [], 'total': 60, 'total_a_pagar': 50, 'applied_deposits': [{'deposit_id': d2, 'amount_applied': 10}], 'created_at': iso(now - timedelta(days=1))}])
    await db.shipments.insert_one({'id': M + '-S', 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'invoice_id': M + '-2', 'shipping_category': 'G', 'package_count': 3,
        'packages': [{'shipping_category': 'G', 'package_count': 2}, {'shipping_category': 'B', 'package_count': 1}], 'shipping_cost': 0, 'created_at': iso(now)})
    tok = requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']
    try:
        d = requests.get(f"{API}/admin/reports/collections", headers={'Authorization': f'Bearer {tok}'}).json()
        print(d['totals'])
        for r in d['clients']:
            print(r['customer_id'], 'paid_wo_ship', r['paid_without_shipment'], r['unshipped_paid_invoices'], '| pkgs', r['packages_total'], r['packages_breakdown'])
    finally:
        if os.environ.get('KEEP') != '1':
            await cleanup(db)

async def cleanup(db):
    await db.wallet_transactions.delete_many({'description': M})
    await db.invoices.delete_many({'id': {'$regex': '^' + M}})
    await db.shipments.delete_many({'id': {'$regex': '^' + M}})

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'cleanup':
        asyncio.run(cleanup(AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]))
    else:
        asyncio.run(main())
