import os, asyncio
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient

# Helper: list recent shipments (created_at, cost, category, packages) for test@preview.com tenant
async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    tid = (await db.users.find_one({'email': 'test@preview.com'}))['tenant_id']
    async for s in db.shipments.find({'tenant_id': tid}, {'_id': 0, 'id': 1, 'created_at': 1, 'customer_id': 1, 'shipping_cost': 1, 'shipping_category': 1, 'package_count': 1, 'packages': 1, 'invoice_id': 1}).sort('created_at', -1).limit(6):
        print(s)

asyncio.run(main())
