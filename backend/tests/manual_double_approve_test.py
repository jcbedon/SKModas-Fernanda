import os, asyncio, uuid, aiohttp, requests
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://personal-shopper-13.preview.emergentagent.com/api"

async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    tenant = await db.tenants.find_one({'id': tid}, {'bank_accounts': 1})
    accts = [a for a in tenant.get('bank_accounts') or [] if a.get('is_active', True)]
    print('accounts:', len(accts))
    c = await db.users.find_one({'tenant_id': tid, 'customer_id': 'M5358'})
    w0 = (await db.wallets.find_one({'user_id': c['id'], 'tenant_id': tid}))['available']
    txid = 'TEST-DBL-' + str(uuid.uuid4())
    await db.wallet_transactions.insert_one({'id': txid, 'tenant_id': tid, 'user_id': c['id'], 'customer_id': 'M5358', 'type': 'deposit', 'amount': 130.0, 'balance_after': 0, 'description': 'TEST double approve', 'status': 'pending', 'bank_account_id': accts[0]['id'] if accts else None, 'reference_number': 'TESTREF', 'created_at': datetime.now(timezone.utc).isoformat()})
    tok = requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']
    try:
        async with aiohttp.ClientSession(headers={'Authorization': f'Bearer {tok}'}) as s:
            async def hit():
                async with s.post(f"{API}/wallet/approve-deposit/{txid}") as r:
                    return r.status
            codes = await asyncio.gather(*[hit() for _ in range(4)])
        print('4 parallel approvals ->', sorted(codes))
        rows = await db.bank_transactions.count_documents({'tenant_id': tid, 'source_transaction_id': txid, 'is_deleted': {'$ne': True}})
        w1 = (await db.wallets.find_one({'user_id': c['id'], 'tenant_id': tid}))['available']
        print('ledger rows:', rows, '| wallet delta:', round(w1 - w0, 2))
        # seed a duplicate, then detect + fix
        if accts:
            await db.bank_transactions.insert_one({'id': 'TEST-DUP-ROW', 'tenant_id': tid, 'bank_account_id': accts[0]['id'], 'kind': 'recharge', 'amount': 130.0, 'source_transaction_id': txid, 'customer_id': 'M5358', 'customer_name': 'Maria', 'reference_number': 'TESTREF', 'created_at': datetime.now(timezone.utc).isoformat()})
            h = {'Authorization': f'Bearer {tok}'}
            d = requests.get(f"{API}/admin/bank-accounts/duplicate-recharges", headers=h).json()
            print('detected:', len(d['duplicates']), 'extra', d['total_extra'])
            f = requests.post(f"{API}/admin/bank-accounts/duplicate-recharges/fix", headers=h).json()
            print('fix:', f)
            rows = await db.bank_transactions.count_documents({'tenant_id': tid, 'source_transaction_id': txid, 'is_deleted': {'$ne': True}})
            print('active ledger rows after fix:', rows)
    finally:
        await db.wallet_transactions.delete_one({'id': txid})
        await db.bank_transactions.delete_many({'source_transaction_id': txid})
        await db.wallets.update_one({'user_id': c['id'], 'tenant_id': tid}, {'$set': {'available': w0}})
        await db.notifications.delete_many({'message': {'$regex': '130.00 USD'}, 'tenant_id': tid}) if False else None
        await db.audit_logs.delete_many({'tenant_id': tid, '$or': [{'entity_id': txid}, {'action': 'bank_duplicates_fixed'}]})
        await db.invoices.update_many({}, {'$pull': {'applied_deposits': {'deposit_id': txid}}})

asyncio.run(main())
