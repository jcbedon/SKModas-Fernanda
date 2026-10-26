import os, sys, asyncio, uuid, json, requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://pdf-horizontal-fix.preview.emergentagent.com/api"
MARK = "TEST-COLLECT"

async def main(action):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    if action == "cleanup":
        await db.invoices.delete_many({'invoice_number': {'$regex': MARK}})
        await db.wallet_transactions.delete_many({'description': MARK})
        print("cleaned"); return
    clients = await db.users.find({'tenant_id': tid, 'role': 'client', 'customer_id': {'$regex': '^.{1,8}$'}}, {'_id': 0}).limit(2).to_list(2)
    now = datetime.now(timezone.utc)
    iso = lambda d: d.isoformat()
    for i, c in enumerate(clients):
        dep1, dep2 = str(uuid.uuid4()), str(uuid.uuid4())
        await db.wallet_transactions.insert_many([
            {'id': dep1, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': c['customer_id'], 'type': 'deposit', 'amount': 20.0, 'balance_after': 0, 'description': MARK, 'status': 'approved', 'created_at': iso(now - timedelta(hours=5 + i))},
            {'id': dep2, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': c['customer_id'], 'type': 'deposit', 'amount': 15.0, 'balance_after': 0, 'description': MARK, 'status': 'approved', 'created_at': iso(now - timedelta(hours=1 + i * 3))},
        ])
        await db.invoices.insert_one({'id': str(uuid.uuid4()), 'tenant_id': tid, 'user_id': c['id'], 'customer_id': c['customer_id'], 'invoice_number': f'{MARK}-{i}', 'status': 'pending',
            'purchase_ids': [], 'subtotal': 100 if i == 0 else 35, 'total': 100 if i == 0 else 35, 'total_a_pagar': 65 if i == 0 else 0, 'saldo_a_favor': 0,
            'applied_deposits': [{'deposit_id': dep1, 'amount_applied': 20}, {'deposit_id': dep2, 'amount_applied': 15}], 'deposits_applied': 35,
            'created_at': iso(now + timedelta(days=1))})  # newest invoice for that client
        # make it "issued" before the deposits
        await db.invoices.update_one({'invoice_number': f'{MARK}-{i}'}, {'$set': {'created_at': iso(now - timedelta(days=1))}})
        print('seeded', c['customer_id'], 'owes' if i == 0 else 'paid off')
    tok = requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']
    d = requests.get(f"{API}/admin/reports/collections", headers={'Authorization': f'Bearer {tok}'}).json()
    print(json.dumps(d['totals']))
    for r in d['clients']:
        print(r['customer_id'], r['remaining'], r['is_paid'], r['paid_in_period'], r['payments_count'], r['last_payment_at'])

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "seed"))
