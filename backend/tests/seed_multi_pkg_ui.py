import os, sys, asyncio, uuid
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient

# Seed/cleanup helper for UI testing of multi-package shipments (TEST- prefixed data)
async def main(action):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    client = await db.users.find_one({'tenant_id': tid, 'role': 'client', 'customer_id': 'M5358'}, {'_id': 0})
    if action == 'seed':
        t = await db.tenants.find_one({'id': tid}, {'_id': 0, 'shipping_categories': 1, 'shipping_mode': 1})
        print('tenant', t)
        print('client', client['id'], client.get('name'))
        for n in ['TEST-UI-MULTI', 'TEST-UI-LEGACY']:
            inv_id, pid = "TEST-" + str(uuid.uuid4()), str(uuid.uuid4())
            await db.purchases.insert_one({'id': pid, 'tenant_id': tid, 'user_id': client['id'], 'customer_id': 'M5358', 'live_id': 'x', 'item_name': 'TEST', 'price': 10, 'commission': 0, 'tax': 0, 'total': 10, 'invoice_id': inv_id, 'status': 'confirmed'})
            await db.invoices.insert_one({'id': inv_id, 'tenant_id': tid, 'user_id': client['id'], 'customer_id': 'M5358', 'invoice_number': n, 'status': 'pending', 'purchase_ids': [pid], 'subtotal': 10, 'total_commission': 0, 'total_tax': 0, 'total': 10, 'created_at': '2026-01-01T00:00:00+00:00'})
            print('invoice', n, inv_id)
    elif action == 'show':
        async for inv in db.invoices.find({'invoice_number': {'$in': ['TEST-UI-MULTI', 'TEST-UI-LEGACY']}}, {'_id': 0, 'id': 1, 'invoice_number': 1, 'shipping_cost': 1, 'total': 1, 'shipment_id': 1}):
            print('inv', inv)
            async for s in db.shipments.find({'invoice_id': inv['id']}, {'_id': 0, 'id': 1, 'shipping_cost': 1, 'package_count': 1, 'shipping_category': 1, 'packages': 1}):
                print('  ship', s)
    elif action == 'cleanup':
        ids = [i['id'] async for i in db.invoices.find({'invoice_number': {'$in': ['TEST-UI-MULTI', 'TEST-UI-LEGACY']}}, {'id': 1})]
        sids = [s['id'] async for s in db.shipments.find({'invoice_id': {'$in': ids}}, {'id': 1})]
        print('del ships', (await db.shipments.delete_many({'invoice_id': {'$in': ids}})).deleted_count)
        print('del purch', (await db.purchases.delete_many({'invoice_id': {'$in': ids}})).deleted_count)
        print('del inv', (await db.invoices.delete_many({'id': {'$in': ids}})).deleted_count)
        await db.audit_logs.delete_many({'entity_id': {'$in': ids + sids}})

asyncio.run(main(sys.argv[1]))
