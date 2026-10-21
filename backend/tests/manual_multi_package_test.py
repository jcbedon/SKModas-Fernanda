import os, asyncio, uuid, requests
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://personal-shopper-13.preview.emergentagent.com/api"

async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    tenant = await db.tenants.find_one({'id': tid}, {'_id': 0, 'shipping_categories': 1, 'shipping_mode': 1})
    print('tenant mode', tenant.get('shipping_mode'), [(c['key'], c.get('value_packages'), c.get('value')) for c in tenant.get('shipping_categories') or []])
    client = await db.users.find_one({'tenant_id': tid, 'role': 'client', 'customer_id': 'M5358'}, {'_id': 0})
    inv_id, pid = "TEST-" + str(uuid.uuid4()), str(uuid.uuid4())
    await db.purchases.insert_one({'id': pid, 'tenant_id': tid, 'user_id': client['id'], 'customer_id': 'M5358', 'live_id': 'x', 'item_name': 'TEST', 'price': 10, 'commission': 0, 'tax': 0, 'total': 10, 'invoice_id': inv_id, 'status': 'confirmed'})
    await db.invoices.insert_one({'id': inv_id, 'tenant_id': tid, 'user_id': client['id'], 'customer_id': 'M5358', 'invoice_number': 'TEST-SHIP', 'status': 'pending', 'purchase_ids': [pid], 'subtotal': 10, 'total_commission': 0, 'total_tax': 0, 'total': 10, 'created_at': '2020-01-01T00:00:00+00:00'})
    h = {'Authorization': 'Bearer ' + requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']}
    ship_id = None
    try:
        r = requests.post(f"{API}/shipments", headers=h, json={
            'user_id': client['id'], 'purchase_ids': [pid], 'invoice_id': inv_id, 'shipping_category': 'G', 'package_count': 3, 'shipping_cost': 96,
            'packages': [{'shipping_category': 'G', 'package_count': 1, 'cost': 32, 'unit_cost': 32}, {'shipping_category': 'B', 'package_count': 2, 'cost': 64, 'unit_cost': 32}]})
        print('create', r.status_code, r.text[:200])
        ship_id = r.json().get('shipment_id')
        s = await db.shipments.find_one({'id': ship_id}, {'_id': 0, 'shipping_cost': 1, 'package_count': 1, 'packages': 1})
        inv = await db.invoices.find_one({'id': inv_id}, {'_id': 0, 'shipping_cost': 1})
        print('created shipment', s, 'invoice shipping', inv)
        r = requests.put(f"{API}/shipments/{ship_id}", headers=h, json={'shipping_cost': 96, 'shipping_category': 'G', 'package_count': 3,
            'packages': [{'shipping_category': 'A', 'package_count': 2}, {'shipping_category': 'B', 'package_count': 1}]})
        print('update', r.status_code)
        s = await db.shipments.find_one({'id': ship_id}, {'_id': 0, 'shipping_cost': 1, 'package_count': 1, 'packages': 1})
        inv = await db.invoices.find_one({'id': inv_id}, {'_id': 0, 'shipping_cost': 1})
        print('updated shipment', s, 'invoice shipping', inv)
        r = requests.put(f"{API}/shipments/{ship_id}", headers=h, json={'tracking_numbers': ['ABC123']})
        s = await db.shipments.find_one({'id': ship_id}, {'_id': 0, 'shipping_cost': 1})
        print('after tracking-only edit', r.status_code, s)
    finally:
        await db.shipments.delete_many({'invoice_id': inv_id})
        await db.purchases.delete_one({'id': pid})
        await db.invoices.delete_one({'id': inv_id})
        await db.audit_logs.delete_many({'entity_id': {'$in': [inv_id, ship_id]}})

asyncio.run(main())
