import os, asyncio, uuid, requests, copy
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://pdf-horizontal-fix.preview.emergentagent.com/api"

async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    tenant = await db.tenants.find_one({'id': tid})
    orig = copy.deepcopy(tenant.get('shipping_categories'))
    cats = copy.deepcopy(orig)
    for c in cats:
        c['late_fee'] = {'G': 5, 'B': 10}.get(c['key'], 0)
    await db.tenants.update_one({'id': tid}, {'$set': {'shipping_categories': cats}})
    c = await db.users.find_one({'tenant_id': tid, 'customer_id': 'M5358'})
    inv = 'TEST-LFP'
    await db.invoices.insert_one({'id': inv, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'invoice_number': inv, 'status': 'pending', 'purchase_ids': [], 'subtotal': 50, 'total': 50, 'total_a_pagar': 50, 'created_at': datetime.now(timezone.utc).isoformat()})
    await db.shipments.insert_one({'id': 'TEST-LFP-S', 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'invoice_id': inv, 'shipping_category': 'G', 'package_count': 3, 'shipping_cost': 0,
        'packages': [{'shipping_category': 'G', 'package_count': 2, 'unit_cost': 0, 'cost': 0}, {'shipping_category': 'B', 'package_count': 1, 'unit_cost': 0, 'cost': 0}], 'created_at': datetime.now(timezone.utc).isoformat()})
    h = {'Authorization': 'Bearer ' + requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']}
    try:
        r = requests.put(f"{API}/invoices/{inv}/late-fee", headers=h, json={'enabled': True}).json()['invoice']
        print('G×2 + B×1 fee (expect 20):', r['late_fee_amount'], r.get('late_fee_category'), 'total_a_pagar', r['total_a_pagar'])
    finally:
        await db.tenants.update_one({'id': tid}, {'$set': {'shipping_categories': orig}})
        await db.invoices.delete_one({'id': inv}); await db.shipments.delete_one({'id': 'TEST-LFP-S'}); await db.audit_logs.delete_many({'entity_id': inv})

asyncio.run(main())
