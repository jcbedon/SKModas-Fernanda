import os, asyncio, uuid, requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://personal-shopper-13.preview.emergentagent.com/api"

async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    c = await db.users.find_one({'tenant_id': tid, 'role': 'client', 'customer_id': 'M5358'}, {'_id': 0})
    inv_id = "TEST-LF-" + str(uuid.uuid4())
    await db.invoices.insert_one({'id': inv_id, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'invoice_number': 'TEST-LATEFEE', 'status': 'pending',
        'purchase_ids': [], 'subtotal': 50, 'total': 50, 'total_a_pagar': 50, 'created_at': (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()})
    h = {'Authorization': 'Bearer ' + requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']}
    get = lambda: requests.get(f"{API}/invoices/{inv_id}", headers=h).json()
    try:
        r = requests.put(f"{API}/invoices/{inv_id}/late-fee", headers=h, json={'enabled': True})
        print('enable w/o amount (no shipment category):', r.status_code, r.json().get('detail'))
        r = requests.put(f"{API}/invoices/{inv_id}/late-fee", headers=h, json={'enabled': True, 'amount': 5})
        d = get(); print('enabled 5:', r.status_code, d['late_fee_applied'], d['late_fee_amount'], 'total_a_pagar', d['total_a_pagar'])
        r = requests.put(f"{API}/invoices/{inv_id}/late-fee", headers=h, json={'enabled': True, 'amount': 7.5})
        d = get(); print('amount 7.5:', d['late_fee_amount'], 'total_a_pagar', d['total_a_pagar'])
        r = requests.put(f"{API}/invoices/{inv_id}/late-fee", headers=h, json={'enabled': False})
        d = get(); print('disabled:', d['late_fee_applied'], 'manual', d.get('late_fee_manual'), 'total_a_pagar', d['total_a_pagar'])
        log = await db.audit_logs.count_documents({'entity_id': inv_id, 'action': 'invoice_late_fee_toggled'})
        print('audit entries:', log)
    finally:
        await db.invoices.delete_one({'id': inv_id})
        await db.audit_logs.delete_many({'entity_id': inv_id})
        await db.invoices.update_many({'tenant_id': tid, 'customer_id': 'M5358'}, {'$set': {}}) if False else None

asyncio.run(main())
