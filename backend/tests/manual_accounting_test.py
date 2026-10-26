import os, asyncio, requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
API = "https://personal-shopper-13.preview.emergentagent.com/api"

async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    h = {'Authorization': 'Bearer ' + requests.post(f"{API}/auth/login", json={'identifier': 'test@preview.com', 'password': 'test123'}).json()['token']}
    await db.tenants.update_one({'id': tid}, {'$set': {'accounting_enabled': False}})
    print('disabled ->', requests.get(f"{API}/accounting/categories", headers=h).status_code, '| me flag', requests.get(f"{API}/auth/me", headers=h).json().get('accounting_enabled'))
    await db.tenants.update_one({'id': tid}, {'$set': {'accounting_enabled': True}})
    cats = requests.get(f"{API}/accounting/categories", headers=h).json()['categories']
    acct = requests.get(f"{API}/admin/bank-accounts", headers=h).json()['bank_accounts'][0]
    today = datetime.now().strftime('%Y-%m-%d')
    def bal():
        s = requests.get(f"{API}/admin/bank-accounts/summary", headers=h).json()
        a = next((x for x in s.get('accounts', []) if x.get('id') == acct['id']), {})
        return a.get('balance')
    b0 = bal()
    r = requests.post(f"{API}/accounting/expenses", headers=h, data={'amount': '45.50', 'category': cats[0]['key'], 'date': today, 'description': 'TEST sueldo', 'bank_account_id': acct['id']},
                      files={'receipt': ('r.png', b'\x89PNG\r\n\x1a\n' + b'0' * 50, 'image/png')})
    e = r.json().get('expense', {}); print('create', r.status_code, e.get('amount'), 'receipt', bool(e.get('receipt_url')))
    print('bank balance', b0, '->', bal())
    rr = requests.get(f"{API}{e['receipt_url'][4:]}", headers=h); print('receipt fetch', rr.status_code)
    r = requests.put(f"{API}/accounting/expenses/{e['id']}", headers=h, json={'amount': 60}); print('update', r.status_code, 'bank ->', bal())
    now = datetime.now(timezone.utc)
    s = requests.get(f"{API}/accounting/summary", headers=h, params={'start': (now - timedelta(days=30)).isoformat(), 'end': now.isoformat(), 'start_day': (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d'), 'end_day': today, 'bucket': 'day', 'tz_offset_minutes': 300}).json()
    print('summary income', s['income'], 'expenses', s['expenses_total'], 'net', s['net'], 'buckets', len(s['series']), s['by_category'])
    r = requests.delete(f"{API}/accounting/expenses/{e['id']}", headers=h); print('delete', r.status_code, 'bank ->', bal())
    r = requests.post(f"{API}/accounting/expenses", headers=h, data={'amount': '-5', 'category': cats[0]['key'], 'date': today}); print('negative ->', r.status_code)
    r = requests.post(f"{API}/accounting/expenses", headers=h, data={'amount': '5', 'category': 'nope', 'date': today}); print('bad cat ->', r.status_code)
    await db.expenses.delete_many({'tenant_id': tid, 'description': 'TEST sueldo'})
    await db.bank_transactions.delete_many({'tenant_id': tid, 'source_expense_id': e['id']})
    await db.tenants.update_one({'id': tid}, {'$set': {'accounting_enabled': os.environ.get('LEAVE_ON') == '1'}})

asyncio.run(main())
